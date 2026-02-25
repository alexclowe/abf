/**
 * file-read -- read files from the project directory.
 * Sandboxed: blocks path traversal and sensitive files.
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';

// Paths that are always blocked
const BLOCKED_PATTERNS = [
	'abf.config.yaml',
	'.env',
	'node_modules',
	'.git',
	'.abf',
	'credentials.enc',
	'database.sqlite',
];

// Paths that are allowed (checked by prefix)
const ALLOWED_PREFIXES = ['outputs', 'memory', 'logs', 'agents', 'teams', 'workflows', 'tools'];

function isPathAllowed(projectRoot: string, resolvedPath: string): boolean {
	// Must be within project root
	if (!resolvedPath.startsWith(projectRoot + '/') && resolvedPath !== projectRoot) {
		return false;
	}

	const relative = resolvedPath.slice(projectRoot.length + 1);

	// Check blocked patterns
	for (const blocked of BLOCKED_PATTERNS) {
		if (
			relative === blocked ||
			relative.startsWith(blocked + '/') ||
			relative.includes('/' + blocked)
		) {
			return false;
		}
	}

	// Check allowed prefixes
	const firstSegment = relative.split('/')[0] ?? '';
	return ALLOWED_PREFIXES.includes(firstSegment);
}

export function createFileReadTool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'file-read' as ToolId,
		name: 'file-read',
		description:
			'Read a file from the project directory. Returns file content as text. ' +
			'Can read from: outputs/, memory/, logs/, agents/, teams/, workflows/, tools/.',
		source: 'registry',
		parameters: [
			{
				name: 'path',
				type: 'string',
				description: 'Relative path from project root (e.g. "outputs/lens/report.md")',
				required: true,
			},
			{
				name: 'max_length',
				type: 'number',
				description: 'Max characters to return (default 10000)',
				required: false,
			},
			{
				name: 'offset',
				type: 'number',
				description: 'Character offset to start reading from (default 0)',
				required: false,
			},
		],
		estimatedCost: 0 as USDCents,
		timeout: 5_000,
	};

	return {
		definition,
		async execute(args) {
			const pathArg = args['path'];
			if (typeof pathArg !== 'string' || !pathArg.trim()) {
				return Err(new ToolError('TOOL_EXECUTION_FAILED', 'file-read: path is required', {}));
			}

			const resolvedPath = resolve(ctx.projectRoot, pathArg);

			if (!isPathAllowed(ctx.projectRoot, resolvedPath)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`file-read: access denied for "${pathArg}". ` +
							`Allowed paths: ${ALLOWED_PREFIXES.join(', ')}/`,
						{},
					),
				);
			}

			// Check file exists
			try {
				const info = await stat(resolvedPath);
				if (!info.isFile()) {
					return Err(
						new ToolError(
							'TOOL_EXECUTION_FAILED',
							`file-read: "${pathArg}" is a directory, not a file`,
							{},
						),
					);
				}
			} catch {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`file-read: file not found: "${pathArg}"`,
						{},
					),
				);
			}

			const maxLength =
				typeof args['max_length'] === 'number' ? Math.min(args['max_length'], 100_000) : 10_000;
			const offset = typeof args['offset'] === 'number' ? Math.max(0, args['offset']) : 0;

			const rawContent = await readFile(resolvedPath, 'utf-8');
			const totalLength = rawContent.length;
			const sliced = rawContent.slice(offset, offset + maxLength);
			const truncated = offset + maxLength < totalLength;

			return Ok({
				path: pathArg,
				content: sliced,
				totalLength,
				truncated,
			});
		},
	};
}
