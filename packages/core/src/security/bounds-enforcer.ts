/**
 * Behavioral bounds enforcement.
 * Validates tool calls against agent's BehavioralBounds at the runtime layer.
 * The LLM never sees these constraints — the runtime enforces them.
 */

import type { BehavioralBounds } from '../types/agent.js';
import type { USDCents } from '../types/common.js';
import type { ABFError, Result } from '../types/errors.js';
import { Err, Ok, SecurityError } from '../types/errors.js';

export interface BoundsCheckInput {
	readonly action: string;
	readonly bounds: BehavioralBounds;
	readonly currentSessionCost: USDCents;
}

export type BoundsCheckResult =
	| { readonly allowed: true }
	| { readonly allowed: false; readonly reason: string }
	| { readonly allowed: 'requires_approval'; readonly action: string; readonly reason?: string };

/**
 * Check if an action matches a bounds entry, supporting colon-delimited sub-actions.
 * e.g. action "database-write:delete" matches entry "database-write" (tool-level)
 *      action "database-write:delete" matches entry "database-write:delete" (exact)
 *      action "database-write" does NOT match entry "database-write:delete" (sub-action specific)
 */
function matchesAction(action: string, entry: string): boolean {
	if (action === entry) return true;
	// If the entry has no sub-action, it matches all sub-actions of that tool
	if (!entry.includes(':') && action.startsWith(`${entry}:`)) return true;
	return false;
}

function matchesAnyAction(action: string, list: readonly string[]): boolean {
	return list.some((entry) => matchesAction(action, entry));
}

export function checkBounds(input: BoundsCheckInput): Result<BoundsCheckResult, ABFError> {
	const { action, bounds, currentSessionCost } = input;

	// 1. Check forbidden actions (highest priority)
	if (matchesAnyAction(action, bounds.forbiddenActions)) {
		return Ok({
			allowed: false,
			reason: `Action "${action}" is explicitly forbidden`,
		});
	}

	// 2. Check cost limit
	if (currentSessionCost >= bounds.maxCostPerSession) {
		return Err(
			new SecurityError(
				'COST_LIMIT_EXCEEDED',
				`Session cost ($${currentSessionCost / 100}) exceeds limit ($${bounds.maxCostPerSession / 100})`,
				{ currentCost: currentSessionCost, limit: bounds.maxCostPerSession },
			),
		);
	}

	// 3. Check requires approval
	if (matchesAnyAction(action, bounds.requiresApproval)) {
		return Ok({
			allowed: 'requires_approval',
			action,
		});
	}

	// 4. Check allowed actions (if non-empty, unlisted actions escalate to human for approval)
	if (bounds.allowedActions.length > 0 && !matchesAnyAction(action, bounds.allowedActions)) {
		return Ok({
			allowed: 'requires_approval',
			action,
			reason: `Action "${action}" is not in the allowed actions list`,
		});
	}

	return Ok({ allowed: true });
}
