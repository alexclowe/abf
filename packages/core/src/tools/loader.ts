/**
 * Tool loader — reads *.tool.yaml files from a directory and registers them.
 * For v0.1, YAML-defined tools execute as NoOpTool (records call, returns metadata).
 * Real .tool.ts execution comes in v0.2.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ToolId } from '../types/common.js';
import type { ABFError, Result } from '../types/errors.js';
import { ABFError as ABFErrorClass, Ok } from '../types/errors.js';
import type { ITool, ToolDefinition } from '../types/tool.js';
import { toolYamlSchema, transformToolYaml } from '../schemas/tool.schema.js';

/** A no-op tool that records its invocation and returns metadata. Used for v0.1 scaffolding. */
class NoOpTool implements ITool {
	constructor(readonly definition: ToolDefinition) {}

	async execute(args: Readonly<Record<string, unknown>>): Promise<Result<unknown, ABFError>> {
		return Ok({
			called: true,
			toolId: this.definition.id,
			toolName: this.definition.name,
			args,
			note: 'NoOpTool: real execution available in v0.2',
		});
	}
}

/** Built-in stub tools registered by default. */
export function createBuiltinTools(): readonly ITool[] {
	const webSearch: ITool = {
		definition: {
			id: 'web-search' as ToolId,
			name: 'web-search',
			description: 'Search the web for information',
			source: 'registry',
			parameters: [
				{ name: 'query', type: 'string', description: 'Search query', required: true },
			],
		},
		execute: async (_args) => {
			return Ok({
				results: [],
				note: 'web-search is a stub in v0.1. Real search available in v0.2.',
			});
		},
	};

	// reschedule — lets agents request to be re-run after a delay.
	// The session manager reads the result and stores it in SessionResult.rescheduleIn.
	const reschedule: ITool = {
		definition: {
			id: 'reschedule' as ToolId,
			name: 'reschedule',
			description:
				'Request to be re-run after a delay. Use this to create a heartbeat loop. ' +
				'Call with a short delay if there is work to do soon, a long delay if idle.',
			source: 'registry',
			parameters: [
				{
					name: 'delay_seconds',
					type: 'number',
					description: 'Seconds to wait before running again (e.g. 300 = 5 minutes)',
					required: true,
				},
				{
					name: 'reason',
					type: 'string',
					description: 'Why you are rescheduling (logged for transparency)',
					required: false,
				},
			],
		},
		execute: async (args) => {
			return Ok({
				rescheduled: true,
				delay_seconds: args['delay_seconds'],
				reason: args['reason'] ?? 'heartbeat',
			});
		},
	};

	return [webSearch, reschedule];
}

/** Load all *.tool.yaml files from a directory and return ITool instances. */
export async function loadToolConfigs(
	toolsDir: string,
): Promise<Result<readonly ITool[], ABFError>> {
	let files: string[];
	try {
		files = readdirSync(toolsDir).filter((f) => f.endsWith('.tool.yaml'));
	} catch {
		// Directory doesn't exist — that's fine
		return Ok([]);
	}

	const tools: ITool[] = [];

	for (const filename of files) {
		const filePath = join(toolsDir, filename);
		let raw: unknown;
		try {
			raw = parse(readFileSync(filePath, 'utf8'));
		} catch (e) {
			return { ok: false, error: new ABFErrorClass('RUNTIME_ERROR', `Failed to parse ${filename}: ${String(e)}`) };
		}

		const parsed = toolYamlSchema.safeParse(raw);
		if (!parsed.success) {
			return {
				ok: false,
				error: new ABFErrorClass('RUNTIME_ERROR', `Invalid tool definition in ${filename}: ${parsed.error.message}`),
			};
		}

		const definition = transformToolYaml(parsed.data);
		tools.push(new NoOpTool(definition));
	}

	return Ok(tools);
}

export { loadMCPTools } from './mcp/loader.js';
