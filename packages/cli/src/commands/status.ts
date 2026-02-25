/**
 * abf status — show agent and system status.
 * Default: concise 5-line overview for non-technical users.
 * --verbose: full technical detail for developers.
 */

import chalk from 'chalk';

interface StatusOptions {
	verbose?: boolean | undefined;
}

export async function statusCommand(options: StatusOptions = {}): Promise<void> {
	try {
		const { loadConfig, loadAgentConfigs, FilesystemCredentialVault } = await import('@abf/core');

		const configResult = await loadConfig(process.cwd());
		if (!configResult.ok) {
			console.log(chalk.yellow('No ABF project found in current directory.'));
			console.log(chalk.dim('Run `abf init` to create a new project.'));
			return;
		}

		const config = configResult.value;

		if (options.verbose) {
			await verboseStatus(config);
			return;
		}

		// ── Concise output ─────────────────────────────────
		console.log();
		console.log(chalk.bold(`  ${config.name}`));
		console.log();

		// Agents
		const agentsResult = await loadAgentConfigs(config.agentsDir);
		const agents = agentsResult.ok ? agentsResult.value : [];

		if (agents.length > 0) {
			const names = agents.map((a) => a.name).join(chalk.dim(' · '));
			console.log(`  ${chalk.green('\u2713')}  ${agents.length} agent${agents.length === 1 ? '' : 's'} ready   ${chalk.dim(names)}`);
		} else {
			console.log(`  ${chalk.red('\u2717')}  No agents loaded`);
			console.log(chalk.dim('     Add agent YAML files to the agents/ directory'));
		}

		// Providers
		const vault = new FilesystemCredentialVault();
		const stored = await vault.list();

		const providerChecks = [
			{ slug: 'anthropic', label: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', vaultKey: 'api_key' },
			{ slug: 'openai', label: 'OpenAI', envKey: 'OPENAI_API_KEY', vaultKey: 'api_key' },
			{ slug: 'ollama', label: 'Ollama', envKey: 'OLLAMA_BASE_URL', vaultKey: 'base_url' },
		] as const;

		const configuredProviders: string[] = [];
		for (const { slug, label, envKey, vaultKey } of providerChecks) {
			const inVault = stored.includes(slug);
			const fromVault = inVault ? await vault.get(slug, vaultKey) : undefined;
			const inEnv = Boolean(process.env[envKey]);
			if (inEnv || Boolean(fromVault)) {
				configuredProviders.push(label);
			}
		}

		if (configuredProviders.length > 0) {
			console.log(`  ${chalk.green('\u2713')}  ${configuredProviders.join(', ')} configured`);
		} else {
			console.log(`  ${chalk.red('\u2717')}  No LLM provider configured`);
			console.log(`     Run: ${chalk.cyan('abf auth anthropic')}`);
		}

		// Next step
		if (agents.length > 0 && configuredProviders.length > 0) {
			const firstAgent = agents[0]!.name;
			console.log(`  ${chalk.dim('\u2192')}  ${chalk.cyan(`abf run ${firstAgent} --task "Give me a daily briefing"`)}`);
		}

		console.log();
	} catch (error) {
		console.error(chalk.red('Error reading project status'));
		console.error(error);
	}
}

async function verboseStatus(config: import('@abf/core').AbfConfig): Promise<void> {
	const { loadAgentConfigs, FilesystemCredentialVault } = await import('@abf/core');

	console.log(chalk.bold(`\n  ${config.name} v${config.version}\n`));

	// Agents
	const agentsResult = await loadAgentConfigs(config.agentsDir);
	if (!agentsResult.ok || agentsResult.value.length === 0) {
		console.log(chalk.dim('  No agents found.'));
	} else {
		const agents = agentsResult.value;
		console.log(chalk.bold('  Agents:'));
		for (const agent of agents) {
			const triggers = agent.triggers.map((t) => t.type).join(', ') || 'none';
			const provider = `${agent.provider}/${agent.model.split('-').slice(0, 2).join('-')}`;
			console.log(
				`    ${chalk.cyan(agent.name.padEnd(16))} ${agent.role.padEnd(25)} [${triggers}] ${chalk.dim(provider)}`,
			);
		}
		console.log();
	}

	// Provider status
	const vault = new FilesystemCredentialVault();
	const stored = await vault.list();

	console.log(chalk.bold('  Providers:'));

	const providerChecks = [
		{ slug: 'anthropic', label: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', vaultKey: 'api_key' },
		{ slug: 'openai', label: 'OpenAI', envKey: 'OPENAI_API_KEY', vaultKey: 'api_key' },
		{ slug: 'ollama', label: 'Ollama (local)', envKey: 'OLLAMA_BASE_URL', vaultKey: 'base_url' },
	] as const;

	for (const { slug, label, envKey, vaultKey } of providerChecks) {
		const inVault = stored.includes(slug);
		const fromVault = inVault ? await vault.get(slug, vaultKey) : undefined;
		const inEnv = Boolean(process.env[envKey]);
		const configured = inEnv || Boolean(fromVault);

		let statusStr: string;
		if (inEnv) {
			statusStr = chalk.cyan('env var');
		} else if (inVault) {
			statusStr = chalk.green('stored');
		} else if (slug === 'ollama') {
			statusStr = chalk.dim('default (localhost:11434)');
		} else {
			statusStr = chalk.dim('not configured');
		}

		const icon = configured || slug === 'ollama' ? chalk.green('\u2713') : chalk.dim('\u2717');
		console.log(`    ${icon} ${label.padEnd(20)} ${statusStr}`);
	}

	console.log();
	console.log(chalk.bold('  Config:'));
	console.log(`    Storage:  ${config.storage.backend}`);
	console.log(`    Bus:      ${config.bus.backend}`);
	console.log(
		`    Gateway:  ${config.gateway.enabled ? `port ${config.gateway.port}` : 'disabled'}`,
	);
	console.log(
		`    Security: injection=${config.security.injectionDetection} bounds=${config.security.boundsEnforcement}`,
	);
	console.log(
		`    Timeout:  ${config.runtime.sessionTimeoutMs / 1000}s per session`,
	);
	console.log();

	console.log(chalk.dim('  Run `abf auth anthropic` to configure a provider.'));
	console.log(chalk.dim('  Run `abf run <agent>` to execute an agent.'));
	console.log();
}
