/**
 * abf workflow add — scaffold a workflow from a built-in template.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { stringify } from 'yaml';

interface WorkflowAddOptions {
	template: string;
	name?: string | undefined;
}

export async function workflowAddCommand(options: WorkflowAddOptions): Promise<void> {
	const { getWorkflowTemplate } = await import('@abf/core');

	const template = getWorkflowTemplate(options.template);
	if (!template) {
		const names = ['fan-out-synthesize', 'sequential-pipeline', 'event-triggered'];
		console.error(
			chalk.red(`Unknown workflow template: ${options.template}\nAvailable: ${names.join(', ')}`),
		);
		process.exit(1);
	}

	const workflowName = options.name ?? template.name;
	const workflowDef = {
		name: workflowName,
		display_name: template.displayName,
		description: template.description,
		steps: template.steps.map((s) => ({
			id: s.id,
			agent: s.agentPlaceholder,
			task: s.task,
			...(s.dependsOn && { depends_on: [...s.dependsOn] }),
			...(s.parallel && { parallel: s.parallel }),
		})),
		...(template.timeout != null && { timeout: template.timeout }),
		on_failure: template.onFailure,
	};

	const workflowsDir = join(process.cwd(), 'workflows');
	await mkdir(workflowsDir, { recursive: true });

	const filePath = join(workflowsDir, `${workflowName}.workflow.yaml`);
	await writeFile(filePath, stringify(workflowDef), 'utf-8');

	console.log(chalk.green(`Workflow created: workflows/${workflowName}.workflow.yaml`));
	console.log(chalk.dim(`  Template: ${template.displayName}`));
	console.log(
		chalk.dim(
			`  Steps: ${template.steps.map((s) => `${s.id} (${s.agentPlaceholder})`).join(' → ')}`,
		),
	);
	console.log();
	console.log(chalk.yellow('  Replace AGENT placeholders with your actual agent names.'));
}
