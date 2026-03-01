/**
 * code-generate -- Generate or modify code using Claude Code in headless mode.
 * Uses promisify(execFile) from node:child_process for safe subprocess execution
 * (never exec() — prevents shell injection). Sandboxed to project directory.
 *
 * Safety: execFile does NOT spawn a shell, so the prompt argument cannot be used
 * for shell injection. This is the same safe pattern used in keychain.ts.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { AgentId, SessionId, ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import { toISOTimestamp } from '../../util/id.js';
import type { BuiltinToolContext } from './context.js';
import { credentialError } from './credential-error.js';
import { cloudProxyCall, getCloudToken } from './cloud-proxy-call.js';

const execFileAsync = promisify(execFile);

// Rate limit: max 3 API calls per agent per runtime session (most expensive tool)
const sessionApiCounts = new Map<string, number>();
const MAX_API_CALLS_PER_SESSION = 3;

const WRITE_ACTIONS = ['generate', 'modify'];
const ALL_ACTIONS = [...WRITE_ACTIONS];

// 180 seconds — code generation can be slow
const EXEC_TIMEOUT_MS = 180_000;

export function createCodeGenerateTool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'code-generate' as ToolId,
		name: 'code-generate',
		description:
			'Generate or modify code using Claude Code in headless mode. ' +
			'Sandboxed to the project directory for safety.',
		source: 'registry',
		parameters: [
			{ name: 'action', type: 'string', description: 'Action to perform: generate, modify', required: true },
			{ name: 'prompt', type: 'string', description: 'What to generate or how to modify', required: true },
			{ name: 'directory', type: 'string', description: 'Working directory for modify (must be under project root)', required: false },
			{ name: 'max_tokens', type: 'number', description: 'Max tokens for generation (default 4096)', required: false },
		],
		estimatedCost: 10 as USDCents,
		timeout: EXEC_TIMEOUT_MS + 5_000,
	};

	return {
		definition,
		async execute(args) {
			const action = args['action'];
			if (typeof action !== 'string' || !ALL_ACTIONS.includes(action)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`code-generate: action must be one of: ${ALL_ACTIONS.join(', ')}`,
						{},
					),
				);
			}

			const prompt = args['prompt'];
			if (typeof prompt !== 'string' || !prompt.trim()) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'code-generate: prompt is required', {}),
				);
			}

			// Rate limit check
			const agentId = typeof args['_agentId'] === 'string' ? args['_agentId'] : 'unknown';
			const count = sessionApiCounts.get(agentId) ?? 0;
			if (count >= MAX_API_CALLS_PER_SESSION) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`code-generate: rate limit reached (max ${String(MAX_API_CALLS_PER_SESSION)} API calls per session)`,
						{},
					),
				);
			}
			sessionApiCounts.set(agentId, count + 1);

			// Queue write actions for approval if approval store is configured
			if (ctx.approvalStore) {
				const approvalId = ctx.approvalStore.create({
					agentId: (args['_agentId'] as AgentId) ?? ('unknown' as AgentId),
					sessionId: (args['_sessionId'] as SessionId) ?? ('unknown' as SessionId),
					toolId: 'code-generate' as ToolId,
					toolName: 'code-generate',
					arguments: {
						action,
						prompt,
						directory: args['directory'],
						max_tokens: args['max_tokens'],
					},
					createdAt: toISOTimestamp(),
				});
				return Ok({
					queued: true,
					approvalId,
					action,
					message: `${action} queued for approval`,
				});
			}

			// Cloud proxy: forward to ABF Cloud if running in cloud mode
			if (ctx.isCloud && ctx.cloudEndpoint) {
				const cloudToken = await getCloudToken(ctx);
				if (cloudToken) {
					return cloudProxyCall(ctx.cloudEndpoint, 'code-generate', { action, prompt, ...args }, cloudToken);
				}
			}

			// Get Anthropic API key: env var first, then vault
			// Claude Code uses ANTHROPIC_API_KEY automatically
			let apiKey = process.env['ANTHROPIC_API_KEY'];
			if (!apiKey) {
				const vaultKey = await ctx.vault.get('anthropic', 'api_key');
				if (vaultKey) apiKey = vaultKey;
			}
			if (!apiKey) {
				return Ok(credentialError(ctx.isCloud, {
					provider: 'anthropic',
					envVar: 'ANTHROPIC_API_KEY',
					dashboardPath: '/settings/integrations/anthropic',
					displayName: 'Anthropic',
				}));
			}

			// Determine working directory with traversal protection
			let cwd = ctx.projectRoot;
			if (action === 'modify' && args['directory']) {
				const resolved = resolve(ctx.projectRoot, args['directory'] as string);
				if (!resolved.startsWith(ctx.projectRoot)) {
					return Err(
						new ToolError(
							'TOOL_EXECUTION_FAILED',
							'code-generate: directory must be within the project root (directory traversal rejected)',
							{},
						),
					);
				}
				cwd = resolved;
			}

			const maxTokens = typeof args['max_tokens'] === 'number' ? args['max_tokens'] : 4096;

			try {
				// execFile does NOT spawn a shell — the prompt is passed as an array
				// element, not interpolated into a shell string. Safe from injection.
				const { stdout, stderr } = await execFileAsync(
					'claude',
					[
						'-p', prompt,
						'--output-format', 'json',
						'--max-tokens', String(maxTokens),
					],
					{
						cwd,
						timeout: EXEC_TIMEOUT_MS,
						env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
						maxBuffer: 10 * 1024 * 1024, // 10MB
					},
				);

				// Parse JSON output from Claude Code
				let result: unknown;
				try {
					result = JSON.parse(stdout);
				} catch {
					// If stdout isn't valid JSON, return it as raw text
					result = { raw_output: stdout.trim() };
				}

				return Ok({
					action,
					directory: cwd,
					result,
					...(stderr.trim() ? { warnings: stderr.trim() } : {}),
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);

				// Check for timeout
				if (message.includes('TIMEOUT') || message.includes('timed out')) {
					return Err(
						new ToolError(
							'TOOL_EXECUTION_FAILED',
							`code-generate: execution timed out after ${String(EXEC_TIMEOUT_MS / 1000)}s`,
							{},
						),
					);
				}

				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`code-generate: ${action} failed: ${message}`,
						{},
					),
				);
			}
		},
	};
}
