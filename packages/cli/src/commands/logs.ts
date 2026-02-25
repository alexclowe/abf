/**
 * abf logs — view agent session logs.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';

interface LogsOptions {
	agent?: string | undefined;
	lines: string;
}

export async function logsCommand(options: LogsOptions): Promise<void> {
	try {
		const { loadConfig } = await import('@abf/core');

		const configResult = await loadConfig(process.cwd());
		if (!configResult.ok) {
			console.log(chalk.yellow('No ABF project found in current directory.'));
			return;
		}

		const config = configResult.value;
		const auditDir = join(config.logsDir, 'audit');
		const limit = Number.parseInt(options.lines, 10) || 50;

		let files: string[];
		try {
			files = await readdir(auditDir);
		} catch {
			console.log(chalk.dim('  No logs found yet.'));
			return;
		}

		const jsonlFiles = files
			.filter((f) => f.endsWith('.jsonl'))
			.sort()
			.reverse();
		if (jsonlFiles.length === 0) {
			console.log(chalk.dim('  No logs found yet.'));
			return;
		}

		let lineCount = 0;
		for (const file of jsonlFiles) {
			if (lineCount >= limit) break;

			const content = await readFile(join(auditDir, file), 'utf-8');
			const lines = content.trim().split('\n').filter(Boolean).reverse();

			for (const line of lines) {
				if (lineCount >= limit) break;

				try {
					const entry = JSON.parse(line) as {
						timestamp: string;
						eventType: string;
						agentId: string;
						severity: string;
					};

					if (options.agent && entry.agentId !== options.agent) continue;

					const severity = colorSeverity(entry.severity);
					console.log(
						`  ${chalk.dim(entry.timestamp)} ${severity} ${chalk.cyan(entry.agentId.padEnd(12))} ${entry.eventType}`,
					);
					lineCount++;
				} catch {
					// Skip malformed lines
				}
			}
		}

		if (lineCount === 0) {
			console.log(chalk.dim('  No matching logs found.'));
		}
	} catch (error) {
		console.error(chalk.red('Error reading logs'));
		console.error(error);
	}
}

function colorSeverity(severity: string): string {
	switch (severity) {
		case 'error':
			return chalk.red('ERR');
		case 'warn':
			return chalk.yellow('WRN');
		case 'security':
			return chalk.magenta('SEC');
		default:
			return chalk.dim('INF');
	}
}
