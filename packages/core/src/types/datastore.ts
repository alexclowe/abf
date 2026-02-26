/**
 * Datastore types — config-driven business database for agent use.
 */

import type { ABFError, Result } from './errors.js';

export type DatastoreBackend = 'sqlite' | 'postgres';

export interface DatastoreConfig {
	readonly backend: DatastoreBackend;
	readonly connectionString?: string;
	readonly sqlitePath?: string;
	readonly schemasDir?: string;
	readonly migrationsDir?: string;
}

export interface DatastoreQueryResult {
	readonly rows: readonly Record<string, unknown>[];
	readonly rowCount: number;
}

export interface DatastoreWriteResult {
	readonly rowsAffected: number;
}

export interface DatastoreSchemaColumn {
	readonly name: string;
	readonly type: string;
	readonly primaryKey?: boolean;
	readonly notNull?: boolean;
	readonly unique?: boolean;
	readonly default?: string;
	readonly references?: string;
}

export interface DatastoreSchema {
	readonly name: string;
	readonly columns: readonly DatastoreSchemaColumn[];
}

export interface IDatastore {
	/** Initialize the datastore (create connection, run setup). */
	initialize(): Promise<Result<void, ABFError>>;

	/** Apply schema definitions (CREATE TABLE IF NOT EXISTS). */
	applySchemas(schemas: readonly DatastoreSchema[]): Promise<Result<void, ABFError>>;

	/** Run a read-only query (SELECT). */
	query(sql: string, params?: readonly unknown[]): Promise<Result<DatastoreQueryResult, ABFError>>;

	/** Run a write query (INSERT/UPDATE/DELETE — no DROP/ALTER). */
	write(sql: string, params?: readonly unknown[]): Promise<Result<DatastoreWriteResult, ABFError>>;

	/** Run a raw migration SQL. */
	migrate(sql: string): Promise<Result<void, ABFError>>;

	/** Close the datastore connection. */
	close(): Promise<void>;
}
