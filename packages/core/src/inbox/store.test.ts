import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryInbox } from './store.js';
import type { InboxItem, InboxItemPriority } from '../types/inbox.js';
import type { AgentId } from '../types/common.js';

/** Helper to build a minimal inbox item payload. */
function makeItem(
	overrides: Partial<Omit<InboxItem, 'id' | 'createdAt' | 'consumed'>> = {},
) {
	return {
		agentId: (overrides.agentId ?? 'scout') as AgentId,
		source: overrides.source ?? ('human' as const),
		priority: overrides.priority ?? ('normal' as InboxItemPriority),
		subject: overrides.subject ?? 'Test task',
		body: overrides.body ?? 'Please do the thing',
		from: overrides.from,
	};
}

describe('InMemoryInbox', () => {
	let inbox: InMemoryInbox;

	beforeEach(() => {
		inbox = new InMemoryInbox();
	});

	// ── Push + Peek by priority ───────────────────────────────────────

	it('pushes items and peeks them sorted by priority (urgent > high > normal > low)', () => {
		inbox.push(makeItem({ priority: 'low' }));
		inbox.push(makeItem({ priority: 'urgent' }));
		inbox.push(makeItem({ priority: 'normal' }));
		inbox.push(makeItem({ priority: 'high' }));

		const items = inbox.peek('scout' as AgentId);
		expect(items).toHaveLength(4);
		expect(items[0].priority).toBe('urgent');
		expect(items[1].priority).toBe('high');
		expect(items[2].priority).toBe('normal');
		expect(items[3].priority).toBe('low');
	});

	it('push returns a unique ID', () => {
		const id1 = inbox.push(makeItem());
		const id2 = inbox.push(makeItem());
		expect(id1).toBeTruthy();
		expect(id2).toBeTruthy();
		expect(id1).not.toBe(id2);
	});

	// ── Peek does not consume, drain does ─────────────────────────────

	it('peek does not mark items as consumed', () => {
		inbox.push(makeItem());
		inbox.push(makeItem());

		// Peek twice — should return the same items
		const first = inbox.peek('scout' as AgentId);
		const second = inbox.peek('scout' as AgentId);
		expect(first).toHaveLength(2);
		expect(second).toHaveLength(2);
	});

	it('drain marks items as consumed so they are not returned again', () => {
		inbox.push(makeItem());
		inbox.push(makeItem());

		const drained = inbox.drain('scout' as AgentId);
		expect(drained).toHaveLength(2);

		// After drain, peek and drain should return nothing
		expect(inbox.peek('scout' as AgentId)).toHaveLength(0);
		expect(inbox.drain('scout' as AgentId)).toHaveLength(0);
	});

	// ── Drain returns priority-sorted items ───────────────────────────

	it('drain returns items sorted by priority', () => {
		inbox.push(makeItem({ priority: 'low' }));
		inbox.push(makeItem({ priority: 'urgent' }));
		inbox.push(makeItem({ priority: 'high' }));
		inbox.push(makeItem({ priority: 'normal' }));

		const drained = inbox.drain('scout' as AgentId);
		expect(drained).toHaveLength(4);
		expect(drained[0].priority).toBe('urgent');
		expect(drained[1].priority).toBe('high');
		expect(drained[2].priority).toBe('normal');
		expect(drained[3].priority).toBe('low');
	});

	// ── Count reflects only unconsumed items ──────────────────────────

	it('count reflects only unconsumed items', () => {
		inbox.push(makeItem());
		inbox.push(makeItem());
		inbox.push(makeItem());

		expect(inbox.count('scout' as AgentId)).toBe(3);

		inbox.drain('scout' as AgentId);
		expect(inbox.count('scout' as AgentId)).toBe(0);
	});

	it('count returns 0 for an agent with no items', () => {
		expect(inbox.count('ghost' as AgentId)).toBe(0);
	});

	// ── Per-agent isolation ───────────────────────────────────────────

	it('isolates items by agent — agents only see their own inbox', () => {
		inbox.push(makeItem({ agentId: 'scout' as AgentId, subject: 'scout-task' }));
		inbox.push(makeItem({ agentId: 'scout' as AgentId, subject: 'scout-task-2' }));
		inbox.push(makeItem({ agentId: 'lens' as AgentId, subject: 'lens-task' }));

		const scoutItems = inbox.peek('scout' as AgentId);
		const lensItems = inbox.peek('lens' as AgentId);

		expect(scoutItems).toHaveLength(2);
		expect(lensItems).toHaveLength(1);
		expect(scoutItems.every((i) => i.agentId === 'scout')).toBe(true);
		expect(lensItems[0].agentId).toBe('lens');
	});

	it('draining one agent does not affect another', () => {
		inbox.push(makeItem({ agentId: 'scout' as AgentId }));
		inbox.push(makeItem({ agentId: 'lens' as AgentId }));

		inbox.drain('scout' as AgentId);

		expect(inbox.count('scout' as AgentId)).toBe(0);
		expect(inbox.count('lens' as AgentId)).toBe(1);
	});

	// ── Per-agent cap (500) eviction ──────────────────────────────────

	it('evicts oldest items when exceeding 500 per agent', () => {
		// Push 500 items — all should be present
		for (let i = 0; i < 500; i++) {
			inbox.push(makeItem({ subject: `task-${i}` }));
		}
		expect(inbox.count('scout' as AgentId)).toBe(500);

		// Push one more — should evict the oldest, keeping 500
		inbox.push(makeItem({ subject: 'task-500' }));
		expect(inbox.count('scout' as AgentId)).toBe(500);

		// The newest item should be present
		const items = inbox.peek('scout' as AgentId, 500);
		const subjects = items.map((i) => i.subject);
		expect(subjects).toContain('task-500');
		// The oldest item should have been evicted
		expect(subjects).not.toContain('task-0');
	});

	it('per-agent cap does not affect other agents', () => {
		for (let i = 0; i < 501; i++) {
			inbox.push(makeItem({ agentId: 'scout' as AgentId }));
		}
		inbox.push(makeItem({ agentId: 'lens' as AgentId }));

		expect(inbox.count('scout' as AgentId)).toBe(500);
		expect(inbox.count('lens' as AgentId)).toBe(1);
	});

	// ── Edge cases ────────────────────────────────────────────────────

	it('peek with limit restricts the number of returned items', () => {
		for (let i = 0; i < 10; i++) {
			inbox.push(makeItem());
		}
		const items = inbox.peek('scout' as AgentId, 3);
		expect(items).toHaveLength(3);
	});

	it('peek/drain on empty inbox return empty arrays', () => {
		expect(inbox.peek('scout' as AgentId)).toHaveLength(0);
		expect(inbox.drain('scout' as AgentId)).toHaveLength(0);
	});
});
