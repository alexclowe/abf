/**
 * abf init — initialize a new ABF project.
 *
 * Supports two modes:
 *   1. Template-based: `abf init --template solo-founder`
 *   2. Seed-based:     `abf init --seed ./my-plan.md`
 *
 * When --seed is provided, the template flag is ignored and the
 * seed-to-company pipeline runs instead (parse -> analyze -> apply).
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { stringify } from 'yaml';

interface InitOptions {
	template: string;
	name?: string | undefined;
	seed?: string | undefined;
	provider?: string | undefined;
}

const PROVIDER_MODEL_MAP: Record<string, string> = {
	anthropic: 'claude-sonnet-4-5',
	openai: 'gpt-4o',
	ollama: 'llama3.2',
};

export async function initCommand(options: InitOptions): Promise<void> {
	// ── Seed-based init ──────────────────────────────────────────────
	if (options.seed) {
		await initFromSeed(options);
		return;
	}

	// ── Template-based init (existing behavior) ──────────────────────
	await initFromTemplate(options);
}

// ─── Seed-based project generation ───────────────────────────────────

async function initFromSeed(options: InitOptions): Promise<void> {
	const seedPath = resolve(process.cwd(), options.seed!);

	// 1. Validate the seed file exists
	if (!existsSync(seedPath)) {
		console.error(chalk.red(`\n  Error: Seed file not found: ${seedPath}\n`));
		process.exit(1);
	}

	// 2. Check format is supported
	const { detectFormat } = await import('@abf/core');
	const format = detectFormat(seedPath);
	if (!format) {
		console.error(
			chalk.red(
				`\n  Error: Unsupported seed document format. Supported: .docx, .pdf, .txt, .md\n`,
			),
		);
		process.exit(1);
	}

	// 3. Parse the seed document
	const parseSpinner = ora('Reading seed document...').start();
	let seedText: string;
	try {
		const { extractText } = await import('@abf/core');
		seedText = await extractText(seedPath);
	} catch (err) {
		parseSpinner.fail(chalk.red('Failed to read seed document'));
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	}

	const wordCount = seedText.split(/\s+/).filter(Boolean).length;
	parseSpinner.succeed(chalk.green(`Seed document loaded (${wordCount.toLocaleString()} words)`));

	// Show a preview
	const preview = seedText.slice(0, 200).replace(/\n/g, ' ');
	console.log(chalk.dim(`  ${preview}${seedText.length > 200 ? '...' : ''}`));
	console.log();

	// 4. Check for LLM provider
	const { createVault, ProviderRegistry, AnthropicProvider, OpenAIProvider, OllamaProvider } =
		await import('@abf/core');

	let vault: import('@abf/core').ICredentialVault;
	try {
		vault = await createVault();
	} catch {
		// If vault creation fails, create a minimal fallback that only checks env vars
		vault = {
			async get(provider: string, key: string) {
				const envKey = `${provider.toUpperCase()}_${key.toUpperCase().replace(/-/g, '_')}`;
				return process.env[envKey] ?? undefined;
			},
			async set() {},
			async delete() {},
			async list() {
				return [];
			},
		} as import('@abf/core').ICredentialVault;
	}

	const providerRegistry = new ProviderRegistry();
	providerRegistry.register(new AnthropicProvider(vault));
	providerRegistry.register(new OpenAIProvider(vault));
	providerRegistry.register(new OllamaProvider(vault));

	// Detect which provider to use
	let providerId = 'anthropic';
	let model = 'claude-sonnet-4-5';

	const hasAnthropicKey =
		!!process.env['ANTHROPIC_API_KEY'] || !!(await vault.get('anthropic', 'api_key'));
	const hasOpenAIKey =
		!!process.env['OPENAI_API_KEY'] || !!(await vault.get('openai', 'api_key'));

	if (options.provider) {
		providerId = options.provider;
		model = PROVIDER_MODEL_MAP[providerId] ?? 'claude-sonnet-4-5';

		// For Ollama: detect best installed model
		if (providerId === 'ollama') {
			const { ensureOllama } = await import('../utils/ollama.js');
			const ollamaResult = await ensureOllama({
				onProgress: (msg) => console.log(chalk.dim(`  ${msg}`)),
				autoInstall: false,
			});
			if (ollamaResult.ok) {
				model = ollamaResult.model;
			} else if (ollamaResult.message === 'not_installed') {
				console.error(chalk.red('\n  Ollama is not installed.'));
				console.log(`  Install: ${chalk.cyan('curl -fsSL https://ollama.com/install.sh | sh')}`);
				console.log(`  Or visit: ${chalk.cyan('https://ollama.com/download')}\n`);
				process.exit(1);
			} else {
				console.error(chalk.red(`\n  ${ollamaResult.message}\n`));
				process.exit(1);
			}
		}
	} else if (hasAnthropicKey) {
		providerId = 'anthropic';
		model = 'claude-sonnet-4-5';
	} else if (hasOpenAIKey) {
		providerId = 'openai';
		model = 'gpt-4o';
	} else {
		// Fall back to Ollama — detect availability and best model
		const { ensureOllama } = await import('../utils/ollama.js');
		console.log(chalk.yellow('\n  No API key found — checking for Ollama (local LLM)...'));

		const ollamaResult = await ensureOllama({
			onProgress: (msg) => console.log(chalk.dim(`  ${msg}`)),
			autoInstall: false,
		});

		if (ollamaResult.ok) {
			providerId = 'ollama';
			model = ollamaResult.model;
			console.log(chalk.yellow(`  Using Ollama (${model}). Quality may be lower than cloud models.\n`));
		} else {
			console.error(
				chalk.red(
					`\n  Error: No LLM provider available.\n` +
					`  Either set an API key: ${chalk.cyan('abf auth anthropic')}\n` +
					`  Or install Ollama:     ${chalk.cyan('curl -fsSL https://ollama.com/install.sh | sh')}\n`,
				),
			);
			process.exit(1);
		}
	}

	// 5. Analyze the seed document with LLM
	const analyzeSpinner = ora(
		`Analyzing seed document with ${providerId}/${model}...`,
	).start();

	let plan: import('@abf/core').CompanyPlan;
	try {
		const { analyzeSeedDoc } = await import('@abf/core');
		plan = await analyzeSeedDoc(providerRegistry, {
			provider: providerId,
			model,
			seedText,
		});
	} catch (err) {
		analyzeSpinner.fail(chalk.red('Failed to analyze seed document'));
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	}

	analyzeSpinner.succeed(chalk.green('Company plan generated'));
	console.log();

	// 6. Show plan summary
	const companyName = plan.company.name;
	const agentNames = plan.agents.map((a) => a.name).join(', ');
	const teamCount = plan.teams.length;
	const knowledgeCount = Object.keys(plan.knowledge).length;
	const toolGapCount = plan.toolGaps.length;

	console.log(chalk.bold(`  Company: ${companyName}`));
	console.log(
		`  Agents: ${plan.agents.length} (${agentNames})`,
	);
	console.log(
		`  Teams: ${teamCount} (${plan.teams.map((t) => t.name).join(', ')})`,
	);
	console.log(`  Knowledge files: ${knowledgeCount}`);
	if (toolGapCount > 0) {
		console.log(`  Tool gaps: ${toolGapCount} (${plan.toolGaps.map((g) => g.capability).join(', ')})`);
	}
	console.log();

	// 7. Determine project name
	const projectName =
		options.name ??
		(companyName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'my-business');

	const root = join(process.cwd(), projectName);

	// 8. Apply the plan
	const applySpinner = ora(`Creating project: ${projectName}`).start();

	try {
		const { applyCompanyPlan } = await import('@abf/core');
		await applyCompanyPlan(plan, root, providerId, model);

		// Generate abf.config.yaml (applyCompanyPlan doesn't create this)
		const config = {
			name: projectName,
			version: '0.1.0',
			description: `${companyName} — powered by ABF`,
			storage: { backend: 'filesystem' },
			bus: { backend: 'in-process' },
			security: {
				injection_detection: true,
				bounds_enforcement: true,
				audit_logging: true,
			},
			gateway: {
				enabled: true,
				port: 3000,
			},
			logging: {
				level: 'info',
				format: 'pretty',
			},
		};
		await writeFile(join(root, 'abf.config.yaml'), stringify(config), 'utf-8');

		// Write tool-gaps.md if there are gaps
		if (plan.toolGaps.length > 0) {
			const gapLines = plan.toolGaps.map(
				(g) =>
					`### ${g.capability}\n- **Priority**: ${g.priority}\n- **Mentioned in**: ${g.mentionedIn}\n- **Suggestion**: ${g.suggestion}\n`,
			);
			const toolGapsMd = `# Tool Gaps\n\nCapabilities mentioned in the seed document that need custom tools or MCP servers.\n\n${gapLines.join('\n')}`;
			await mkdir(join(root, 'knowledge'), { recursive: true });
			await writeFile(join(root, 'knowledge', 'tool-gaps.md'), toolGapsMd, 'utf-8');
		}
	} catch (err) {
		applySpinner.fail(chalk.red('Failed to create project'));
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	}

	applySpinner.succeed(chalk.green(`Project created: ${root}`));
	console.log();

	// 9. Show success summary
	console.log(chalk.bold(`  ${companyName} — powered by ABF`));
	console.log();

	// Group agents by team
	const teamAgentMap = new Map<string, string[]>();
	for (const agent of plan.agents) {
		const teamName = agent.team || 'unassigned';
		const existing = teamAgentMap.get(teamName) ?? [];
		existing.push(agent.name);
		teamAgentMap.set(teamName, existing);
	}

	console.log(
		`  ${plan.agents.length} agents across ${plan.teams.length} team${plan.teams.length === 1 ? '' : 's'}:`,
	);
	for (const team of plan.teams) {
		const members = teamAgentMap.get(team.name) ?? [];
		const orchestratorMark = (name: string) =>
			name === team.orchestrator ? `${name} (orchestrator)` : name;
		console.log(
			`    ${team.name}: ${members.map(orchestratorMark).join(', ')}`,
		);
	}
	console.log();

	if (plan.toolGaps.length > 0) {
		console.log(
			`  ${plan.toolGaps.length} tool gap${plan.toolGaps.length === 1 ? '' : 's'} identified (see knowledge/tool-gaps.md):`,
		);
		for (const gap of plan.toolGaps) {
			console.log(`    ${chalk.dim('\u2022')} ${gap.capability} (${gap.priority})`);
		}
		console.log();
	}

	console.log(chalk.dim('  Next steps:'));
	console.log(`    ${chalk.cyan('cd')} ${projectName}`);
	if (providerId === 'ollama') {
		console.log(`    ${chalk.yellow('Make sure Ollama is running (ollama serve)')}`);
	} else if (!hasAnthropicKey && !hasOpenAIKey) {
		console.log(
			`    ${chalk.cyan(`abf auth ${providerId}`)}          Configure your LLM`,
		);
	}
	console.log(
		`    ${chalk.cyan('abf status')}                  Verify agents loaded`,
	);
	console.log(
		`    ${chalk.cyan('abf dev')}                     Start the runtime`,
	);
	console.log();
}

// ─── Template-based project generation (existing behavior) ───────────

async function initFromTemplate(options: InitOptions): Promise<void> {
	const projectName = options.name ?? 'my-business';
	const provider = options.provider ?? 'anthropic';
	let model = PROVIDER_MODEL_MAP[provider] ?? 'claude-sonnet-4-5';

	// For Ollama: detect best installed model before creating the project
	if (provider === 'ollama') {
		const { ensureOllama } = await import('../utils/ollama.js');
		console.log(chalk.dim('  Checking Ollama...'));
		const ollamaResult = await ensureOllama({
			onProgress: (msg) => console.log(chalk.dim(`  ${msg}`)),
			autoInstall: false,
		});
		if (ollamaResult.ok) {
			model = ollamaResult.model;
		} else if (ollamaResult.message === 'not_installed') {
			console.error(chalk.red('\n  Ollama is not installed.'));
			console.log(`  Install: ${chalk.cyan('curl -fsSL https://ollama.com/install.sh | sh')}`);
			console.log(`  Or visit: ${chalk.cyan('https://ollama.com/download')}\n`);
			process.exit(1);
		} else {
			console.error(chalk.red(`\n  ${ollamaResult.message}\n`));
			process.exit(1);
		}
	}

	const spinner = ora(`Creating ABF project: ${projectName}`).start();

	try {
		const root = join(process.cwd(), projectName);

		// Create directory structure
		const dirs = [
			'agents',
			'teams',
			'tools',
			'memory/agents',
			'memory/knowledge',
			'knowledge',
			'outputs',
			'datastore/schemas',
			'datastore/migrations',
			'logs',
			'workflows',
			'monitors',
			'interfaces',
			'templates',
		];

		for (const dir of dirs) {
			await mkdir(join(root, dir), { recursive: true });
		}

		// Knowledge base starter files (shared across templates)
		const knowledgeCompany = `# Company Overview\n\nDescribe your company here. This file is shared with all agents.\n\n## Mission\n\n## Product\n\n## Target Market\n\n## Key Metrics\n`;
		const knowledgeBrandVoice = `# Brand Voice\n\nDefine your brand voice and communication style here.\n\n## Tone\n\n## Do's\n\n## Don'ts\n\n## Examples\n`;

		// Starter datastore schema
		const starterSchema = `name: contacts\ncolumns:\n  - { name: id, type: integer, primary_key: true }\n  - { name: name, type: text }\n  - { name: email, type: text }\n  - { name: notes, type: text }\n  - { name: created_at, type: timestamp, default: CURRENT_TIMESTAMP }\n`;

		if (options.template === 'solo-founder') {
			const { soloFounderTemplate } = await import('../templates/solo-founder.js');
			const files = soloFounderTemplate(projectName, provider, model);
			await writeFile(join(root, 'abf.config.yaml'), files.config, 'utf-8');
			await writeFile(join(root, 'agents', 'compass.agent.yaml'), files.compass, 'utf-8');
			await writeFile(join(root, 'agents', 'scout.agent.yaml'), files.scout, 'utf-8');
			await writeFile(join(root, 'agents', 'scribe.agent.yaml'), files.scribe, 'utf-8');
			await writeFile(join(root, 'teams', 'founders.team.yaml'), files.foundersTeam, 'utf-8');
			await writeFile(join(root, 'memory', 'decisions.md'), files.decisions, 'utf-8');
			await writeFile(join(root, 'knowledge', 'company.md'), knowledgeCompany, 'utf-8');
			await writeFile(join(root, 'knowledge', 'brand-voice.md'), knowledgeBrandVoice, 'utf-8');
			await writeFile(join(root, 'datastore', 'schemas', 'contacts.schema.yaml'), starterSchema, 'utf-8');
			await writeFile(join(root, 'README.md'), files.readme, 'utf-8');
			await writeFile(join(root, 'docker-compose.yml'), files.dockerCompose, 'utf-8');

			spinner.succeed(chalk.green(`Project created: ${root}`));
			console.log();
			console.log(chalk.bold('  Solo Founder workspace ready — 3 agents, 1 team'));
			console.log();
			console.log(`  ${chalk.cyan('cd')} ${projectName}`);
			if (provider === 'ollama') {
				console.log(`  ${chalk.yellow('Make sure Ollama is running (ollama serve)')}`);
			} else {
				console.log(`  ${chalk.cyan(`abf auth ${provider}`)}                          Configure your LLM`);
			}
			console.log(`  ${chalk.cyan('abf status')}                                  Verify 3 agents loaded`);
			console.log();
			console.log(chalk.dim('  Quick runs:'));
			console.log(`  ${chalk.cyan('abf run compass --task "Give me a daily briefing"')}`);
			console.log(`  ${chalk.cyan('abf run scout  --task "Research top AI agent frameworks"')}`);
			console.log(`  ${chalk.cyan('abf run scribe --task "Write a cold email to a design partner"')}`);
			console.log();

		} else if (options.template === 'saas') {
			const { saasTemplate } = await import('../templates/saas.js');
			const files = saasTemplate(projectName, provider, model);
			await writeFile(join(root, 'abf.config.yaml'), files.config, 'utf-8');
			await writeFile(join(root, 'agents', 'atlas.agent.yaml'), files.atlas, 'utf-8');
			await writeFile(join(root, 'agents', 'scout.agent.yaml'), files.scout, 'utf-8');
			await writeFile(join(root, 'agents', 'scribe.agent.yaml'), files.scribe, 'utf-8');
			await writeFile(join(root, 'agents', 'signal.agent.yaml'), files.signal, 'utf-8');
			await writeFile(join(root, 'agents', 'herald.agent.yaml'), files.herald, 'utf-8');
			await writeFile(join(root, 'teams', 'product.team.yaml'), files.productTeam, 'utf-8');
			await writeFile(join(root, 'teams', 'gtm.team.yaml'), files.gtmTeam, 'utf-8');
			await writeFile(join(root, 'memory', 'decisions.md'), files.decisions, 'utf-8');
			await writeFile(join(root, 'knowledge', 'company.md'), knowledgeCompany, 'utf-8');
			await writeFile(join(root, 'knowledge', 'brand-voice.md'), knowledgeBrandVoice, 'utf-8');
			await writeFile(join(root, 'datastore', 'schemas', 'contacts.schema.yaml'), starterSchema, 'utf-8');
			await writeFile(join(root, 'README.md'), files.readme, 'utf-8');
			await writeFile(join(root, 'docker-compose.yml'), files.dockerCompose, 'utf-8');

			spinner.succeed(chalk.green(`Project created: ${root}`));
			console.log();
			console.log(chalk.bold('  SaaS workspace ready — 5 agents, 2 teams (product + gtm)'));
			console.log();
			console.log(`  ${chalk.cyan('cd')} ${projectName}`);
			if (provider === 'ollama') {
				console.log(`  ${chalk.yellow('Make sure Ollama is running (ollama serve)')}`);
			} else {
				console.log(`  ${chalk.cyan(`abf auth ${provider}`)}                          Configure your LLM`);
			}
			console.log(`  ${chalk.cyan('abf status')}                                  Verify 5 agents loaded`);
			console.log();
			console.log(chalk.dim('  Quick runs:'));
			console.log(`  ${chalk.cyan('abf run atlas   --task "Run a product standup"')}`);
			console.log(`  ${chalk.cyan('abf run scout   --task "Research the top 5 competitors in our space"')}`);
			console.log(`  ${chalk.cyan('abf run scribe  --task "Write a changelog for our latest release"')}`);
			console.log(`  ${chalk.cyan('abf run signal  --task "Draft a positioning brief for our launch"')}`);
			console.log(`  ${chalk.cyan('abf run herald  --task "Analyze this week\'s user feedback"')}`);
			console.log();

		} else if (options.template === 'marketing-agency') {
			const { marketingAgencyTemplate } = await import('../templates/marketing-agency.js');
			const files = marketingAgencyTemplate(projectName, provider, model);
			await writeFile(join(root, 'abf.config.yaml'), files.config, 'utf-8');
			await writeFile(join(root, 'agents', 'director.agent.yaml'), files.director, 'utf-8');
			await writeFile(join(root, 'agents', 'strategist.agent.yaml'), files.strategist, 'utf-8');
			await writeFile(join(root, 'agents', 'copywriter.agent.yaml'), files.copywriter, 'utf-8');
			await writeFile(join(root, 'agents', 'analyst.agent.yaml'), files.analyst, 'utf-8');
			await writeFile(join(root, 'teams', 'agency.team.yaml'), files.agencyTeam, 'utf-8');
			await writeFile(join(root, 'memory', 'decisions.md'), files.decisions, 'utf-8');
			await writeFile(join(root, 'knowledge', 'company.md'), knowledgeCompany, 'utf-8');
			await writeFile(join(root, 'knowledge', 'brand-voice.md'), knowledgeBrandVoice, 'utf-8');
			await writeFile(join(root, 'datastore', 'schemas', 'contacts.schema.yaml'), starterSchema, 'utf-8');
			await writeFile(join(root, 'README.md'), files.readme, 'utf-8');
			await writeFile(join(root, 'docker-compose.yml'), files.dockerCompose, 'utf-8');

			spinner.succeed(chalk.green(`Project created: ${root}`));
			console.log();
			console.log(chalk.bold('  Marketing Agency workspace ready — 4 agents, 1 team'));
			console.log();
			console.log(`  ${chalk.cyan('cd')} ${projectName}`);
			if (provider === 'ollama') {
				console.log(`  ${chalk.yellow('Make sure Ollama is running (ollama serve)')}`);
			} else {
				console.log(`  ${chalk.cyan(`abf auth ${provider}`)}                          Configure your LLM`);
			}
			console.log(`  ${chalk.cyan('abf status')}                                  Verify 4 agents loaded`);
			console.log();
			console.log(chalk.dim('  Quick runs:'));
			console.log(`  ${chalk.cyan('abf run director   --task "Run a daily standup"')}`);
			console.log(`  ${chalk.cyan('abf run analyst    --task "Analyze last week\'s campaign performance"')}`);
			console.log(`  ${chalk.cyan('abf run strategist --task "Draft a campaign brief for Q1 launch"')}`);
			console.log(`  ${chalk.cyan('abf run copywriter --task "Write 3 LinkedIn ad variations"')}`);
			console.log();

		} else {
			// Default / custom template — minimal single-agent skeleton
			const config = {
				name: projectName,
				version: '0.1.0',
				description: `${projectName} — powered by ABF`,
				storage: { backend: 'filesystem' },
				bus: { backend: 'in-process' },
				security: {
					injection_detection: true,
					bounds_enforcement: true,
					audit_logging: true,
				},
				gateway: {
					enabled: true,
					port: 3000,
				},
				logging: {
					level: 'info',
					format: 'pretty',
				},
			};
			await writeFile(join(root, 'abf.config.yaml'), stringify(config), 'utf-8');

			// Create a sample agent
			const sampleAgent = {
				name: 'assistant',
				display_name: 'General Assistant',
				role: 'Assistant',
				description: 'A general-purpose AI assistant.',
				provider,
				model,
				temperature: 0.3,
				tools: [],
				triggers: [{ type: 'manual', task: 'assist' }],
				behavioral_bounds: {
					allowed_actions: ['read_data', 'write_draft'],
					forbidden_actions: ['delete_data'],
					max_cost_per_session: '$2.00',
					requires_approval: [],
				},
				charter: '# Assistant\n\nYou are a helpful general-purpose assistant.',
			};

			await writeFile(
				join(root, 'agents', 'assistant.agent.yaml'),
				stringify(sampleAgent),
				'utf-8',
			);

			// Create decisions.md
			await writeFile(
				join(root, 'memory', 'decisions.md'),
				'# Decisions\n\nNo decisions yet.\n',
				'utf-8',
			);

			spinner.succeed(chalk.green(`Project created: ${root}`));
			console.log();
			console.log(`  ${chalk.cyan('cd')} ${projectName}`);
			console.log(`  ${chalk.cyan('abf dev')}    Start in development mode`);
			console.log(`  ${chalk.cyan('abf status')} Check agent status`);
			console.log();
		}
	} catch (error) {
		spinner.fail(chalk.red('Failed to create project'));
		console.error(error);
		process.exit(1);
	}
}
