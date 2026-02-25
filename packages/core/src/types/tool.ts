/**
 * Tool system types.
 * Tools are the capabilities agents can use. Three sources:
 * ABF Registry (curated), MCP Servers, Custom (TypeScript functions).
 */

import type { AgentId, ISOTimestamp, ToolId, USDCents } from './common.js';
import type { ABFError, Result } from './errors.js';

// ─── Tool Definition ──────────────────────────────────────────────────

export type ToolSource = 'registry' | 'mcp' | 'custom';

export interface ToolParameter {
	readonly name: string;
	readonly type: 'string' | 'number' | 'boolean' | 'object' | 'array';
	readonly description: string;
	readonly required: boolean;
	readonly default?: unknown | undefined;
}

export interface ToolDefinition {
	readonly id: ToolId;
	readonly name: string;
	readonly description: string;
	readonly source: ToolSource;
	readonly parameters: readonly ToolParameter[];
	readonly estimatedCost?: USDCents | undefined;
	readonly timeout?: number | undefined; // milliseconds
	readonly requiresApproval?: boolean | undefined;
}

// ─── Tool Execution ───────────────────────────────────────────────────

export interface ToolCall {
	readonly toolId: ToolId;
	readonly arguments: Readonly<Record<string, unknown>>;
	readonly agentId: AgentId;
	readonly timestamp: ISOTimestamp;
}

export interface ToolResult {
	readonly toolId: ToolId;
	readonly success: boolean;
	readonly output: unknown;
	readonly error?: string | undefined;
	readonly cost?: USDCents | undefined;
	readonly durationMs: number;
}

// ─── Tool Interfaces ──────────────────────────────────────────────────

export interface ITool {
	readonly definition: ToolDefinition;
	execute(args: Readonly<Record<string, unknown>>): Promise<Result<unknown, ABFError>>;
}

export interface IToolRegistry {
	register(tool: ITool): void;
	get(id: ToolId): ITool | undefined;
	getAll(): readonly ITool[];
	has(id: ToolId): boolean;
	getForAgent(agentId: AgentId, allowedTools: readonly string[]): readonly ITool[];
}

export interface IToolSandbox {
	execute(
		call: ToolCall,
		tool: ITool,
		costBudgetRemaining: USDCents,
	): Promise<Result<ToolResult, ABFError>>;
}
