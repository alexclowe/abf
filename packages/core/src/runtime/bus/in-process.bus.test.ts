import { describe, expect, it, vi } from 'vitest';
import type { AgentId, ISOTimestamp, MessageId } from '../../types/common.js';
import type { BusMessage } from '../../types/message.js';
import { InProcessBus } from './in-process.bus.js';

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

describe('InProcessBus', () => {
	it('delivers direct messages to subscribers', async () => {
		const bus = new InProcessBus();
		const received: BusMessage[] = [];

		bus.subscribe('agent-b' as AgentId, (msg) => {
			received.push(msg);
		});

		await bus.publish(makeMessage('agent-a', 'agent-b', 'hello'));

		expect(received).toHaveLength(1);
		expect(received[0]?.context).toBe('hello');
	});

	it('does not deliver messages to wrong subscriber', async () => {
		const bus = new InProcessBus();
		const handler = vi.fn();

		bus.subscribe('agent-c' as AgentId, handler);

		await bus.publish(makeMessage('agent-a', 'agent-b', 'not for you'));

		expect(handler).not.toHaveBeenCalled();
	});

	it('delivers broadcast messages to all except sender', async () => {
		const bus = new InProcessBus();
		const receivedA: BusMessage[] = [];
		const receivedB: BusMessage[] = [];

		bus.subscribe('agent-a' as AgentId, (msg) => receivedA.push(msg));
		bus.subscribe('agent-b' as AgentId, (msg) => receivedB.push(msg));

		await bus.publish(makeMessage('agent-a', '*', 'broadcast'));

		// Sender should not receive their own broadcast
		expect(receivedA).toHaveLength(0);
		expect(receivedB).toHaveLength(1);
	});

	it('stores and retrieves pending messages', async () => {
		const bus = new InProcessBus();

		await bus.publish(makeMessage('agent-a', 'agent-b', 'pending1'));
		await bus.publish(makeMessage('agent-a', 'agent-b', 'pending2'));

		const pending = await bus.getPending('agent-b' as AgentId);
		expect(pending).toHaveLength(2);

		// Pending should be cleared after retrieval
		const again = await bus.getPending('agent-b' as AgentId);
		expect(again).toHaveLength(0);
	});

	it('unsubscribe stops delivery', async () => {
		const bus = new InProcessBus();
		const handler = vi.fn();

		const unsubscribe = bus.subscribe('agent-x' as AgentId, handler);
		unsubscribe();

		await bus.publish(makeMessage('agent-a', 'agent-x', 'should not arrive'));

		expect(handler).not.toHaveBeenCalled();
	});

	it('filters messages by type', async () => {
		const bus = new InProcessBus();
		const received: BusMessage[] = [];

		bus.subscribeWithFilter({ to: 'agent-b' as AgentId, type: 'ALERT' }, (msg) =>
			received.push(msg),
		);

		await bus.publish(makeMessage('agent-a', 'agent-b', 'request'));
		await bus.publish({
			...makeMessage('agent-a', 'agent-b', 'alert'),
			type: 'ALERT',
		});

		expect(received).toHaveLength(1);
		expect(received[0]?.type).toBe('ALERT');
	});
});
