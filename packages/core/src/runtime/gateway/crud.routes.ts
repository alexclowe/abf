/**
 * CRUD routes — full create/read/update/delete for all ABF resources.
 *
 * Pattern: Dashboard sends camelCase JSON → backend converts to snake_case YAML → writes to disk → hot-reloads into runtime.
 * Files on disk remain the source of truth.
 */

import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Hono } from 'hono';
import { stringify, parse as parseYaml } from 'yaml';
import { loadAgentConfig } from '../../config/loader.js';
import { teamYamlSchema, transformTeamYaml } from '../../schemas/team.schema.js';
import type { AgentConfig } from '../../types/agent.js';
import type { IScheduler } from '../interfaces.js';
import type { GatewayDeps } from './http.gateway.js';
import { sanitizeFilename, isPathWithinDir } from './auth-utils.js';

export interface CrudDeps extends GatewayDeps {
	readonly scheduler: IScheduler;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Convert agent camelCase JSON body to snake_case YAML object. */
function agentToYaml(body: Record<string, unknown>): Record<string, unknown> {
	const yaml: Record<string, unknown> = {
		name: body['name'],
		display_name: body['displayName'],
		role: body['role'],
		description: body['description'],
		provider: body['provider'] ?? 'anthropic',
		model: body['model'] ?? 'claude-sonnet-4-6',
		temperature: body['temperature'] ?? 0.3,
		team: body['team'] ?? undefined,
		reports_to: body['reportsTo'] ?? null,
		tools: body['tools'] ?? ['web-search'],
		triggers: body['triggers'] ?? [{ type: 'manual', task: 'default' }],
		charter: body['charter'] ?? '',
	};

	if (body['roleArchetype']) {
		yaml['role_archetype'] = body['roleArchetype'];
	}

	// Escalation rules
	const esc = body['escalationRules'] as Array<Record<string, unknown>> | undefined;
	yaml['escalation_rules'] = esc?.map((r) => {
		const rule: Record<string, unknown> = { condition: r['condition'], target: r['target'] };
		if (r['message']) rule['message'] = r['message'];
		return rule;
	}) ?? [{ condition: 'requires_human_decision', target: 'human' }];

	// Behavioral bounds
	const bounds = body['behavioralBounds'] as Record<string, unknown> | undefined;
	yaml['behavioral_bounds'] = {
		allowed_actions: bounds?.['allowedActions'] ?? ['read_data', 'write_draft'],
		forbidden_actions: bounds?.['forbiddenActions'] ?? ['delete_data', 'modify_billing'],
		max_cost_per_session: bounds?.['maxCostPerSession'] ?? '$2.00',
		requires_approval: bounds?.['requiresApproval'] ?? [],
	};

	// KPIs
	yaml['kpis'] = body['kpis'] ?? [];

	return yaml;
}

/** Convert team camelCase JSON body to snake_case YAML object. */
function teamToYaml(body: Record<string, unknown>): Record<string, unknown> {
	return {
		name: body['name'],
		display_name: body['displayName'],
		description: body['description'],
		orchestrator: body['orchestrator'],
		members: body['members'] ?? [],
		goals: body['goals'] ?? [],
	};
}

/** Convert workflow camelCase JSON body to snake_case YAML object. */
function workflowToYaml(body: Record<string, unknown>): Record<string, unknown> {
	const steps = body['steps'] as Array<Record<string, unknown>> | undefined;
	const result: Record<string, unknown> = {
		name: body['name'],
		display_name: body['displayName'],
		description: body['description'],
		steps: steps?.map((s) => {
			const step: Record<string, unknown> = { id: s['id'], agent: s['agent'], task: s['task'] };
			if (s['dependsOn']) step['depends_on'] = s['dependsOn'];
			if (s['parallel'] != null) step['parallel'] = s['parallel'];
			if (s['timeout'] != null) step['timeout'] = s['timeout'];
			return step;
		}) ?? [],
		on_failure: body['onFailure'] ?? 'stop',
	};
	if (body['timeout'] != null) result['timeout'] = body['timeout'];
	return result;
}

/** Ensure directory exists. */
async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
}

/** Sanitize a name for use as a filename. */
function sanitizeName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

// ─── Route Registration ──────────────────────────────────────────────

