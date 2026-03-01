/**
 * app-deploy -- Deploy web applications to Vercel using the REST API.
 * Supports create-project, deploy, set-env, add-domain, and get-deployment actions.
 * Uses inline file deployment (no git required).
 * All write actions require approval if an approval store is configured.
 */
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { AgentId, SessionId, ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import { toISOTimestamp } from '../../util/id.js';
import type { BuiltinToolContext } from './context.js';
import { credentialError } from './credential-error.js';
import { cloudProxyCall, getCloudToken } from './cloud-proxy-call.js';

// Rate limit: max 5 API calls per agent per runtime session (deploys are expensive)
const sessionApiCounts = new Map<string, number>();
const MAX_API_CALLS_PER_SESSION = 5;

const VERCEL_API_BASE = 'https://api.vercel.com';

const WRITE_ACTIONS = ['create-project', 'deploy', 'set-env', 'add-domain'];
const ALL_ACTIONS = [...WRITE_ACTIONS, 'get-deployment'];

export function createAppDeployTool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'app-deploy' as ToolId,
		name: 'app-deploy',
		description:
			'Deploy web applications to Vercel. Supports create-project, deploy (inline files), ' +
			'set-env (environment variables), add-domain, and get-deployment actions.',
		source: 'registry',
		parameters: [
			{ name: 'action', type: 'string', description: 'Action to perform: create-project, deploy, set-env, add-domain, get-deployment', required: true },
			{ name: 'project_name', type: 'string', description: 'Project name (for create-project)', required: false },
			{ name: 'project_id', type: 'string', description: 'Vercel project ID (for deploy, set-env, add-domain)', required: false },
			{ name: 'files', type: 'object', description: 'Array of { file: "path", data: "content" } objects (for deploy)', required: false },
			{ name: 'framework', type: 'string', description: 'Framework preset: nextjs, vite, etc. (for create-project, deploy)', required: false },
			{ name: 'env_key', type: 'string', description: 'Environment variable name (for set-env)', required: false },
			{ name: 'env_value', type: 'string', description: 'Environment variable value (for set-env)', required: false },
			{ name: 'env_target', type: 'object', description: 'Target environments: ["production", "preview", "development"] (for set-env)', required: false },
			{ name: 'domain', type: 'string', description: 'Custom domain (for add-domain)', required: false },
			{ name: 'deployment_id', type: 'string', description: 'Deployment ID (for get-deployment)', required: false },
			{ name: 'team_id', type: 'string', description: 'Optional Vercel team ID', required: false },
		],
		estimatedCost: 0 as USDCents,
		timeout: 120_000,
	};

	return {
		definition,
		async execute(args) {
			const action = args['action'];
			if (typeof action !== 'string' || !ALL_ACTIONS.includes(action)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`app-deploy: action must be one of: ${ALL_ACTIONS.join(', ')}`,
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
						`app-deploy: rate limit reached (max ${String(MAX_API_CALLS_PER_SESSION)} API calls per session)`,
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
					toolId: 'app-deploy' as ToolId,
					toolName: 'app-deploy',
					arguments: {
						action,
						project_name: args['project_name'],
						project_id: args['project_id'],
						framework: args['framework'],
						domain: args['domain'],
						env_key: args['env_key'],
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
					return cloudProxyCall(ctx.cloudEndpoint, 'app-deploy', { action, ...args }, cloudToken);
				}
			}

			// Get Vercel token: env var first, then vault
			let token = process.env['VERCEL_TOKEN'];
			if (!token) {
				const vaultToken = await ctx.vault.get('vercel', 'api_key');
				if (vaultToken) token = vaultToken;
			}
			if (!token) {
				return Ok(credentialError(ctx.isCloud, {
					provider: 'vercel',
					envVar: 'VERCEL_TOKEN',
					dashboardPath: '/settings/integrations/vercel',
					displayName: 'Vercel',
				}));
			}

			const teamId = args['team_id'] as string | undefined;
			const teamQuery = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';

			switch (action) {
				case 'create-project':
					return createProject(token, teamQuery, args);
				case 'deploy':
					return deploy(token, teamQuery, args);
				case 'set-env':
					return setEnv(token, teamQuery, args);
				case 'add-domain':
					return addDomain(token, teamQuery, args);
				case 'get-deployment':
					return getDeployment(token, teamQuery, args);
				default:
					return Err(
						new ToolError('TOOL_EXECUTION_FAILED', `app-deploy: unknown action '${action}'`, {}),
					);
			}
		},
	};
}

