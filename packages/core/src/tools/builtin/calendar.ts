/**
 * calendar -- CRUD operations on a calendar_events table in the business datastore.
 * Returns null if no datastore is configured.
 */
import { nanoid } from 'nanoid';
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';

let tableCreated = false;

async function ensureTable(ctx: BuiltinToolContext): Promise<void> {
	if (tableCreated) return;
	await ctx.datastore!.migrate(
		`CREATE TABLE IF NOT EXISTS calendar_events (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			description TEXT,
			event_time TEXT,
			created_at TEXT DEFAULT (datetime('now')),
			updated_at TEXT DEFAULT (datetime('now'))
		)`,
	);
	tableCreated = true;
}

export function createCalendarTool(ctx: BuiltinToolContext): ITool | null {
	if (!ctx.datastore) return null;

	const definition: ToolDefinition = {
		id: 'calendar' as ToolId,
		name: 'calendar',
		description:
			'Manage calendar events in the business database. ' +
			'Supports list, create, update, and delete actions.',
		source: 'registry',
		parameters: [
			{
				name: 'action',
				type: 'string',
				description: "Action to perform: 'list', 'create', 'update', or 'delete'",
				required: true,
			},
			{
				name: 'id',
				type: 'string',
				description: 'Event ID (required for update and delete)',
				required: false,
			},
			{
				name: 'title',
				type: 'string',
				description: 'Event title (required for create)',
				required: false,
			},
			{
				name: 'description',
				type: 'string',
				description: 'Event description',
				required: false,
			},
			{
				name: 'time',
				type: 'string',
				description: 'ISO datetime for the event',
				required: false,
			},
			{
				name: 'start_date',
				type: 'string',
				description: 'ISO date to filter events from (for list)',
				required: false,
			},
			{
				name: 'end_date',
				type: 'string',
				description: 'ISO date to filter events until (for list)',
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
			if (typeof action !== 'string' || !['list', 'create', 'update', 'delete'].includes(action)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						"calendar: action must be 'list', 'create', 'update', or 'delete'",
						{},
					),
				);
			}

			await ensureTable(ctx);

			switch (action) {
				case 'list':
					return listEvents(ctx, args);
				case 'create':
					return createEvent(ctx, args);
				case 'update':
					return updateEvent(ctx, args);
				case 'delete':
					return deleteEvent(ctx, args);
				default:
					return Err(
						new ToolError('TOOL_EXECUTION_FAILED', `calendar: unknown action '${action}'`, {}),
					);
			}
		},
	};
}

async function listEvents(ctx: BuiltinToolContext, args: Readonly<Record<string, unknown>>) {
	const startDate = typeof args['start_date'] === 'string' ? args['start_date'] : null;
	const endDate = typeof args['end_date'] === 'string' ? args['end_date'] : null;

	let sql = 'SELECT * FROM calendar_events';
	const params: unknown[] = [];
	const conditions: string[] = [];

	if (startDate) {
		conditions.push('event_time >= ?');
		params.push(startDate);
	}
	if (endDate) {
		conditions.push('event_time <= ?');
		params.push(endDate);
	}
	if (conditions.length > 0) {
		sql += ` WHERE ${conditions.join(' AND ')}`;
	}
	sql += ' ORDER BY event_time ASC';

	const result = await ctx.datastore!.query(sql, params);
	if (!result.ok) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', `calendar: query failed: ${result.error.message}`, {}),
		);
	}

	return Ok({ events: result.value.rows, count: result.value.rowCount });
}

async function createEvent(ctx: BuiltinToolContext, args: Readonly<Record<string, unknown>>) {
	const title = args['title'];
	if (typeof title !== 'string' || !title.trim()) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'calendar: title is required for create', {}),
		);
	}

	const id = `evt_${nanoid(12)}`;
	const description = typeof args['description'] === 'string' ? args['description'] : null;
	const time = typeof args['time'] === 'string' ? args['time'] : null;

	const result = await ctx.datastore!.write(
		'INSERT INTO calendar_events (id, title, description, event_time) VALUES (?, ?, ?, ?)',
		[id, title, description, time],
	);
	if (!result.ok) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', `calendar: insert failed: ${result.error.message}`, {}),
		);
	}

	return Ok({ id, title, description, event_time: time, created: true });
}

async function updateEvent(ctx: BuiltinToolContext, args: Readonly<Record<string, unknown>>) {
	const id = args['id'];
	if (typeof id !== 'string' || !id.trim()) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'calendar: id is required for update', {}),
		);
	}

	const sets: string[] = [];
	const params: unknown[] = [];

	if (typeof args['title'] === 'string') {
		sets.push('title = ?');
		params.push(args['title']);
	}
	if (typeof args['description'] === 'string') {
		sets.push('description = ?');
		params.push(args['description']);
	}
	if (typeof args['time'] === 'string') {
		sets.push('event_time = ?');
		params.push(args['time']);
	}

	if (sets.length === 0) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'calendar: at least one field (title, description, time) is required for update',
				{},
			),
		);
	}

	sets.push("updated_at = datetime('now')");
	params.push(id);

	const result = await ctx.datastore!.write(
		`UPDATE calendar_events SET ${sets.join(', ')} WHERE id = ?`,
		params,
	);
	if (!result.ok) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', `calendar: update failed: ${result.error.message}`, {}),
		);
	}

	return Ok({ id, rowsAffected: result.value.rowsAffected, updated: true });
}

async function deleteEvent(ctx: BuiltinToolContext, args: Readonly<Record<string, unknown>>) {
	const id = args['id'];
	if (typeof id !== 'string' || !id.trim()) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'calendar: id is required for delete', {}),
		);
	}

	const result = await ctx.datastore!.write('DELETE FROM calendar_events WHERE id = ?', [id]);
	if (!result.ok) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', `calendar: delete failed: ${result.error.message}`, {}),
		);
	}

	return Ok({ id, rowsAffected: result.value.rowsAffected, deleted: true });
}
