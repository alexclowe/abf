/**
 * PostgresDatastore — pg implementation of IDatastore.
 * Used for production deployments.
 */

import type { ABFError, Result } from '../types/errors.js';
import { ABFError as ABFErrorClass, Ok, Err } from '../types/errors.js';
import type {
	DatastoreQueryResult,
	DatastoreSchema,
	DatastoreWriteResult,
	IDatastore,
} from '../types/datastore.js';
import { schemaToDDL } from './schema-loader.js';

// Forbidden SQL patterns for write operations
const FORBIDDEN_WRITE_PATTERNS = /^\s*(DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\s/i;

export class PostgresDatastore implements IDatastore {
	private pool: import('pg').Pool | null = null;

	constructor(private readonly connectionString: string) {}

	async initialize(): Promise<Result<void, ABFError>> {
		try {
			const { Pool } = await import('pg');
			this.pool = new Pool({ connectionString: this.connectionString });
			// Test connection
			const client = await this.pool.connect();
			client.release();
			return Ok(undefined);
		} catch (e) {
			return Err(
				new ABFErrorClass(
					'RUNTIME_ERROR',
					`Postgres init failed: ${e instanceof Error ? e.message : String(e)}`,
				),
			);
		}
	}

	async applySchemas(schemas: readonly DatastoreSchema[]): Promise<Result<void, ABFError>> {
		if (!this.pool) return Err(new ABFErrorClass('RUNTIME_ERROR', 'Postgres not initialized'));
		try {
			for (const schema of schemas) {
				await this.pool.query(schemaToDDL(schema));
			}
			return Ok(undefined);
		} catch (e) {
			return Err(
				new ABFErrorClass(
					'RUNTIME_ERROR',
					`Schema apply failed: ${e instanceof Error ? e.message : String(e)}`,
				),
			);
		}
	}

	async query(
		sql: string,
		params?: readonly unknown[],
	): Promise<Result<DatastoreQueryResult, ABFError>> {
		if (!this.pool) return Err(new ABFErrorClass('RUNTIME_ERROR', 'Postgres not initialized'));
		try {
			const result = await this.pool.query(sql, params as unknown[]);
			return Ok({
				rows: result.rows as Record<string, unknown>[],
				rowCount: result.rowCount ?? result.rows.length,
			});
		} catch (e) {
			return Err(
				new ABFErrorClass(
					'RUNTIME_ERROR',
					`Query failed: ${e instanceof Error ? e.message : String(e)}`,
				),
			);
		}
	}

	async write(
		sql: string,
		params?: readonly unknown[],
	): Promise<Result<DatastoreWriteResult, ABFError>> {
		if (!this.pool) return Err(new ABFErrorClass('RUNTIME_ERROR', 'Postgres not initialized'));

		// Security: block DROP, ALTER, TRUNCATE, etc.
		if (FORBIDDEN_WRITE_PATTERNS.test(sql)) {
			return Err(
				new ABFErrorClass(
					'RUNTIME_ERROR',
					'Forbidden SQL operation. Only INSERT, UPDATE, DELETE are allowed.',
				),
			);
		}

		try {
			const result = await this.pool.query(sql, params as unknown[]);
			return Ok({ rowsAffected: result.rowCount ?? 0 });
		} catch (e) {
			return Err(
				new ABFErrorClass(
					'RUNTIME_ERROR',
					`Write failed: ${e instanceof Error ? e.message : String(e)}`,
				),
			);
		}
	}

	async migrate(sql: string): Promise<Result<void, ABFError>> {
		if (!this.pool) return Err(new ABFErrorClass('RUNTIME_ERROR', 'Postgres not initialized'));
		try {
			await this.pool.query(sql);
			return Ok(undefined);
		} catch (e) {
			return Err(
				new ABFErrorClass(
					'RUNTIME_ERROR',
					`Migration failed: ${e instanceof Error ? e.message : String(e)}`,
				),
			);
		}
	}

	async close(): Promise<void> {
		await this.pool?.end();
		this.pool = null;
	}
}
