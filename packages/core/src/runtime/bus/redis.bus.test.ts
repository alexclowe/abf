import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock ioredis with ioredis-mock before importing RedisBus
vi.mock('ioredis', async () => {
	const { default: RedisMock } = await import('ioredis-mock');
	return { default: RedisMock, Redis: RedisMock };
});

import type { AgentId, ISOTimestamp, MessageId } from '../../types/common.js';
import type { BusMessage } from '../../types/message.js';
import { RedisBus } from './redis.bus.js';

let testCounter = 0;

function makeMessage(from: string, to: string, context: string): BusMessage {
	return {
		id: `msg_test_${Date.now()}` as MessageId,
		from: from as AgentId,
		to: to as AgentId,
		type: 'REQUEST',
		priority: 'normal',
		context,
		payload: { data: context },
		timestamp: new Date().toISOString() as ISOTimestamp,
	};
}

describe('RedisBus', () => {
	let bus: RedisBus;

	beforeEach(async () => {
		// Use a unique URL per test so ioredis-mock isolates the data store
		testCounter++;
		bus = new RedisBus(`redis://test-${testCounter}:6379`);
		await bus.connect();
	});

	afterEach(async () => {
		await bus.disconnect();
	});

	it('delivers direct messages to subscribers', async () => {
		const received: BusMessage[] = [];

		bus.subscribe('agent-b' as AgentId, (msg) => {
			received.push(msg);
		});

		// Give ioredis-mock time to process subscription
		await new Promise((r) => setTimeout(r, 50));

		await bus.publish(makeMessage('agent-a', 'agent-b', 'hello'));

		// Give time for pub/sub delivery
		await new Promise((r) => setTimeout(r, 50));

		expect(received).toHaveLength(1);
		expect(received[0]?.context).toBe('hello');
	});

	it('does not deliver messages to wrong subscriber', async () => {
		const handler = vi.fn();

		bus.subscribe('agent-c' as AgentId, handler);

		await new Promise((r) => setTimeout(r, 50));

		await bus.publish(makeMessage('agent-a', 'agent-b', 'not for you'));

		await new Promise((r) => setTimeout(r, 50));

		expect(handler).not.toHaveBeenCalled();
	});

	it('delivers broadcast messages to all except sender', async () => {
		const receivedA: BusMessage[] = [];
		const receivedB: BusMessage[] = [];

		bus.subscribe('agent-a' as AgentId, (msg) => receivedA.push(msg));
		bus.subscribe('agent-b' as AgentId, (msg) => receivedB.push(msg));

		await new Promise((r) => setTimeout(r, 50));

		await bus.publish(makeMessage('agent-a', '*', 'broadcast'));

		await new Promise((r) => setTimeout(r, 50));

		// Sender should not receive their own broadcast
		expect(receivedA).toHaveLength(0);
		expect(receivedB).toHaveLength(1);
	});

	it('stores and retrieves pending messages', async () => {
		await bus.publish(makeMessage('agent-a', 'agent-b', 'pending1'));
		await bus.publish(makeMessage('agent-a', 'agent-b', 'pending2'));

		const pending = await bus.getPending('agent-b' as AgentId);
		expect(pending).toHaveLength(2);

		// Pending should be cleared after retrieval
		const again = await bus.getPending('agent-b' as AgentId);
		expect(again).toHaveLength(0);
	});

	it('unsubscribe stops delivery', async () => {
		const handler = vi.fn();

		const unsubscribe = bus.subscribe('agent-x' as AgentId, handler);

		await new Promise((r) => setTimeout(r, 50));

		unsubscribe();

		await new Promise((r) => setTimeout(r, 50));

		await bus.publish(makeMessage('agent-a', 'agent-x', 'should not arrive'));

		await new Promise((r) => setTimeout(r, 50));

		expect(handler).not.toHaveBeenCalled();
	});

	it('filters messages by type', async () => {
		const received: BusMessage[] = [];

		bus.subscribeWithFilter({ to: 'agent-b' as AgentId, type: 'ALERT' }, (msg) =>
			received.push(msg),
		);

		await new Promise((r) => setTimeout(r, 50));

		await bus.publish(makeMessage('agent-a', 'agent-b', 'request'));
		await bus.publish({
			...makeMessage('agent-a', 'agent-b', 'alert'),
			type: 'ALERT',
		});

		await new Promise((r) => setTimeout(r, 50));

		expect(received).toHaveLength(1);
		expect(received[0]?.type).toBe('ALERT');
	});

	it('stores and retrieves message history', async () => {
		await bus.publish(makeMessage('agent-a', 'agent-b', 'msg1'));
		await bus.publish(makeMessage('agent-a', 'agent-b', 'msg2'));

		// agent-a should have history (as sender)
		const historyA = await bus.getHistory('agent-a' as AgentId, 10);
		expect(historyA).toHaveLength(2);

		// agent-b should have history (as receiver)
		const historyB = await bus.getHistory('agent-b' as AgentId, 10);
		expect(historyB).toHaveLength(2);
	});
});
