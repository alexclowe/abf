import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadMigrationFiles, runMigrations } from './migration-runner.js';
import type { IDatastore } from '../types/datastore.js';
import type { Result } from '../types/errors.js';
import type {
	DatastoreQueryResult,
	DatastoreWriteResult,
} from '../types/datastore.js';
import type { ABFError } from '../types/errors.js';

/**
 * Creates a mock IDatastore with vi.fn() for all methods.
 * By default: query returns empty rows, write/migrate succeed.
 */
function createMockDatastore(overrides?: Partial<{
	queryRows: Record<string, unknown>[];
}>): IDatastore & {
	initialize: ReturnType<typeof vi.fn>;
	applySchemas: ReturnType<typeof vi.fn>;
	query: ReturnType<typeof vi.fn>;
	write: ReturnType<typeof vi.fn>;
	migrate: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
} {
	const queryRows = overrides?.queryRows ?? [];

	return {
		initialize: vi.fn(async () => ({ ok: true, value: undefined }) as Result<void, ABFError>),
		applySchemas: vi.fn(async () => ({ ok: true, value: undefined }) as Result<void, ABFError>),
		query: vi.fn(async () => ({
			ok: true,
			value: { rows: queryRows, rowCount: queryRows.length },
		}) as Result<DatastoreQueryResult, ABFError>),
		write: vi.fn(async () => ({
			ok: true,
			value: { rowsAffected: 1 },
		}) as Result<DatastoreWriteResult, ABFError>),
		migrate: vi.fn(async () => ({ ok: true, value: undefined }) as Result<void, ABFError>),
		close: vi.fn(async () => {}),
	};
}

describe('Migration Runner', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'abf-migration-test-'));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe('loadMigrationFiles', () => {
		it('loads .sql files sorted by filename', async () => {
			await writeFile(join(tempDir, '002_add_index.sql'), 'CREATE INDEX idx ON t(c);', 'utf-8');
			await writeFile(join(tempDir, '001_create_table.sql'), 'CREATE TABLE t (id INT);', 'utf-8');
			await writeFile(join(tempDir, '003_seed.sql'), "INSERT INTO t VALUES (1);", 'utf-8');

			const files = loadMigrationFiles(tempDir);

			expect(files).toHaveLength(3);
			expect(files[0].version).toBe('001_create_table');
			expect(files[1].version).toBe('002_add_index');
			expect(files[2].version).toBe('003_seed');
			expect(files[0].sql).toBe('CREATE TABLE t (id INT);');
			expect(files[0].name).toBe('001_create_table.sql');
		});

		it('returns empty array for non-existent directory', () => {
			const files = loadMigrationFiles(join(tempDir, 'does-not-exist'));
			expect(files).toEqual([]);
		});

		it('returns empty array for directory with no .sql files', async () => {
			await writeFile(join(tempDir, 'readme.md'), '# Migrations', 'utf-8');

			const files = loadMigrationFiles(tempDir);
			expect(files).toEqual([]);
		});
	});

	describe('runMigrations', () => {
		it('creates the _migrations tracking table', async () => {
			const ds = createMockDatastore();
			await runMigrations(ds, []);

			expect(ds.migrate).toHaveBeenCalledTimes(1);
			const createTableSQL = ds.migrate.mock.calls[0][0] as string;
			expect(createTableSQL).toContain('CREATE TABLE IF NOT EXISTS _migrations');
			expect(createTableSQL).toContain('version TEXT PRIMARY KEY');
		});

		it('applies pending migrations', async () => {
			const ds = createMockDatastore();

			const migrations = [
				{ version: '001_init', name: '001_init.sql', sql: 'CREATE TABLE t (id INT);' },
				{ version: '002_data', name: '002_data.sql', sql: "INSERT INTO t VALUES (1);" },
			];

			const result = await runMigrations(ds, migrations);

			expect(result.applied).toEqual(['001_init', '002_data']);
			expect(result.skipped).toEqual([]);

			// migrate called: 1 for _migrations table + 2 for each migration
			expect(ds.migrate).toHaveBeenCalledTimes(3);
			expect(ds.migrate).toHaveBeenCalledWith('CREATE TABLE t (id INT);');
			expect(ds.migrate).toHaveBeenCalledWith("INSERT INTO t VALUES (1);");

			// write called once per applied migration to record version
			expect(ds.write).toHaveBeenCalledTimes(2);
			expect(ds.write).toHaveBeenCalledWith(
				'INSERT INTO _migrations (version) VALUES ($1)',
				['001_init'],
			);
			expect(ds.write).toHaveBeenCalledWith(
				'INSERT INTO _migrations (version) VALUES ($1)',
				['002_data'],
			);
		});

		it('skips already-applied migrations', async () => {
			// Simulate that 001 and 002 are already applied
			const ds = createMockDatastore({
				queryRows: [{ version: '001_init' }, { version: '002_data' }],
			});

			const migrations = [
				{ version: '001_init', name: '001_init.sql', sql: 'CREATE TABLE t (id INT);' },
				{ version: '002_data', name: '002_data.sql', sql: "INSERT INTO t VALUES (1);" },
				{ version: '003_new', name: '003_new.sql', sql: 'ALTER TABLE t ADD col TEXT;' },
			];

			const result = await runMigrations(ds, migrations);

			expect(result.skipped).toEqual(['001_init', '002_data']);
			expect(result.applied).toEqual(['003_new']);

			// migrate called: 1 for _migrations table + 1 for the new migration
			expect(ds.migrate).toHaveBeenCalledTimes(2);
			// write called only once for the newly applied migration
			expect(ds.write).toHaveBeenCalledTimes(1);
		});

		it('returns applied and skipped arrays', async () => {
			const ds = createMockDatastore({
				queryRows: [{ version: '001_init' }],
			});

			const migrations = [
				{ version: '001_init', name: '001_init.sql', sql: 'SQL1' },
				{ version: '002_add', name: '002_add.sql', sql: 'SQL2' },
				{ version: '003_fix', name: '003_fix.sql', sql: 'SQL3' },
			];

			const result = await runMigrations(ds, migrations);

			expect(result).toEqual({
				applied: ['002_add', '003_fix'],
				skipped: ['001_init'],
			});
		});

		it('throws when a migration fails', async () => {
			const ds = createMockDatastore();

			// Override migrate: first call succeeds (_migrations table), second fails
			let callCount = 0;
			ds.migrate.mockImplementation(async () => {
				callCount++;
				if (callCount === 2) {
					return { ok: false, error: { message: 'syntax error near "INVALID"' } };
				}
				return { ok: true, value: undefined };
			});

			const migrations = [
				{ version: '001_bad', name: '001_bad.sql', sql: 'INVALID SQL;' },
			];

			await expect(runMigrations(ds, migrations)).rejects.toThrow(
				'Migration 001_bad failed',
			);
		});
	});
});
