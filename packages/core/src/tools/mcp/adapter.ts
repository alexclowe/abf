/**
 * MCPToolAdapter — wraps an MCP tool as an ITool for use in the tool registry.
 */

import type { ToolId } from '../../types/common.js';
import type { ABFError, Result } from '../../types/errors.js';
import { ABFError as ABFErrorClass, Ok, Err } from '../../types/errors.js';
import type { ITool, ToolDefinition } from '../../types/tool.js';
import { toUSDCents } from '../../util/id.js';
import type { MCPClient } from './client.js';

export class MCPToolAdapter implements ITool {
	readonly definition: ToolDefinition;

	constructor(
		private readonly serverId: string,
		private readonly toolName: string,
		description: string,
		inputSchema: Record<string, unknown>,
		private readonly client: MCPClient,
	) {
		this.definition = {
			id: `mcp:${serverId}:${toolName}` as ToolId,
			name: `${serverId}/${toolName}`,
			description,
			source: 'mcp',
			parameters: MCPToolAdapter.schemaToParameters(inputSchema),
			estimatedCost: toUSDCents(0),
			timeout: 30_000,
			requiresApproval: false,
		};
	}

	async execute(
		args: Readonly<Record<string, unknown>>,
	): Promise<Result<unknown, ABFError>> {
		try {
			const output = await this.client.callTool(this.toolName, args as Record<string, unknown>);
			return Ok(output);
		} catch (error) {
			return Err(
				new ABFErrorClass(
					'TOOL_EXECUTION_FAILED',
					`MCP tool ${this.serverId}/${this.toolName} failed: ${String(error)}`,
					{ cause: error },
				),
			);
		}
	}

	private static schemaToParameters(
		schema: Record<string, unknown>,
	): ToolDefinition['parameters'] {
		const props = (schema['properties'] as Record<string, Record<string, unknown>> | undefined) ?? {};
		const required = (schema['required'] as string[] | undefined) ?? [];
		return Object.entries(props).map(([name, prop]) => ({
			name,
			type: (prop['type'] as 'string' | 'number' | 'boolean' | 'object' | 'array') ?? 'string',
			description: (prop['description'] as string) ?? '',
			required: required.includes(name),
		}));
	}
}
