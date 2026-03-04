/**
 * Approval Queue types — tools with requiresApproval queue here for human review.
 */

import type { AgentId, ISOTimestamp, SessionId, ToolId } from './common.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'answered';

export interface ApprovalRequest {
	readonly id: string;
	readonly agentId: AgentId;
	readonly sessionId: SessionId;
	readonly toolId: ToolId;
	readonly toolName: string;
	readonly arguments: Readonly<Record<string, unknown>>;
	readonly createdAt: ISOTimestamp;
	status: ApprovalStatus;
	resolvedAt?: ISOTimestamp;
	resolvedBy?: string;
	/** Distinguishes approval requests from human inquiries. Default: 'approval'. */
	readonly type?: 'approval' | 'inquiry' | undefined;
	/** The question asked (for inquiry type). */
	readonly question?: string | undefined;
	/** The human's answer (for inquiry type, set when answered). */
	answer?: string | undefined;
	/** Why this approval was created. 'unlisted_action' = tool not in allowedActions. */
	readonly escalationReason?: 'requires_approval' | 'unlisted_action' | undefined;
	/** Conversation ID for auto-resume after approval (chat sessions). */
	readonly conversationId?: string | undefined;
	/** Original task description for context when auto-resuming. */
	readonly originalTask?: string | undefined;
}

export interface IApprovalStore {
	/** Queue a new approval request. Returns the request ID. */
	create(request: Omit<ApprovalRequest, 'id' | 'status' | 'resolvedAt' | 'resolvedBy'>): string;

	/** Get a single approval request by ID. */
	get(id: string): ApprovalRequest | undefined;

	/** List approval requests, optionally filtered. */
	list(filter?: {
		status?: ApprovalStatus;
		agentId?: AgentId;
	}): readonly ApprovalRequest[];

	/** Approve a pending request. */
	approve(id: string, resolvedBy?: string): boolean;

	/** Reject a pending request. */
	reject(id: string, resolvedBy?: string): boolean;

	/** Answer an inquiry with a free-form response. */
	answer(id: string, answerText: string, resolvedBy?: string): boolean;
}
