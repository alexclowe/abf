/**
 * Session Event Bus — emits lifecycle events for real-time session observation.
 *
 * Allows operators to watch automated sessions (cron/heartbeat) as they run,
 * via SSE endpoints: GET /api/agents/:id/stream, GET /api/sessions/:id/stream.
 */

import { EventEmitter } from 'node:events';
import type { AgentId, SessionId } from '../types/common.js';
import type { StreamEvent } from './interfaces.js';

export interface SessionLifecycleEvent {
	readonly type: 'session_start' | 'session_end' | 'stream_event';
	readonly agentId: AgentId;
	readonly sessionId: SessionId;
	readonly timestamp: number;
	readonly event?: StreamEvent | undefined;
	readonly result?: { status: string; outputText?: string | undefined } | undefined;
}

export class SessionEventBus extends EventEmitter {
	emitSessionStart(agentId: AgentId, sessionId: SessionId): void {
		const event: SessionLifecycleEvent = {
			type: 'session_start',
			agentId,
			sessionId,
			timestamp: Date.now(),
		};
		this.emit('session', event);
		this.emit(`agent:${agentId}`, event);
		this.emit(`session:${sessionId}`, event);
	}

	emitSessionEnd(agentId: AgentId, sessionId: SessionId, status: string, outputText?: string): void {
		const event: SessionLifecycleEvent = {
			type: 'session_end',
			agentId,
			sessionId,
			timestamp: Date.now(),
			result: { status, outputText },
		};
		this.emit('session', event);
		this.emit(`agent:${agentId}`, event);
		this.emit(`session:${sessionId}`, event);
	}

	emitStreamEvent(agentId: AgentId, sessionId: SessionId, streamEvent: StreamEvent): void {
		const event: SessionLifecycleEvent = {
			type: 'stream_event',
			agentId,
			sessionId,
			timestamp: Date.now(),
			event: streamEvent,
		};
		this.emit('session', event);
		this.emit(`agent:${agentId}`, event);
		this.emit(`session:${sessionId}`, event);
	}
}
