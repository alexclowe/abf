/**
 * ABF Cloud Gateway — the server-side component that proxies LLM requests.
 *
 * This is the service that runs at api.abf.cloud/v1. It:
 * 1. Validates bearer tokens
 * 2. Checks billing balance
 * 3. Routes to configured LLM providers (Anthropic, OpenAI)
 * 4. Streams responses back as NDJSON
 * 5. Records usage for billing
 *
 * Can be deployed as a standalone Hono service.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { stream } from 'hono/streaming';
import type { IProviderRegistry } from '../types/provider.js';
import type { IBillingLedger, UsageRecord } from '../billing/types.js';
import type { AgentId, SessionId, USDCents } from '../types/common.js';
import { toISOTimestamp, createSessionId } from '../util/id.js';
import {
	validateToken,
	type ITokenStore,
	type CloudToken,
} from './token.js';

export interface CloudGatewayConfig {
	/** Port to listen on. Default: 8787. */
	readonly port: number;
	/** Allowed CORS origins. */
	readonly allowedOrigins?: readonly string[];
}

export interface CloudGatewayDeps {
	readonly providerRegistry: IProviderRegistry;
	readonly tokenStore: ITokenStore;
	readonly billingLedger: IBillingLedger;
}

/**
 * Create the ABF Cloud Gateway Hono app.
 * Can be served directly or mounted as a sub-app.
 */
export function createCloudGateway(deps: CloudGatewayDeps): Hono {
	const app = new Hono();

	// CORS
	app.use('*', cors({ origin: '*' }));

	// Health check
	app.get('/health', (c) => c.json({ status: 'ok', service: 'abf-cloud' }));

	// Auth middleware — extract and validate token
	app.use('/v1/*', async (c, next) => {
		const authHeader = c.req.header('Authorization');
		if (!authHeader?.startsWith('Bearer ')) {
			return c.json({ error: 'Missing or invalid Authorization header' }, 401);
		}

		const rawToken = authHeader.slice(7);
		const result = await validateToken(rawToken, deps.tokenStore);

		if (!result.valid || !result.token) {
			return c.json({ error: result.reason ?? 'Invalid token' }, 401);
		}

		// Attach token to context for downstream handlers
		c.set('cloudToken' as never, result.token as never);
		await next();
	});

	// POST /v1/chat — proxy LLM chat request
	app.post('/v1/chat', async (c) => {
		const token = c.get('cloudToken' as never) as CloudToken;

		const body = await c.req.json<{
			model?: string;
			messages?: Array<{ role: string; content: string }>;
			temperature?: number;
			provider?: string;
		}>().catch((): { model?: string; messages?: Array<{ role: string; content: string }>; temperature?: number; provider?: string } => ({}));

		if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
			return c.json({ error: 'messages array is required' }, 400);
		}

		// Check balance
		const balance = await deps.billingLedger.getBalance();
		if (balance.balanceCents <= 0) {
			return c.json({ error: 'Insufficient balance. Please add credits.' }, 402);
		}

		// Find provider
		const providerSlug = body.provider ?? 'anthropic';
		const provider = deps.providerRegistry.getBySlug(providerSlug);
		if (!provider) {
			return c.json({ error: `Provider "${providerSlug}" not available` }, 400);
		}

		const model = body.model ?? 'claude-sonnet-4-6';
		const sessionId = createSessionId();

		// Stream response as NDJSON
		return stream(c, async (s) => {
			let inputTokens = 0;
			let outputTokens = 0;

			try {
				const chunks = provider.chat({
					model,
					messages: body.messages!.map((m) => ({
						role: m.role as 'user' | 'assistant' | 'system',
						content: m.content,
					})),
					temperature: body.temperature ?? 0.3,
				});

				for await (const chunk of chunks) {
					if (chunk.type === 'text' && chunk.text) {
						await s.write(`${JSON.stringify({ content: chunk.text })}\n`);
					}
					if (chunk.type === 'usage' && chunk.usage) {
						inputTokens = chunk.usage.inputTokens ?? 0;
						outputTokens = chunk.usage.outputTokens ?? 0;
					}
				}

				// Send done marker with usage
				await s.write(`${JSON.stringify({
					done: true,
					usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
				})}\n`);

				// Record usage (fire-and-forget)
				const costCents = provider.estimateCost(model, inputTokens + outputTokens);
				const record: UsageRecord = {
					agentId: token.accountId as AgentId,
					sessionId: sessionId as SessionId,
					provider: providerSlug,
					model,
					inputTokens,
					outputTokens,
					costCents: costCents as USDCents,
					timestamp: toISOTimestamp(),
				};
				void deps.billingLedger.debit(record);
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Provider error';
				await s.write(`${JSON.stringify({ error: message })}\n`);
			}
		});
	});

	// GET /v1/models — list available models
	app.get('/v1/models', async (c) => {
		const providers = deps.providerRegistry.getAll();
		const models: Array<{ id: string; provider: string; name: string }> = [];

		for (const p of providers) {
			try {
				const providerModels = await p.models();
				for (const m of providerModels) {
					models.push({ id: m.id, provider: p.slug, name: m.name ?? m.id });
				}
			} catch {
				// Skip unavailable
			}
		}

		return c.json({ models });
	});

	// GET /v1/balance — check account balance
	app.get('/v1/balance', async (c) => {
		const balance = await deps.billingLedger.getBalance();
		return c.json(balance);
	});

	return app;
}
