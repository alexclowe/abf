/**
 * In-memory tool registry.
 * Tools are registered at startup and looked up by ID or agent permissions.
 */

import type { AgentId, ToolId } from '../types/common.js';
import type { ITool, IToolRegistry } from '../types/tool.js';

export class ToolRegistry implements IToolRegistry {
	private readonly tools = new Map<string, ITool>();

	register(tool: ITool): void {
		this.tools.set(tool.definition.id, tool);
	}

	get(id: ToolId): ITool | undefined {
		return this.tools.get(id);
	}

	getAll(): readonly ITool[] {
		return [...this.tools.values()];
	}

	has(id: ToolId): boolean {
		return this.tools.has(id);
	}

	getForAgent(_agentId: AgentId, allowedTools: readonly string[]): readonly ITool[] {
		return allowedTools
			.map((name) => this.tools.get(name))
			.filter((tool): tool is ITool => tool !== undefined);
	}
}
