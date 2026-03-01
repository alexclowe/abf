/**
 * backend-provision -- Provision and manage Supabase backends via the Management API.
 * Supports create-project, get-project, list-projects, run-migration,
 * configure-auth, and get-api-keys actions.
 * Write actions require approval if an approval store is configured.
 */
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { AgentId, SessionId, ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import { toISOTimestamp } from '../../util/id.js';
import type { BuiltinToolContext } from './context.js';
import { credentialError } from './credential-error.js';
import { cloudProxyCall, getCloudToken } from './cloud-proxy-call.js';

// Rate limit: max 20 API calls per agent per runtime session
const sessionApiCounts = new Map<string, number>();
const MAX_API_CALLS_PER_SESSION = 20;

const SUPABASE_API_BASE = 'https://api.supabase.com/v1';

const WRITE_ACTIONS = ['create-project', 'run-migration', 'configure-auth'];
const ALL_ACTIONS = [...WRITE_ACTIONS, 'get-project', 'list-projects', 'get-api-keys'];

export function createBackendProvisionTool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'backend-provision' as ToolId,
		name: 'backend-provision',
		description:
			'Provision and manage Supabase backends. Supports create-project, get-project, ' +
			'list-projects, run-migration (SQL), configure-auth, and get-api-keys actions.',
		source: 'registry',
		parameters: [
			{ name: 'action', type: 'string', description: 'Action to perform: create-project, get-project, list-projects, run-migration, configure-auth, get-api-keys', required: true },
			{ name: 'project_name', type: 'string', description: 'Project name (for create-project)', required: false },
			{ name: 'organization_id', type: 'string', description: 'Supabase organization ID (for create-project)', required: false },
			{ name: 'region', type: 'string', description: "Cloud region, default us-east-1 (for create-project)", required: false },
			{ name: 'db_password', type: 'string', description: 'Database password (for create-project)', required: false },
			{ name: 'project_ref', type: 'string', description: 'Supabase project ref (for per-project actions)', required: false },
			{ name: 'sql', type: 'string', description: 'SQL migration text (for run-migration)', required: false },
			{ name: 'auth_config', type: 'object', description: 'Auth configuration object (for configure-auth)', required: false },
		],
		estimatedCost: 0 as USDCents,
		timeout: 60_000,
	};

	return {
		definition,
		async execute(args) {
			const action = args['action'];
			if (typeof action !== 'string' || !ALL_ACTIONS.includes(action)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`backend-provision: action must be one of: ${ALL_ACTIONS.join(', ')}`,
						{},
					),
				);
			}

			// Rate limit check
			const agentId = typeof args['_agentId'] === 'string' ? args['_agentId'] : 'unknown';
			const count = sessionApiCounts.get(agentId) ?? 0;
			if (count >= MAX_API_CALLS_PER_SESSION) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`backend-provision: rate limit reached (max ${String(MAX_API_CALLS_PER_SESSION)} API calls per session)`,
						{},
					),
				);
			}
			sessionApiCounts.set(agentId, count + 1);

			// Queue write actions for approval if approval store is configured
			if (WRITE_ACTIONS.includes(action) && ctx.approvalStore) {
				const approvalId = ctx.approvalStore.create({
					agentId: (args['_agentId'] as AgentId) ?? ('unknown' as AgentId),
					sessionId: (args['_sessionId'] as SessionId) ?? ('unknown' as SessionId),
					toolId: 'backend-provision' as ToolId,
					toolName: 'backend-provision',
					arguments: {
						action,
						project_name: args['project_name'],
						project_ref: args['project_ref'],
						organization_id: args['organization_id'],
						region: args['region'],
					},
					createdAt: toISOTimestamp(),
				});
				return Ok({
					queued: true,
					approvalId,
					action,
					message: `${action} queued for approval`,
				});
			}

			// Cloud proxy: forward to ABF Cloud if running in cloud mode
			if (ctx.isCloud && ctx.cloudEndpoint) {
				const cloudToken = await getCloudToken(ctx);
				if (cloudToken) {
					return cloudProxyCall(ctx.cloudEndpoint, 'backend-provision', { action, ...args }, cloudToken);
				}
			}

			// Get Supabase access token: env var first, then vault
			let token = process.env['SUPABASE_ACCESS_TOKEN'];
			if (!token) {
				const vaultToken = await ctx.vault.get('supabase', 'api_key');
				if (vaultToken) token = vaultToken;
			}
			if (!token) {
				return Ok(credentialError(ctx.isCloud, {
					provider: 'supabase',
					envVar: 'SUPABASE_ACCESS_TOKEN',
					dashboardPath: '/settings/integrations/supabase',
					displayName: 'Supabase',
				}));
			}

			switch (action) {
				case 'create-project':
					return createProject(token, args);
				case 'get-project':
					return getProject(token, args);
				case 'list-projects':
					return listProjects(token);
				case 'run-migration':
					return runMigration(token, args);
				case 'configure-auth':
					return configureAuth(token, args);
				case 'get-api-keys':
					return getApiKeys(token, args);
				default:
					return Err(
						new ToolError('TOOL_EXECUTION_FAILED', `backend-provision: unknown action '${action}'`, {}),
					);
			}
		},
	};
}

