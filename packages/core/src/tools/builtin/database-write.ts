/**
 * database-write -- INSERT/UPDATE/DELETE tool for the business datastore.
 * No DROP, ALTER, TRUNCATE, or other DDL operations are allowed.
 */

import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';

export function createDatabaseWriteTool(ctx: BuiltinToolContext): ITool | null {
	if (!ctx.datastore) return null;

	const definition: ToolDefinition = {
		id: 'database-write' as ToolId,
		name: 'database-write',
		description:
			'Run a write SQL statement against the business database. ' +
			'Supports INSERT, UPDATE, and DELETE. No DROP, ALTER, or schema changes.',
		source: 'registry',
		parameters: [
			{
				name: 'sql',
				type: 'string',
				description: 'SQL INSERT, UPDATE, or DELETE statement',
				required: true,
			},
			{
				name: 'params',
				type: 'string',
				description: 'JSON array of query parameters (for $1, $2, etc.)',
				required: false,
			},
		],
		estimatedCost: 0 as USDCents,
		timeout: 30_000,
	};

	return {
		definition,
		async execute(args) {
			const sql = args['sql'];
			if (typeof sql !== 'string' || !sql.trim()) {
				return Err(new ToolError('TOOL_EXECUTION_FAILED', 'database-write: sql is required', {}));
			}

			// Only allow INSERT, UPDATE, DELETE
			if (!/^\s*(INSERT|UPDATE|DELETE)\s/i.test(sql)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						'database-write: only INSERT, UPDATE, DELETE statements are allowed',
						{},
					),
				);
			}

			let params: unknown[] = [];
			if (typeof args['params'] === 'string') {
				try {
					params = JSON.parse(args['params']) as unknown[];
				} catch {
					return Err(
						new ToolError('TOOL_EXECUTION_FAILED', 'database-write: invalid params JSON', {}),
					);
				}
			}

			const result = await ctx.datastore!.write(sql, params);
			if (!result.ok) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', `database-write: ${result.error.message}`, {}),
				);
			}

			return Ok({
				rowsAffected: result.value.rowsAffected,
			});
		},
	};
}
