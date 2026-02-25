import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId, TeamId } from '../types/common.js';
import { computeChecksum } from '../util/checksum.js';
import { PostgresMemoryStore } from './postgres.store.js';

// Mock pg module
const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => {
	return {
		default: {
			Pool: vi.fn(() => ({
				query: mockQuery,
				end: mockEnd,
			})),
		},
	};
});

describe('PostgresMemoryStore', () => {
	let store: PostgresMemoryStore;

	beforeEach(() => {
		vi.clearAllMocks();
		store = new PostgresMemoryStore('postgres://localhost/test');
	});

	describe('initialize', () => {
		it('creates extension and tables', async () => {
			mockQuery.mockResolvedValue({ rows: [] });
			await store.initialize();
			// CREATE EXTENSION + 4 CREATE TABLE + 1 CREATE INDEX = 6 queries
			expect(mockQuery).toHaveBeenCalledTimes(6);
			expect(mockQuery.mock.calls[0]![0]).toContain('CREATE EXTENSION IF NOT EXISTS vector');
			expect(mockQuery.mock.calls[1]![0]).toContain('abf_agent_history');
			expect(mockQuery.mock.calls[2]![0]).toContain('idx_abf_history_agent');
			expect(mockQuery.mock.calls[3]![0]).toContain('abf_agent_charter');
			expect(mockQuery.mock.calls[4]![0]).toContain('abf_decisions');
			expect(mockQuery.mock.calls[5]![0]).toContain('abf_knowledge');
		});
	});

	describe('read', () => {
		it('reads charter for an agent', async () => {
			mockQuery.mockResolvedValueOnce({ rows: [{ content: '# Scout Charter' }] });
			const result = await store.read('scout' as AgentId, 'charter');
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe('# Scout Charter');
			}
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining('abf_agent_charter'),
				['scout'],
			);
		});

		it('returns error for missing charter', async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const result = await store.read('missing' as AgentId, 'charter');
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe('MEMORY_READ_FAILED');
			}
		});

		it('reads history entries joined with separator', async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [{ content: 'Entry 1' }, { content: 'Entry 2' }],
			});
			const result = await store.read('scout' as AgentId, 'history');
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe('Entry 1\n\n---\n\nEntry 2');
			}
		});

		it('reads decisions', async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [{ content: 'Decision A' }],
			});
			const result = await store.read('scout' as AgentId, 'decisions');
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe('Decision A');
			}
		});

		it('reads knowledge as JSON', async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [{ key: 'clients', content: 'Acme Corp' }],
			});
			const result = await store.read('scout' as AgentId, 'knowledge');
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(JSON.parse(result.value)).toEqual({ clients: 'Acme Corp' });
			}
		});

		it('returns error on query failure', async () => {
			mockQuery.mockRejectedValueOnce(new Error('connection refused'));
			const result = await store.read('scout' as AgentId, 'charter');
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe('MEMORY_READ_FAILED');
				expect(result.error.message).toContain('connection refused');
			}
		});
	});

	describe('append', () => {
		it('inserts history entry with checksum', async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const result = await store.append('scout' as AgentId, 'history', 'Did something');
			expect(result.ok).toBe(true);
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining('INSERT INTO abf_agent_history'),
				['scout', 'Did something', computeChecksum('Did something')],
			);
		});

		it('returns error on insert failure', async () => {
			mockQuery.mockRejectedValueOnce(new Error('disk full'));
			const result = await store.append('scout' as AgentId, 'history', 'content');
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe('MEMORY_WRITE_FAILED');
			}
		});
	});

	describe('write', () => {
		it('upserts charter', async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const result = await store.write('scout' as AgentId, 'charter', '# New Charter');
			expect(result.ok).toBe(true);
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining('ON CONFLICT(agent_id)'),
				['scout', '# New Charter', computeChecksum('# New Charter')],
			);
		});

		it('inserts decisions', async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const result = await store.write('scout' as AgentId, 'decisions', 'We decided X');
			expect(result.ok).toBe(true);
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining('INSERT INTO abf_decisions'),
				['We decided X', computeChecksum('We decided X')],
			);
		});

		it('upserts knowledge', async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const result = await store.write('clients' as AgentId, 'knowledge', 'Acme data');
			expect(result.ok).toBe(true);
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining('ON CONFLICT(key)'),
				['clients', 'Acme data', computeChecksum('Acme data')],
			);
		});
	});

	describe('loadContext', () => {
		it('returns sensible defaults for empty results', async () => {
			mockQuery
				.mockResolvedValueOnce({ rows: [] }) // charter
				.mockResolvedValueOnce({ rows: [] }) // history
				.mockResolvedValueOnce({ rows: [] }) // decisions
				.mockResolvedValueOnce({ rows: [] }); // knowledge
			const result = await store.loadContext('empty' as AgentId);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.charter).toBe('');
				expect(result.value.history).toEqual([]);
				expect(result.value.decisions).toEqual([]);
				expect(result.value.knowledge).toEqual({});
				expect(result.value.pendingMessages).toBe(0);
			}
		});

		it('populates context from query results', async () => {
			const ts = new Date('2024-06-01T00:00:00Z');
			const checksum = computeChecksum('history entry');
			mockQuery
				.mockResolvedValueOnce({ rows: [{ content: '# Charter' }] })
				.mockResolvedValueOnce({
					rows: [{ content: 'history entry', timestamp: ts, checksum }],
				})
				.mockResolvedValueOnce({
					rows: [{ content: 'decision', team_id: 'product', timestamp: ts, checksum }],
				})
				.mockResolvedValueOnce({
					rows: [{ key: 'clients', content: 'Acme' }],
				});

			const result = await store.loadContext('scout' as AgentId);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.charter).toBe('# Charter');
				expect(result.value.history).toHaveLength(1);
				expect(result.value.history[0]!.layer).toBe('history');
				expect(result.value.history[0]!.content).toBe('history entry');
				expect(result.value.decisions).toHaveLength(1);
				expect(result.value.decisions[0]!.teamId).toBe('product');
				expect(result.value.knowledge).toEqual({ clients: 'Acme' });
			}
		});

		it('handles decisions without team_id', async () => {
			const ts = new Date('2024-06-01T00:00:00Z');
			const checksum = computeChecksum('decision');
			mockQuery
				.mockResolvedValueOnce({ rows: [] })
				.mockResolvedValueOnce({ rows: [] })
				.mockResolvedValueOnce({
					rows: [{ content: 'decision', team_id: null, timestamp: ts, checksum }],
				})
				.mockResolvedValueOnce({ rows: [] });

			const result = await store.loadContext('scout' as AgentId);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.decisions).toHaveLength(1);
				expect(result.value.decisions[0]!.teamId).toBeUndefined();
			}
		});

		it('returns error on query failure', async () => {
			mockQuery.mockRejectedValueOnce(new Error('timeout'));
			const result = await store.loadContext('scout' as AgentId);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe('MEMORY_READ_FAILED');
			}
		});
	});

	describe('verify', () => {
		it('returns true for matching charter checksum', async () => {
			const content = 'charter content';
			const checksum = computeChecksum(content);
			mockQuery.mockResolvedValueOnce({ rows: [{ content, checksum }] });
			const result = await store.verify('scout' as AgentId, 'charter');
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe(true);
			}
		});

		it('returns false for mismatched charter checksum', async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [{ content: 'content', checksum: 'wrong-checksum' }],
			});
			const result = await store.verify('scout' as AgentId, 'charter');
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe(false);
			}
		});

		it('returns false for missing charter', async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const result = await store.verify('scout' as AgentId, 'charter');
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe(false);
			}
		});

		it('returns true when no history entries exist', async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const result = await store.verify('scout' as AgentId, 'history');
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe(true);
			}
		});

		it('returns true for other layers', async () => {
			const result = await store.verify('scout' as AgentId, 'decisions');
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe(true);
			}
		});
	});

	describe('list', () => {
		it('lists decisions without filter', async () => {
			const ts = new Date('2024-06-01T00:00:00Z');
			const checksum = computeChecksum('d1');
			mockQuery.mockResolvedValueOnce({
				rows: [{ content: 'd1', team_id: 'product', timestamp: ts, checksum }],
			});
			const result = await store.list('decisions');
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(1);
				expect(result.value[0]!.layer).toBe('decisions');
				expect(result.value[0]!.teamId).toBe('product');
			}
		});

		it('lists decisions filtered by teamId', async () => {
			const ts = new Date('2024-06-01T00:00:00Z');
			const checksum = computeChecksum('d1');
			mockQuery.mockResolvedValueOnce({
				rows: [{ content: 'd1', team_id: 'product', timestamp: ts, checksum }],
			});
			const result = await store.list('decisions', { teamId: 'product' as TeamId });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(1);
			}
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining('WHERE team_id = $1'),
				['product'],
			);
		});

		it('returns empty array for non-decisions layer', async () => {
			const result = await store.list('charter');
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
		});
	});

	describe('disconnect', () => {
		it('ends the pool', async () => {
			mockEnd.mockResolvedValueOnce(undefined);
			await store.disconnect();
			expect(mockEnd).toHaveBeenCalledOnce();
		});
	});
});
