/**
 * app-generate -- Generate UI components and web apps using the v0 Platform API.
 * Supports generate, iterate, and get-generation actions.
 * Write actions (generate, iterate) require approval if an approval store is configured.
 */
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { AgentId, SessionId, ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import { toISOTimestamp } from '../../util/id.js';
import type { BuiltinToolContext } from './context.js';
import { credentialError } from './credential-error.js';
import { cloudProxyCall, getCloudToken } from './cloud-proxy-call.js';

// Rate limit: max 10 API calls per agent per runtime session (generations are expensive)
const sessionApiCounts = new Map<string, number>();
const MAX_API_CALLS_PER_SESSION = 10;

const V0_API_BASE = 'https://api.v0.dev/v1';

const WRITE_ACTIONS = ['generate', 'iterate'];
const ALL_ACTIONS = [...WRITE_ACTIONS, 'get-generation'];

export function createAppGenerateTool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'app-generate' as ToolId,
		name: 'app-generate',
		description:
			'Generate UI components and web apps using v0. Supports generate (create new), ' +
			'iterate (refine existing), and get-generation (check status) actions.',
		source: 'registry',
		parameters: [
			{ name: 'action', type: 'string', description: 'Action to perform: generate, iterate, get-generation', required: true },
			{ name: 'prompt', type: 'string', description: 'What to generate or how to iterate (for generate/iterate)', required: false },
			{ name: 'generation_id', type: 'string', description: 'Generation ID (for iterate/get-generation)', required: false },
			{ name: 'framework', type: 'string', description: "Target framework: nextjs (default), react, vue, svelte", required: false },
		],
		estimatedCost: 5 as USDCents,
		timeout: 120_000,
	};

	return {
		definition,
		async execute(args) {
			const action = args['action'];
			if (typeof action !== 'string' || !ALL_ACTIONS.includes(action)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`app-generate: action must be one of: ${ALL_ACTIONS.join(', ')}`,
						{},
					),
				);
			}

			// Rate limit check
			const agentId = typeof args['_agentId'] === 'string' ? args['_agentId'] : 'unknown';
			const count = sessionApiCounts.get(agentId) ?? 0;
			if (count >= MAX_API_CALLS_PER_SESSION) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`app-generate: rate limit reached (max ${String(MAX_API_CALLS_PER_SESSION)} API calls per session)`,
						{},
					),
				);
			}
			sessionApiCounts.set(agentId, count + 1);

			// Queue write actions for approval if approval store is configured
			if (WRITE_ACTIONS.includes(action) && ctx.approvalStore) {
				const approvalId = ctx.approvalStore.create({
					agentId: (args['_agentId'] as AgentId) ?? ('unknown' as AgentId),
					sessionId: (args['_sessionId'] as SessionId) ?? ('unknown' as SessionId),
					toolId: 'app-generate' as ToolId,
					toolName: 'app-generate',
					arguments: {
						action,
						prompt: args['prompt'],
						generation_id: args['generation_id'],
						framework: args['framework'],
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
					return cloudProxyCall(ctx.cloudEndpoint, 'app-generate', { action, ...args }, cloudToken);
				}
			}

			// Get v0 API key: env var first, then vault
			let apiKey = process.env['V0_API_KEY'];
			if (!apiKey) {
				const vaultKey = await ctx.vault.get('v0', 'api_key');
				if (vaultKey) apiKey = vaultKey;
			}
			if (!apiKey) {
				return Ok(credentialError(ctx.isCloud, {
					provider: 'v0',
					envVar: 'V0_API_KEY',
					dashboardPath: '/settings/integrations/v0',
					displayName: 'v0',
				}));
			}

			switch (action) {
				case 'generate':
					return generate(apiKey, args);
				case 'iterate':
					return iterate(apiKey, args);
				case 'get-generation':
					return getGeneration(apiKey, args);
				default:
					return Err(
						new ToolError('TOOL_EXECUTION_FAILED', `app-generate: unknown action '${action}'`, {}),
					);
			}
		},
	};
}

async function generate(
	apiKey: string,
	args: Readonly<Record<string, unknown>>,
) {
	const prompt = args['prompt'] as string;
	const framework = (args['framework'] as string) || 'nextjs';

	if (!prompt) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'app-generate: generate requires prompt', {}),
		);
	}

	try {
		const res = await fetch(`${V0_API_BASE}/generations`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ prompt, framework }),
		});

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `app-generate: v0 API error ${String(res.status)}: ${body}`, {}),
			);
		}

		const data = await res.json() as Record<string, unknown>;
		return Ok({
			generation_id: data['id'],
			status: data['status'],
			code: data['code'],
			url: data['url'],
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`app-generate: generate failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function iterate(
	apiKey: string,
	args: Readonly<Record<string, unknown>>,
) {
	const prompt = args['prompt'] as string;
	const generationId = args['generation_id'] as string;
	const framework = (args['framework'] as string) || 'nextjs';

	if (!prompt || !generationId) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'app-generate: iterate requires prompt and generation_id',
				{},
			),
		);
	}

	try {
		const res = await fetch(`${V0_API_BASE}/generations`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ prompt, parentId: generationId, framework }),
		});

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `app-generate: v0 API error ${String(res.status)}: ${body}`, {}),
			);
		}

		const data = await res.json() as Record<string, unknown>;
		return Ok({
			generation_id: data['id'],
			parent_id: generationId,
			status: data['status'],
			code: data['code'],
			url: data['url'],
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`app-generate: iterate failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function getGeneration(
	apiKey: string,
	args: Readonly<Record<string, unknown>>,
) {
	const generationId = args['generation_id'] as string;

	if (!generationId) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'app-generate: get-generation requires generation_id', {}),
		);
	}

	try {
		const res = await fetch(`${V0_API_BASE}/generations/${encodeURIComponent(generationId)}`, {
			headers: {
				'Authorization': `Bearer ${apiKey}`,
			},
		});

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `app-generate: v0 API error ${String(res.status)}: ${body}`, {}),
			);
		}

		const data = await res.json() as Record<string, unknown>;
		return Ok({
			generation_id: data['id'],
			status: data['status'],
			code: data['code'],
			url: data['url'],
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`app-generate: get-generation failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}
