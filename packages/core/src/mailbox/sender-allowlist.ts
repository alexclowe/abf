/**
 * Sender allowlist — validates external mail senders against glob patterns.
 *
 * Agent-to-agent mail and operator mail always pass.
 * External senders (source === 'email') must match at least one allowedSenders pattern.
 *
 * Pattern format:
 *   "*@company.com"   — any sender from company.com
 *   "ceo@partner.io"  — exact match
 *   "*"               — accept all (open relay — not recommended)
 */

/**
 * Convert a simple glob pattern (supporting only `*`) to a RegExp.
 * Escapes all special regex chars except `*`, which becomes `.*`.
 */
function globToRegex(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
	return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Check whether a sender is allowed to deliver mail.
 *
 * @param from        - The sender identifier (agent name, "operator", or email address)
 * @param source      - The mail source type
 * @param allowedSenders - Glob patterns for accepted external senders. If undefined/empty, external mail is rejected.
 * @param agentsMap   - Known agents (agent-to-agent mail always passes)
 */
export function isAllowedSender(
	from: string,
	source: 'agent' | 'human' | 'email',
	allowedSenders: readonly string[] | undefined,
	agentsMap: ReadonlyMap<string, unknown>,
): { allowed: boolean; reason?: string } {
	// Agent-to-agent mail: always trusted
	if (source === 'agent') {
		return { allowed: true };
	}

	// Operator mail (dashboard / API with auth): always trusted
	if (source === 'human' && (from === 'operator' || from === 'dashboard')) {
		return { allowed: true };
	}

	// Known agent names sending via human/email source still pass
	// (covers edge case of agents using the API endpoint)
	for (const agent of agentsMap.values()) {
		if ((agent as { name?: string }).name === from) {
			return { allowed: true };
		}
	}

	// External email: check allowlist
	if (!allowedSenders || allowedSenders.length === 0) {
		return { allowed: false, reason: 'No allowed senders configured — external mail rejected' };
	}

	for (const pattern of allowedSenders) {
		if (globToRegex(pattern).test(from)) {
			return { allowed: true };
		}
	}

	return { allowed: false, reason: `Sender "${from}" does not match any allowed pattern` };
}
