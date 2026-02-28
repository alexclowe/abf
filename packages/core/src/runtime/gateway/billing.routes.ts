/**
 * Billing routes — balance, usage history, top-up, and pricing.
 *
 * GET  /api/billing/balance — current balance + usage summary
 * GET  /api/billing/usage   — detailed usage history
 * POST /api/billing/topup   — add credits
 * GET  /api/billing/pricing — per-model pricing table
 */

import type { Hono } from 'hono';
import type { ISOTimestamp } from '../../types/common.js';
import type { IBillingLedger } from '../../billing/types.js';
import type { IProviderRegistry } from '../../types/provider.js';

export interface BillingRoutesDeps {
	readonly ledger: IBillingLedger;
	readonly providerRegistry: IProviderRegistry;
}

export function registerBillingRoutes(app: Hono, deps: BillingRoutesDeps): void {
	app.get('/api/billing/balance', async (c) => {
		const balance = await deps.ledger.getBalance();
		return c.json(balance);
	});

	app.get('/api/billing/usage', async (c) => {
		const since = c.req.query('since') ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
		const agentId = c.req.query('agentId');
		const model = c.req.query('model');

		let records = await deps.ledger.getUsage(since as ISOTimestamp);

		if (agentId) {
			records = records.filter((r) => r.agentId === agentId);
		}
		if (model) {
			records = records.filter((r) => r.model === model);
		}

		// Aggregate by agent
		const byAgent: Record<string, { totalCents: number; sessions: number; tokens: number }> = {};
		for (const r of records) {
			const entry = byAgent[r.agentId] ?? { totalCents: 0, sessions: 0, tokens: 0 };
			entry.totalCents += r.costCents as number;
			entry.sessions++;
			entry.tokens += r.inputTokens + r.outputTokens;
			byAgent[r.agentId] = entry;
		}

		return c.json({ records, byAgent, totalRecords: records.length });
	});

	app.post('/api/billing/topup', async (c) => {
		const body = await c.req.json<{ amountCents?: number; source?: string }>().catch((): { amountCents?: number; source?: string } => ({}));
		const amount = body.amountCents;
		if (typeof amount !== 'number' || amount <= 0) {
			return c.json({ error: 'amountCents must be a positive number' }, 400);
		}

		await deps.ledger.credit(amount, body.source ?? 'manual');
		const balance = await deps.ledger.getBalance();
		return c.json({ success: true, balance });
	});

	app.get('/api/billing/pricing', async (c) => {
		const providers = deps.providerRegistry.getAll();
		const pricing: Array<{ provider: string; model: string; costPer1kInput: number; costPer1kOutput: number }> = [];

		for (const p of providers) {
			try {
				const models = await p.models();
				for (const m of models) {
					pricing.push({
						provider: p.slug,
						model: m.id,
						costPer1kInput: (m.costPerInputToken ?? 0) * 1000,
						costPer1kOutput: (m.costPerOutputToken ?? 0) * 1000,
					});
				}
			} catch {
				// Skip unavailable providers
			}
		}

		return c.json(pricing);
	});
}
