import { describe, it, expect } from 'vitest';
import {
	BUILTIN_WORKFLOW_TEMPLATES,
	getWorkflowTemplate,
	fanOutSynthesize,
	sequentialPipeline,
	eventTriggered,
	type WorkflowTemplateDefinition,
} from './templates.js';

describe('Workflow Templates', () => {
	describe('BUILTIN_WORKFLOW_TEMPLATES', () => {
		it('has exactly 3 entries', () => {
			expect(BUILTIN_WORKFLOW_TEMPLATES).toHaveLength(3);
		});

		it('contains fan-out-synthesize, sequential-pipeline, event-triggered', () => {
			const names = BUILTIN_WORKFLOW_TEMPLATES.map((t) => t.name);
			expect(names).toContain('fan-out-synthesize');
			expect(names).toContain('sequential-pipeline');
			expect(names).toContain('event-triggered');
		});
	});

	describe('getWorkflowTemplate', () => {
		it('returns a template by name', () => {
			const template = getWorkflowTemplate('fan-out-synthesize');
			expect(template).toBeDefined();
			expect(template!.name).toBe('fan-out-synthesize');
		});

		it('returns undefined for unknown name', () => {
			expect(getWorkflowTemplate('nonexistent')).toBeUndefined();
		});
	});

	describe('all templates have required fields', () => {
		for (const template of BUILTIN_WORKFLOW_TEMPLATES) {
			describe(`template: ${template.name}`, () => {
				it('has name, displayName, pattern, steps, and onFailure', () => {
					expect(typeof template.name).toBe('string');
					expect(template.name.length).toBeGreaterThan(0);
					expect(typeof template.displayName).toBe('string');
					expect(template.displayName.length).toBeGreaterThan(0);
					expect(typeof template.pattern).toBe('string');
					expect(template.pattern.length).toBeGreaterThan(0);
					expect(Array.isArray(template.steps)).toBe(true);
					expect(template.steps.length).toBeGreaterThan(0);
					expect(typeof template.onFailure).toBe('string');
				});

				it('has a timeout', () => {
					expect(typeof template.timeout).toBe('number');
					expect(template.timeout!).toBeGreaterThan(0);
				});

				it('has unique step IDs', () => {
					const ids = template.steps.map((s) => s.id);
					const uniqueIds = new Set(ids);
					expect(uniqueIds.size).toBe(ids.length);
				});
			});
		}
	});

	describe('fan-out-synthesize', () => {
		it('has parallel research steps', () => {
			const parallelSteps = fanOutSynthesize.steps.filter((s) => s.parallel);
			expect(parallelSteps.length).toBeGreaterThanOrEqual(2);
		});

		it('has a synthesize step that dependsOn all parallel steps', () => {
			const synthesize = fanOutSynthesize.steps.find((s) => s.id === 'synthesize');
			expect(synthesize).toBeDefined();
			expect(synthesize!.dependsOn).toBeDefined();

			const parallelIds = fanOutSynthesize.steps
				.filter((s) => s.parallel)
				.map((s) => s.id);

			for (const id of parallelIds) {
				expect(synthesize!.dependsOn).toContain(id);
			}
		});
	});

	describe('sequential-pipeline', () => {
		it('has steps where each depends on the previous', () => {
			const steps = sequentialPipeline.steps;

			// First step has no dependencies
			expect(steps[0].dependsOn).toBeUndefined();

			// Each subsequent step depends on the previous one
			for (let i = 1; i < steps.length; i++) {
				expect(steps[i].dependsOn).toBeDefined();
				expect(steps[i].dependsOn).toContain(steps[i - 1].id);
			}
		});
	});

	describe('event-triggered', () => {
		it('has a monitor step as the first step', () => {
			expect(eventTriggered.steps[0].id).toBe('monitor');
		});

		it('has analyze depending on monitor', () => {
			const analyze = eventTriggered.steps.find((s) => s.id === 'analyze');
			expect(analyze).toBeDefined();
			expect(analyze!.dependsOn).toContain('monitor');
		});
	});
});
