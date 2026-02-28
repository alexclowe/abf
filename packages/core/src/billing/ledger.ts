/**
 * Billing ledger implementations.
 * InMemoryBillingLedger — for self-hosted/dev (state lost on restart).
 * FileBillingLedger — persists to JSON file for self-hosted production.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ISOTimestamp } from '../types/common.js';
import { toISOTimestamp } from '../util/id.js';
import type { AccountBalance, IBillingLedger, UsageRecord } from './types.js';

// ─── In-Memory Ledger ──────────────────────────────────────────────

export class InMemoryBillingLedger implements IBillingLedger {
	private balanceCents: number;
	private lifetimeUsageCents = 0;
	private lastTopUp: ISOTimestamp | null = null;
	private records: UsageRecord[] = [];

	constructor(initialCreditsCents = 500) {
		this.balanceCents = initialCreditsCents;
		if (initialCreditsCents > 0) {
			this.lastTopUp = toISOTimestamp();
		}
	}

	async getBalance(): Promise<AccountBalance> {
		return {
			balanceCents: this.balanceCents,
			lifetimeUsageCents: this.lifetimeUsageCents,
			lastTopUp: this.lastTopUp,
		};
	}

	async debit(record: UsageRecord): Promise<boolean> {
		const cost = record.costCents as number;
		if (cost > this.balanceCents) return false;

		this.balanceCents -= cost;
		this.lifetimeUsageCents += cost;
		this.records.push(record);

		// Cap stored records at 10,000
		if (this.records.length > 10_000) {
			this.records = this.records.slice(-5_000);
		}

		return true;
	}

	async credit(amountCents: number, _source: string): Promise<void> {
		this.balanceCents += amountCents;
		this.lastTopUp = toISOTimestamp();
	}

	async getUsage(since: ISOTimestamp): Promise<readonly UsageRecord[]> {
		return this.records.filter((r) => r.timestamp >= since);
	}
}

// ─── File-Persisted Ledger ─────────────────────────────────────────

interface LedgerFileData {
	balanceCents: number;
	lifetimeUsageCents: number;
	lastTopUp: string | null;
	records: UsageRecord[];
}

export class FileBillingLedger implements IBillingLedger {
	private data: LedgerFileData;

	constructor(
		private readonly filePath: string,
		initialCreditsCents = 500,
	) {
		if (existsSync(filePath)) {
			try {
				this.data = JSON.parse(readFileSync(filePath, 'utf-8')) as LedgerFileData;
			} catch {
				this.data = this.defaultData(initialCreditsCents);
			}
		} else {
			this.data = this.defaultData(initialCreditsCents);
			this.persist();
		}
	}

	private defaultData(credits: number): LedgerFileData {
		return {
			balanceCents: credits,
			lifetimeUsageCents: 0,
			lastTopUp: credits > 0 ? toISOTimestamp() : null,
			records: [],
		};
	}

	private persist(): void {
		try {
			mkdirSync(dirname(this.filePath), { recursive: true });
			writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
		} catch {
			// Silently fail persistence — in-memory state is still valid
		}
	}

	async getBalance(): Promise<AccountBalance> {
		return {
			balanceCents: this.data.balanceCents,
			lifetimeUsageCents: this.data.lifetimeUsageCents,
			lastTopUp: this.data.lastTopUp as ISOTimestamp | null,
		};
	}

	async debit(record: UsageRecord): Promise<boolean> {
		const cost = record.costCents as number;
		if (cost > this.data.balanceCents) return false;

		this.data.balanceCents -= cost;
		this.data.lifetimeUsageCents += cost;
		this.data.records.push(record);

		if (this.data.records.length > 10_000) {
			this.data.records = this.data.records.slice(-5_000);
		}

		this.persist();
		return true;
	}

	async credit(amountCents: number, _source: string): Promise<void> {
		this.data.balanceCents += amountCents;
		this.data.lastTopUp = toISOTimestamp();
		this.persist();
	}

	async getUsage(since: ISOTimestamp): Promise<readonly UsageRecord[]> {
		return this.data.records.filter((r) => r.timestamp >= since);
	}
}
