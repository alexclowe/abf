/**
 * file-write -- write content to a file in the outputs directory.
 * Sandboxed: writes only to {projectRoot}/outputs/. Path traversal is blocked.
 */
import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';

const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.csv', '.json', '.html', '.xml']);
const MAX_BYTES = 1_048_576; // 1MB

function sanitizeFilename(filename: string): string | null {
	// Remove path separators and traversal
	const name = filename.replace(/[/\\]/g, '').replace(/\.\./g, '');
	// Only allow safe characters
	if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
	// Must have an allowed extension
	const ext = name.slice(name.lastIndexOf('.'));
	if (!ALLOWED_EXTENSIONS.has(ext)) return null;
	return name;
}

export function createFileWriteTool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'file-write' as ToolId,
		name: 'file-write',
		description:
			'Write content to a file in the outputs directory. ' +
			'Supported formats: .md, .txt, .csv, .json, .html, .xml. ' +
			'Returns the file path.',
		source: 'registry',
		parameters: [
			{
				name: 'filename',
				type: 'string',
				description: 'Filename with extension (e.g. "weekly-report.md")',
				required: true,
			},
			{
				name: 'content',
				type: 'string',
				description: 'File content to write',
				required: true,
			},
			{
				name: 'append',
				type: 'boolean',
				description: 'Append to existing file instead of overwriting (default false)',
				required: false,
			},
		],
		estimatedCost: 0 as USDCents,
		timeout: 5_000,
	};

	return {
		definition,
		async execute(args) {
			const filename = args['filename'];
			if (typeof filename !== 'string') {
				return Err(new ToolError('TOOL_EXECUTION_FAILED', 'file-write: filename is required', {}));
			}

			const content = args['content'];
			if (typeof content !== 'string') {
				return Err(new ToolError('TOOL_EXECUTION_FAILED', 'file-write: content is required', {}));
			}

			const safeName = sanitizeFilename(filename);
			if (!safeName) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`file-write: invalid filename "${filename}". Use alphanumeric characters, hyphens, underscores, and dots. Allowed extensions: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
						{},
					),
				);
			}

			if (content.length * 2 > MAX_BYTES) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'file-write: content exceeds 1MB limit', {}),
				);
			}

			const outputsDir = join(ctx.projectRoot, 'outputs');
			await mkdir(outputsDir, { recursive: true });

			const filePath = resolve(outputsDir, safeName);
			const shouldAppend = args['append'] === true;

			let isNewFile = true;
			try {
				await stat(filePath);
				isNewFile = false;
			} catch {
				isNewFile = true;
			}

			if (shouldAppend) {
				await appendFile(filePath, content, 'utf-8');
			} else {
				await writeFile(filePath, content, 'utf-8');
			}

			const bytesWritten = Buffer.byteLength(content, 'utf-8');
			const relativePath = `outputs/${safeName}`;

			return Ok({
				path: relativePath,
				bytesWritten,
				created: isNewFile || !shouldAppend,
			});
		},
	};
}
