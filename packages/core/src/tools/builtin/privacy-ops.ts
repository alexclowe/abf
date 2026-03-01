/**
 * privacy-ops -- manage privacy consents and data deletion requests
 * using the business datastore. Returns null if no datastore is configured.
 */
import { nanoid } from 'nanoid';
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { AgentId, SessionId, ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import { toISOTimestamp } from '../../util/id.js';
import type { BuiltinToolContext } from './context.js';
import { cloudProxyCall, getCloudToken } from './cloud-proxy-call.js';

let tableCreated = false;

async function ensureTable(ctx: BuiltinToolContext): Promise<void> {
	if (tableCreated) return;
	await ctx.datastore!.migrate(
		`CREATE TABLE IF NOT EXISTS privacy_consents (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			consent_type TEXT NOT NULL,
			granted INTEGER NOT NULL,
			source TEXT,
			recorded_at TEXT DEFAULT (datetime('now')),
			updated_at TEXT DEFAULT (datetime('now'))
		)`,
	);
	await ctx.datastore!.migrate(
		`CREATE TABLE IF NOT EXISTS privacy_deletion_requests (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			reason TEXT,
			status TEXT DEFAULT 'pending',
			requested_at TEXT DEFAULT (datetime('now')),
			processed_at TEXT,
			processed_by TEXT
		)`,
	);
	tableCreated = true;
}

const VALID_ACTIONS = [
	'record-consent',
	'check-consent',
	'request-deletion',
	'list-deletions',
	'process-deletion',
	'check-retention',
] as const;

export function createPrivacyOpsTool(ctx: BuiltinToolContext): ITool | null {
	if (!ctx.datastore) return null;

	const definition: ToolDefinition = {
		id: 'privacy-ops' as ToolId,
		name: 'privacy-ops',
		description:
			'Manage privacy consents and data deletion requests. ' +
			'Supports record-consent, check-consent, request-deletion, list-deletions, process-deletion, and check-retention actions.',
		source: 'registry',
		parameters: [
			{
				name: 'action',
				type: 'string',
				description:
					"Action to perform: 'record-consent', 'check-consent', 'request-deletion', 'list-deletions', 'process-deletion', or 'check-retention'",
				required: true,
			},
			{
				name: 'user_id',
				type: 'string',
				description: 'User identifier',
				required: false,
			},
			{
				name: 'consent_type',
				type: 'string',
				description: "Type of consent (e.g., 'marketing', 'analytics', 'data-processing')",
				required: false,
			},
			{
				name: 'granted',
				type: 'boolean',
				description: 'Whether consent is granted',
				required: false,
			},
			{
				name: 'source',
				type: 'string',
				description: "Where consent was collected (e.g., 'signup-form', 'settings-page')",
				required: false,
			},
			{
				name: 'deletion_id',
				type: 'string',
				description: 'Deletion request ID (for process-deletion)',
				required: false,
			},
			{
				name: 'reason',
				type: 'string',
				description: 'Reason for deletion request',
				required: false,
			},
			{
				name: 'retention_days',
				type: 'number',
				description: 'Number of days to check retention against',
				required: false,
			},
			{
				name: 'status',
				type: 'string',
				description: 'Filter deletions by status',
				required: false,
			},
		],
		estimatedCost: 0 as USDCents,
		timeout: 10_000,
	};

	return {
		definition,
		async execute(args) {
			const action = args['action'];
			if (typeof action !== 'string' || !(VALID_ACTIONS as readonly string[]).includes(action)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`privacy-ops: action must be one of: ${VALID_ACTIONS.join(', ')}`,
						{},
					),
				);
			}

			// Cloud proxy: forward to ABF Cloud if running in cloud mode
			if (ctx.isCloud && ctx.cloudEndpoint) {
				const cloudToken = await getCloudToken(ctx);
				if (cloudToken) {
					return cloudProxyCall(ctx.cloudEndpoint, 'privacy-ops', { action, ...args }, cloudToken);
				}
			}

			await ensureTable(ctx);

			switch (action) {
				case 'record-consent':
					return recordConsent(ctx, args);
				case 'check-consent':
					return checkConsent(ctx, args);
				case 'request-deletion':
					return requestDeletion(ctx, args);
				case 'list-deletions':
					return listDeletions(ctx, args);
				case 'process-deletion':
					return processDeletion(ctx, args);
				case 'check-retention':
					return checkRetention(ctx, args);
				default:
					return Err(
						new ToolError('TOOL_EXECUTION_FAILED', `privacy-ops: unknown action '${action}'`, {}),
					);
			}
		},
	};
}

async function recordConsent(ctx: BuiltinToolContext, args: Readonly<Record<string, unknown>>) {
	const userId = args['user_id'];
	if (typeof userId !== 'string' || !userId.trim()) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'privacy-ops: user_id is required for record-consent', {}),
		);
	}
	const consentType = args['consent_type'];
	if (typeof consentType !== 'string' || !consentType.trim()) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'privacy-ops: consent_type is required for record-consent', {}),
		);
	}
	const granted = args['granted'];
	if (typeof granted !== 'boolean') {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'privacy-ops: granted (boolean) is required for record-consent', {}),
		);
	}

	const id = `consent_${nanoid(12)}`;
	const source = typeof args['source'] === 'string' ? args['source'] : null;

	const result = await ctx.datastore!.write(
		`INSERT OR REPLACE INTO privacy_consents (id, user_id, consent_type, granted, source) VALUES (?, ?, ?, ?, ?)`,
		[id, userId, consentType, granted ? 1 : 0, source],
	);
	if (!result.ok) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', `privacy-ops: insert failed: ${result.error.message}`, {}),
		);
	}

	return Ok({ id, user_id: userId, consent_type: consentType, granted, source, recorded: true });
}

