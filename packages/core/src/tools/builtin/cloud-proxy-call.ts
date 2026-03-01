/**
 * cloudProxyCall — shared helper for forwarding tool calls through ABF Cloud's proxy.
 * All credential-bearing tools call this in cloud mode instead of hitting APIs directly.
 */
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { Result, ABFError } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';

/**
 * Forward a tool invocation to the ABF Cloud proxy.
 *
 * URL: `{endpoint}/tools/{toolId}`
 * Auth: Bearer token from ABF_CLOUD_TOKEN env or vault `abf-cloud/api_key`
 */
export async function cloudProxyCall(
	endpoint: string,
	toolId: string,
	args: Record<string, unknown>,
	cloudToken: string,
): Promise<Result<unknown, ABFError>> {
	const url = `${endpoint}/tools/${encodeURIComponent(toolId)}`;

	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${cloudToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(args),
		});

		if (!res.ok) {
			const body = await res.text();
			return Err(
				new ToolError(
					'TOOL_EXECUTION_FAILED',
					`Cloud proxy error for ${toolId}: ${String(res.status)} ${body}`,
					{ status: res.status },
				),
			);
		}

		const data = await res.json();
		return Ok(data);
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`Cloud proxy request failed for ${toolId}: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

/**
 * Resolve the ABF Cloud token from environment or vault.
 * Returns undefined if no token is available.
 */
export async function getCloudToken(ctx: BuiltinToolContext): Promise<string | undefined> {
	return process.env['ABF_CLOUD_TOKEN'] ?? (await ctx.vault.get('abf-cloud', 'api_key')) ?? undefined;
}
