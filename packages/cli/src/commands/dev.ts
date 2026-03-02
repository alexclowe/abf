/**
 * abf dev — start ABF in development mode with real runtime.
 *
 * Spawns the Next.js dashboard as a child process on port 3001 and proxies
 * non-API traffic through the Hono gateway on port 3000, giving operators
 * a single URL to access everything.
 */

import { existsSync, cpSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import { stringify } from 'yaml';

interface DevOptions {
	port: string;
	provider?: string;
}

const PROVIDER_MODEL_MAP: Record<string, string> = {
	anthropic: 'claude-sonnet-4-6',
	openai: 'gpt-5.2',
	ollama: 'llama3.2',
};

const DASHBOARD_PORT = 3001;

/** Detect if an LLM provider API key is set via environment variables. */
function detectProviderFromEnv(): { provider: string; model: string } | null {
	if (process.env['ANTHROPIC_API_KEY']) return { provider: 'anthropic', model: 'claude-sonnet-4-6' };
	if (process.env['OPENAI_API_KEY']) return { provider: 'openai', model: 'gpt-5.2' };
	return null;
}

/** Write a minimal config + starter agent to the project root. */
async function scaffoldStarterProject(projectRoot: string, provider: string, model: string): Promise<void> {
	const configObj = {
		name: 'abf',
		version: '0.1.0',
		description: 'ABF project — auto-scaffolded',
		storage: { backend: 'filesystem' },
		bus: { backend: 'in-process' },
		security: {
			injection_detection: true,
			bounds_enforcement: true,
			audit_logging: true,
		},
		gateway: { enabled: true, port: 3000 },
		logging: { level: 'info', format: 'pretty' },
	};
	await mkdir(projectRoot, { recursive: true });
	await writeFile(join(projectRoot, 'abf.config.yaml'), stringify(configObj), 'utf-8');

	await mkdir(join(projectRoot, 'agents'), { recursive: true });
	const agentObj = {
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
		join(projectRoot, 'agents', 'assistant.agent.yaml'),
		stringify(agentObj),
		'utf-8',
	);
}

/** Default config used when no abf.config.yaml exists (bootstrap / setup mode). */
function getDefaultConfig(): import('@abf/core').AbfConfig {
	return {
		name: 'abf',
		version: '0.1.0',
		storage: { backend: 'filesystem', basePath: '.' },
		bus: { backend: 'in-process' },
		security: {
			injectionDetection: true,
			boundsEnforcement: true,
			auditLogging: true,
			credentialRotationHours: 24,
			maxSessionCostDefault: 2.0,
		},
		gateway: { enabled: true, host: '0.0.0.0', port: 3000 },
		runtime: { maxConcurrentSessions: 10, sessionTimeoutMs: 300_000, healthCheckIntervalMs: 30_000 },
		logging: { level: 'info', format: 'pretty' },
		agentsDir: 'agents',
		teamsDir: 'teams',
		toolsDir: 'tools',
		memoryDir: 'memory',
		logsDir: 'logs',
		knowledgeDir: 'knowledge',
		outputsDir: 'outputs',
	};
}

/**
 * Find the dashboard package directory.
 * Tries monorepo layout first, then npm resolution.
 */
function findDashboardDir(): string | null {
	const thisDir = dirname(new URL(import.meta.url).pathname);

	// Monorepo: try multiple relative paths to handle both
	// unbundled (dist/commands/dev.js → ../../../dashboard) and
	// bundled (dist/dev-*.js → ../../dashboard) layouts.
	for (const rel of ['../../dashboard', '../../../dashboard']) {
		const candidate = join(thisDir, rel);
		if (existsSync(join(candidate, 'package.json'))) {
			return candidate;
		}
	}

	// npm install: try require.resolve
	try {
		const resolved = require.resolve('@abf/dashboard/package.json', { paths: [process.cwd()] });
		return dirname(resolved);
	} catch {
		return null;
	}
}

/**
 * Spawn the Next.js dashboard as a child process.
 * Returns the child process, or null if dashboard is not available.
 */
function spawnDashboard(dashboardDir: string): ChildProcess {
	// In monorepos, Next.js standalone output nests server.js under the package path
	const standaloneRoot = join(dashboardDir, '.next', 'standalone');
	const standaloneDirect = join(standaloneRoot, 'server.js');
	const standaloneNested = join(standaloneRoot, 'packages', 'dashboard', 'server.js');
	const standalonePath = existsSync(standaloneDirect) ? standaloneDirect
		: existsSync(standaloneNested) ? standaloneNested
		: null;
	const isStandalone = standalonePath !== null;

	const env = {
		...process.env,
		PORT: String(DASHBOARD_PORT),
		NEXT_PUBLIC_ABF_API_URL: '',
	};

	if (isStandalone) {
		// Next.js standalone output excludes .next/static/ and public/ — they must
		// be copied into the standalone directory for the server to serve them.
		// The server.js location determines where Next.js looks for these assets:
		// it resolves .next/static relative to the server.js parent directory.
		const serverDir = dirname(standalonePath!);
		const staticSrc = join(dashboardDir, '.next', 'static');
		const staticDest = join(serverDir, '.next', 'static');
		if (existsSync(staticSrc) && !existsSync(staticDest)) {
			cpSync(staticSrc, staticDest, { recursive: true });
		}

		const publicSrc = join(dashboardDir, 'public');
		const publicDest = join(serverDir, 'public');
		if (existsSync(publicSrc) && !existsSync(publicDest)) {
			cpSync(publicSrc, publicDest, { recursive: true });
		}

		// Production mode: standalone server built by `next build` with output: 'standalone'
		// cwd must be the standalone root so Next.js resolves static assets correctly
		// detached: own process group so we can kill the entire tree on shutdown
		return spawn('node', [standalonePath!], {
			stdio: 'pipe',
			env,
			cwd: standaloneRoot,
			detached: true,
		});
	}

	// Dev mode: use npx next dev
	// detached: own process group so shell→npx→next→next-server all die together
	return spawn('npx', ['next', 'dev', '-p', String(DASHBOARD_PORT)], {
		stdio: 'pipe',
		env,
		cwd: dashboardDir,
		shell: true,
		detached: true,
	});
}

/** Kill a dashboard process and all its children by killing the process group. */
function killDashboard(proc: ChildProcess): void {
	if (!proc.pid || proc.killed) return;
	try {
		// Negative PID = kill entire process group
		process.kill(-proc.pid, 'SIGTERM');
	} catch {
		try { proc.kill('SIGTERM'); } catch {}
	}
	// Force-kill after 2s if still alive
	setTimeout(() => {
		if (!proc.killed) {
			try { process.kill(-proc.pid!, 'SIGKILL'); } catch {}
		}
	}, 2000).unref();
}

export async function devCommand(options: DevOptions): Promise<void> {
	const spinner = ora('Starting ABF development server...').start();

	let dashboardProcess: ChildProcess | null = null;

	try {
		const { loadConfig, createRuntime } = await import('@abf/core');

		// ABF_PROJECT_ROOT lets cloud hosts point to a persistent disk mount
		const projectRoot = process.env['ABF_PROJECT_ROOT'] ?? process.cwd();

		let bootstrapMode = false;
		const configResult = await loadConfig(projectRoot);
		let config: import('@abf/core').AbfConfig;

		if (!configResult.ok) {
			if (configResult.error.code === 'CONFIG_NOT_FOUND') {
				bootstrapMode = true;
				config = getDefaultConfig();

				// If --provider is set, auto-scaffold a config + starter agent
				if (options.provider) {
					const provider = options.provider;
					let model = PROVIDER_MODEL_MAP[provider] ?? 'claude-sonnet-4-6';

					// For Ollama: detect availability and auto-select best model
					if (provider === 'ollama') {
						const { ensureOllama } = await import('../utils/ollama.js');
						spinner.text = 'Checking Ollama...';
						const result = await ensureOllama({
							onProgress: (msg) => { spinner.text = msg; },
							autoInstall: false,
						});

						if (!result.ok) {
							if (result.message === 'not_installed') {
								spinner.fail(chalk.red('Ollama is not installed'));
								console.log();
								console.log(`  Install Ollama: ${chalk.cyan('curl -fsSL https://ollama.com/install.sh | sh')}`);
								console.log(`  Or visit: ${chalk.cyan('https://ollama.com/download')}`);
								console.log();
								console.log(chalk.dim('  Then run this command again.'));
								process.exit(1);
							}
							spinner.fail(chalk.red(result.message ?? 'Ollama setup failed'));
							process.exit(1);
						}

						model = result.model;
						if (result.pulled) {
							spinner.succeed(chalk.green(`Downloaded ${model}`));
							// new spinner for scaffolding
							spinner.start();
						}
					}

					spinner.text = `Scaffolding ${provider} agent...`;
					await scaffoldStarterProject(projectRoot, provider, model);

					// Re-load config now that we've written it
					const reloadResult = await loadConfig(projectRoot);
					if (reloadResult.ok) {
						config = reloadResult.value;
						bootstrapMode = false;
					}
				} else {
					// Auto-scaffold on cloud when an API key is detected via env vars.
					// Only on cloud platforms — local dev should show the setup wizard.
					const isCloud = Boolean(
						process.env['RENDER'] || process.env['RAILWAY_ENVIRONMENT'] || process.env['FLY_APP_NAME'],
					);
					const detectedProvider = isCloud ? detectProviderFromEnv() : null;
					if (detectedProvider) {
						spinner.text = `Detected ${detectedProvider.provider} API key — scaffolding starter agent...`;
						await scaffoldStarterProject(projectRoot, detectedProvider.provider, detectedProvider.model);
						const reloadResult = await loadConfig(projectRoot);
						if (reloadResult.ok) {
							config = reloadResult.value;
							bootstrapMode = false;
						}
					} else {
						spinner.text = 'No config found — running in setup mode...';
					}
				}
			} else {
				spinner.fail(chalk.red(configResult.error.message));
				process.exit(1);
			}
		} else {
			config = configResult.value;
		}

		// Port override: CLI flag > PORT env var > config
		const port = Number.parseInt(options.port, 10) || Number.parseInt(process.env['PORT'] ?? '', 10) || config.gateway.port;
		const patchedConfig = {
			...config,
			gateway: { ...config.gateway, port, enabled: true },
		};

		// Spawn dashboard if available
		let dashboardPort: number | undefined;
		const dashboardDir = findDashboardDir();
		if (dashboardDir) {
			spinner.text = 'Starting dashboard...';
			dashboardProcess = spawnDashboard(dashboardDir);
			dashboardPort = DASHBOARD_PORT;

			// Log dashboard errors for debugging
			dashboardProcess.stderr?.on('data', (d: Buffer) => {
				const msg = d.toString().trim();
				if (msg) console.error(chalk.dim(`  [dashboard] ${msg}`));
			});
			dashboardProcess.on('error', (err: Error) => {
				console.error(chalk.dim(`  [dashboard] spawn error: ${err.message}`));
			});
			dashboardProcess.on('exit', (code: number | null) => {
				if (code !== null && code !== 0) {
					console.error(chalk.dim(`  [dashboard] exited with code ${code}`));
				}
			});
		}

		// Check if vault needs a password (no keychain + no env var)
		let masterPassword: string | undefined;
		if (!bootstrapMode) {
			const { createKeychain } = await import('@abf/core');
			const keychain = createKeychain();
			const keychainAvailable = await keychain.isAvailable();

			if (!keychainAvailable && !process.env['ABF_VAULT_PASSWORD']) {
				// Check existing vault header to decide what to prompt
				const { existsSync } = await import('node:fs');
				const { readFile: readFs } = await import('node:fs/promises');
				const { homedir } = await import('node:os');
				const vaultPath = join(homedir(), '.abf', 'credentials.enc');

				let vaultBackend: string | null = null;
				if (existsSync(vaultPath)) {
					try {
						const content = await readFs(vaultPath, 'utf-8');
						const firstLine = content.trim().split('\n')[0] ?? '';
						if (firstLine.startsWith('{')) {
							const header = JSON.parse(firstLine) as { backend?: string };
							vaultBackend = header.backend ?? null;
						}
					} catch {
						// Can't read header — will prompt for password
					}
				}

				if (vaultBackend === 'keychain') {
					// Vault was created with keychain that's no longer available.
					// A password won't help — vault will reset. Warn and continue.
					spinner.stop();
					console.log();
					console.log(chalk.yellow('  Vault keychain unavailable'));
					console.log(chalk.dim('  Your credentials were stored with OS keychain, which is not available.'));
					console.log(chalk.dim('  Stored credentials will be reset. Re-add them with: abf auth <provider>'));
					console.log(chalk.dim('  To use a password instead, set ABF_VAULT_PASSWORD env var.'));
					console.log();
					spinner.start();
				} else {
					// Scrypt vault or new vault — prompt for password
					spinner.stop();
					console.log();
					console.log(chalk.yellow('  Vault password required'));
					console.log(chalk.dim('  Your credentials are encrypted with a password.'));
					console.log(chalk.dim('  Set ABF_VAULT_PASSWORD env var to skip this prompt.'));
					console.log();
					const { promptHidden } = await import('../utils/prompt.js');
					masterPassword = await promptHidden('  Vault password: ');
					if (!masterPassword) {
						console.error(chalk.red('  Password cannot be empty.'));
						process.exit(1);
					}
					spinner.start();
				}
			}
		}

		// Stop spinner during runtime creation and agent loading — both
		// produce console output that would interleave with the spinner.
		spinner.stop();
		const runtime = await createRuntime(patchedConfig, projectRoot, { dashboardPort, masterPassword });

		const agentsResult = await runtime.loadAgents();
		if (!agentsResult.ok) {
			console.log(chalk.yellow(`  Warning: ${agentsResult.error.message}`));
		}

		const agentCount = agentsResult.ok ? agentsResult.value.length : 0;

		spinner.start('Starting runtime...');
		await runtime.start();

		if (bootstrapMode) {
			spinner.succeed(chalk.green('ABF running in setup mode'));
		} else {
			spinner.succeed(chalk.green(`ABF running — ${agentCount} agent(s) loaded`));
		}

		console.log();
		if (!bootstrapMode && agentsResult.ok) {
			for (const agent of agentsResult.value) {
				const triggerSummary = agent.triggers.map((t) => t.type).join(', ') || 'none';
				console.log(
					`  ${chalk.cyan(agent.name.padEnd(16))} ${agent.role.padEnd(25)} [${triggerSummary}]`,
				);
			}
		}

		console.log();
		console.log(`  ${chalk.cyan(`http://localhost:${port}`)}`);
		if (bootstrapMode) {
			console.log(`  Setup:   ${chalk.cyan(`http://localhost:${port}/setup`)}`);
		}
		if (!dashboardDir) {
			console.log(chalk.dim('  (Dashboard not found — API-only mode)'));
		}
		console.log(`  Health:  ${chalk.cyan(`http://localhost:${port}/health`)}`);
		console.log();
		console.log(chalk.dim('  Press Ctrl+C to stop'));

		// Graceful shutdown with hard timeout
		const shutdown = async (signal: string) => {
			console.log();
			console.log(chalk.dim(`  Received ${signal}, shutting down...`));
			if (dashboardProcess) killDashboard(dashboardProcess);
			// Force exit after 3s if runtime.stop() hangs (e.g. open connections)
			const forceExit = setTimeout(() => process.exit(0), 3000);
			forceExit.unref();
			await runtime.stop();
			process.exit(0);
		};

		process.on('SIGINT', () => void shutdown('SIGINT'));
		process.on('SIGTERM', () => void shutdown('SIGTERM'));

		// Keep process alive
		await new Promise(() => {});
	} catch (error) {
		if (dashboardProcess) killDashboard(dashboardProcess);
		spinner.fail(chalk.red('Failed to start development server'));
		console.error(error);
		process.exit(1);
	}
}