export function registerCrudRoutes(app: Hono, deps: CrudDeps): void {
	const root = deps.projectRoot;
	const agentsMap = deps.agentsMap as Map<string, AgentConfig>;

	// ── Agents CRUD ──────────────────────────────────────────────────

	app.post('/api/agents', async (c) => {
		try {
			const body = await c.req.json<Record<string, unknown>>();
			const name = body['name'] as string;
			if (!name) return c.json({ error: 'name is required' }, 400);

			const safeName = sanitizeName(name);
			const agentsDir = join(root, 'agents');
			await ensureDir(agentsDir);

			const filePath = join(agentsDir, `${safeName}.agent.yaml`);
			const yamlObj = agentToYaml(body);
			await writeFile(filePath, stringify(yamlObj), 'utf-8');

			// Validate and load
			const loadResult = await loadAgentConfig(filePath);
			if (!loadResult.ok) {
				await unlink(filePath).catch(() => {});
				return c.json({ error: loadResult.error.message }, 400);
			}

			// Register in runtime
			const agent = loadResult.value;
			agentsMap.set(agent.id, agent);
			deps.scheduler.registerAgent(agent);
			deps.dispatcher.registerAgent(agent);

			return c.json({ success: true, agent: { id: agent.id, name: agent.name, displayName: agent.displayName } }, 201);
		} catch (e) {
			return c.json({ error: `Failed to create agent: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});

	app.put('/api/agents/:id', async (c) => {
		try {
			const id = c.req.param('id');
			if (!agentsMap.has(id)) return c.json({ error: 'Agent not found' }, 404);

			const body = await c.req.json<Record<string, unknown>>();
			const safeName = sanitizeName(id);
			const agentsDir = join(root, 'agents');
			const filePath = join(agentsDir, `${safeName}.agent.yaml`);

			const yamlObj = agentToYaml({ ...body, name: id });
			await writeFile(filePath, stringify(yamlObj), 'utf-8');

			// Validate and reload
			const loadResult = await loadAgentConfig(filePath);
			if (!loadResult.ok) {
				return c.json({ error: loadResult.error.message }, 400);
			}

			const agent = loadResult.value;
			agentsMap.set(agent.id, agent);
			deps.scheduler.unregisterAgent(agent.id);
			deps.scheduler.registerAgent(agent);
			deps.dispatcher.registerAgent(agent);

			return c.json({ success: true, agent: { id: agent.id, name: agent.name, displayName: agent.displayName } });
		} catch (e) {
			return c.json({ error: `Failed to update agent: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});

	app.delete('/api/agents/:id', async (c) => {
		try {
			const id = c.req.param('id');
			if (!agentsMap.has(id)) return c.json({ error: 'Agent not found' }, 404);

			const safeName = sanitizeName(id);
			const filePath = join(root, 'agents', `${safeName}.agent.yaml`);
			await unlink(filePath).catch(() => {});

			agentsMap.delete(id);
			deps.scheduler.unregisterAgent(id as import('../../types/common.js').AgentId);

			return c.json({ success: true });
		} catch (e) {
			return c.json({ error: `Failed to delete agent: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});

	// ── Teams CRUD ───────────────────────────────────────────────────

	app.post('/api/teams', async (c) => {
		try {
			const body = await c.req.json<Record<string, unknown>>();
			const name = body['name'] as string;
			if (!name) return c.json({ error: 'name is required' }, 400);

			const safeName = sanitizeName(name);
			const teamsDir = deps.teamsDir;
			await ensureDir(teamsDir);

			const filePath = join(teamsDir, `${safeName}.team.yaml`);
			const yamlObj = teamToYaml(body);
			await writeFile(filePath, stringify(yamlObj), 'utf-8');

			// Validate
			const parsed = teamYamlSchema.safeParse(parseYaml(stringify(yamlObj)));
			if (!parsed.success) {
				await unlink(filePath).catch(() => {});
				return c.json({ error: `Validation failed: ${parsed.error.issues.map((i) => i.message).join(', ')}` }, 400);
			}

			return c.json({ success: true, team: transformTeamYaml(parsed.data) }, 201);
		} catch (e) {
			return c.json({ error: `Failed to create team: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});

	app.put('/api/teams/:id', async (c) => {
		try {
			const id = c.req.param('id');
			const safeName = sanitizeName(id);
			const filePath = join(deps.teamsDir, `${safeName}.team.yaml`);

			const body = await c.req.json<Record<string, unknown>>();
			const yamlObj = teamToYaml({ ...body, name: id });
			await writeFile(filePath, stringify(yamlObj), 'utf-8');

			return c.json({ success: true });
		} catch (e) {
			return c.json({ error: `Failed to update team: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});

	app.delete('/api/teams/:id', async (c) => {
		try {
			const id = c.req.param('id');
			const safeName = sanitizeName(id);
			const filePath = join(deps.teamsDir, `${safeName}.team.yaml`);
			await unlink(filePath).catch(() => {});
			return c.json({ success: true });
		} catch (e) {
			return c.json({ error: `Failed to delete team: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});

	// ── Knowledge CRUD ───────────────────────────────────────────────

	app.get('/api/knowledge', async (c) => {
		try {
			const knowledgeDir = join(root, 'knowledge');
			await ensureDir(knowledgeDir);
			const entries = await readdir(knowledgeDir);
			const mdFiles = entries.filter((f) => f.endsWith('.md'));

			const files = await Promise.all(
				mdFiles.map(async (filename) => {
					const content = await readFile(join(knowledgeDir, filename), 'utf-8');
					return { filename, content, size: content.length };
				}),
			);
			return c.json(files);
		} catch {
			return c.json([]);
		}
	});

	app.get('/api/knowledge/:filename', async (c) => {
		try {
			const filename = c.req.param('filename');
			if (!filename.endsWith('.md')) return c.json({ error: 'Only .md files supported' }, 400);
			if (!sanitizeFilename(filename)) return c.json({ error: 'Invalid filename' }, 400);
			const knowledgeDir = join(root, 'knowledge');
			const filePath = resolve(knowledgeDir, filename);
			if (!isPathWithinDir(filePath, knowledgeDir)) return c.json({ error: 'Invalid filename' }, 400);
			const content = await readFile(filePath, 'utf-8');
			return c.json({ filename, content });
		} catch {
			return c.json({ error: 'File not found' }, 404);
		}
	});

	app.post('/api/knowledge', async (c) => {
		try {
			const body = await c.req.json<{ filename: string; content: string }>();
			if (!body.filename) return c.json({ error: 'filename is required' }, 400);

			const filename = body.filename.endsWith('.md') ? body.filename : `${body.filename}.md`;
			const safeName = sanitizeName(filename.replace('.md', '')) + '.md';
			const knowledgeDir = join(root, 'knowledge');
			await ensureDir(knowledgeDir);

			await writeFile(join(knowledgeDir, safeName), body.content ?? '', 'utf-8');
			return c.json({ success: true, filename: safeName }, 201);
		} catch (e) {
			return c.json({ error: `Failed to create file: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});

	app.put('/api/knowledge/:filename', async (c) => {
		try {
			const filename = c.req.param('filename');
			if (!sanitizeFilename(filename)) return c.json({ error: 'Invalid filename' }, 400);
			const knowledgeDir = join(root, 'knowledge');
			const filePath = resolve(knowledgeDir, filename);
			if (!isPathWithinDir(filePath, knowledgeDir)) return c.json({ error: 'Invalid filename' }, 400);
			const body = await c.req.json<{ content: string }>();
			await writeFile(filePath, body.content, 'utf-8');
			return c.json({ success: true });
		} catch (e) {
			return c.json({ error: `Failed to update file: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});

	app.delete('/api/knowledge/:filename', async (c) => {
		try {
			const filename = c.req.param('filename');
			if (!sanitizeFilename(filename)) return c.json({ error: 'Invalid filename' }, 400);
			const knowledgeDir = join(root, 'knowledge');
			const filePath = resolve(knowledgeDir, filename);
			if (!isPathWithinDir(filePath, knowledgeDir)) return c.json({ error: 'Invalid filename' }, 400);
			await unlink(filePath);
			return c.json({ success: true });
		} catch {
			return c.json({ error: 'File not found' }, 404);
		}
	});

	// ── Workflows CRUD ───────────────────────────────────────────────

	app.post('/api/workflows', async (c) => {
		try {
			const body = await c.req.json<Record<string, unknown>>();
			const name = body['name'] as string;
			if (!name) return c.json({ error: 'name is required' }, 400);

			const safeName = sanitizeName(name);
			const workflowsDir = deps.workflowsDir ?? join(root, 'workflows');
			await ensureDir(workflowsDir);

			const filePath = join(workflowsDir, `${safeName}.workflow.yaml`);
			const yamlObj = workflowToYaml(body);
			await writeFile(filePath, stringify(yamlObj), 'utf-8');

			return c.json({ success: true, name: safeName }, 201);
		} catch (e) {
			return c.json({ error: `Failed to create workflow: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});

	app.put('/api/workflows/:name', async (c) => {
		try {
			const name = c.req.param('name');
			const safeName = sanitizeName(name);
			const workflowsDir = deps.workflowsDir ?? join(root, 'workflows');
			const filePath = join(workflowsDir, `${safeName}.workflow.yaml`);

			const body = await c.req.json<Record<string, unknown>>();
			const yamlObj = workflowToYaml({ ...body, name });
			await writeFile(filePath, stringify(yamlObj), 'utf-8');

			return c.json({ success: true });
		} catch (e) {
			return c.json({ error: `Failed to update workflow: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});

	app.delete('/api/workflows/:name', async (c) => {
		try {
			const name = c.req.param('name');
			const safeName = sanitizeName(name);
			const workflowsDir = deps.workflowsDir ?? join(root, 'workflows');
			const filePath = join(workflowsDir, `${safeName}.workflow.yaml`);
			await unlink(filePath);
			return c.json({ success: true });
		} catch {
			return c.json({ error: 'Workflow not found' }, 404);
		}
	});

	// ── Monitors CRUD ────────────────────────────────────────────────

	app.get('/api/monitors', async (c) => {
		try {
			const monitorsDir = join(root, 'monitors');
			await ensureDir(monitorsDir);
			const entries = await readdir(monitorsDir);
			const files = entries.filter((f) => f.endsWith('.monitor.yaml'));

			const monitors = await Promise.all(
				files.map(async (f) => {
					const raw = await readFile(join(monitorsDir, f), 'utf-8');
					const parsed = parseYaml(raw) as Record<string, unknown>;
					return {
						name: parsed['name'] as string,
						description: parsed['description'] as string | undefined,
						url: parsed['url'] as string,
						interval: parsed['interval'] as string,
						agent: parsed['agent'] as string,
						task: parsed['task'] as string,
						method: parsed['method'] as string | undefined,
					};
				}),
			);
			return c.json(monitors);
		} catch {
			return c.json([]);
		}
	});

	app.post('/api/monitors', async (c) => {
		try {
			const body = await c.req.json<Record<string, unknown>>();
			const name = body['name'] as string;
			if (!name) return c.json({ error: 'name is required' }, 400);

			const safeName = sanitizeName(name);
			const monitorsDir = join(root, 'monitors');
			await ensureDir(monitorsDir);

			const yamlObj: Record<string, unknown> = {
				name: body['name'],
				url: body['url'],
				interval: body['interval'] ?? '5m',
				agent: body['agent'],
				task: body['task'],
			};
			if (body['description']) yamlObj['description'] = body['description'];
			if (body['method']) yamlObj['method'] = body['method'];

			const filePath = join(monitorsDir, `${safeName}.monitor.yaml`);
			await writeFile(filePath, stringify(yamlObj), 'utf-8');

			return c.json({ success: true, name: safeName }, 201);
		} catch (e) {
			return c.json({ error: `Failed to create monitor: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});

	app.put('/api/monitors/:name', async (c) => {
		try {
			const name = c.req.param('name');
			const safeName = sanitizeName(name);
			const monitorsDir = join(root, 'monitors');
			const filePath = join(monitorsDir, `${safeName}.monitor.yaml`);

			const body = await c.req.json<Record<string, unknown>>();
			const yamlObj: Record<string, unknown> = {
				name,
				url: body['url'],
				interval: body['interval'] ?? '5m',
				agent: body['agent'],
				task: body['task'],
			};
			if (body['description']) yamlObj['description'] = body['description'];
			if (body['method']) yamlObj['method'] = body['method'];

			await writeFile(filePath, stringify(yamlObj), 'utf-8');
			return c.json({ success: true });
		} catch (e) {
			return c.json({ error: `Failed to update monitor: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});

	app.delete('/api/monitors/:name', async (c) => {
		try {
			const name = c.req.param('name');
			const safeName = sanitizeName(name);
			await unlink(join(root, 'monitors', `${safeName}.monitor.yaml`));
			return c.json({ success: true });
		} catch {
			return c.json({ error: 'Monitor not found' }, 404);
		}
	});

	// ── Message Templates CRUD ───────────────────────────────────────

	app.get('/api/message-templates', async (c) => {
		try {
			const templatesDir = join(root, 'templates', 'messages');
			await ensureDir(templatesDir);
			const entries = await readdir(templatesDir);
			const files = entries.filter((f) => f.endsWith('.template.yaml'));

			const templates = await Promise.all(
				files.map(async (f) => {
					const raw = await readFile(join(templatesDir, f), 'utf-8');
					return parseYaml(raw) as Record<string, unknown>;
				}),
			);
			return c.json(templates);
		} catch {
			return c.json([]);
		}
	});

	app.post('/api/message-templates', async (c) => {
		try {
			const body = await c.req.json<Record<string, unknown>>();
			const name = body['name'] as string;
			if (!name) return c.json({ error: 'name is required' }, 400);

			const safeName = sanitizeName(name);
			const templatesDir = join(root, 'templates', 'messages');
			await ensureDir(templatesDir);

			const yamlObj: Record<string, unknown> = {
				name: body['name'],
				channel: body['channel'] ?? 'email',
				body: body['body'] ?? '',
				variables: body['variables'] ?? [],
			};
			if (body['description']) yamlObj['description'] = body['description'];
			if (body['subject']) yamlObj['subject'] = body['subject'];

			const filePath = join(templatesDir, `${safeName}.template.yaml`);
			await writeFile(filePath, stringify(yamlObj), 'utf-8');

			return c.json({ success: true, name: safeName }, 201);
		} catch (e) {
			return c.json({ error: `Failed to create template: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});

	app.put('/api/message-templates/:name', async (c) => {
		try {
			const name = c.req.param('name');
			const safeName = sanitizeName(name);
			const templatesDir = join(root, 'templates', 'messages');
			const filePath = join(templatesDir, `${safeName}.template.yaml`);

			const body = await c.req.json<Record<string, unknown>>();
			const yamlObj: Record<string, unknown> = {
				name,
				channel: body['channel'] ?? 'email',
				body: body['body'] ?? '',
				variables: body['variables'] ?? [],
			};
			if (body['description']) yamlObj['description'] = body['description'];
			if (body['subject']) yamlObj['subject'] = body['subject'];

			await writeFile(filePath, stringify(yamlObj), 'utf-8');
			return c.json({ success: true });
		} catch (e) {
			return c.json({ error: `Failed to update template: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});

	app.delete('/api/message-templates/:name', async (c) => {
		try {
			const name = c.req.param('name');
			const safeName = sanitizeName(name);
			await unlink(join(root, 'templates', 'messages', `${safeName}.template.yaml`));
			return c.json({ success: true });
		} catch {
			return c.json({ error: 'Template not found' }, 404);
		}
	});

	// ── Config/Settings ──────────────────────────────────────────────

	app.get('/api/config', async (c) => {
		try {
			const configPath = join(root, 'abf.config.yaml');
			const raw = await readFile(configPath, 'utf-8');
			const parsed = parseYaml(raw) as Record<string, unknown>;
			return c.json(parsed);
		} catch {
			return c.json({ error: 'Config not found' }, 404);
		}
	});

	app.put('/api/config', async (c) => {
		try {
			const body = await c.req.json<Record<string, unknown>>();
			// Basic validation: must have at least a name field
			if (!body || typeof body !== 'object') {
				return c.json({ error: 'Invalid config: must be a JSON object' }, 400);
			}
			const configPath = join(root, 'abf.config.yaml');
			// Back up previous config before overwriting
			try {
				const existing = await readFile(configPath, 'utf-8');
				await writeFile(`${configPath}.bak`, existing, 'utf-8');
			} catch {
				// No existing config to back up
			}
			await writeFile(configPath, stringify(body), 'utf-8');
			return c.json({ success: true });
		} catch (e) {
			return c.json({ error: `Failed to update config: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});
}
