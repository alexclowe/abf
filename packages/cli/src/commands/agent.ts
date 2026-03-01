/**
 * abf agent add — scaffold a new agent from an archetype.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { stringify } from 'yaml';

interface AgentAddOptions {
	name: string;
	archetype?: string | undefined;
	team?: string | undefined;
}

export async function agentAddCommand(options: AgentAddOptions): Promise<void> {
	const { getArchetype, listArchetypes } = await import('@abf/core');

	if (options.archetype && !getArchetype(options.archetype)) {
		console.error(
			chalk.red(
				`Unknown archetype: ${options.archetype}\nAvailable: ${listArchetypes().join(', ')}`,
			),
		);
		process.exit(1);
	}

	const archetype = options.archetype ? getArchetype(options.archetype) : undefined;

	const agentDef: Record<string, unknown> = {
		name: options.name,
		display_name: options.name.charAt(0).toUpperCase() + options.name.slice(1),
		role: options.archetype
			? options.archetype.charAt(0).toUpperCase() + options.archetype.slice(1)
			: 'General Assistant',
		description: `${options.name} agent`,
		...(options.archetype && { role_archetype: options.archetype }),
		provider: 'anthropic',
		model: 'claude-sonnet-4-6',
		...(archetype && { temperature: archetype.temperature }),
		...(options.team && { team: options.team }),
		tools: archetype ? [...archetype.tools] : [],
		triggers: [{ type: 'manual', task: 'assist' }],
		behavioral_bounds: {
			allowed_actions: archetype ? [...archetype.allowedActions] : ['read_data', 'write_draft'],
			forbidden_actions: archetype
				? [...archetype.forbiddenActions]
				: ['delete_data', 'modify_billing'],
			max_cost_per_session: '$2.00',
			requires_approval: [],
		},
		...(archetype && {
			charter: archetype.charterTemplate.replace(/\{\{name\}\}/g, options.name),
		}),
	};

	const agentsDir = join(process.cwd(), 'agents');
	await mkdir(agentsDir, { recursive: true });

	const filePath = join(agentsDir, `${options.name}.agent.yaml`);
	await writeFile(filePath, stringify(agentDef), 'utf-8');

	console.log(chalk.green(`Agent created: agents/${options.name}.agent.yaml`));
	if (options.archetype) {
		console.log(chalk.dim(`  Archetype: ${options.archetype}`));
	}
	if (options.team) {
		console.log(chalk.dim(`  Team: ${options.team}`));
	}
	console.log();
	console.log(`  ${chalk.cyan(`abf run ${options.name} --task "Hello, what can you do?"`)}`);
}