async function createProject(
	token: string,
	teamQuery: string,
	args: Readonly<Record<string, unknown>>,
) {
	const projectName = args['project_name'] as string;
	const framework = args['framework'] as string | undefined;

	if (!projectName) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'app-deploy: create-project requires project_name', {}),
		);
	}

	try {
		const res = await fetch(`${VERCEL_API_BASE}/v10/projects${teamQuery}`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				name: projectName,
				...(framework ? { framework } : {}),
			}),
		});

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `app-deploy: Vercel API error ${String(res.status)}: ${body}`, {}),
			);
		}

		const data = await res.json() as Record<string, unknown>;
		return Ok({
			created: true,
			project_id: data['id'],
			name: data['name'],
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`app-deploy: create-project failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function deploy(
	token: string,
	teamQuery: string,
	args: Readonly<Record<string, unknown>>,
) {
	const projectId = args['project_id'] as string;
	const files = args['files'] as Array<{ file: string; data: string }> | undefined;
	const framework = args['framework'] as string | undefined;

	if (!projectId || !files || !Array.isArray(files) || files.length === 0) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'app-deploy: deploy requires project_id and files (array of { file, data })',
				{},
			),
		);
	}

	try {
		const res = await fetch(`${VERCEL_API_BASE}/v13/deployments${teamQuery}`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				name: projectId,
				files: files.map(f => ({
					file: f.file,
					data: f.data,
				})),
				projectSettings: {
					...(framework ? { framework } : {}),
				},
			}),
		});

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `app-deploy: Vercel API error ${String(res.status)}: ${body}`, {}),
			);
		}

		const data = await res.json() as Record<string, unknown>;
		return Ok({
			deployed: true,
			deployment_id: data['id'],
			url: data['url'],
			readyState: data['readyState'],
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`app-deploy: deploy failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function setEnv(
	token: string,
	teamQuery: string,
	args: Readonly<Record<string, unknown>>,
) {
	const projectId = args['project_id'] as string;
	const envKey = args['env_key'] as string;
	const envValue = args['env_value'] as string;
	const envTarget = (args['env_target'] as string[]) || ['production', 'preview', 'development'];

	if (!projectId || !envKey || !envValue) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'app-deploy: set-env requires project_id, env_key, and env_value',
				{},
			),
		);
	}

	try {
		const res = await fetch(
			`${VERCEL_API_BASE}/v10/projects/${encodeURIComponent(projectId)}/env${teamQuery}`,
			{
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					key: envKey,
					value: envValue,
					target: envTarget,
					type: 'encrypted',
				}),
			},
		);

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `app-deploy: Vercel API error ${String(res.status)}: ${body}`, {}),
			);
		}

		const data = await res.json() as Record<string, unknown>;
		return Ok({
			created: true,
			key: envKey,
			target: envTarget,
			id: data['id'],
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`app-deploy: set-env failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function addDomain(
	token: string,
	teamQuery: string,
	args: Readonly<Record<string, unknown>>,
) {
	const projectId = args['project_id'] as string;
	const domain = args['domain'] as string;

	if (!projectId || !domain) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'app-deploy: add-domain requires project_id and domain', {}),
		);
	}

	try {
		const res = await fetch(
			`${VERCEL_API_BASE}/v10/projects/${encodeURIComponent(projectId)}/domains${teamQuery}`,
			{
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ name: domain }),
			},
		);

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `app-deploy: Vercel API error ${String(res.status)}: ${body}`, {}),
			);
		}

		const data = await res.json() as Record<string, unknown>;
		return Ok({
			added: true,
			domain: data['name'],
			verified: data['verified'],
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`app-deploy: add-domain failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function getDeployment(
	token: string,
	teamQuery: string,
	args: Readonly<Record<string, unknown>>,
) {
	const deploymentId = args['deployment_id'] as string;

	if (!deploymentId) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'app-deploy: get-deployment requires deployment_id', {}),
		);
	}

	try {
		const res = await fetch(
			`${VERCEL_API_BASE}/v13/deployments/${encodeURIComponent(deploymentId)}${teamQuery}`,
			{
				headers: {
					'Authorization': `Bearer ${token}`,
				},
			},
		);

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError('TOOL_EXECUTION_FAILED', `app-deploy: Vercel API error ${String(res.status)}: ${body}`, {}),
			);
		}

		const data = await res.json() as Record<string, unknown>;
		return Ok({
			deployment_id: data['id'],
			url: data['url'],
			readyState: data['readyState'],
			createdAt: data['createdAt'],
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`app-deploy: get-deployment failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}
