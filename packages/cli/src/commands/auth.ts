/**
 * abf auth — manage provider credentials.
 *
 * abf auth <provider>         — prompts for API key, stores encrypted
 * abf auth list               — shows which providers have credentials
 * abf auth remove <provider>  — removes stored credential
 */

import { createInterface } from 'node:readline';
import chalk from 'chalk';

const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'ollama'] as const;
type Provider = (typeof SUPPORTED_PROVIDERS)[number];

const PROVIDER_LABELS: Record<Provider, string> = {
	anthropic: 'Anthropic (Claude)',
	openai: 'OpenAI (GPT)',
	ollama: 'Ollama (local)',
};

const PROVIDER_KEY_NAMES: Record<Provider, string> = {
	anthropic: 'api_key',
	openai: 'api_key',
	ollama: 'base_url',
};

const PROVIDER_KEY_URLS: Record<Provider, string | undefined> = {
	anthropic: 'https://console.anthropic.com/keys',
	openai: 'https://platform.openai.com/api-keys',
	ollama: undefined,
};

const PROVIDER_PROMPTS: Record<Provider, string> = {
	anthropic: 'Enter Anthropic API key (sk-ant-...): ',
	openai: 'Enter OpenAI API key (sk-...): ',
	ollama: 'Enter Ollama base URL (default: http://localhost:11434): ',
};

function prompt(question: string, hidden = true): Promise<string> {
	return new Promise((resolve) => {
		const rl = createInterface({ input: process.stdin, output: process.stdout });

		if (hidden && process.stdin.isTTY) {
			// Suppress echo for API keys
			process.stdout.write(question);
			process.stdin.setRawMode(true);
			let input = '';
			process.stdin.on('data', function handler(char: Buffer) {
				const c = char.toString();
				if (c === '\r' || c === '\n') {
					process.stdin.setRawMode(false);
					process.stdin.removeListener('data', handler);
					process.stdout.write('\n');
					rl.close();
					resolve(input);
				} else if (c === '\u0003') {
					// Ctrl+C
					process.stdin.setRawMode(false);
					process.stdout.write('\n');
					process.exit(1);
				} else if (c === '\u007f' || c === '\b') {
					// Backspace
					input = input.slice(0, -1);
				} else {
					input += c;
					process.stdout.write('*');
				}
			});
		} else {
			rl.question(question, (answer) => {
				rl.close();
				resolve(answer.trim());
			});
		}
	});
}

export async function authCommand(
	provider: string | undefined,
	options: { list?: boolean; remove?: string },
): Promise<void> {
	const { FilesystemCredentialVault } = await import('@abf/core');
	const vault = new FilesystemCredentialVault();

	// abf auth list
	if (options.list || provider === 'list') {
		const stored = await vault.list();
		console.log();
		console.log(chalk.bold('  Provider Credentials'));
		console.log();

		for (const p of SUPPORTED_PROVIDERS) {
			const inVault = stored.includes(p);
			const envKey = p === 'ollama' ? 'OLLAMA_BASE_URL' : `${p.toUpperCase()}_API_KEY`;
			const inEnv = Boolean(process.env[envKey]);

			let status: string;
			let statusColor: typeof chalk.green;

			if (inEnv) {
				status = 'env var';
				statusColor = chalk.cyan;
			} else if (inVault) {
				status = 'stored';
				statusColor = chalk.green;
			} else {
				status = 'not configured';
				statusColor = chalk.dim;
			}

			console.log(
				`    ${(inVault || inEnv ? chalk.green('\u2713') : chalk.dim('\u2717'))} ${chalk.cyan(PROVIDER_LABELS[p]!.padEnd(20))} ${statusColor(status)}`,
			);
		}
		console.log();
		return;
	}

	// abf auth remove <provider>
	const removeTarget = options.remove ?? (provider === 'remove' ? undefined : undefined);
	if (options.remove) {
		const target = options.remove as Provider;
		if (!SUPPORTED_PROVIDERS.includes(target)) {
			console.error(chalk.red(`Unknown provider: ${target}`));
			console.log(chalk.dim(`  Supported: ${SUPPORTED_PROVIDERS.join(', ')}`));
			process.exit(1);
		}
		const key = PROVIDER_KEY_NAMES[target]!;
		await vault.delete(target, key);
		console.log(chalk.green(`\u2713 Removed credentials for ${PROVIDER_LABELS[target]}`));
		return;
	}
	void removeTarget;

	// abf auth <provider>
	if (!provider) {
		console.error(chalk.red('Usage: abf auth <provider>'));
		console.log(chalk.dim(`  Providers: ${SUPPORTED_PROVIDERS.join(', ')}`));
		console.log(chalk.dim('  Options: --list, --remove <provider>'));
		process.exit(1);
	}

	if (!SUPPORTED_PROVIDERS.includes(provider as Provider)) {
		console.error(chalk.red(`Unknown provider: ${provider}`));
		console.log(chalk.dim(`  Supported: ${SUPPORTED_PROVIDERS.join(', ')}`));
		process.exit(1);
	}

	const p = provider as Provider;
	const keyName = PROVIDER_KEY_NAMES[p]!;
	const promptText = PROVIDER_PROMPTS[p]!;
	const keyUrl = PROVIDER_KEY_URLS[p];

	console.log();
	if (keyUrl) {
		console.log(chalk.dim(`  Get your key at ${chalk.cyan(keyUrl)}`));
		console.log();
	}

	const value = await prompt(promptText, p !== 'ollama');

	if (!value || (p === 'ollama' && value === '')) {
		// For Ollama, empty = use default
		if (p === 'ollama') {
			await vault.set(p, keyName, 'http://localhost:11434');
			console.log(chalk.green(`\u2713 Saved Ollama base URL: http://localhost:11434`));
		} else {
			console.log(chalk.yellow('No value entered \u2014 skipping.'));
		}
		return;
	}

	await vault.set(p, keyName, value);
	console.log(chalk.green(`\u2713 Saved! Try: ${chalk.cyan('abf run compass --task "Give me a daily briefing"')}`));
	console.log(chalk.dim(`  Stored encrypted at ~/.abf/credentials.enc`));
	console.log();
}
