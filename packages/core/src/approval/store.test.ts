import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryApprovalStore } from './store.js';
import type { ApprovalRequest } from '../types/approval.js';
import type { AgentId, ISOTimestamp, SessionId, ToolId } from '../types/common.js';

/** Helper to build a minimal approval request payload. */
function makeRequest(overrides: Partial<Omit<ApprovalRequest, 'id' | 'status' | 'resolvedAt' | 'resolvedBy'>> = {}) {
	return {
		agentId: (overrides.agentId ?? 'scout') as AgentId,
		sessionId: (overrides.sessionId ?? 'ses_abc123') as SessionId,
		toolId: (overrides.toolId ?? 'send-message') as ToolId,
		toolName: overrides.toolName ?? 'send-message',
		arguments: overrides.arguments ?? { to: 'client', body: 'Hello' },
		createdAt: (overrides.createdAt ?? new Date().toISOString()) as ISOTimestamp,
	};
}

describe('InMemoryApprovalStore', () => {
	let store: InMemoryApprovalStore;

	beforeEach(() => {
		store = new InMemoryApprovalStore();
	});

	// ── Create + Retrieve ─────────────────────────────────────────────

	it('creates a request and retrieves it by ID', () => {
		const id = store.create(makeRequest());
		const entry = store.get(id);

		expect(entry).toBeDefined();
		expect(entry!.id).toBe(id);
		expect(entry!.status).toBe('pending');
		expect(entry!.agentId).toBe('scout');
		expect(entry!.toolName).toBe('send-message');
	});

	it('returns undefined for a non-existent ID', () => {
		expect(store.get('does-not-exist')).toBeUndefined();
	});

	// ── List with filters ─────────────────────────────────────────────

	it('lists all entries without filters', () => {
		store.create(makeRequest());
		store.create(makeRequest({ agentId: 'lens' as AgentId }));

		const all = store.list();
		expect(all).toHaveLength(2);
	});

	it('filters by status', () => {
		const id1 = store.create(makeRequest());
		store.create(makeRequest());
		store.approve(id1);

		const pending = store.list({ status: 'pending' });
		expect(pending).toHaveLength(1);

		const approved = store.list({ status: 'approved' });
		expect(approved).toHaveLength(1);
		expect(approved[0].id).toBe(id1);
	});

	it('filters by agentId', () => {
		store.create(makeRequest({ agentId: 'scout' as AgentId }));
		store.create(makeRequest({ agentId: 'scout' as AgentId }));
		store.create(makeRequest({ agentId: 'lens' as AgentId }));

		const scoutOnly = store.list({ agentId: 'scout' as AgentId });
		expect(scoutOnly).toHaveLength(2);

		const lensOnly = store.list({ agentId: 'lens' as AgentId });
		expect(lensOnly).toHaveLength(1);
	});

	it('filters by both status and agentId simultaneously', () => {
		const id1 = store.create(makeRequest({ agentId: 'scout' as AgentId }));
		store.create(makeRequest({ agentId: 'scout' as AgentId }));
		store.create(makeRequest({ agentId: 'lens' as AgentId }));
		store.approve(id1);

		const result = store.list({ status: 'approved', agentId: 'scout' as AgentId });
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe(id1);
	});

	// ── Approve / Reject ──────────────────────────────────────────────

	it('approves a pending request and sets resolvedAt/resolvedBy', () => {
		const id = store.create(makeRequest());
		const result = store.approve(id, 'admin');

		expect(result).toBe(true);

		const entry = store.get(id)!;
		expect(entry.status).toBe('approved');
		expect(entry.resolvedAt).toBeDefined();
		expect(entry.resolvedBy).toBe('admin');
	});

	it('rejects a pending request and sets resolvedAt/resolvedBy', () => {
		const id = store.create(makeRequest());
		const result = store.reject(id, 'admin');

		expect(result).toBe(true);

		const entry = store.get(id)!;
		expect(entry.status).toBe('rejected');
		expect(entry.resolvedAt).toBeDefined();
		expect(entry.resolvedBy).toBe('admin');
	});

	it('defaults resolvedBy to "operator" when not specified', () => {
		const id1 = store.create(makeRequest());
		const id2 = store.create(makeRequest());
		store.approve(id1);
		store.reject(id2);

		expect(store.get(id1)!.resolvedBy).toBe('operator');
		expect(store.get(id2)!.resolvedBy).toBe('operator');
	});

	// ── Already-resolved returns false ────────────────────────────────

	it('returns false when approving an already-approved request', () => {
		const id = store.create(makeRequest());
		store.approve(id);
		expect(store.approve(id)).toBe(false);
	});

	it('returns false when rejecting an already-rejected request', () => {
		const id = store.create(makeRequest());
		store.reject(id);
		expect(store.reject(id)).toBe(false);
	});

	it('returns false when approving an already-rejected request', () => {
		const id = store.create(makeRequest());
		store.reject(id);
		expect(store.approve(id)).toBe(false);
	});

	it('returns false when rejecting an already-approved request', () => {
		const id = store.create(makeRequest());
		store.approve(id);
		expect(store.reject(id)).toBe(false);
	});

	it('returns false when approving a non-existent ID', () => {
		expect(store.approve('ghost')).toBe(false);
	});

	it('returns false when rejecting a non-existent ID', () => {
		expect(store.reject('ghost')).toBe(false);
	});

	// ── Most-recent-first ordering ────────────────────────────────────

	it('returns entries in most-recent-first order', () => {
		const id1 = store.create(makeRequest({ toolName: 'first' }));
		const id2 = store.create(makeRequest({ toolName: 'second' }));
		const id3 = store.create(makeRequest({ toolName: 'third' }));

		const all = store.list();
		expect(all[0].id).toBe(id3);
		expect(all[1].id).toBe(id2);
		expect(all[2].id).toBe(id1);
	});

	// ── MAX_ENTRIES cap (1000) eviction ───────────────────────────────

	it('evicts the oldest entry when exceeding 1000 entries', () => {
		// Create 1000 entries
		const firstId = store.create(makeRequest({ toolName: 'oldest' }));
		for (let i = 1; i < 1000; i++) {
			store.create(makeRequest({ toolName: `entry-${i}` }));
		}

		// All 1000 should be present, including the first
		expect(store.list()).toHaveLength(1000);
		expect(store.get(firstId)).toBeDefined();

		// The 1001st entry should evict the oldest
		store.create(makeRequest({ toolName: 'newest' }));

		expect(store.list()).toHaveLength(1000);
		expect(store.get(firstId)).toBeUndefined();
	});
});
