/**
 * abf escalations — view and resolve agent escalations.
 */

import chalk from 'chalk';

interface EscalationsOptions {
	resolve?: string | undefined;
}

export async function escalationsCommand(options: EscalationsOptions = {}): Promise<void> {
	try {
		const { loadConfig } = await import('@abf/core');
		const configResult = await loadConfig(process.cwd());
		if (!configResult.ok) {
			console.log(chalk.yellow('No ABF project found in current directory.'));
			console.log(chalk.dim('Run `abf init` to create a new project.'));
			return;
		}

		const config = configResult.value;
		const baseUrl = `http://localhost:${config.gateway.port}`;

		if (options.resolve) {
			try {
				const res = await fetch(`${baseUrl}/api/escalations/${options.resolve}/resolve`, {
					method: 'POST',
				});
				if (res.ok) {
					console.log(chalk.green(`  Escalation ${options.resolve} resolved.`));
				} else {
					console.log(chalk.red(`  Failed to resolve: ${res.statusText}`));
				}
			} catch {
				console.log(chalk.red('  Could not reach runtime. Is `abf dev` running?'));
			}
			return;
		}

		let escalations: { id: string; type: string; agentId: string; message: string; target: string; resolved: boolean; timestamp: string }[];
		try {
			const res = await fetch(`${baseUrl}/api/escalations`);
			if (!res.ok) {
				console.log(chalk.red('  Could not reach runtime. Is `abf dev` running?'));
				return;
			}
			escalations = (await res.json()) as typeof escalations;
		} catch {
			console.log(chalk.red('  Could not reach runtime. Is `abf dev` running?'));
			return;
		}

		const open = escalations.filter((e) => !e.resolved);
		const resolved = escalations.filter((e) => e.resolved);

		console.log();
		console.log(chalk.bold('  Escalations'));
		console.log();

		if (open.length === 0 && resolved.length === 0) {
			console.log(chalk.dim('  No escalations.'));
			console.log();
			return;
		}

		if (open.length > 0) {
			console.log(chalk.yellow(`  Open (${open.length}):`));
			for (const esc of open) {
				console.log(`    ${chalk.yellow('!')} ${chalk.bold(esc.type)} ${chalk.dim(`from ${esc.agentId}`)}`);
				console.log(`      ${esc.message}`);
				console.log(`      ${chalk.dim(`target: ${esc.target} | ${new Date(esc.timestamp).toLocaleString()}`)}`);
				console.log(`      ${chalk.dim(`resolve: abf escalations --resolve ${esc.id}`)}`);
			}
			console.log();
		}

		if (resolved.length > 0) {
			console.log(chalk.dim(`  Resolved (${resolved.length}):`));
			for (const esc of resolved) {
				console.log(`    ${chalk.dim(`${esc.type} from ${esc.agentId} — ${esc.message}`)}`);
			}
			console.log();
		}
	} catch (error) {
		console.error(chalk.red('Error fetching escalations'));
		console.error(error);
	}
}
