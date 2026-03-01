/**
 * Configuration loading — reads YAML files, validates with Zod, returns typed configs.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { agentYamlSchema, transformAgentYaml } from '../schemas/agent.schema.js';
import { configYamlSchema, transformConfigYaml } from '../schemas/config.schema.js';
import { teamYamlSchema, transformTeamYaml } from '../schemas/team.schema.js';
import { workflowYamlSchema, transformWorkflowYaml } from '../schemas/workflow.schema.js';
import type { AgentConfig } from '../types/agent.js';
import type { AbfConfig } from '../types/config.js';
import { ConfigError } from '../types/errors.js';
import type { Result } from '../types/errors.js';
import { Err, Ok } from '../types/errors.js';
import type { TeamConfig } from '../types/team.js';
import type { WorkflowDefinition } from '../types/workflow.js';

// ─── Friendly Error Formatting ───────────────────────────────────────

function formatZodError(zodError: { issues: ReadonlyArray<{ path: readonly (string | number)[]; message: string }> }, filename: string): string {
	const issues = zodError.issues
		.map((e) => `  \u2022 ${e.path.join('.')}: ${e.message}`)
		.join('\n');
	return `Invalid configuration in ${filename}:\n\n${issues}\n\nRun "abf status --verbose" for more details.`;
}

// ─── Config Loading ───────────────────────────────────────────────────

export async function loadConfig(projectRoot: string): Promise<Result<AbfConfig, ConfigError>> {
	const configPath = join(resolve(projectRoot), 'abf.config.yaml');

	let raw: string;
	try {
		raw = await readFile(configPath, 'utf-8');
	} catch {
		return Err(
			new ConfigError('CONFIG_NOT_FOUND', `Config file not found: ${configPath}`, {
				path: configPath,
			}),
		);
	}

	let parsed: unknown;
	try {
		parsed = parseYaml(raw);
	} catch (e) {
		return Err(
			new ConfigError('CONFIG_PARSE_ERROR', `Failed to parse YAML: ${configPath}`, {
				path: configPath,
				error: String(e),
			}),
		);
	}

	const result = configYamlSchema.safeParse(parsed);
	if (!result.success) {
		const filename = configPath.replace(/^.*[\\/]/, '');
		return Err(
			new ConfigError('CONFIG_INVALID', formatZodError(result.error, filename), {
				path: configPath,
				issues: result.error.issues,
			}),
		);
	}

	return Ok(transformConfigYaml(result.data));
}

// ─── Agent Loading ────────────────────────────────────────────────────

export async function loadAgentConfig(filePath: string): Promise<Result<AgentConfig, ConfigError>> {
	let raw: string;
	try {
		raw = await readFile(filePath, 'utf-8');
	} catch {
		return Err(
			new ConfigError('CONFIG_NOT_FOUND', `Agent file not found: ${filePath}`, {
				path: filePath,
			}),
		);
	}

	let parsed: unknown;
	try {
		parsed = parseYaml(raw);
	} catch (e) {
		return Err(
			new ConfigError('CONFIG_PARSE_ERROR', `Failed to parse agent YAML: ${filePath}`, {
				path: filePath,
				error: String(e),
			}),
		);
	}

	const result = agentYamlSchema.safeParse(parsed);
	if (!result.success) {
		const filename = filePath.replace(/^.*[\\/]/, '');
		return Err(
			new ConfigError('CONFIG_INVALID', formatZodError(result.error, filename), {
				path: filePath,
				issues: result.error.issues,
			}),
		);
	}

	return Ok(transformAgentYaml(result.data));
}

/**
 * Result of loading agent configs — may include both valid agents and warnings
 * for agents that failed validation (partial success).
 */
export interface AgentLoadResult {
	readonly agents: readonly AgentConfig[];
	readonly warnings: readonly string[];
}

export async function loadAgentConfigs(
	agentsDir: string,
): Promise<Result<AgentLoadResult, ConfigError>> {
	const dir = resolve(agentsDir);
	let files: string[];
	try {
		const entries = await readdir(dir);
		files = entries.filter((f) => f.endsWith('.agent.yaml'));
	} catch {
		return Ok({ agents: [], warnings: [] }); // No agents dir = no agents
	}

	// Load all agent configs in parallel — partial success (valid agents load, invalid get warnings)
	const results = await Promise.all(files.map((file) => loadAgentConfig(join(dir, file))));
	const configs: AgentConfig[] = [];
	const warnings: string[] = [];
	for (const result of results) {
		if (!result.ok) warnings.push(result.error.message);
		else configs.push(result.value);
	}

	return Ok({ agents: configs, warnings });
}

