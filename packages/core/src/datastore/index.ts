/**
 * Datastore — barrel export + factory function.
 */

export { SQLiteDatastore } from './sqlite.store.js';
export { PostgresDatastore } from './postgres.store.js';
export { loadDatastoreSchemas, schemaToDDL } from './schema-loader.js';
export { loadMigrationFiles, runMigrations } from './migration-runner.js';

import type { DatastoreConfig, IDatastore } from '../types/datastore.js';
import { SQLiteDatastore } from './sqlite.store.js';
import { PostgresDatastore } from './postgres.store.js';

/**
 * Create a datastore from config. Returns null if no datastore is configured.
 */
export function createDatastore(config: DatastoreConfig): IDatastore {
	if (config.backend === 'sqlite') {
		return new SQLiteDatastore(config.sqlitePath ?? 'data.db');
	}
	if (config.backend === 'postgres') {
		if (!config.connectionString) {
			throw new Error('Postgres datastore requires connection_string');
		}
		return new PostgresDatastore(config.connectionString);
	}
	throw new Error(`Unknown datastore backend: ${config.backend}`);
}
