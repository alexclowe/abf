/**
 * Google Workspace tools — available when Google OAuth tokens are present.
 * Provides: google-drive-search, google-drive-read, google-sheets-read, google-sheets-write.
 */

import type { ToolId } from '../../types/common.js';
import type { ABFError, Result } from '../../types/errors.js';
import { Ok, ABFError as ABFErrorClass } from '../../types/errors.js';
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ICredentialVault } from '../../credentials/vault.js';

const GOOGLE_API = 'https://www.googleapis.com';

async function getGoogleToken(vault: ICredentialVault): Promise<string | null> {
	const raw = await vault.get('google', 'oauth_token');
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as { accessToken?: string };
		return parsed.accessToken ?? null;
	} catch {
		return null;
	}
}

async function googleFetch(url: string, token: string, init?: RequestInit): Promise<unknown> {
	const res = await fetch(url, {
		...init,
		headers: {
			...(init?.headers as Record<string, string> ?? {}),
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
	});
	if (!res.ok) {
		throw new Error(`Google API error: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

// ─── Google Drive Search ──────────────────────────────────────────

function createGoogleDriveSearchTool(vault: ICredentialVault): ITool {
	const definition: ToolDefinition = {
		id: 'google-drive-search' as ToolId,
		name: 'google-drive-search',
		description: 'Search files and folders in Google Drive.',
		source: 'registry',
		parameters: [
			{ name: 'query', type: 'string', description: 'Search query (Google Drive search syntax)', required: true },
			{ name: 'maxResults', type: 'number', description: 'Maximum number of results (default 10)', required: false },
		],
	};

	return {
		definition,
		async execute(args: Readonly<Record<string, unknown>>): Promise<Result<unknown, ABFError>> {
			const token = await getGoogleToken(vault);
			if (!token) return { ok: false, error: new ABFErrorClass('PROVIDER_AUTH_FAILED', 'Google not connected. Use OAuth to connect Google Workspace.') };

			const query = args['query'] as string;
			const maxResults = (args['maxResults'] as number) ?? 10;
			const params = new URLSearchParams({
				q: query,
				pageSize: String(maxResults),
				fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
			});

			const data = await googleFetch(`${GOOGLE_API}/drive/v3/files?${params}`, token);
			return Ok(data);
		},
	};
}

// ─── Google Drive Read ──────────────────────────────────────────

function createGoogleDriveReadTool(vault: ICredentialVault): ITool {
	const definition: ToolDefinition = {
		id: 'google-drive-read' as ToolId,
		name: 'google-drive-read',
		description: 'Read the text content of a Google Drive document.',
		source: 'registry',
		parameters: [
			{ name: 'fileId', type: 'string', description: 'Google Drive file ID', required: true },
		],
	};

	return {
		definition,
		async execute(args: Readonly<Record<string, unknown>>): Promise<Result<unknown, ABFError>> {
			const token = await getGoogleToken(vault);
			if (!token) return { ok: false, error: new ABFErrorClass('PROVIDER_AUTH_FAILED', 'Google not connected.') };

			const fileId = args['fileId'] as string;
			const data = await googleFetch(
				`${GOOGLE_API}/drive/v3/files/${fileId}/export?mimeType=text/plain`,
				token,
			);
			return Ok(data);
		},
	};
}

// ─── Google Sheets Read ──────────────────────────────────────────

function createGoogleSheetsReadTool(vault: ICredentialVault): ITool {
	const definition: ToolDefinition = {
		id: 'google-sheets-read' as ToolId,
		name: 'google-sheets-read',
		description: 'Read data from a Google Spreadsheet. Returns JSON array of rows.',
		source: 'registry',
		parameters: [
			{ name: 'spreadsheetId', type: 'string', description: 'Google Spreadsheet ID', required: true },
			{ name: 'range', type: 'string', description: 'A1 notation range (e.g. "Sheet1!A1:D10")', required: true },
		],
	};

	return {
		definition,
		async execute(args: Readonly<Record<string, unknown>>): Promise<Result<unknown, ABFError>> {
			const token = await getGoogleToken(vault);
			if (!token) return { ok: false, error: new ABFErrorClass('PROVIDER_AUTH_FAILED', 'Google not connected.') };

			const spreadsheetId = args['spreadsheetId'] as string;
			const range = encodeURIComponent(args['range'] as string);
			const data = await googleFetch(
				`${GOOGLE_API}/v4/spreadsheets/${spreadsheetId}/values/${range}`,
				token,
			);
			return Ok(data);
		},
	};
}

// ─── Google Sheets Write ──────────────────────────────────────────

function createGoogleSheetsWriteTool(vault: ICredentialVault): ITool {
	const definition: ToolDefinition = {
		id: 'google-sheets-write' as ToolId,
		name: 'google-sheets-write',
		description: 'Append or update rows in a Google Spreadsheet.',
		source: 'registry',
		parameters: [
			{ name: 'spreadsheetId', type: 'string', description: 'Google Spreadsheet ID', required: true },
			{ name: 'range', type: 'string', description: 'A1 notation range', required: true },
			{ name: 'values', type: 'object', description: 'Array of arrays (rows of values)', required: true },
			{ name: 'mode', type: 'string', description: '"append" or "update" (default: append)', required: false },
		],
	};

	return {
		definition,
		async execute(args: Readonly<Record<string, unknown>>): Promise<Result<unknown, ABFError>> {
			const token = await getGoogleToken(vault);
			if (!token) return { ok: false, error: new ABFErrorClass('PROVIDER_AUTH_FAILED', 'Google not connected.') };

			const spreadsheetId = args['spreadsheetId'] as string;
			const range = encodeURIComponent(args['range'] as string);
			const values = args['values'];
			const mode = (args['mode'] as string) ?? 'append';

			const url = mode === 'update'
				? `${GOOGLE_API}/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`
				: `${GOOGLE_API}/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;

			const data = await googleFetch(url, token, {
				method: mode === 'update' ? 'PUT' : 'POST',
				body: JSON.stringify({ values }),
			});
			return Ok(data);
		},
	};
}

// ─── Factory ──────────────────────────────────────────────────────

/**
 * Create Google Workspace tools if Google OAuth tokens are available.
 * Returns empty array if Google is not connected.
 */
export async function createGoogleWorkspaceTools(vault: ICredentialVault): Promise<readonly ITool[]> {
	const token = await getGoogleToken(vault);
	if (!token) return [];

	return [
		createGoogleDriveSearchTool(vault),
		createGoogleDriveReadTool(vault),
		createGoogleSheetsReadTool(vault),
		createGoogleSheetsWriteTool(vault),
	];
}