// ─── Team Loading ─────────────────────────────────────────────────────

export async function loadTeamConfig(filePath: string): Promise<Result<TeamConfig, ConfigError>> {
	let raw: string;
	try {
		raw = await readFile(filePath, 'utf-8');
	} catch {
		return Err(
			new ConfigError('CONFIG_NOT_FOUND', `Team file not found: ${filePath}`, {
				path: filePath,
			}),
		);
	}

	let parsed: unknown;
	try {
		parsed = parseYaml(raw);
	} catch (e) {
		return Err(
			new ConfigError('CONFIG_PARSE_ERROR', `Failed to parse team YAML: ${filePath}`, {
				path: filePath,
				error: String(e),
			}),
		);
	}

	const result = teamYamlSchema.safeParse(parsed);
	if (!result.success) {
		const filename = filePath.replace(/^.*[\\/]/, '');
		return Err(
			new ConfigError('CONFIG_INVALID', formatZodError(result.error, filename), {
				path: filePath,
				issues: result.error.issues,
			}),
		);
	}

	return Ok(transformTeamYaml(result.data));
}

export async function loadTeamConfigs(
	teamsDir: string,
): Promise<Result<readonly TeamConfig[], ConfigError>> {
	const dir = resolve(teamsDir);
	let files: string[];
	try {
		const entries = await readdir(dir);
		files = entries.filter((f) => f.endsWith('.team.yaml'));
	} catch {
		return Ok([]); // No teams dir = no teams
	}

	// Load all team configs in parallel
	const results = await Promise.all(files.map((file) => loadTeamConfig(join(dir, file))));
	const configs: TeamConfig[] = [];
	const errors: string[] = [];
	for (const result of results) {
		if (!result.ok) errors.push(result.error.message);
		else configs.push(result.value);
	}
	if (errors.length > 0) {
		return Err(new ConfigError('CONFIG_INVALID', errors.join('\n')));
	}

	return Ok(configs);
}

// ─── Workflow Loading ─────────────────────────────────────────────────

export async function loadWorkflowConfig(
	filePath: string,
): Promise<Result<WorkflowDefinition, ConfigError>> {
	let raw: string;
	try {
		raw = await readFile(filePath, 'utf-8');
	} catch {
		return Err(
			new ConfigError('CONFIG_NOT_FOUND', `Workflow file not found: ${filePath}`, {
				path: filePath,
			}),
		);
	}

	let parsed: unknown;
	try {
		parsed = parseYaml(raw);
	} catch (e) {
		return Err(
			new ConfigError('CONFIG_PARSE_ERROR', `Failed to parse workflow YAML: ${filePath}`, {
				path: filePath,
				error: String(e),
			}),
		);
	}

	const result = workflowYamlSchema.safeParse(parsed);
	if (!result.success) {
		const filename = filePath.replace(/^.*[\\/]/, '');
		return Err(
			new ConfigError('CONFIG_INVALID', formatZodError(result.error, filename), {
				path: filePath,
				issues: result.error.issues,
			}),
		);
	}

	const name = filePath.replace(/^.*[\\/]/, '').replace(/\.workflow\.yaml$/, '');
	return Ok(transformWorkflowYaml(result.data, name));
}

export async function loadWorkflowConfigs(
	workflowsDir: string,
): Promise<Result<readonly WorkflowDefinition[], ConfigError>> {
	const dir = resolve(workflowsDir);
	let files: string[];
	try {
		const entries = await readdir(dir);
		files = entries.filter((f) => f.endsWith('.workflow.yaml'));
	} catch {
		return Ok([]); // No workflows dir = no workflows
	}

	// Load all workflow configs in parallel
	const results = await Promise.all(files.map((file) => loadWorkflowConfig(join(dir, file))));
	const configs: WorkflowDefinition[] = [];
	const errors: string[] = [];
	for (const result of results) {
		if (!result.ok) errors.push(result.error.message);
		else configs.push(result.value);
	}
	if (errors.length > 0) {
		return Err(new ConfigError('CONFIG_INVALID', errors.join('\n')));
	}

	return Ok(configs);
}
