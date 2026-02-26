/**
 * abf migrate — apply database migrations.
 */

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';
import { parse } from 'yaml';

export async function migrateCommand(): Promise<void> {
	const spinner = ora('Running datastore migrations...').start();

	try {
		// Load config
		const configPath = join(process.cwd(), 'abf.config.yaml');
		let rawConfig: unknown;
		try {
			rawConfig = parse(readFileSync(configPath, 'utf-8'));
		} catch {
			spinner.fail(chalk.red('No abf.config.yaml found. Run from project root.'));
			process.exit(1);
		}

		const { configYamlSchema, transformConfigYaml } = await import('@abf/core');
		const parsed = configYamlSchema.safeParse(rawConfig);
		if (!parsed.success) {
			spinner.fail(chalk.red('Invalid config: ' + parsed.error.message));
			process.exit(1);
		}
		const config = transformConfigYaml(parsed.data);

		if (!config.datastore) {
			spinner.fail(chalk.red('No datastore configured in abf.config.yaml'));
			process.exit(1);
		}

		const { createDatastore, loadDatastoreSchemas, loadMigrationFiles, runMigrations } =
			await import('@abf/core');

		const projectRoot = process.cwd();
		const dsConfig = { ...config.datastore };
		if (dsConfig.backend === 'sqlite' && !dsConfig.sqlitePath) {
			(dsConfig as { sqlitePath?: string }).sqlitePath = join(projectRoot, 'data.db');
		}

		const datastore = createDatastore(dsConfig);
		const initResult = await datastore.initialize();
		if (!initResult.ok) {
			spinner.fail(chalk.red(`Failed to connect: ${initResult.error.message}`));
			process.exit(1);
		}

		// Apply schemas
		const schemasDir = join(projectRoot, config.datastore.schemasDir ?? 'datastore/schemas');
		const schemas = loadDatastoreSchemas(schemasDir);
		if (schemas.length > 0) {
			await datastore.applySchemas(schemas);
			spinner.text = `Applied ${schemas.length} schema(s)`;
		}

		// Run migrations
		const migrationsDir = join(projectRoot, config.datastore.migrationsDir ?? 'datastore/migrations');
		const migrations = loadMigrationFiles(migrationsDir);
		const { applied, skipped } = await runMigrations(datastore, migrations);

		await datastore.close();

		spinner.succeed(chalk.green('Migrations complete'));
		if (schemas.length > 0) {
			console.log(`  ${chalk.cyan('Schemas')}: ${schemas.length} applied`);
		}
		if (applied.length > 0) {
			console.log(`  ${chalk.cyan('Applied')}: ${applied.join(', ')}`);
		}
		if (skipped.length > 0) {
			console.log(`  ${chalk.dim('Skipped')}: ${skipped.join(', ')}`);
		}
		if (applied.length === 0 && skipped.length === 0 && schemas.length === 0) {
			console.log(chalk.dim('  No schemas or migrations found.'));
		}
	} catch (error) {
		spinner.fail(chalk.red('Migration failed'));
		console.error(error);
		process.exit(1);
	}
}
