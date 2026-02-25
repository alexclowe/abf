/**
 * abf run <agent> — manually trigger an agent with real session execution.
 */

import chalk from 'chalk';
import ora from 'ora';

interface RunOptions {
	task?: string | undefined;
}

export async function runCommand(agentName: string, options: RunOptions): Promise<void> {
	const spinner = ora(`Running agent: ${agentName}`).start();

	try {
		const { loadConfig, createRuntime, createActivationId, toISOTimestamp } = await import(
			'@abf/core'
		);

		const configResult = await loadConfig(process.cwd());
		if (!configResult.ok) {
			spinner.fail(chalk.red(configResult.error.message));
			process.exit(1);
		}

		const config = configResult.value;

		// Disable gateway for CLI run (no need for HTTP server)
		const patchedConfig = {
			...config,
			gateway: { ...config.gateway, enabled: false },
		};

		spinner.text = 'Assembling runtime...';
		const runtime = await createRuntime(patchedConfig, process.cwd());

		spinner.text = 'Loading agents...';
		const agentsResult = await runtime.loadAgents();
		if (!agentsResult.ok) {
			spinner.fail(chalk.red(agentsResult.error.message));
			process.exit(1);
		}

		const agent = agentsResult.value.find((a) => a.name === agentName || a.id === agentName);
		if (!agent) {
			spinner.fail(chalk.red(`Agent "${agentName}" not found`));
			const available = agentsResult.value.map((a) => a.name).join(', ');
			if (available) console.log(chalk.dim(`  Available agents: ${available}`));
			process.exit(1);
		}

		const task = options.task ?? agent.triggers[0]?.task ?? 'manual_run';
		spinner.text = `Running ${agent.displayName}...`;

		// Build a manual activation
		const activation = {
			id: createActivationId(),
			agentId: agent.id,
			trigger: { type: 'manual' as const, task },
			timestamp: toISOTimestamp(),
		};

		// Execute directly through the session manager for synchronous result
		const result = await runtime.components.sessionManager.execute(activation);

		if (!result.ok) {
			spinner.fail(chalk.red(`Session failed: ${result.error.message}`));
			process.exit(1);
		}

		const session = result.value;
		const durationMs =
			new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime();
		const durationStr = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(0)}s`;
		const costDollars = (session.cost as number) / 100;

		if (session.status === 'completed') {
			spinner.succeed(
				`${chalk.cyan(agent.displayName)} ${chalk.dim('\u00b7')} ${durationStr} ${chalk.dim('\u00b7')} $${costDollars.toFixed(2)}`,
			);
		} else {
			spinner.warn(chalk.yellow(`Session ended with status: ${session.status}`));
		}

		// Show agent response
		if (session.outputText) {
			const termWidth = process.stdout.columns ?? 72;
			const divider = chalk.dim('\u2500'.repeat(termWidth));

			console.log();
			console.log(divider);
			console.log();
			console.log(wordWrap(session.outputText, termWidth));
			console.log();
			console.log(divider);
		}

		if (session.error) {
			console.log();
			console.log(chalk.yellow(`  Error: ${session.error}`));
		}

		console.log();
		console.log(
			chalk.dim(`Memory saved \u2192 memory/agents/${agent.name}/history.md`),
		);
		console.log();
	} catch (error) {
		spinner.fail(chalk.red('Failed to run agent'));
		console.error(error);
		process.exit(1);
	}
}

function wordWrap(text: string, width: number): string {
	return text
		.split('\n')
		.map((line) => {
			if (line.length <= width) return line;
			const words = line.split(' ');
			const lines: string[] = [];
			let current = '';
			for (const word of words) {
				if (current.length + word.length + 1 > width && current.length > 0) {
					lines.push(current);
					current = word;
				} else {
					current = current.length > 0 ? `${current} ${word}` : word;
				}
			}
			if (current.length > 0) lines.push(current);
			return lines.join('\n');
		})
		.join('\n');
}
