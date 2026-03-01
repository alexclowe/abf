/**
 * database-query -- SELECT-only read tool for the business datastore.
 */

import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';
import { containsSqlInjection } from '../../runtime/gateway/auth-utils.js';

export function createDatabaseQueryTool(ctx: BuiltinToolContext): ITool | null {
	if (!ctx.datastore) return null;

	const definition: ToolDefinition = {
		id: 'database-query' as ToolId,
		name: 'database-query',
		description:
			'Run a read-only SQL query against the business database. ' +
			'Only SELECT statements are allowed. Returns rows as JSON.',
		source: 'registry',
		parameters: [
			{
				name: 'sql',
				type: 'string',
				description: 'SQL SELECT query to execute',
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
				return Err(new ToolError('TOOL_EXECUTION_FAILED', 'database-query: sql is required', {}));
			}

			// Only allow SELECT
			if (!/^\s*SELECT\s/i.test(sql)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						'database-query: only SELECT statements are allowed',
						{},
					),
				);
			}

			// Reject multi-statement queries (SQL injection defense)
			if (containsSqlInjection(sql)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						'database-query: multi-statement queries, comments, and semicolons are not allowed',
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
						new ToolError('TOOL_EXECUTION_FAILED', 'database-query: invalid params JSON', {}),
					);
				}
			}

			const result = await ctx.datastore!.query(sql, params);
			if (!result.ok) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', `database-query: ${result.error.message}`, {}),
				);
			}

			return Ok({
				rows: result.value.rows,
				rowCount: result.value.rowCount,
			});
		},
	};
}
