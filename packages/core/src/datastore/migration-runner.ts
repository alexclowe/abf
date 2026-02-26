/**
 * Migration runner — applies numbered *.sql migration files in order.
 * Tracks applied migrations in a _migrations table.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IDatastore } from '../types/datastore.js';

export interface MigrationFile {
	readonly version: string;
	readonly name: string;
	readonly sql: string;
}

/**
 * Load all *.sql migration files from a directory, sorted by filename.
 */
export function loadMigrationFiles(dir: string): MigrationFile[] {
	let files: string[];
	try {
		files = readdirSync(dir)
			.filter((f) => f.endsWith('.sql'))
			.sort();
	} catch {
		return [];
	}

	return files.map((f) => ({
		version: f.replace('.sql', ''),
		name: f,
		sql: readFileSync(join(dir, f), 'utf-8'),
	}));
}

/**
 * Run all pending migrations against the datastore.
 */
export async function runMigrations(
	datastore: IDatastore,
	migrations: readonly MigrationFile[],
): Promise<{ applied: string[]; skipped: string[] }> {
	// Ensure migrations tracking table exists
	await datastore.migrate(
		`CREATE TABLE IF NOT EXISTS _migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`,
	);

	// Get already-applied versions
	const result = await datastore.query('SELECT version FROM _migrations ORDER BY version');
	const appliedSet = new Set(
		result.ok ? result.value.rows.map((r) => String(r['version'])) : [],
	);

	const applied: string[] = [];
	const skipped: string[] = [];

	for (const migration of migrations) {
		if (appliedSet.has(migration.version)) {
			skipped.push(migration.version);
			continue;
		}

		const migrateResult = await datastore.migrate(migration.sql);
		if (!migrateResult.ok) {
			throw new Error(
				`Migration ${migration.version} failed: ${migrateResult.error.message}`,
			);
		}

		// Record as applied
		await datastore.write(
			'INSERT INTO _migrations (version) VALUES ($1)',
			[migration.version],
		);
		applied.push(migration.version);
	}

	return { applied, skipped };
}
