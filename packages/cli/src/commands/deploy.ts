/**
 * abf deploy — generate cloud deployment configuration files.
 *
 * Supports: railway, render, fly
 * Pure file generation — no API calls, no shell execution.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';
import { parse as parseYaml } from 'yaml';

interface DeployOptions {
	target: 'railway' | 'render' | 'fly';
}

export async function deployCommand(options: DeployOptions): Promise<void> {
	const spinner = ora(`Generating ${options.target} deployment config…`).start();
	const cwd = process.cwd();

	// Read project name from abf.config.yaml if it exists
	let projectName = 'abf-runtime';
	const configPath = join(cwd, 'abf.config.yaml');
	if (existsSync(configPath)) {
		try {
			const raw = await readFile(configPath, 'utf-8');
			const parsed = parseYaml(raw) as { name?: string };
			if (parsed.name) projectName = parsed.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
		} catch {
			// Use default name
		}
	}

	try {
		switch (options.target) {
			case 'railway':
				await generateRailway(cwd, spinner);
				break;
			case 'render':
				await generateRender(cwd, projectName, spinner);
				break;
			case 'fly':
				await generateFly(cwd, projectName, spinner);
				break;
		}
	} catch (error) {
		spinner.fail(chalk.red('Failed to generate deployment config'));
		console.error(error);
		process.exit(1);
	}
}

async function generateRailway(cwd: string, spinner: ReturnType<typeof ora>): Promise<void> {
	const config = JSON.stringify(
		{
			$schema: 'https://railway.app/railway.schema.json',
			build: {
				builder: 'DOCKERFILE',
				dockerfilePath: 'Dockerfile',
			},
			deploy: {
				restartPolicyType: 'ON_FAILURE',
				restartPolicyMaxRetries: 3,
			},
		},
		null,
		2,
	);

	await writeFile(join(cwd, 'railway.json'), config, 'utf-8');
	spinner.succeed(chalk.green('Generated railway.json'));
	console.log();
	console.log(chalk.dim('  Next steps:'));
	console.log(`  ${chalk.cyan('npm install -g @railway/cli')}`);
	console.log(`  ${chalk.cyan('railway login')}`);
	console.log(`  ${chalk.cyan('railway up')}`);
	console.log();
	console.log(chalk.dim('  Set environment variables in the Railway dashboard:'));
	console.log(`  ${chalk.yellow('ANTHROPIC_API_KEY')}, ${chalk.yellow('OPENAI_API_KEY')}`);
	console.log();
}

async function generateRender(cwd: string, projectName: string, spinner: ReturnType<typeof ora>): Promise<void> {
	const config =
		[
			'services:',
			`  - type: web`,
			`    name: ${projectName}`,
			`    runtime: docker`,
			`    dockerfilePath: ./Dockerfile`,
			`    envVars:`,
			`      - key: NODE_ENV`,
			`        value: production`,
			`      - key: ANTHROPIC_API_KEY`,
			`        sync: false`,
			`      - key: OPENAI_API_KEY`,
			`        sync: false`,
			`      - key: OLLAMA_BASE_URL`,
			`        sync: false`,
			`    healthCheckPath: /health`,
		].join('\n') + '\n';

	await writeFile(join(cwd, 'render.yaml'), config, 'utf-8');
	spinner.succeed(chalk.green('Generated render.yaml'));
	console.log();
	console.log(chalk.dim('  Next steps:'));
	console.log(`  1. Push this project to a GitHub repository`);
	console.log(`  2. Go to ${chalk.cyan('https://render.com')} → New → Blueprint`);
	console.log(`  3. Connect your repository`);
	console.log(`  4. Set ${chalk.yellow('ANTHROPIC_API_KEY')} in Environment settings`);
	console.log();
}

async function generateFly(cwd: string, projectName: string, spinner: ReturnType<typeof ora>): Promise<void> {
	const config =
		[
			`app = "${projectName}"`,
			`primary_region = "iad"`,
			``,
			`[build]`,
			`  dockerfile = "Dockerfile"`,
			``,
			`[http_service]`,
			`  internal_port = 3000`,
			`  force_https = true`,
			`  auto_stop_machines = true`,
			`  auto_start_machines = true`,
			`  min_machines_running = 0`,
			``,
			`[[vm]]`,
			`  memory = "512mb"`,
			`  cpu_kind = "shared"`,
			`  cpus = 1`,
		].join('\n') + '\n';

	await writeFile(join(cwd, 'fly.toml'), config, 'utf-8');
	spinner.succeed(chalk.green('Generated fly.toml'));
	console.log();
	console.log(chalk.dim('  Next steps:'));
	console.log(`  ${chalk.cyan('brew install flyctl')}  ${chalk.dim('# or https://fly.io/docs/hands-on/install-flyctl/')}`);
	console.log(`  ${chalk.cyan('fly auth login')}`);
	console.log(`  ${chalk.cyan('fly launch --no-deploy')}  ${chalk.dim('# link to existing fly.toml')}`);
	console.log(`  ${chalk.cyan(`fly secrets set ANTHROPIC_API_KEY=sk-...`)}`);
	console.log(`  ${chalk.cyan('fly deploy')}`);
	console.log();
}
