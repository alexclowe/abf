/**
 * SSE event stream types and re-export of the shared hook.
 * The actual connection lives in EventStreamProvider (mounted in RootLayout).
 */

export interface AgentMessageSnapshot {
  conversationId: string;
  agentId: string;
  agentName: string;
  title: string;
  content: string;
  timestamp: number;
  source: string;
}

export interface EventSnapshot {
  status: { version: string; uptime: number; agents: number; activeSessions: number; configured: boolean };
  runtime: Record<string, unknown>;
  agents: { config: Record<string, unknown>; state: Record<string, unknown> | null }[];
  agentStates: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  escalations: { id: string; type: string; agentId: string; message: string; target: string; resolved: boolean; timestamp: string }[];
  agentMessages?: AgentMessageSnapshot[];
}

export { useEventStream } from './event-stream-provider';
