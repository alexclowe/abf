/**
 * social-publish -- publish and schedule social media posts via Buffer REST API.
 * Supports: publish, schedule, list-scheduled, analytics, list-profiles.
 * Write actions (publish, schedule) are queued for approval if an approval store is configured.
 * Pure fetch — no npm SDK required.
 */
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { AgentId, SessionId, ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import { toISOTimestamp } from '../../util/id.js';
import type { BuiltinToolContext } from './context.js';
import { credentialError } from './credential-error.js';
import { cloudProxyCall, getCloudToken } from './cloud-proxy-call.js';

const BUFFER_API = 'https://api.bufferapp.com/1';

// Rate limit: max 5 publish/schedule actions per agent per runtime session
const sessionWriteCounts = new Map<string, number>();
const MAX_WRITES_PER_SESSION = 5;

const VALID_ACTIONS = ['publish', 'schedule', 'list-scheduled', 'analytics', 'list-profiles'] as const;

export function createSocialPublishTool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'social-publish' as ToolId,
		name: 'social-publish',
		description:
			'Publish and schedule social media posts via Buffer. ' +
			'Supports publish, schedule, list-scheduled, analytics, and list-profiles actions.',
		source: 'registry',
		parameters: [
			{
				name: 'action',
				type: 'string',
				description:
					"Action to perform: 'publish', 'schedule', 'list-scheduled', 'analytics', or 'list-profiles'",
				required: true,
			},
			{
				name: 'profile_id',
				type: 'string',
				description: 'Buffer profile ID (required for publish, schedule, list-scheduled)',
				required: false,
			},
			{
				name: 'text',
				type: 'string',
				description: 'Post text content (required for publish, schedule)',
				required: false,
			},
			{
				name: 'link',
				type: 'string',
				description: 'URL to share with the post',
				required: false,
			},
			{
				name: 'image_url',
				type: 'string',
				description: 'Image URL to attach to the post',
				required: false,
			},
			{
				name: 'scheduled_at',
				type: 'string',
				description: 'ISO datetime for scheduling (required for schedule action)',
				required: false,
			},
			{
				name: 'post_id',
				type: 'string',
				description: 'Buffer post/update ID (required for analytics action)',
				required: false,
			},
			{
				name: 'limit',
				type: 'number',
				description: 'Number of results to return (default 10)',
				required: false,
			},
		],
		estimatedCost: 0 as USDCents,
		timeout: 15_000,
	};

	return {
		definition,
		async execute(args) {
			const action = args['action'];
			if (typeof action !== 'string' || !(VALID_ACTIONS as readonly string[]).includes(action)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`social-publish: action must be one of: ${VALID_ACTIONS.join(', ')}`,
						{},
					),
				);
			}

			// Cloud proxy: forward to ABF Cloud if running in cloud mode
			if (ctx.isCloud && ctx.cloudEndpoint) {
				const cloudToken = await getCloudToken(ctx);
				if (cloudToken) {
					return cloudProxyCall(ctx.cloudEndpoint, 'social-publish', { action, ...args }, cloudToken);
				}
			}

			// Get Buffer access token: env var first, then vault
			let token = process.env['BUFFER_ACCESS_TOKEN'];
			if (!token) {
				const vaultToken = await ctx.vault.get('buffer', 'access_token');
				if (vaultToken) token = vaultToken;
			}

			if (!token) {
				return Ok(credentialError(ctx.isCloud, {
					provider: 'buffer',
					envVar: 'BUFFER_ACCESS_TOKEN',
					dashboardPath: '/settings/integrations/buffer',
					displayName: 'Buffer',
				}));
			}

			switch (action) {
				case 'list-profiles':
					return listProfiles(token);
				case 'publish':
					return publish(ctx, args, token);
				case 'schedule':
					return schedule(ctx, args, token);
				case 'list-scheduled':
					return listScheduled(args, token);
				case 'analytics':
					return getAnalytics(args, token);
				default:
					return Err(
						new ToolError(
							'TOOL_EXECUTION_FAILED',
							`social-publish: unknown action '${action}'`,
							{},
						),
					);
			}
		},
	};
}

// ─── list-profiles ──────────────────────────────────────────────────

