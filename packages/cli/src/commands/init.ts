/**
 * abf init — initialize a new ABF project.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { stringify } from 'yaml';

interface InitOptions {
	template: string;
	name?: string | undefined;
}

export async function initCommand(options: InitOptions): Promise<void> {
	const projectName = options.name ?? 'my-business';
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
			'logs',
			'workflows',
			'interfaces',
			'templates',
		];

		for (const dir of dirs) {
			await mkdir(join(root, dir), { recursive: true });
		}

		if (options.template === 'solo-founder') {
			const { soloFounderTemplate } = await import('../templates/solo-founder.js');
			const files = soloFounderTemplate(projectName);
			await writeFile(join(root, 'abf.config.yaml'), files.config, 'utf-8');
			await writeFile(join(root, 'agents', 'compass.agent.yaml'), files.compass, 'utf-8');
			await writeFile(join(root, 'agents', 'scout.agent.yaml'), files.scout, 'utf-8');
			await writeFile(join(root, 'agents', 'scribe.agent.yaml'), files.scribe, 'utf-8');
			await writeFile(join(root, 'teams', 'founders.team.yaml'), files.foundersTeam, 'utf-8');
			await writeFile(join(root, 'memory', 'decisions.md'), files.decisions, 'utf-8');
			await writeFile(join(root, 'README.md'), files.readme, 'utf-8');
			await writeFile(join(root, 'docker-compose.yml'), files.dockerCompose, 'utf-8');

			spinner.succeed(chalk.green(`Project created: ${root}`));
			console.log();
			console.log(chalk.bold('  Solo Founder workspace ready — 3 agents, 1 team'));
			console.log();
			console.log(`  ${chalk.cyan('cd')} ${projectName}`);
			console.log(`  ${chalk.cyan('abf auth anthropic')}                          Configure your LLM`);
			console.log(`  ${chalk.cyan('abf status')}                                  Verify 3 agents loaded`);
			console.log();
			console.log(chalk.dim('  Quick runs:'));
			console.log(`  ${chalk.cyan('abf run compass --task "Give me a daily briefing"')}`);
			console.log(`  ${chalk.cyan('abf run scout  --task "Research top AI agent frameworks"')}`);
			console.log(`  ${chalk.cyan('abf run scribe --task "Write a cold email to a design partner"')}`);
			console.log();

		} else if (options.template === 'saas') {
			const { saasTemplate } = await import('../templates/saas.js');
			const files = saasTemplate(projectName);
			await writeFile(join(root, 'abf.config.yaml'), files.config, 'utf-8');
			await writeFile(join(root, 'agents', 'atlas.agent.yaml'), files.atlas, 'utf-8');
			await writeFile(join(root, 'agents', 'scout.agent.yaml'), files.scout, 'utf-8');
			await writeFile(join(root, 'agents', 'scribe.agent.yaml'), files.scribe, 'utf-8');
			await writeFile(join(root, 'agents', 'signal.agent.yaml'), files.signal, 'utf-8');
			await writeFile(join(root, 'agents', 'herald.agent.yaml'), files.herald, 'utf-8');
			await writeFile(join(root, 'teams', 'product.team.yaml'), files.productTeam, 'utf-8');
			await writeFile(join(root, 'teams', 'gtm.team.yaml'), files.gtmTeam, 'utf-8');
			await writeFile(join(root, 'memory', 'decisions.md'), files.decisions, 'utf-8');
			await writeFile(join(root, 'README.md'), files.readme, 'utf-8');
			await writeFile(join(root, 'docker-compose.yml'), files.dockerCompose, 'utf-8');

			spinner.succeed(chalk.green(`Project created: ${root}`));
			console.log();
			console.log(chalk.bold('  SaaS workspace ready — 5 agents, 2 teams (product + gtm)'));
			console.log();
			console.log(`  ${chalk.cyan('cd')} ${projectName}`);
			console.log(`  ${chalk.cyan('abf auth anthropic')}                          Configure your LLM`);
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
			const files = marketingAgencyTemplate(projectName);
			await writeFile(join(root, 'abf.config.yaml'), files.config, 'utf-8');
			await writeFile(join(root, 'agents', 'director.agent.yaml'), files.director, 'utf-8');
			await writeFile(join(root, 'agents', 'strategist.agent.yaml'), files.strategist, 'utf-8');
			await writeFile(join(root, 'agents', 'copywriter.agent.yaml'), files.copywriter, 'utf-8');
			await writeFile(join(root, 'agents', 'analyst.agent.yaml'), files.analyst, 'utf-8');
			await writeFile(join(root, 'teams', 'agency.team.yaml'), files.agencyTeam, 'utf-8');
			await writeFile(join(root, 'memory', 'decisions.md'), files.decisions, 'utf-8');
			await writeFile(join(root, 'README.md'), files.readme, 'utf-8');
			await writeFile(join(root, 'docker-compose.yml'), files.dockerCompose, 'utf-8');

			spinner.succeed(chalk.green(`Project created: ${root}`));
			console.log();
			console.log(chalk.bold('  Marketing Agency workspace ready — 4 agents, 1 team'));
			console.log();
			console.log(`  ${chalk.cyan('cd')} ${projectName}`);
			console.log(`  ${chalk.cyan('abf auth anthropic')}                          Configure your LLM`);
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
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
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
