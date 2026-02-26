import { describe, it, expect } from 'vitest';
import {
	listArchetypes,
	getArchetype,
	BUILTIN_ARCHETYPES,
	type ArchetypeDefaults,
} from './registry.js';

const EXPECTED_ARCHETYPES = [
	'researcher',
	'writer',
	'orchestrator',
	'analyst',
	'customer-support',
	'developer',
	'marketer',
	'finance',
	'monitor',
	'generalist',
] as const;

describe('Archetypes Registry', () => {
	describe('listArchetypes', () => {
		it('returns all 10 archetype names', () => {
			const names = listArchetypes();
			expect(names).toHaveLength(10);
		});

		it('includes every expected archetype name', () => {
			const names = listArchetypes();
			for (const name of EXPECTED_ARCHETYPES) {
				expect(names).toContain(name);
			}
		});
	});

	describe('getArchetype', () => {
		it('returns the archetype for an existing name', () => {
			const researcher = getArchetype('researcher');
			expect(researcher).toBeDefined();
			expect(researcher!.temperature).toBe(0.3);
			expect(researcher!.tools).toContain('web-search');
		});

		it('returns undefined for an unknown name', () => {
			expect(getArchetype('nonexistent')).toBeUndefined();
			expect(getArchetype('')).toBeUndefined();
		});
	});

	describe('all archetypes have required fields', () => {
		const names = Object.keys(BUILTIN_ARCHETYPES);

		for (const name of names) {
			describe(`archetype: ${name}`, () => {
				let archetype: ArchetypeDefaults;

				it('exists via getArchetype', () => {
					const result = getArchetype(name);
					expect(result).toBeDefined();
					archetype = result!;
				});

				it('has a temperature between 0 and 1', () => {
					archetype = getArchetype(name)!;
					expect(typeof archetype.temperature).toBe('number');
					expect(archetype.temperature).toBeGreaterThanOrEqual(0);
					expect(archetype.temperature).toBeLessThanOrEqual(1);
				});

				it('has non-empty tools array', () => {
					archetype = getArchetype(name)!;
					expect(Array.isArray(archetype.tools)).toBe(true);
					expect(archetype.tools.length).toBeGreaterThan(0);
				});

				it('has non-empty allowedActions array', () => {
					archetype = getArchetype(name)!;
					expect(Array.isArray(archetype.allowedActions)).toBe(true);
					expect(archetype.allowedActions.length).toBeGreaterThan(0);
				});

				it('has non-empty forbiddenActions array', () => {
					archetype = getArchetype(name)!;
					expect(Array.isArray(archetype.forbiddenActions)).toBe(true);
					expect(archetype.forbiddenActions.length).toBeGreaterThan(0);
				});

				it('has a charterTemplate containing {{name}} placeholder', () => {
					archetype = getArchetype(name)!;
					expect(typeof archetype.charterTemplate).toBe('string');
					expect(archetype.charterTemplate).toContain('{{name}}');
				});
			});
		}
	});
});
