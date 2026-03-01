import { describe, expect, it } from 'vitest';
import type { BehavioralBounds } from '../types/agent.js';
import type { USDCents } from '../types/common.js';
import { checkBounds } from './bounds-enforcer.js';

const bounds: BehavioralBounds = {
	allowedActions: ['read_data', 'write_report', 'send_alert'],
	forbiddenActions: ['delete_data', 'modify_billing'],
	maxCostPerSession: 200 as USDCents, // $2.00
	requiresApproval: ['publish_content'],
};

describe('Bounds Enforcer', () => {
	it('allows listed actions', () => {
		const result = checkBounds({
			action: 'read_data',
			bounds,
			currentSessionCost: 0 as USDCents,
		});

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.allowed).toBe(true);
	});

	it('blocks forbidden actions', () => {
		const result = checkBounds({
			action: 'delete_data',
			bounds,
			currentSessionCost: 0 as USDCents,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.allowed).toBe(false);
			if (result.value.allowed === false) {
				expect(result.value.reason).toContain('forbidden');
			}
		}
	});

	it('blocks actions not in allowed list', () => {
		const result = checkBounds({
			action: 'access_credentials',
			bounds,
			currentSessionCost: 0 as USDCents,
		});

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.allowed).toBe(false);
	});

	it('flags actions requiring approval', () => {
		const result = checkBounds({
			action: 'publish_content',
			bounds,
			currentSessionCost: 0 as USDCents,
		});

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.allowed).toBe('requires_approval');
	});

	it('rejects when cost limit exceeded', () => {
		const result = checkBounds({
			action: 'read_data',
			bounds,
			currentSessionCost: 250 as USDCents, // Over $2.00
		});

		// Cost limit returns Err, not Ok with allowed=false
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe('COST_LIMIT_EXCEEDED');
	});

	it('matches sub-actions against tool-level forbidden entries', () => {
		const result = checkBounds({
			action: 'delete_data:cascade',
			bounds,
			currentSessionCost: 0 as USDCents,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.allowed).toBe(false);
		}
	});

	it('matches sub-actions against tool-level allowed entries', () => {
		const result = checkBounds({
			action: 'read_data:recent',
			bounds,
			currentSessionCost: 0 as USDCents,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.allowed).toBe(true);
	});

	it('matches sub-actions against requires_approval entries', () => {
		const result = checkBounds({
			action: 'publish_content:social',
			bounds,
			currentSessionCost: 0 as USDCents,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.allowed).toBe('requires_approval');
	});

	it('does not match tool-level action against sub-action entry', () => {
		const specificBounds: BehavioralBounds = {
			allowedActions: [],
			forbiddenActions: ['database-write:delete'],
			maxCostPerSession: 200 as USDCents,
			requiresApproval: [],
		};
		// Tool-level action should NOT match a sub-action-specific entry
		const result = checkBounds({
			action: 'database-write',
			bounds: specificBounds,
			currentSessionCost: 0 as USDCents,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.allowed).toBe(true);
	});

	it('allows all actions when allowedActions is empty', () => {
		const openBounds: BehavioralBounds = {
			...bounds,
			allowedActions: [],
		};

		const result = checkBounds({
			action: 'any_action',
			bounds: openBounds,
			currentSessionCost: 0 as USDCents,
		});

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.allowed).toBe(true);
	});
});
