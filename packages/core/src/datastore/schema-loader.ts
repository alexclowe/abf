/**
 * Schema loader — reads *.schema.yaml files and generates DDL.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { DatastoreSchema } from '../types/datastore.js';
import { datastoreSchemaYaml, transformDatastoreSchema } from '../schemas/datastore.schema.js';

/**
 * Load all *.schema.yaml files from a directory.
 */
export function loadDatastoreSchemas(dir: string): DatastoreSchema[] {
	let files: string[];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith('.schema.yaml'));
	} catch {
		return [];
	}

	const schemas: DatastoreSchema[] = [];
	for (const file of files) {
		const raw = parse(readFileSync(join(dir, file), 'utf-8'));
		const parsed = datastoreSchemaYaml.safeParse(raw);
		if (parsed.success) {
			schemas.push(transformDatastoreSchema(parsed.data));
		}
	}
	return schemas;
}

/**
 * Generate CREATE TABLE IF NOT EXISTS DDL from a schema definition.
 */
export function schemaToDDL(schema: DatastoreSchema): string {
	const cols = schema.columns.map((c) => {
		const parts = [c.name, c.type.toUpperCase()];
		if (c.primaryKey) parts.push('PRIMARY KEY');
		if (c.notNull) parts.push('NOT NULL');
		if (c.unique) parts.push('UNIQUE');
		if (c.default) parts.push(`DEFAULT ${c.default}`);
		if (c.references) parts.push(`REFERENCES ${c.references}`);
		return `  ${parts.join(' ')}`;
	});
	return `CREATE TABLE IF NOT EXISTS ${schema.name} (\n${cols.join(',\n')}\n);`;
}
