/**
 * Seed routes — the seed-to-company pipeline API.
 *
 * Provides endpoints for:
 * - Uploading and parsing seed documents (docx, pdf, txt, md)
 * - Analyzing seed docs into a CompanyPlan via LLM
 * - Applying a CompanyPlan (generating files + reloading agents)
 * - Interactive interview to build a seed doc step-by-step
 * - Re-analyzing updated seed docs against an existing plan
 */

import { access, writeFile as writeFileFs } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import type { Hono } from 'hono';
import type { AgentConfig } from '../../types/agent.js';
import type { IScheduler } from '../interfaces.js';
import type { GatewayDeps } from './http.gateway.js';

export interface SeedRouteDeps extends GatewayDeps {
	readonly scheduler: IScheduler;
}

export function registerSeedRoutes(app: Hono, deps: SeedRouteDeps): void {
	// Lazily-created interview engine (persists across requests)
	let interviewEngine: import('../../seed/interview.js').InterviewEngine | null = null;

	// ── 1. POST /api/seed/upload ─────────────────────────────────────────
	app.post('/api/seed/upload', async (c) => {
		try {
			const body = await c.req.json<{
				text?: string;
				format?: 'docx' | 'pdf' | 'txt' | 'md';
			}>().catch(() => ({}) as { text?: string; format?: string });

			if (!body.text) {
				return c.json({ error: 'text is required' }, 400);
			}

			let extractedText: string;

			if (body.format === 'docx' || body.format === 'pdf') {
				// Binary content — decode base64 to Buffer, then parse
				const buffer = Buffer.from(body.text, 'base64');
				const { extractText } = await import('../../seed/parser.js');
				extractedText = await extractText(buffer, body.format);
			} else {
				// Plain text / markdown — use directly
				extractedText = body.text;
			}

			const wordCount = extractedText.split(/\s+/).filter(Boolean).length;

			return c.json({ text: extractedText, wordCount });
		} catch (e) {
			return c.json(
				{ error: `Upload failed: ${e instanceof Error ? e.message : String(e)}` },
				500,
			);
		}
	});

	// ── 2. POST /api/seed/analyze ────────────────────────────────────────
	app.post('/api/seed/analyze', async (c) => {
		try {
			const body = await c.req.json<{
				seedText?: string;
				provider?: string;
				model?: string;
			}>().catch(() => ({}) as { seedText?: string; provider?: string; model?: string });

			if (!body.seedText) {
				return c.json({ error: 'seedText is required' }, 400);
			}

			const provider = body.provider ?? 'anthropic';
			const model = body.model ?? 'claude-sonnet-4-5';

			const { analyzeSeedDoc } = await import('../../seed/analyzer.js');
			const plan = await analyzeSeedDoc(deps.providerRegistry, {
				seedText: body.seedText,
				provider,
				model,
			});

			return c.json(plan);
		} catch (e) {
			return c.json(
				{ error: `Analysis failed: ${e instanceof Error ? e.message : String(e)}` },
				500,
			);
		}
	});

	// ── 3. POST /api/seed/apply ──────────────────────────────────────────
	app.post('/api/seed/apply', async (c) => {
		try {
			const body = await c.req.json<{
				plan?: import('../../seed/types.js').CompanyPlan;
				provider?: string;
				model?: string;
			}>().catch(() => ({}) as {
				plan?: import('../../seed/types.js').CompanyPlan;
				provider?: string;
				model?: string;
			});

			if (!body.plan) {
				return c.json({ error: 'plan is required' }, 400);
			}

			const provider = body.provider ?? 'anthropic';
			const model = body.model ?? 'claude-sonnet-4-5';

			const { applyCompanyPlan } = await import('../../seed/apply.js');
			const filesWritten = await applyCompanyPlan(
				body.plan,
				deps.projectRoot,
				provider,
				model,
			);

			// Generate abf.config.yaml if it doesn't exist
			const configPath = join(deps.projectRoot, 'abf.config.yaml');
			try {
				await access(configPath);
			} catch {
				const companyName = body.plan.company?.name ?? 'abf';
				const safeName = companyName.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
				const configContent = yamlStringify({
					name: safeName,
					version: '0.1.0',
					storage: { backend: 'filesystem' },
					bus: { backend: 'in-process' },
					gateway: { enabled: true, host: '0.0.0.0', port: 3000 },
				});
				await writeFileFs(configPath, configContent, 'utf-8');
			}

			// Reload agents from disk (same pattern as setup.routes.ts)
			const { loadAgentConfigs } = await import('../../config/loader.js');
			const agentsDir = join(deps.projectRoot, 'agents');
			const loadResult = await loadAgentConfigs(agentsDir);

			if (!loadResult.ok) {
				return c.json(
					{ error: `Files written but failed to reload agents: ${loadResult.error.message}` },
					500,
				);
			}

			const agentsMap = deps.agentsMap as Map<string, AgentConfig>;
			const newAgents: { id: string; name: string; displayName: string; role: string }[] = [];

			for (const agent of loadResult.value) {
				if (!agentsMap.has(agent.id)) {
					agentsMap.set(agent.id, agent);
					deps.scheduler.registerAgent(agent);
					deps.dispatcher.registerAgent(agent);
				}
				newAgents.push({
					id: agent.id,
					name: agent.name,
					displayName: agent.displayName,
					role: agent.role,
				});
			}

			return c.json({
				success: true,
				filesWritten,
				agents: newAgents,
			});
		} catch (e) {
			return c.json(
				{ error: `Apply failed: ${e instanceof Error ? e.message : String(e)}` },
				500,
			);
		}
	});

	// ── 4. POST /api/seed/interview/start ────────────────────────────────
	app.post('/api/seed/interview/start', async (c) => {
		try {
			const body = await c.req.json<{
				companyType?: 'new' | 'existing';
				provider?: string;
				model?: string;
			}>().catch(() => ({}) as { companyType?: string; provider?: string; model?: string });

			if (!body.companyType || (body.companyType !== 'new' && body.companyType !== 'existing')) {
				return c.json({ error: 'companyType is required (must be "new" or "existing")' }, 400);
			}

			const provider = body.provider ?? 'anthropic';
			const model = body.model ?? 'claude-sonnet-4-5';

			// Lazily create the interview engine
			if (!interviewEngine) {
				const { InterviewEngine } = await import('../../seed/interview.js');
				interviewEngine = new InterviewEngine(deps.providerRegistry, provider, model);
			}

			const { sessionId, step } = await interviewEngine.start(body.companyType);

			return c.json({ sessionId, step });
		} catch (e) {
			return c.json(
				{ error: `Interview start failed: ${e instanceof Error ? e.message : String(e)}` },
				500,
			);
		}
	});

	// ── 5. POST /api/seed/interview/:sessionId/respond ───────────────────
	app.post('/api/seed/interview/:sessionId/respond', async (c) => {
		try {
			const sessionId = c.req.param('sessionId');

			const body = await c.req.json<{ answer?: string }>().catch(() => ({}) as { answer?: string });

			if (!body.answer) {
				return c.json({ error: 'answer is required' }, 400);
			}

			if (!interviewEngine) {
				return c.json({ error: 'No interview engine initialized. Start an interview first.' }, 400);
			}

			const session = interviewEngine.getSession(sessionId);
			if (!session) {
				return c.json({ error: 'Interview session not found' }, 404);
			}

			const step = await interviewEngine.respond(sessionId, body.answer);

			return c.json(step);
		} catch (e) {
			return c.json(
				{ error: `Interview respond failed: ${e instanceof Error ? e.message : String(e)}` },
				500,
			);
		}
	});

	// ── 6. GET /api/seed/interview/:sessionId ────────────────────────────
	app.get('/api/seed/interview/:sessionId', (c) => {
		const sessionId = c.req.param('sessionId');

		if (!interviewEngine) {
			return c.json({ error: 'No interview engine initialized. Start an interview first.' }, 404);
		}

		const session = interviewEngine.getSession(sessionId);
		if (!session) {
			return c.json({ error: 'Interview session not found' }, 404);
		}

		return c.json(session);
	});

	// ── 7. POST /api/seed/reanalyze ──────────────────────────────────────
	app.post('/api/seed/reanalyze', async (c) => {
		try {
			const body = await c.req.json<{
				originalSeedText?: string;
				updatedSeedText?: string;
				currentPlan?: import('../../seed/types.js').CompanyPlan;
				provider?: string;
				model?: string;
			}>().catch(() => ({}) as {
				originalSeedText?: string;
				updatedSeedText?: string;
				currentPlan?: import('../../seed/types.js').CompanyPlan;
				provider?: string;
				model?: string;
			});

			if (!body.originalSeedText) {
				return c.json({ error: 'originalSeedText is required' }, 400);
			}
			if (!body.updatedSeedText) {
				return c.json({ error: 'updatedSeedText is required' }, 400);
			}
			if (!body.currentPlan) {
				return c.json({ error: 'currentPlan is required' }, 400);
			}

			const provider = body.provider ?? 'anthropic';
			const model = body.model ?? 'claude-sonnet-4-5';

			const { reanalyzeSeedDoc } = await import('../../seed/analyzer.js');
			const updatedPlan = await reanalyzeSeedDoc(deps.providerRegistry, {
				seedText: body.updatedSeedText,
				originalSeedText: body.originalSeedText,
				currentPlan: body.currentPlan,
				provider,
				model,
			});

			return c.json(updatedPlan);
		} catch (e) {
			return c.json(
				{ error: `Reanalysis failed: ${e instanceof Error ? e.message : String(e)}` },
				500,
			);
		}
	});
}
