/**
 * abf auth — manage provider credentials.
 *
 * abf auth <provider>         — prompts for API key, stores encrypted
 * abf auth list               — shows which providers have credentials
 * abf auth remove <provider>  — removes stored credential
 *
 * Supports three tiers:
 *   Core:   anthropic, openai, ollama (SDK-based, existing behavior)
 *   Preset: moonshot, deepseek, groq, together, openrouter (OpenAI-compatible)
 *   Custom: any slug — prompts for API key, stores under that slug
 */

import chalk from 'chalk';
import { promptHidden, promptVisible } from '../utils/prompt.js';

// ─── Core providers (SDK-based, special handling) ────────────────────

const CORE_PROVIDERS = ['anthropic', 'openai', 'ollama'] as const;
type CoreProvider = (typeof CORE_PROVIDERS)[number];

const CORE_LABELS: Record<CoreProvider, string> = {
	anthropic: 'Anthropic (Claude)',
	openai: 'OpenAI (GPT)',
	ollama: 'Ollama (local)',
};

const CORE_KEY_NAMES: Record<CoreProvider, string> = {
	anthropic: 'api_key',
	openai: 'api_key',
	ollama: 'base_url',
};

const CORE_KEY_URLS: Record<CoreProvider, string | undefined> = {
	anthropic: 'https://console.anthropic.com/keys',
	openai: 'https://platform.openai.com/api-keys',
	ollama: undefined,
};

const CORE_PROMPTS: Record<CoreProvider, string> = {
	anthropic: 'Enter Anthropic API key (sk-ant-...): ',
	openai: 'Enter OpenAI API key (sk-...): ',
	ollama: 'Enter Ollama base URL (default: http://localhost:11434): ',
};

// ─── Preset provider metadata ────────────────────────────────────────

interface PresetMeta {
	label: string;
	keyUrl: string;
	prompt: string;
}

const PRESET_META: Record<string, PresetMeta> = {
	moonshot: {
		label: 'Moonshot AI (Kimi)',
		keyUrl: 'https://platform.moonshot.cn/console/api-keys',
		prompt: 'Enter Moonshot API key: ',
	},
	deepseek: {
		label: 'DeepSeek',
		keyUrl: 'https://platform.deepseek.com/api_keys',
		prompt: 'Enter DeepSeek API key: ',
	},
	groq: {
		label: 'Groq',
		keyUrl: 'https://console.groq.com/keys',
		prompt: 'Enter Groq API key (gsk_...): ',
	},
	together: {
		label: 'Together AI',
		keyUrl: 'https://api.together.ai/settings/api-keys',
		prompt: 'Enter Together AI API key: ',
	},
	openrouter: {
		label: 'OpenRouter',
		keyUrl: 'https://openrouter.ai/keys',
		prompt: 'Enter OpenRouter API key (sk-or-...): ',
	},
};

function isCore(slug: string): slug is CoreProvider {
	return (CORE_PROVIDERS as readonly string[]).includes(slug);
}

function isPreset(slug: string): boolean {
	return slug in PRESET_META;
}

// ─── Prompt helper (delegated to shared utility) ─────────────────────

function prompt(question: string, hidden = true): Promise<string> {
	return hidden ? promptHidden(question) : promptVisible(question);
}

// ─── Main command ────────────────────────────────────────────────────

