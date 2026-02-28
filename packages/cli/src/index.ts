import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

program.name('abf').description('ABF — Agentic Business Framework CLI').version(pkg.version);

// Lazy-load commands to keep startup fast
program
	.command('init')
	.description('Initialize a new ABF project')
	.option('-t, --template <template>', 'Business template to use', 'custom')
	.option('-n, --name <name>', 'Project name')
	.option('--seed <path>', 'Path to a seed document (.docx, .pdf, .txt, .md) to generate agents from')
	.option('--provider <provider>', 'LLM provider (anthropic, openai, ollama)')
	.action(async (options) => {
		const { initCommand } = await import('./commands/init.js');
		await initCommand(options);
	});

program
	.command('dev')
	.description('Start ABF in development mode')
	.option('-p, --port <port>', 'Gateway port', '3000')
	.option('--provider <provider>', 'LLM provider (anthropic, openai, ollama)')
	.action(async (options) => {
		const { devCommand } = await import('./commands/dev.js');
		await devCommand(options);
	});

program
	.command('status')
	.description('Show agent and system status')
	.option('-v, --verbose', 'Show detailed technical output')
	.action(async (options: { verbose?: boolean }) => {
		const { statusCommand } = await import('./commands/status.js');
		await statusCommand(options);
	});

program
	.command('logs')
	.description('View agent session logs')
	.option('-a, --agent <name>', 'Filter by agent name')
	.option('-n, --lines <count>', 'Number of lines to show', '50')
	.action(async (options) => {
		const { logsCommand } = await import('./commands/logs.js');
		await logsCommand(options);
	});

program
	.command('run <agent>')
	.description('Manually trigger an agent')
	.option('-t, --task <task>', 'Task to execute')
	.action(async (agent: string, options) => {
		const { runCommand } = await import('./commands/run.js');
		await runCommand(agent, options);
	});

program
	.command('auth [provider]')
	.description('Manage provider credentials')
	.option('-l, --list', 'List configured providers')
	.option('-r, --remove <provider>', 'Remove stored credential')
	.action(async (provider: string | undefined, options) => {
		const { authCommand } = await import('./commands/auth.js');
		await authCommand(provider, options);
	});

program
	.command('setup')
	.description('Open the visual setup wizard in your browser')
	.action(async () => {
		const { setupCommand } = await import('./commands/setup.js');
		await setupCommand();
	});

program
	.command('migrate')
	.description('Run datastore schema and SQL migrations')
	.action(async () => {
		const { migrateCommand } = await import('./commands/migrate.js');
		await migrateCommand();
	});

const workflow = program.command('workflow').description('Manage workflows');
workflow
	.command('add')
	.description('Scaffold a workflow from a built-in template')
	.requiredOption('-t, --template <template>', 'Workflow template (fan-out-synthesize, sequential-pipeline, event-triggered)')
	.option('-n, --name <name>', 'Custom workflow name')
	.action(async (options: { template: string; name?: string }) => {
		const { workflowAddCommand } = await import('./commands/workflow.js');
		await workflowAddCommand(options);
	});

const agent = program.command('agent').description('Manage agents');
agent
	.command('add')
	.description('Scaffold a new agent (optionally from an archetype)')
	.requiredOption('-n, --name <name>', 'Agent name')
	.option('-a, --archetype <type>', 'Role archetype (researcher, writer, orchestrator, analyst, customer-support, developer, marketer, finance, monitor, generalist)')
	.option('-t, --team <team>', 'Team to assign the agent to')
	.action(async (options: { name: string; archetype?: string; team?: string }) => {
		const { agentAddCommand } = await import('./commands/agent.js');
		await agentAddCommand(options);
	});

program
	.command('escalations')
	.description('View and resolve agent escalations')
	.option('-r, --resolve <id>', 'Resolve an escalation by ID')
	.action(async (options: { resolve?: string }) => {
		const { escalationsCommand } = await import('./commands/escalations.js');
		await escalationsCommand(options);
	});

program
	.command('deploy')
	.description('Generate cloud deployment configuration')
	.requiredOption('-t, --target <target>', 'Deployment target (railway, render, fly)')
	.action(async (options: { target: string }) => {
		const target = options.target as 'railway' | 'render' | 'fly';
		const validTargets = ['railway', 'render', 'fly'];
		if (!validTargets.includes(target)) {
			console.error(chalk.red(`Invalid target: ${target}. Must be one of: ${validTargets.join(', ')}`));
			process.exit(1);
		}
		const { deployCommand } = await import('./commands/deploy.js');
		await deployCommand({ target });
	});

program.parse();
