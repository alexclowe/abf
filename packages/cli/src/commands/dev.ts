/**
 * abf dev — start ABF in development mode with real runtime.
 */

import chalk from 'chalk';
import ora from 'ora';

interface DevOptions {
	port: string;
}

export async function devCommand(options: DevOptions): Promise<void> {
	const spinner = ora('Starting ABF development server...').start();

	try {
		const { loadConfig, createRuntime } = await import('@abf/core');

		const configResult = await loadConfig(process.cwd());
		if (!configResult.ok) {
			spinner.fail(chalk.red(configResult.error.message));
			process.exit(1);
		}

		const config = configResult.value;

		// Port override from CLI flag
		const port = Number.parseInt(options.port, 10) || config.gateway.port;
		const patchedConfig = {
			...config,
			gateway: { ...config.gateway, port, enabled: true },
		};

		spinner.text = 'Assembling runtime...';
		const runtime = await createRuntime(patchedConfig, process.cwd());

		spinner.text = 'Loading agents...';
		const agentsResult = await runtime.loadAgents();
		if (!agentsResult.ok) {
			spinner.warn(chalk.yellow(`Agent loading warning: ${agentsResult.error.message}`));
		}

		const agentCount = agentsResult.ok ? agentsResult.value.length : 0;

		spinner.text = 'Starting runtime...';
		await runtime.start();

		spinner.succeed(chalk.green(`ABF running — ${agentCount} agent(s) loaded`));

		console.log();
		if (agentsResult.ok) {
			for (const agent of agentsResult.value) {
				const triggerSummary = agent.triggers.map((t) => t.type).join(', ') || 'none';
				console.log(
					`  ${chalk.cyan(agent.name.padEnd(16))} ${agent.role.padEnd(25)} [${triggerSummary}]`,
				);
			}
		}

		console.log();
		console.log(`  Gateway: ${chalk.cyan(`http://localhost:${port}`)}`);
		console.log(`  Health:  ${chalk.cyan(`http://localhost:${port}/health`)}`);
		console.log();
		console.log(chalk.dim('  Press Ctrl+C to stop'));

		// Graceful shutdown
		const shutdown = async (signal: string) => {
			console.log();
			console.log(chalk.dim(`  Received ${signal}, shutting down...`));
			await runtime.stop();
			process.exit(0);
		};

		process.on('SIGINT', () => void shutdown('SIGINT'));
		process.on('SIGTERM', () => void shutdown('SIGTERM'));

		// Keep process alive
		await new Promise(() => {});
	} catch (error) {
		spinner.fail(chalk.red('Failed to start development server'));
		console.error(error);
		process.exit(1);
	}
}
