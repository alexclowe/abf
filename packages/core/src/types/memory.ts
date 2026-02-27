/**
 * Memory system types.
 * Layered memory: Charter, History, Decisions, Knowledge, Session.
 */

import type { AgentId, Checksum, ISOTimestamp, TeamId } from './common.js';
import type { ABFError, Result } from './errors.js';

// ─── Memory Layers ────────────────────────────────────────────────────

export type MemoryLayer = 'charter' | 'history' | 'decisions' | 'knowledge' | 'session';

export interface MemoryEntry {
	readonly layer: MemoryLayer;
	readonly agentId?: AgentId | undefined;
	readonly teamId?: TeamId | undefined;
	readonly content: string;
	readonly timestamp: ISOTimestamp;
	readonly checksum: Checksum;
	readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

// ─── Agent Memory Context ─────────────────────────────────────────────
// The memory loaded at session start for an agent.

export interface AgentMemoryContext {
	readonly charter: string;
	readonly history: readonly MemoryEntry[];
	readonly decisions: readonly MemoryEntry[];
	readonly knowledge: Readonly<Record<string, string>>;
	readonly pendingMessages: number;
	readonly summary?: string | undefined;
}

// ─── Memory Store Interface ───────────────────────────────────────────

export interface IMemoryStore {
	/** Read a specific memory layer for an agent. */
	read(agentId: AgentId, layer: MemoryLayer): Promise<Result<string, ABFError>>;

	/** Append to an agent's history (append-only). */
	append(agentId: AgentId, layer: 'history', content: string): Promise<Result<void, ABFError>>;

	/** Write/overwrite a memory layer. */
	write(
		agentId: AgentId,
		layer: Exclude<MemoryLayer, 'history'>,
		content: string,
	): Promise<Result<void, ABFError>>;

	/** Load full memory context for an agent's session. */
	loadContext(agentId: AgentId): Promise<Result<AgentMemoryContext, ABFError>>;

	/** Verify integrity of a memory entry. */
	verify(agentId: AgentId, layer: MemoryLayer): Promise<Result<boolean, ABFError>>;

	/** Get all entries for a layer (e.g., team decisions). */
	list(
		layer: MemoryLayer,
		filter?: { readonly teamId?: TeamId | undefined } | undefined,
	): Promise<Result<readonly MemoryEntry[], ABFError>>;
}
