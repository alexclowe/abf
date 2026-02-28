/**
 * Billing types — usage tracking, account balance, and billing ledger.
 */

import type { AgentId, ISOTimestamp, SessionId, USDCents } from '../types/common.js';

export interface UsageRecord {
	readonly agentId: AgentId;
	readonly sessionId: SessionId;
	readonly provider: string;
	readonly model: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly costCents: USDCents;
	readonly timestamp: ISOTimestamp;
}

export interface AccountBalance {
	readonly balanceCents: number;
	readonly lifetimeUsageCents: number;
	readonly lastTopUp: ISOTimestamp | null;
}

export interface IBillingLedger {
	getBalance(): Promise<AccountBalance>;
	debit(record: UsageRecord): Promise<boolean>;
	credit(amountCents: number, source: string): Promise<void>;
	getUsage(since: ISOTimestamp): Promise<readonly UsageRecord[]>;
}