async function checkConsent(ctx: BuiltinToolContext, args: Readonly<Record<string, unknown>>) {
	const userId = args['user_id'];
	if (typeof userId !== 'string' || !userId.trim()) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'privacy-ops: user_id is required for check-consent', {}),
		);
	}
	const consentType = args['consent_type'];
	if (typeof consentType !== 'string' || !consentType.trim()) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'privacy-ops: consent_type is required for check-consent', {}),
		);
	}

	const result = await ctx.datastore!.query(
		'SELECT * FROM privacy_consents WHERE user_id = ? AND consent_type = ?',
		[userId, consentType],
	);
	if (!result.ok) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', `privacy-ops: query failed: ${result.error.message}`, {}),
		);
	}

	if (result.value.rowCount === 0) {
		return Ok({ found: false, user_id: userId, consent_type: consentType });
	}

	return Ok(result.value.rows[0]);
}

async function requestDeletion(ctx: BuiltinToolContext, args: Readonly<Record<string, unknown>>) {
	const userId = args['user_id'];
	if (typeof userId !== 'string' || !userId.trim()) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'privacy-ops: user_id is required for request-deletion', {}),
		);
	}

	const id = `del_${nanoid(12)}`;
	const reason = typeof args['reason'] === 'string' ? args['reason'] : null;

	const result = await ctx.datastore!.write(
		'INSERT INTO privacy_deletion_requests (id, user_id, reason) VALUES (?, ?, ?)',
		[id, userId, reason],
	);
	if (!result.ok) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', `privacy-ops: insert failed: ${result.error.message}`, {}),
		);
	}

	return Ok({ id, user_id: userId, reason, status: 'pending', requested: true });
}

async function listDeletions(ctx: BuiltinToolContext, args: Readonly<Record<string, unknown>>) {
	const status = typeof args['status'] === 'string' ? args['status'] : null;

	let sql = 'SELECT * FROM privacy_deletion_requests';
	const params: unknown[] = [];

	if (status) {
		sql += ' WHERE status = ?';
		params.push(status);
	}
	sql += ' ORDER BY requested_at DESC';

	const result = await ctx.datastore!.query(sql, params);
	if (!result.ok) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', `privacy-ops: query failed: ${result.error.message}`, {}),
		);
	}

	return Ok({ requests: result.value.rows, count: result.value.rowCount });
}

async function processDeletion(ctx: BuiltinToolContext, args: Readonly<Record<string, unknown>>) {
	const deletionId = args['deletion_id'];
	if (typeof deletionId !== 'string' || !deletionId.trim()) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'privacy-ops: deletion_id is required for process-deletion', {}),
		);
	}

	// process-deletion requires approval
	if (ctx.approvalStore) {
		const approvalId = ctx.approvalStore.create({
			agentId: (args['_agentId'] as AgentId) ?? ('unknown' as AgentId),
			sessionId: (args['_sessionId'] as SessionId) ?? ('unknown' as SessionId),
			toolId: 'privacy-ops' as ToolId,
			toolName: 'privacy-ops',
			arguments: { action: 'process-deletion', deletion_id: deletionId },
			createdAt: toISOTimestamp(),
		});
		return Ok({
			processed: false,
			queued: true,
			approvalId,
			message: 'Deletion request queued for approval. An operator must approve before processing.',
		});
	}

	const result = await ctx.datastore!.write(
		`UPDATE privacy_deletion_requests SET status = 'processed', processed_at = datetime('now'), processed_by = 'agent' WHERE id = ?`,
		[deletionId],
	);
	if (!result.ok) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', `privacy-ops: update failed: ${result.error.message}`, {}),
		);
	}

	return Ok({ deletion_id: deletionId, rowsAffected: result.value.rowsAffected, processed: true });
}

async function checkRetention(ctx: BuiltinToolContext, args: Readonly<Record<string, unknown>>) {
	const userId = args['user_id'];
	if (typeof userId !== 'string' || !userId.trim()) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'privacy-ops: user_id is required for check-retention', {}),
		);
	}
	const retentionDays = args['retention_days'];
	if (typeof retentionDays !== 'number' || retentionDays <= 0) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'privacy-ops: retention_days (positive number) is required for check-retention', {}),
		);
	}

	const result = await ctx.datastore!.query(
		'SELECT * FROM privacy_consents WHERE user_id = ? ORDER BY recorded_at ASC LIMIT 1',
		[userId],
	);
	if (!result.ok) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', `privacy-ops: query failed: ${result.error.message}`, {}),
		);
	}

	if (result.value.rowCount === 0) {
		return Ok({ user_id: userId, expired: false, message: 'No consent records found for this user.' });
	}

	const oldestRecord = result.value.rows[0] as Record<string, unknown>;
	const recordedAt = oldestRecord['recorded_at'] as string;
	const recordDate = new Date(recordedAt);
	const now = new Date();
	const daysSinceOldest = Math.floor((now.getTime() - recordDate.getTime()) / (1000 * 60 * 60 * 24));
	const expired = daysSinceOldest > retentionDays;

	return Ok({
		user_id: userId,
		expired,
		oldestRecord: recordedAt,
		daysSinceOldest,
		retentionDays,
	});
}
