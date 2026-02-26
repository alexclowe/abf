import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteDatastore } from './sqlite.store.js';
import type { DatastoreSchema } from '../types/datastore.js';

/** Helper schema for a basic "users" table. */
const usersSchema: DatastoreSchema = {
	name: 'users',
	columns: [
		{ name: 'id', type: 'integer', primaryKey: true, notNull: true },
		{ name: 'name', type: 'text', notNull: true },
		{ name: 'email', type: 'text', unique: true },
		{ name: 'created_at', type: 'text', default: "CURRENT_TIMESTAMP" },
	],
};

/** Helper schema for a basic "posts" table with a foreign key. */
const postsSchema: DatastoreSchema = {
	name: 'posts',
	columns: [
		{ name: 'id', type: 'integer', primaryKey: true, notNull: true },
		{ name: 'title', type: 'text', notNull: true },
		{ name: 'body', type: 'text' },
		{ name: 'author_id', type: 'integer', references: 'users(id)' },
	],
};

describe('SQLiteDatastore', () => {
	let tmpDir: string;
	let store: SQLiteDatastore;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), 'abf-sqlite-test-'));
		store = new SQLiteDatastore(join(tmpDir, 'test.db'));
	});

	afterEach(async () => {
		await store.close();
		await rm(tmpDir, { recursive: true, force: true });
	});

	// ── initialize() ─────────────────────────────────────────────────

	it('initialize() creates a DB with WAL journal mode', async () => {
		const result = await store.initialize();
		expect(result.ok).toBe(true);

		// Verify WAL mode is active by querying the pragma
		const pragma = await store.query('PRAGMA journal_mode');
		expect(pragma.ok).toBe(true);
		if (pragma.ok) {
			expect(pragma.value.rows[0]).toEqual({ journal_mode: 'wal' });
		}
	});

	// ── applySchemas() ───────────────────────────────────────────────

	it('applySchemas() creates tables from schema objects', async () => {
		await store.initialize();

		const result = await store.applySchemas([usersSchema, postsSchema]);
		expect(result.ok).toBe(true);

		// Verify tables exist by querying sqlite_master
		const tables = await store.query(
			"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'posts') ORDER BY name",
		);
		expect(tables.ok).toBe(true);
		if (tables.ok) {
			expect(tables.value.rows).toEqual([{ name: 'posts' }, { name: 'users' }]);
			expect(tables.value.rowCount).toBe(2);
		}
	});

	// ── query() ──────────────────────────────────────────────────────

	it('query() returns rows and rowCount', async () => {
		await store.initialize();
		await store.applySchemas([usersSchema]);
		await store.write("INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@test.com')");
		await store.write("INSERT INTO users (id, name, email) VALUES (2, 'Bob', 'bob@test.com')");

		const result = await store.query('SELECT id, name FROM users ORDER BY id');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.rowCount).toBe(2);
			expect(result.value.rows).toEqual([
				{ id: 1, name: 'Alice' },
				{ id: 2, name: 'Bob' },
			]);
		}
	});

	it('query() with params binds values correctly', async () => {
		await store.initialize();
		await store.applySchemas([usersSchema]);
		await store.write("INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@test.com')");
		await store.write("INSERT INTO users (id, name, email) VALUES (2, 'Bob', 'bob@test.com')");

		const result = await store.query('SELECT id, name FROM users WHERE name = ?', ['Bob']);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.rowCount).toBe(1);
			expect(result.value.rows).toEqual([{ id: 2, name: 'Bob' }]);
		}
	});

	// ── write() ──────────────────────────────────────────────────────

	it('write() INSERT returns rowsAffected', async () => {
		await store.initialize();
		await store.applySchemas([usersSchema]);

		const result = await store.write(
			"INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@test.com')",
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.rowsAffected).toBe(1);
		}
	});

	it('write() UPDATE returns rowsAffected', async () => {
		await store.initialize();
		await store.applySchemas([usersSchema]);
		await store.write("INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@test.com')");
		await store.write("INSERT INTO users (id, name, email) VALUES (2, 'Bob', 'bob@test.com')");

		const result = await store.write("UPDATE users SET name = 'Updated'");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.rowsAffected).toBe(2);
		}
	});

	it('write() DELETE returns rowsAffected', async () => {
		await store.initialize();
		await store.applySchemas([usersSchema]);
		await store.write("INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@test.com')");
		await store.write("INSERT INTO users (id, name, email) VALUES (2, 'Bob', 'bob@test.com')");
		await store.write("INSERT INTO users (id, name, email) VALUES (3, 'Carol', 'carol@test.com')");

		const result = await store.write('DELETE FROM users WHERE id > ?', [1]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.rowsAffected).toBe(2);
		}
	});

	// ── write() forbidden patterns ───────────────────────────────────

	it.each([
		['DROP TABLE users', 'DROP'],
		['ALTER TABLE users ADD COLUMN age INTEGER', 'ALTER'],
		['TRUNCATE TABLE users', 'TRUNCATE'],
		['CREATE TABLE evil (id INTEGER)', 'CREATE'],
		['GRANT ALL ON users TO public', 'GRANT'],
		['REVOKE ALL ON users FROM public', 'REVOKE'],
	])('write() blocks forbidden pattern: %s', async (sql, _label) => {
		await store.initialize();

		const result = await store.write(sql);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('RUNTIME_ERROR');
			expect(result.error.message).toContain('Forbidden SQL operation');
		}
	});

	// ── migrate() ────────────────────────────────────────────────────

	it('migrate() executes raw SQL (including CREATE TABLE)', async () => {
		await store.initialize();

		const migrationSQL = `
			CREATE TABLE IF NOT EXISTS _migrations (
				version INTEGER PRIMARY KEY,
				applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			INSERT INTO _migrations (version) VALUES (1);
		`;
		const result = await store.migrate(migrationSQL);
		expect(result.ok).toBe(true);

		// Verify migration table and row exist
		const rows = await store.query('SELECT version FROM _migrations');
		expect(rows.ok).toBe(true);
		if (rows.ok) {
			expect(rows.value.rows).toEqual([{ version: 1 }]);
		}
	});

	// ── close() ──────────────────────────────────────────────────────

	it('close() shuts down the database connection', async () => {
		await store.initialize();
		await store.close();

		// After close, queries should fail with "not initialized"
		const result = await store.query('SELECT 1');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain('not initialized');
		}
	});

	// ── Error: operations before initialize ──────────────────────────

	it('query() before initialize returns an error', async () => {
		const result = await store.query('SELECT 1');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('RUNTIME_ERROR');
			expect(result.error.message).toContain('not initialized');
		}
	});

	it('write() before initialize returns an error', async () => {
		const result = await store.write("INSERT INTO users (id, name) VALUES (1, 'x')");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('RUNTIME_ERROR');
			expect(result.error.message).toContain('not initialized');
		}
	});

	it('applySchemas() before initialize returns an error', async () => {
		const result = await store.applySchemas([usersSchema]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('RUNTIME_ERROR');
			expect(result.error.message).toContain('not initialized');
		}
	});

	it('migrate() before initialize returns an error', async () => {
		const result = await store.migrate('CREATE TABLE x (id INTEGER)');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('RUNTIME_ERROR');
			expect(result.error.message).toContain('not initialized');
		}
	});

	// ── Error: invalid SQL ───────────────────────────────────────────

	it('query() with invalid SQL returns an error', async () => {
		await store.initialize();

		const result = await store.query('SELECT * FROM nonexistent_table_xyz');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('RUNTIME_ERROR');
			expect(result.error.message).toContain('Query failed');
		}
	});

	it('write() with invalid SQL returns an error', async () => {
		await store.initialize();

		const result = await store.write('INSERT INTO nonexistent_table_xyz (a) VALUES (1)');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('RUNTIME_ERROR');
			expect(result.error.message).toContain('Write failed');
		}
	});
});
