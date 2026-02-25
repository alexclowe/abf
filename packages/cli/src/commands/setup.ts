/**
 * abf setup — open the ABF Dashboard setup wizard in the browser.
 * For non-technical users who prefer visual configuration.
 */
import chalk from 'chalk';
import ora from 'ora';

export async function setupCommand(): Promise<void> {
	const setupUrl = 'http://localhost:3001/setup';
	const spinner = ora('Checking if ABF Dashboard is running\u2026').start();

	// Check if dashboard is reachable
	let dashboardRunning = false;
	try {
		const res = await fetch(setupUrl, { signal: AbortSignal.timeout(2000) });
		dashboardRunning = res.ok || res.status === 200;
	} catch {
		dashboardRunning = false;
	}

	if (!dashboardRunning) {
		spinner.warn(chalk.yellow('Dashboard not running'));
		console.log();
		console.log('  Start the dashboard first:');
		console.log(`  ${chalk.cyan('abf dev')}    then open ${chalk.cyan(setupUrl)}`);
		console.log();
		console.log('  Or run the CLI setup instead:');
		console.log(`  ${chalk.cyan('abf init --template solo-founder')}`);
		console.log(`  ${chalk.cyan('abf auth anthropic')}`);
		return;
	}

	spinner.succeed('Dashboard is running');
	console.log(`  Opening ${chalk.cyan(setupUrl)} in your browser\u2026`);
	console.log();

	try {
		const { default: open } = await import('open');
		await open(setupUrl);
	} catch {
		console.log(`  Could not open browser automatically.`);
		console.log(`  Please open: ${chalk.cyan(setupUrl)}`);
	}
}
