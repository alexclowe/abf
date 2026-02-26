/**
 * CustomTool — wraps a dynamically imported .tool.js module as an ITool.
 * Custom tools export an `execute` function that receives args + context.
 * They run in-process (same trust model as MCP tools).
 */

import type { ICredentialVault } from '../credentials/index.js';
import type { IDatastore } from '../types/datastore.js';
import type { ABFError, Result } from '../types/errors.js';
import { ABFError as ABFErrorClass, Ok } from '../types/errors.js';
import type { ITool, ToolDefinition } from '../types/tool.js';

/** Context injected into custom tool execute functions. */
export interface CustomToolContext {
	/** Absolute path to the project root directory. */
	readonly projectRoot: string;
	/** Credential vault for reading API keys. */
	readonly vault: ICredentialVault;
	/** Business database (if configured). */
	readonly datastore?: IDatastore | undefined;
	/** Structured logging for the tool. */
	readonly log: (msg: string) => void;
}

/** The shape a .tool.js module must export. */
export interface CustomToolModule {
	execute(args: Record<string, unknown>, ctx: CustomToolContext): Promise<unknown>;
}

/** Validates that a dynamic import result is a valid CustomToolModule. */
export function isCustomToolModule(mod: unknown): mod is CustomToolModule {
	return (
		typeof mod === 'object' &&
		mod !== null &&
		'execute' in mod &&
		typeof (mod as Record<string, unknown>)['execute'] === 'function'
	);
}

export class CustomTool implements ITool {
	constructor(
		readonly definition: ToolDefinition,
		private readonly module: CustomToolModule,
		private readonly ctx: CustomToolContext,
	) {}

	async execute(args: Readonly<Record<string, unknown>>): Promise<Result<unknown, ABFError>> {
		try {
			const result = await this.module.execute({ ...args }, this.ctx);
			return Ok(result);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return {
				ok: false,
				error: new ABFErrorClass(
					'TOOL_EXECUTION_FAILED',
					`Custom tool ${this.definition.name} failed: ${message}`,
				),
			};
		}
	}
}