async function listProfiles(token: string) {
	try {
		const resp = await fetch(`${BUFFER_API}/profiles.json?access_token=${token}`);
		if (!resp.ok) {
			return Err(
				new ToolError(
					'TOOL_EXECUTION_FAILED',
					`social-publish: Buffer API error ${String(resp.status)}: ${resp.statusText}`,
					{ status: resp.status },
				),
			);
		}
		const profiles = await resp.json();
		return Ok({ profiles });
	} catch (e) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`social-publish: list-profiles failed: ${e instanceof Error ? e.message : String(e)}`,
				{},
			),
		);
	}
}

// ─── publish ────────────────────────────────────────────────────────

async function publish(
	ctx: BuiltinToolContext,
	args: Readonly<Record<string, unknown>>,
	token: string,
) {
	const profileId = args['profile_id'];
	const text = args['text'];

	if (typeof profileId !== 'string' || !profileId.trim()) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'social-publish: profile_id is required for publish', {}),
		);
	}
	if (typeof text !== 'string' || !text.trim()) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'social-publish: text is required for publish', {}),
		);
	}

	// Rate limit check
	const agentId = (args['_agentId'] as string) ?? 'unknown';
	const rateKey = `publish:${agentId}`;
	const count = sessionWriteCounts.get(rateKey) ?? 0;
	if (count >= MAX_WRITES_PER_SESSION) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`social-publish: rate limit reached (max ${String(MAX_WRITES_PER_SESSION)} publish/schedule actions per session)`,
				{},
			),
		);
	}

	// Approval check
	if (ctx.approvalStore) {
		const approvalId = ctx.approvalStore.create({
			agentId: (args['_agentId'] as AgentId) ?? ('unknown' as AgentId),
			sessionId: (args['_sessionId'] as SessionId) ?? ('unknown' as SessionId),
			toolId: 'social-publish' as ToolId,
			toolName: 'social-publish',
			arguments: { action: 'publish', profile_id: profileId, text, link: args['link'], image_url: args['image_url'] },
			createdAt: toISOTimestamp(),
		});
		return Ok({
			published: false,
			queued: true,
			approvalId,
			message: 'Post queued for approval. An operator must approve before publishing.',
		});
	}

	sessionWriteCounts.set(rateKey, count + 1);

	try {
		const body = new URLSearchParams({
			'profile_ids[]': profileId,
			'text': text,
			'now': 'true',
		});
		if (typeof args['link'] === 'string' && args['link'].trim()) {
			body.set('media[link]', args['link']);
		}
		if (typeof args['image_url'] === 'string' && args['image_url'].trim()) {
			body.set('media[photo]', args['image_url']);
		}

		const resp = await fetch(`${BUFFER_API}/updates/create.json?access_token=${token}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
		});

		if (!resp.ok) {
			const errorBody = await resp.text();
			return Err(
				new ToolError(
					'TOOL_EXECUTION_FAILED',
					`social-publish: Buffer API error ${String(resp.status)}: ${errorBody}`,
					{ status: resp.status },
				),
			);
		}

		const data = await resp.json();
		return Ok({ published: true, update: data });
	} catch (e) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`social-publish: publish failed: ${e instanceof Error ? e.message : String(e)}`,
				{},
			),
		);
	}
}

// ─── schedule ───────────────────────────────────────────────────────

async function schedule(
	ctx: BuiltinToolContext,
	args: Readonly<Record<string, unknown>>,
	token: string,
) {
	const profileId = args['profile_id'];
	const text = args['text'];
	const scheduledAt = args['scheduled_at'];

	if (typeof profileId !== 'string' || !profileId.trim()) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'social-publish: profile_id is required for schedule', {}),
		);
	}
	if (typeof text !== 'string' || !text.trim()) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'social-publish: text is required for schedule', {}),
		);
	}
	if (typeof scheduledAt !== 'string' || !scheduledAt.trim()) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'social-publish: scheduled_at is required for schedule (ISO datetime)',
				{},
			),
		);
	}

	// Rate limit check
	const agentId = (args['_agentId'] as string) ?? 'unknown';
	const rateKey = `publish:${agentId}`;
	const count = sessionWriteCounts.get(rateKey) ?? 0;
	if (count >= MAX_WRITES_PER_SESSION) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`social-publish: rate limit reached (max ${String(MAX_WRITES_PER_SESSION)} publish/schedule actions per session)`,
				{},
			),
		);
	}

	// Approval check
	if (ctx.approvalStore) {
		const approvalId = ctx.approvalStore.create({
			agentId: (args['_agentId'] as AgentId) ?? ('unknown' as AgentId),
			sessionId: (args['_sessionId'] as SessionId) ?? ('unknown' as SessionId),
			toolId: 'social-publish' as ToolId,
			toolName: 'social-publish',
			arguments: {
				action: 'schedule',
				profile_id: profileId,
				text,
				scheduled_at: scheduledAt,
				link: args['link'],
				image_url: args['image_url'],
			},
			createdAt: toISOTimestamp(),
		});
		return Ok({
			scheduled: false,
			queued: true,
			approvalId,
			message: 'Scheduled post queued for approval. An operator must approve before scheduling.',
		});
	}

	sessionWriteCounts.set(rateKey, count + 1);

	try {
		const body = new URLSearchParams({
			'profile_ids[]': profileId,
			'text': text,
			'scheduled_at': scheduledAt,
			'now': 'false',
		});
		if (typeof args['link'] === 'string' && args['link'].trim()) {
			body.set('media[link]', args['link']);
		}
		if (typeof args['image_url'] === 'string' && args['image_url'].trim()) {
			body.set('media[photo]', args['image_url']);
		}

		const resp = await fetch(`${BUFFER_API}/updates/create.json?access_token=${token}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
		});

		if (!resp.ok) {
			const errorBody = await resp.text();
			return Err(
				new ToolError(
					'TOOL_EXECUTION_FAILED',
					`social-publish: Buffer API error ${String(resp.status)}: ${errorBody}`,
					{ status: resp.status },
				),
			);
		}

		const data = await resp.json();
		return Ok({ scheduled: true, update: data });
	} catch (e) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`social-publish: schedule failed: ${e instanceof Error ? e.message : String(e)}`,
				{},
			),
		);
	}
}

