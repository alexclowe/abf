/**
 * Tool sandbox — bounds checking and cost tracking.
 * In v0.1 this does behavioral bounds enforcement (no process isolation).
 */

import type { USDCents } from '../types/common.js';
import type { ABFError, Result } from '../types/errors.js';
import { Err, Ok, SecurityError, ToolError } from '../types/errors.js';
import type { ITool, IToolSandbox, ToolCall, ToolResult } from '../types/tool.js';

export class BasicToolSandbox implements IToolSandbox {
	async execute(
		call: ToolCall,
		tool: ITool,
		costBudgetRemaining: USDCents,
	): Promise<Result<ToolResult, ABFError>> {
		// Check cost budget
		const estimatedCost = tool.definition.estimatedCost ?? (0 as USDCents);
		if (estimatedCost > costBudgetRemaining) {
			return Err(
				new SecurityError(
					'COST_LIMIT_EXCEEDED',
					`Tool ${call.toolId} estimated cost (${estimatedCost}) exceeds remaining budget (${costBudgetRemaining})`,
					{ toolId: call.toolId, estimatedCost, budget: costBudgetRemaining },
				),
			);
		}

		const startTime = Date.now();
		const timeout = tool.definition.timeout ?? 30_000;

		try {
			const result = await Promise.race([
				tool.execute(call.arguments),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Tool execution timed out')), timeout),
				),
			]);

			const durationMs = Date.now() - startTime;

			if (!result.ok) {
				return Ok({
					toolId: call.toolId,
					success: false,
					output: null,
					error: result.error.message,
					cost: 0 as USDCents,
					durationMs,
				});
			}

			return Ok({
				toolId: call.toolId,
				success: true,
				output: result.value,
				cost: estimatedCost,
				durationMs,
			});
		} catch (e) {
			const durationMs = Date.now() - startTime;
			const message = e instanceof Error ? e.message : String(e);

			if (message === 'Tool execution timed out') {
				return Err(
					new ToolError('TOOL_TIMEOUT', `Tool ${call.toolId} timed out after ${timeout}ms`, {
						toolId: call.toolId,
						timeout,
					}),
				);
			}

			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `Tool ${call.toolId} failed: ${message}`, {
					toolId: call.toolId,
					error: message,
					durationMs,
				}),
			);
		}
	}
}
