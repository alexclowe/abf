import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadDatastoreSchemas, schemaToDDL } from './schema-loader.js';
import type { DatastoreSchema } from '../types/datastore.js';

describe('Schema Loader', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'abf-schema-test-'));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe('loadDatastoreSchemas', () => {
		it('loads valid YAML schema files from a directory', async () => {
			const yaml = `
name: users
columns:
  - name: id
    type: integer
    primary_key: true
  - name: email
    type: text
    not_null: true
    unique: true
  - name: created_at
    type: timestamp
    default: "CURRENT_TIMESTAMP"
`;
			await writeFile(join(tempDir, 'users.schema.yaml'), yaml, 'utf-8');

			const schemas = loadDatastoreSchemas(tempDir);

			expect(schemas).toHaveLength(1);
			expect(schemas[0].name).toBe('users');
			expect(schemas[0].columns).toHaveLength(3);
			expect(schemas[0].columns[0].name).toBe('id');
			expect(schemas[0].columns[0].primaryKey).toBe(true);
			expect(schemas[0].columns[1].notNull).toBe(true);
			expect(schemas[0].columns[1].unique).toBe(true);
			expect(schemas[0].columns[2].default).toBe('CURRENT_TIMESTAMP');
		});

		it('returns empty array for non-existent directory', () => {
			const schemas = loadDatastoreSchemas(join(tempDir, 'no-such-dir'));
			expect(schemas).toEqual([]);
		});

		it('skips malformed YAML files', async () => {
			// Valid schema
			const validYaml = `
name: orders
columns:
  - name: id
    type: integer
    primary_key: true
`;
			await writeFile(join(tempDir, 'orders.schema.yaml'), validYaml, 'utf-8');

			// Malformed: missing required fields
			await writeFile(join(tempDir, 'bad.schema.yaml'), 'not_a_valid_schema: true', 'utf-8');

			// Not a schema file — should be ignored entirely
			await writeFile(join(tempDir, 'readme.txt'), 'just a text file', 'utf-8');

			const schemas = loadDatastoreSchemas(tempDir);

			expect(schemas).toHaveLength(1);
			expect(schemas[0].name).toBe('orders');
		});

		it('loads multiple schema files', async () => {
			for (const table of ['customers', 'products', 'invoices']) {
				const yaml = `
name: ${table}
columns:
  - name: id
    type: integer
    primary_key: true
`;
				await writeFile(join(tempDir, `${table}.schema.yaml`), yaml, 'utf-8');
			}

			const schemas = loadDatastoreSchemas(tempDir);
			expect(schemas).toHaveLength(3);
			const names = schemas.map((s) => s.name).sort();
			expect(names).toEqual(['customers', 'invoices', 'products']);
		});
	});

	describe('schemaToDDL', () => {
		it('generates CREATE TABLE IF NOT EXISTS statement', () => {
			const schema: DatastoreSchema = {
				name: 'tasks',
				columns: [
					{ name: 'id', type: 'integer', primaryKey: true },
					{ name: 'title', type: 'text', notNull: true },
				],
			};

			const ddl = schemaToDDL(schema);

			expect(ddl).toContain('CREATE TABLE IF NOT EXISTS tasks');
			expect(ddl).toContain('id INTEGER PRIMARY KEY');
			expect(ddl).toContain('title TEXT NOT NULL');
		});

		it('handles all column constraints', () => {
			const schema: DatastoreSchema = {
				name: 'line_items',
				columns: [
					{ name: 'id', type: 'integer', primaryKey: true },
					{ name: 'sku', type: 'text', notNull: true, unique: true },
					{ name: 'quantity', type: 'integer', notNull: true, default: '1' },
					{ name: 'order_id', type: 'integer', references: 'orders(id)' },
				],
			};

			const ddl = schemaToDDL(schema);

			expect(ddl).toContain('id INTEGER PRIMARY KEY');
			expect(ddl).toContain('sku TEXT NOT NULL UNIQUE');
			expect(ddl).toContain('quantity INTEGER NOT NULL DEFAULT 1');
			expect(ddl).toContain('order_id INTEGER REFERENCES orders(id)');
		});

		it('uppercases column types', () => {
			const schema: DatastoreSchema = {
				name: 'events',
				columns: [{ name: 'payload', type: 'jsonb' }],
			};

			const ddl = schemaToDDL(schema);
			expect(ddl).toContain('payload JSONB');
		});

		it('produces proper multi-line DDL with commas', () => {
			const schema: DatastoreSchema = {
				name: 'metrics',
				columns: [
					{ name: 'id', type: 'integer', primaryKey: true },
					{ name: 'value', type: 'real' },
					{ name: 'label', type: 'text' },
				],
			};

			const ddl = schemaToDDL(schema);
			const lines = ddl.split('\n');

			// First line: CREATE TABLE
			expect(lines[0]).toBe('CREATE TABLE IF NOT EXISTS metrics (');
			// Middle lines separated by commas
			expect(lines[1]).toContain('id INTEGER PRIMARY KEY');
			expect(lines[2]).toContain('value REAL');
			expect(lines[3]).toContain('label TEXT');
			// Last line: closing paren + semicolon
			expect(lines[4]).toBe(');');
		});
	});
});
