/**
 * github-ci -- GitHub CI/CD operations using Octokit.
 * Supports create-branch, commit-file, open-pr, trigger-workflow, check-run,
 * list-files, and read-file actions.
 * Write actions require approval if an approval store is configured.
 */
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { AgentId, SessionId, ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import { toISOTimestamp } from '../../util/id.js';
import type { BuiltinToolContext } from './context.js';
import { credentialError } from './credential-error.js';

// Rate limit: max 30 API calls per agent per runtime session
const sessionApiCounts = new Map<string, number>();
const MAX_API_CALLS_PER_SESSION = 30;

const WRITE_ACTIONS = ['create-branch', 'commit-file', 'open-pr', 'trigger-workflow'];
const ALL_ACTIONS = [...WRITE_ACTIONS, 'check-run', 'list-files', 'read-file'];

export function createGitHubCITool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'github-ci' as ToolId,
		name: 'github-ci',
		description:
			'Interact with GitHub repositories and CI/CD. Supports create-branch, commit-file, ' +
			'open-pr, trigger-workflow, check-run, list-files, and read-file actions.',
		source: 'registry',
		parameters: [
			{ name: 'action', type: 'string', description: 'Action to perform: create-branch, commit-file, open-pr, trigger-workflow, check-run, list-files, read-file', required: true },
			{ name: 'owner', type: 'string', description: 'Repository owner', required: false },
			{ name: 'repo', type: 'string', description: 'Repository name', required: false },
			{ name: 'branch', type: 'string', description: 'Branch name (for create-branch, commit-file, list-files, read-file)', required: false },
			{ name: 'base_branch', type: 'string', description: "Base branch for create-branch (default 'main') and open-pr", required: false },
			{ name: 'path', type: 'string', description: 'File path (for commit-file, read-file)', required: false },
			{ name: 'content', type: 'string', description: 'File content (for commit-file)', required: false },
			{ name: 'message', type: 'string', description: 'Commit message (for commit-file) or PR title (for open-pr)', required: false },
			{ name: 'title', type: 'string', description: 'PR title (for open-pr)', required: false },
			{ name: 'body', type: 'string', description: 'PR body (for open-pr)', required: false },
			{ name: 'workflow_id', type: 'string', description: 'Workflow file name or ID (for trigger-workflow)', required: false },
			{ name: 'run_id', type: 'string', description: 'Workflow run ID (for check-run)', required: false },
			{ name: 'inputs', type: 'object', description: 'Workflow inputs (for trigger-workflow)', required: false },
			{ name: 'sha', type: 'string', description: 'File SHA for updates (for commit-file)', required: false },
		],
		estimatedCost: 0 as USDCents,
		timeout: 30_000,
	};

	return {
		definition,
		async execute(args) {
			const action = args['action'];
			if (typeof action !== 'string' || !ALL_ACTIONS.includes(action)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`github-ci: action must be one of: ${ALL_ACTIONS.join(', ')}`,
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
						`github-ci: rate limit reached (max ${String(MAX_API_CALLS_PER_SESSION)} API calls per session)`,
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
					toolId: 'github-ci' as ToolId,
					toolName: 'github-ci',
					arguments: {
						action,
						owner: args['owner'],
						repo: args['repo'],
						branch: args['branch'],
						base_branch: args['base_branch'],
						path: args['path'],
						content: args['content'],
						message: args['message'],
						title: args['title'],
						body: args['body'],
						workflow_id: args['workflow_id'],
						inputs: args['inputs'],
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

			// Get GitHub token: env var first, then vault
			let token = process.env['GITHUB_TOKEN'];
			if (!token) {
				const vaultToken = await ctx.vault.get('github', 'api_key');
				if (vaultToken) token = vaultToken;
			}
			if (!token) {
				return Ok(credentialError(ctx.isCloud, {
					provider: 'github',
					envVar: 'GITHUB_TOKEN',
					dashboardPath: '/settings/integrations/github',
					displayName: 'GitHub',
				}));
			}

			// Dynamic import Octokit
			const { Octokit } = await import('@octokit/rest');
			const octokit = new Octokit({ auth: token });

			const owner = args['owner'] as string;
			const repo = args['repo'] as string;

			switch (action) {
				case 'create-branch':
					return createBranch(octokit, owner, repo, args);
				case 'commit-file':
					return commitFile(octokit, owner, repo, args);
				case 'open-pr':
					return openPR(octokit, owner, repo, args);
				case 'trigger-workflow':
					return triggerWorkflow(octokit, owner, repo, args);
				case 'check-run':
					return checkRun(octokit, owner, repo, args);
				case 'list-files':
					return listFiles(octokit, owner, repo, args);
				case 'read-file':
					return readFile(octokit, owner, repo, args);
				default:
					return Err(
						new ToolError('TOOL_EXECUTION_FAILED', `github-ci: unknown action '${action}'`, {}),
					);
			}
		},
	};
}

// biome-ignore lint: Octokit is dynamically imported, use any for the instance type
type OctokitInstance = any;

async function createBranch(
	octokit: OctokitInstance,
	owner: string,
	repo: string,
	args: Readonly<Record<string, unknown>>,
) {
	const branch = args['branch'] as string;
	const baseBranch = (args['base_branch'] as string) || 'main';

	if (!owner || !repo || !branch) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'github-ci: create-branch requires owner, repo, and branch', {}),
		);
	}

	try {
		const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${baseBranch}` });
		await octokit.git.createRef({
			owner,
			repo,
			ref: `refs/heads/${branch}`,
			sha: ref.data.object.sha,
		});
		return Ok({ created: true, branch, baseSha: ref.data.object.sha });
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`github-ci: create-branch failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function commitFile(
	octokit: OctokitInstance,
	owner: string,
	repo: string,
	args: Readonly<Record<string, unknown>>,
) {
	const branch = args['branch'] as string;
	const path = args['path'] as string;
	const content = args['content'] as string;
	const message = args['message'] as string;
	const sha = args['sha'] as string | undefined;

	if (!owner || !repo || !branch || !path || !content || !message) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'github-ci: commit-file requires owner, repo, branch, path, content, and message',
				{},
			),
		);
	}

	try {
		const result = await octokit.repos.createOrUpdateFileContents({
			owner,
			repo,
			path,
			message,
			content: Buffer.from(content).toString('base64'),
			branch,
			...(sha ? { sha } : {}),
		});
		return Ok({ committed: true, sha: result.data.content?.sha, path });
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`github-ci: commit-file failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function openPR(
	octokit: OctokitInstance,
	owner: string,
	repo: string,
	args: Readonly<Record<string, unknown>>,
) {
	const branch = args['branch'] as string;
	const baseBranch = (args['base_branch'] as string) || 'main';
	const title = (args['title'] as string) || (args['message'] as string);
	const body = (args['body'] as string) || '';

	if (!owner || !repo || !branch || !title) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'github-ci: open-pr requires owner, repo, branch, and title (or message)',
				{},
			),
		);
	}

	try {
		const pr = await octokit.pulls.create({
			owner,
			repo,
			title,
			body,
			head: branch,
			base: baseBranch,
		});
		return Ok({ created: true, number: pr.data.number, url: pr.data.html_url });
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`github-ci: open-pr failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function triggerWorkflow(
	octokit: OctokitInstance,
	owner: string,
	repo: string,
	args: Readonly<Record<string, unknown>>,
) {
	const workflowId = args['workflow_id'] as string;
	const branch = (args['branch'] as string) || 'main';
	const inputs = (args['inputs'] as Record<string, string>) || {};

	if (!owner || !repo || !workflowId) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'github-ci: trigger-workflow requires owner, repo, and workflow_id',
				{},
			),
		);
	}

	try {
		await octokit.actions.createWorkflowDispatch({
			owner,
			repo,
			workflow_id: workflowId,
			ref: branch,
			inputs,
		});
		return Ok({ triggered: true, workflow_id: workflowId });
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`github-ci: trigger-workflow failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function checkRun(
	octokit: OctokitInstance,
	owner: string,
	repo: string,
	args: Readonly<Record<string, unknown>>,
) {
	const runId = args['run_id'] as string;

	if (!owner || !repo || !runId) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'github-ci: check-run requires owner, repo, and run_id', {}),
		);
	}

	try {
		const run = await octokit.actions.getWorkflowRun({
			owner,
			repo,
			run_id: Number(runId),
		});
		return Ok({
			status: run.data.status,
			conclusion: run.data.conclusion,
			url: run.data.html_url,
			name: run.data.name,
			created_at: run.data.created_at,
			updated_at: run.data.updated_at,
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`github-ci: check-run failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function listFiles(
	octokit: OctokitInstance,
	owner: string,
	repo: string,
	args: Readonly<Record<string, unknown>>,
) {
	const branch = (args['branch'] as string) || 'main';
	const path = (args['path'] as string) || '';

	if (!owner || !repo) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'github-ci: list-files requires owner and repo', {}),
		);
	}

	try {
		const result = await octokit.repos.getContent({
			owner,
			repo,
			path,
			ref: branch,
		});
		const data = result.data;
		const files = Array.isArray(data)
			? data.map(f => ({ name: f.name, path: f.path, type: f.type, sha: f.sha }))
			: [{ name: (data as { name: string }).name, path: (data as { path: string }).path, type: (data as { type: string }).type, sha: (data as { sha: string }).sha }];
		return Ok({ files });
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`github-ci: list-files failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function readFile(
	octokit: OctokitInstance,
	owner: string,
	repo: string,
	args: Readonly<Record<string, unknown>>,
) {
	const branch = (args['branch'] as string) || 'main';
	const path = args['path'] as string;

	if (!owner || !repo || !path) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'github-ci: read-file requires owner, repo, and path', {}),
		);
	}

	try {
		const result = await octokit.repos.getContent({
			owner,
			repo,
			path,
			ref: branch,
		});
		const fileData = result.data as { content?: string; encoding?: string; sha: string; size: number };
		const decoded = fileData.content
			? Buffer.from(fileData.content, 'base64').toString('utf-8')
			: '';
		return Ok({ content: decoded, sha: fileData.sha, size: fileData.size });
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`github-ci: read-file failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}