export async function authCommand(
	provider: string | undefined,
	options: { list?: boolean; remove?: string },
): Promise<void> {
	const { FilesystemCredentialVault } = await import('@abf/core');
	const vault = new FilesystemCredentialVault();

	// ── abf auth list ────────────────────────────────────────────────
	if (options.list || provider === 'list') {
		const stored = await vault.list();
		console.log();
		console.log(chalk.bold('  Provider Credentials'));
		console.log();

		// Core providers
		console.log(chalk.dim('  Core'));
		for (const p of CORE_PROVIDERS) {
			const inVault = stored.includes(p);
			const envKey = p === 'ollama' ? 'OLLAMA_BASE_URL' : `${p.toUpperCase()}_API_KEY`;
			const inEnv = Boolean(process.env[envKey]);
			printProviderStatus(CORE_LABELS[p]!, inVault, inEnv);
		}

		// Preset providers
		console.log();
		console.log(chalk.dim('  OpenAI-Compatible'));
		for (const [slug, meta] of Object.entries(PRESET_META)) {
			const inVault = stored.includes(slug);
			const envKey = `${slug.toUpperCase()}_API_KEY`;
			const inEnv = Boolean(process.env[envKey]);
			printProviderStatus(meta.label, inVault, inEnv);
		}

		// Any other stored credentials (custom providers)
		const allKnown = new Set([...CORE_PROVIDERS, ...Object.keys(PRESET_META)]);
		const custom = stored.filter((s) => !allKnown.has(s));
		if (custom.length > 0) {
			console.log();
			console.log(chalk.dim('  Custom'));
			for (const slug of custom) {
				printProviderStatus(slug, true, false);
			}
		}

		console.log();
		return;
	}

	// ── abf auth remove <provider> ───────────────────────────────────
	if (options.remove) {
		const target = options.remove;
		const keyName = isCore(target) ? CORE_KEY_NAMES[target]! : 'api_key';
		await vault.delete(target, keyName);
		const label = isCore(target)
			? CORE_LABELS[target]!
			: isPreset(target)
				? PRESET_META[target]!.label
				: target;
		console.log(chalk.green(`\u2713 Removed credentials for ${label}`));
		return;
	}

	// ── abf auth <provider> ──────────────────────────────────────────
	if (!provider) {
		console.error(chalk.red('Usage: abf auth <provider>'));
		console.log(chalk.dim(`  Core:    ${CORE_PROVIDERS.join(', ')}`));
		console.log(chalk.dim(`  Preset:  ${Object.keys(PRESET_META).join(', ')}`));
		console.log(chalk.dim('  Custom:  any slug (e.g. "my-llm")'));
		console.log(chalk.dim('  Options: --list, --remove <provider>'));
		process.exit(1);
	}

	// Core provider — existing behavior
	if (isCore(provider)) {
		return handleCoreAuth(vault, provider);
	}

	// Preset provider
	if (isPreset(provider)) {
		return handlePresetAuth(vault, provider);
	}

	// Custom provider — store API key under the given slug
	return handleCustomAuth(vault, provider);
}

// ─── Auth handlers ───────────────────────────────────────────────────

async function handleCoreAuth(vault: import('@abf/core').FilesystemCredentialVault, p: CoreProvider): Promise<void> {
	const keyName = CORE_KEY_NAMES[p]!;
	const promptText = CORE_PROMPTS[p]!;
	const keyUrl = CORE_KEY_URLS[p];

	console.log();
	if (keyUrl) {
		console.log(chalk.dim(`  Get your key at ${chalk.cyan(keyUrl)}`));
		console.log();
	}

	const value = await prompt(promptText, p !== 'ollama');

	if (!value || (p === 'ollama' && value === '')) {
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

async function handlePresetAuth(vault: import('@abf/core').FilesystemCredentialVault, slug: string): Promise<void> {
	const meta = PRESET_META[slug]!;

	console.log();
	console.log(chalk.dim(`  Get your key at ${chalk.cyan(meta.keyUrl)}`));
	console.log();

	const value = await prompt(meta.prompt);

	if (!value) {
		console.log(chalk.yellow('No value entered \u2014 skipping.'));
		return;
	}

	await vault.set(slug, 'api_key', value);
	console.log(chalk.green(`\u2713 Saved ${meta.label} API key.`));
	console.log(chalk.dim(`  Use in agent YAML: provider: ${slug}`));
	console.log();
}

async function handleCustomAuth(vault: import('@abf/core').FilesystemCredentialVault, slug: string): Promise<void> {
	console.log();
	console.log(chalk.dim(`  Storing API key for custom provider "${slug}"`));
	console.log(chalk.dim(`  Make sure you've added it to abf.config.yaml under "providers:"`));
	console.log();

	const value = await prompt(`Enter API key for ${slug}: `);

	if (!value) {
		console.log(chalk.yellow('No value entered \u2014 skipping.'));
		return;
	}

	await vault.set(slug, 'api_key', value);
	console.log(chalk.green(`\u2713 Saved API key for "${slug}".`));
	console.log(chalk.dim(`  Use in agent YAML: provider: ${slug}`));
	console.log();
}

// ─── Helpers ─────────────────────────────────────────────────────────

function printProviderStatus(label: string, inVault: boolean, inEnv: boolean): void {
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
		`    ${(inVault || inEnv ? chalk.green('\u2713') : chalk.dim('\u2717'))} ${chalk.cyan(label.padEnd(24))} ${statusColor(status)}`,
	);
}
