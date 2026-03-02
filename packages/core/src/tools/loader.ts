/**
 * Tool loader — reads *.tool.yaml files from a directory and registers them.
 * If a co-located .tool.js file exists, it is dynamically imported and
 * wrapped as a CustomTool with real execution. Otherwise falls back to NoOpTool.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import type { ToolId } from '../types/common.js';
import type { ABFError, Result } from '../types/errors.js';
import { ABFError as ABFErrorClass, Ok } from '../types/errors.js';
import type { ITool, ToolDefinition } from '../types/tool.js';
import { toolYamlSchema, transformToolYaml } from '../schemas/tool.schema.js';
import type { BuiltinToolContext } from './builtin/context.js';
import { createWebSearchTool } from './builtin/web-search.js';
import { createWebFetchTool } from './builtin/web-fetch.js';
import { createFileWriteTool } from './builtin/file-write.js';
import { createFileReadTool } from './builtin/file-read.js';
import { createDataTransformTool } from './builtin/data-transform.js';
import { createKnowledgeSearchTool } from './builtin/knowledge-search.js';
import { createSendMessageTool } from './builtin/send-message.js';
import { createBrowseTool } from './builtin/browse.js';
import { createDatabaseQueryTool } from './builtin/database-query.js';
import { createDatabaseWriteTool } from './builtin/database-write.js';
import { createPlanTaskTool } from './builtin/plan-task.js';
import { createAskHumanTool } from './builtin/ask-human.js';
import { createCalendarTool } from './builtin/calendar.js';
import { createPrivacyOpsTool } from './builtin/privacy-ops.js';
import { createEmailSendTool } from './builtin/email-send.js';
import { createImageRenderTool } from './builtin/image-render.js';
import { createSocialPublishTool } from './builtin/social-publish.js';
import { createGitHubCITool } from './builtin/github-ci.js';
import { createStripeBillingTool } from './builtin/stripe-billing.js';
import { createAppGenerateTool } from './builtin/app-generate.js';
import { createAppDeployTool } from './builtin/app-deploy.js';
import { createBackendProvisionTool } from './builtin/backend-provision.js';
import { createCodeGenerateTool } from './builtin/code-generate.js';
import { createAgentEmailTool } from './builtin/agent-email.js';
import { CustomTool, isCustomToolModule } from './custom-tool.js';
import type { CustomToolContext } from './custom-tool.js';

/** A no-op tool that records its invocation. Used when no .tool.js file is provided. */
class NoOpTool implements ITool {
	constructor(readonly definition: ToolDefinition) {}

	async execute(args: Readonly<Record<string, unknown>>): Promise<Result<unknown, ABFError>> {
		return Ok({
			called: true,
			toolId: this.definition.id,
			toolName: this.definition.name,
			args,
			note: 'NoOpTool: provide a co-located .tool.js file to enable real execution',
		});
	}
}

/** All built-in tools — real implementations wired to external services. */
export function createBuiltinTools(ctx: BuiltinToolContext): readonly ITool[] {
	// reschedule — self-scheduling heartbeat. No external deps; kept inline.
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

	const tools: ITool[] = [
		createWebSearchTool(ctx),
		createWebFetchTool(ctx),
		createFileWriteTool(ctx),
		createFileReadTool(ctx),
		createDataTransformTool(ctx),
		createKnowledgeSearchTool(ctx),
		createSendMessageTool(ctx),
		createBrowseTool(ctx),
		reschedule,
	];

	// Conditional: database tools only if datastore is configured
	const dbQuery = createDatabaseQueryTool(ctx);
	if (dbQuery) tools.push(dbQuery);
	const dbWrite = createDatabaseWriteTool(ctx);
	if (dbWrite) tools.push(dbWrite);

	// Conditional: datastore-dependent tools
	const calendar = createCalendarTool(ctx);
	if (calendar) tools.push(calendar);
	const privacyOps = createPrivacyOpsTool(ctx);
	if (privacyOps) tools.push(privacyOps);

	// Always-available tools
	tools.push(createEmailSendTool(ctx));
	tools.push(createImageRenderTool(ctx));
	tools.push(createSocialPublishTool(ctx));
	tools.push(createGitHubCITool(ctx));
	tools.push(createStripeBillingTool(ctx));
	tools.push(createAppGenerateTool(ctx));
	tools.push(createAppDeployTool(ctx));
	tools.push(createBackendProvisionTool(ctx));
	tools.push(createCodeGenerateTool(ctx));

	// Task planning tool
	if (ctx.taskPlanStore) {
		tools.push(createPlanTaskTool(ctx.taskPlanStore));
	}

	// Human inquiry tool
	if (ctx.approvalStore) {
		tools.push(createAskHumanTool(ctx.approvalStore));
	}

	// Inter-agent email tool
	const agentEmail = createAgentEmailTool(ctx);
	if (agentEmail) tools.push(agentEmail);

	return tools;
}

/** Load all *.tool.yaml files from a directory and return ITool instances.
 *  If a co-located .tool.js file exists for a YAML definition, it is dynamically
 *  imported and the tool gets real execution. Otherwise it falls back to NoOpTool. */
export async function loadToolConfigs(
	toolsDir: string,
	customCtx?: CustomToolContext,
): Promise<Result<readonly ITool[], ABFError>> {
	let files: string[];
	try {
		files = (await readdir(toolsDir)).filter((f) => f.endsWith('.tool.yaml'));
	} catch {
		// Directory doesn't exist — that's fine
		return Ok([]);
	}

	const tools: ITool[] = [];

	for (const filename of files) {
		const filePath = join(toolsDir, filename);
		let raw: unknown;
		try {
			raw = parse(await readFile(filePath, 'utf8'));
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

		// Check for co-located .tool.js implementation
		const baseName = filename.replace(/\.tool\.yaml$/, '');
		const jsPath = join(toolsDir, `${baseName}.tool.js`);

		if (existsSync(jsPath) && customCtx) {
			try {
				const mod = await import(pathToFileURL(jsPath).href);
				if (isCustomToolModule(mod)) {
					tools.push(new CustomTool(definition, mod, customCtx));
					continue;
				}
				// Module exists but doesn't export execute() — warn and fall back to NoOp
				customCtx.log(`Warning: ${baseName}.tool.js does not export an execute() function, using NoOp`);
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				customCtx.log(`Warning: Failed to import ${baseName}.tool.js: ${message}, using NoOp`);
			}
		}

		tools.push(new NoOpTool(definition));
	}

	return Ok(tools);
}

export { loadMCPTools } from './mcp/loader.js';