async function createProject(
	token: string,
	args: Readonly<Record<string, unknown>>,
) {
	const projectName = args['project_name'] as string;
	const organizationId = args['organization_id'] as string;
	const region = (args['region'] as string) || 'us-east-1';
	const dbPassword = args['db_password'] as string;

	if (!projectName || !organizationId || !dbPassword) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'backend-provision: create-project requires project_name, organization_id, and db_password',
				{},
			),
		);
	}

	try {
		const res = await fetch(`${SUPABASE_API_BASE}/projects`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				name: projectName,
				organization_id: organizationId,
				region,
				db_pass: dbPassword,
			}),
		});

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `backend-provision: Supabase API error ${String(res.status)}: ${body}`, {}),
			);
		}

		const data = await res.json() as Record<string, unknown>;
		return Ok({
			created: true,
			project_ref: data['id'],
			name: data['name'],
			region: data['region'],
			status: data['status'],
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`backend-provision: create-project failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function getProject(
	token: string,
	args: Readonly<Record<string, unknown>>,
) {
	const projectRef = args['project_ref'] as string;

	if (!projectRef) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'backend-provision: get-project requires project_ref', {}),
		);
	}

	try {
		const res = await fetch(`${SUPABASE_API_BASE}/projects/${encodeURIComponent(projectRef)}`, {
			headers: {
				'Authorization': `Bearer ${token}`,
			},
		});

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `backend-provision: Supabase API error ${String(res.status)}: ${body}`, {}),
			);
		}

		const data = await res.json() as Record<string, unknown>;
		return Ok({
			project_ref: data['id'],
			name: data['name'],
			region: data['region'],
			status: data['status'],
			created_at: data['created_at'],
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`backend-provision: get-project failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function listProjects(token: string) {
	try {
		const res = await fetch(`${SUPABASE_API_BASE}/projects`, {
			headers: {
				'Authorization': `Bearer ${token}`,
			},
		});

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `backend-provision: Supabase API error ${String(res.status)}: ${body}`, {}),
			);
		}

		const data = await res.json() as Array<Record<string, unknown>>;
		return Ok({
			projects: data.map(p => ({
				project_ref: p['id'],
				name: p['name'],
				region: p['region'],
				status: p['status'],
			})),
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`backend-provision: list-projects failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function runMigration(
	token: string,
	args: Readonly<Record<string, unknown>>,
) {
	const projectRef = args['project_ref'] as string;
	const sql = args['sql'] as string;

	if (!projectRef || !sql) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'backend-provision: run-migration requires project_ref and sql',
				{},
			),
		);
	}

	try {
		const res = await fetch(
			`${SUPABASE_API_BASE}/projects/${encodeURIComponent(projectRef)}/database/query`,
			{
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ query: sql }),
			},
		);

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `backend-provision: Supabase API error ${String(res.status)}: ${body}`, {}),
			);
		}

		const data = await res.json() as unknown;
		return Ok({
			executed: true,
			project_ref: projectRef,
			result: data,
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`backend-provision: run-migration failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function configureAuth(
	token: string,
	args: Readonly<Record<string, unknown>>,
) {
	const projectRef = args['project_ref'] as string;
	const authConfig = args['auth_config'] as Record<string, unknown>;

	if (!projectRef || !authConfig) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'backend-provision: configure-auth requires project_ref and auth_config',
				{},
			),
		);
	}

	try {
		const res = await fetch(
			`${SUPABASE_API_BASE}/projects/${encodeURIComponent(projectRef)}/config/auth`,
			{
				method: 'PATCH',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(authConfig),
			},
		);

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `backend-provision: Supabase API error ${String(res.status)}: ${body}`, {}),
			);
		}

		const data = await res.json() as Record<string, unknown>;
		return Ok({
			configured: true,
			project_ref: projectRef,
			auth: data,
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`backend-provision: configure-auth failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function getApiKeys(
	token: string,
	args: Readonly<Record<string, unknown>>,
) {
	const projectRef = args['project_ref'] as string;

	if (!projectRef) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'backend-provision: get-api-keys requires project_ref', {}),
		);
	}

	try {
		const res = await fetch(
			`${SUPABASE_API_BASE}/projects/${encodeURIComponent(projectRef)}/api-keys`,
			{
				headers: {
					'Authorization': `Bearer ${token}`,
				},
			},
		);

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `backend-provision: Supabase API error ${String(res.status)}: ${body}`, {}),
			);
		}

		const data = await res.json() as Array<Record<string, unknown>>;
		return Ok({
			project_ref: projectRef,
			keys: data.map(k => ({
				name: k['name'],
				api_key: k['api_key'],
			})),
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`backend-provision: get-api-keys failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}