// ─── list-scheduled ─────────────────────────────────────────────────

async function listScheduled(args: Readonly<Record<string, unknown>>, token: string) {
	const profileId = args['profile_id'];
	if (typeof profileId !== 'string' || !profileId.trim()) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'social-publish: profile_id is required for list-scheduled',
				{},
			),
		);
	}

	const limit = typeof args['limit'] === 'number' ? Math.max(1, Math.min(100, args['limit'])) : 10;

	try {
		const resp = await fetch(
			`${BUFFER_API}/profiles/${profileId}/updates/pending.json?access_token=${token}&count=${String(limit)}`,
		);
		if (!resp.ok) {
			return Err(
				new ToolError(
					'TOOL_EXECUTION_FAILED',
					`social-publish: Buffer API error ${String(resp.status)}: ${resp.statusText}`,
					{ status: resp.status },
				),
			);
		}

		const data = (await resp.json()) as { updates?: unknown[]; total?: number };
		return Ok({ updates: data.updates ?? [], total: data.total ?? 0 });
	} catch (e) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`social-publish: list-scheduled failed: ${e instanceof Error ? e.message : String(e)}`,
				{},
			),
		);
	}
}

// ─── analytics ──────────────────────────────────────────────────────

async function getAnalytics(args: Readonly<Record<string, unknown>>, token: string) {
	const postId = args['post_id'];
	if (typeof postId !== 'string' || !postId.trim()) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'social-publish: post_id is required for analytics',
				{},
			),
		);
	}

	try {
		const resp = await fetch(
			`${BUFFER_API}/updates/${postId}/interactions.json?access_token=${token}`,
		);
		if (!resp.ok) {
			return Err(
				new ToolError(
					'TOOL_EXECUTION_FAILED',
					`social-publish: Buffer API error ${String(resp.status)}: ${resp.statusText}`,
					{ status: resp.status },
				),
			);
		}

		const data = await resp.json();
		return Ok({ interactions: data });
	} catch (e) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`social-publish: analytics failed: ${e instanceof Error ? e.message : String(e)}`,
				{},
			),
		);
	}
}
