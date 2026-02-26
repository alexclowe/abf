/**
 * InMemoryApprovalStore — Map-based approval queue, capped at 1000 entries.
 * Persistent backends (Postgres, Redis) can implement IApprovalStore later.
 */

import { nanoid } from 'nanoid';
import type { AgentId } from '../types/common.js';
import { toISOTimestamp } from '../util/id.js';
import type {
	ApprovalRequest,
	ApprovalStatus,
	IApprovalStore,
} from '../types/approval.js';

const MAX_ENTRIES = 1000;

export class InMemoryApprovalStore implements IApprovalStore {
	private readonly store = new Map<string, ApprovalRequest>();

	create(
		request: Omit<ApprovalRequest, 'id' | 'status' | 'resolvedAt' | 'resolvedBy'>,
	): string {
		const id = nanoid();
		const entry: ApprovalRequest = {
			...request,
			id,
			status: 'pending',
		};
		this.store.set(id, entry);

		// Evict oldest entries if over cap
		if (this.store.size > MAX_ENTRIES) {
			const first = this.store.keys().next().value;
			if (first !== undefined) this.store.delete(first);
		}

		return id;
	}

	get(id: string): ApprovalRequest | undefined {
		return this.store.get(id);
	}

	list(filter?: {
		status?: ApprovalStatus;
		agentId?: AgentId;
	}): readonly ApprovalRequest[] {
		let entries = [...this.store.values()];
		if (filter?.status) {
			entries = entries.filter((e) => e.status === filter.status);
		}
		if (filter?.agentId) {
			entries = entries.filter((e) => e.agentId === filter.agentId);
		}
		// Most recent first
		return entries.reverse();
	}

	approve(id: string, resolvedBy?: string): boolean {
		const entry = this.store.get(id);
		if (!entry || entry.status !== 'pending') return false;
		entry.status = 'approved';
		entry.resolvedAt = toISOTimestamp();
		entry.resolvedBy = resolvedBy ?? 'operator';
		return true;
	}

	reject(id: string, resolvedBy?: string): boolean {
		const entry = this.store.get(id);
		if (!entry || entry.status !== 'pending') return false;
		entry.status = 'rejected';
		entry.resolvedAt = toISOTimestamp();
		entry.resolvedBy = resolvedBy ?? 'operator';
		return true;
	}
}
