/**
 * SQLiteDatastore — better-sqlite3 implementation of IDatastore.
 * Used for local development and small deployments.
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

export class SQLiteDatastore implements IDatastore {
	private db: import('better-sqlite3').Database | null = null;

	constructor(private readonly dbPath: string) {}

	async initialize(): Promise<Result<void, ABFError>> {
		try {
			// better-sqlite3 exports the constructor as default (CJS compat)
			const mod = await import('better-sqlite3');
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const Database = (mod as any).default ?? mod;
			this.db = new Database(this.dbPath);
			this.db!.pragma('journal_mode = WAL');
			return Ok(undefined);
		} catch (e) {
			return Err(
				new ABFErrorClass(
					'RUNTIME_ERROR',
					`SQLite init failed: ${e instanceof Error ? e.message : String(e)}`,
				),
			);
		}
	}

	async applySchemas(schemas: readonly DatastoreSchema[]): Promise<Result<void, ABFError>> {
		if (!this.db) return Err(new ABFErrorClass('RUNTIME_ERROR', 'SQLite not initialized'));
		try {
			for (const schema of schemas) {
				this.db.exec(schemaToDDL(schema));
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
		if (!this.db) return Err(new ABFErrorClass('RUNTIME_ERROR', 'SQLite not initialized'));
		try {
			const stmt = this.db.prepare(sql);
			const rows = params ? stmt.all(...params) : stmt.all();
			return Ok({
				rows: rows as Record<string, unknown>[],
				rowCount: rows.length,
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
		if (!this.db) return Err(new ABFErrorClass('RUNTIME_ERROR', 'SQLite not initialized'));

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
			const stmt = this.db.prepare(sql);
			const result = params ? stmt.run(...params) : stmt.run();
			return Ok({ rowsAffected: result.changes });
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
		if (!this.db) return Err(new ABFErrorClass('RUNTIME_ERROR', 'SQLite not initialized'));
		try {
			this.db.exec(sql);
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
		this.db?.close();
		this.db = null;
	}
}
