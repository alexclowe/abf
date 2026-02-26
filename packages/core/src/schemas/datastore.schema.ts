/**
 * Zod schema for *.schema.yaml datastore schema definitions.
 */

import { z } from 'zod';
import type { DatastoreSchema } from '../types/datastore.js';

const columnSchema = z.object({
	name: z.string(),
	type: z.string(),
	primary_key: z.boolean().optional(),
	not_null: z.boolean().optional(),
	unique: z.boolean().optional(),
	default: z.string().optional(),
	references: z.string().optional(),
});

export const datastoreSchemaYaml = z.object({
	name: z.string(),
	columns: z.array(columnSchema),
});

export function transformDatastoreSchema(
	parsed: z.output<typeof datastoreSchemaYaml>,
): DatastoreSchema {
	return {
		name: parsed.name,
		columns: parsed.columns.map((c) => ({
			name: c.name,
			type: c.type,
			...(c.primary_key != null && { primaryKey: c.primary_key }),
			...(c.not_null != null && { notNull: c.not_null }),
			...(c.unique != null && { unique: c.unique }),
			...(c.default != null && { default: c.default }),
			...(c.references != null && { references: c.references }),
		})),
	};
}
