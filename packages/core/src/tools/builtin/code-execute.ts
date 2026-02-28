/**
 * code-execute -- run JavaScript code in a sandboxed child process.
 * Used by agents to generate documents (PPTX, DOCX, XLSX) or run data processing.
 * The code runs with access to pptxgenjs, docx, and exceljs npm packages.
 * Output files should be written to the outputs/ directory.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';

function listFiles(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

export function createCodeExecuteTool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'code-execute' as ToolId,
		name: 'code-execute',
		description:
			'Execute JavaScript code in a sandboxed child process. Use this to generate documents (PPTX, DOCX, XLSX) or run data processing scripts. The code runs with access to pptxgenjs, docx, and exceljs npm packages. Write output files to the outputs/ directory.',
		source: 'registry',
		parameters: [
			{
				name: 'code',
				type: 'string',
				description:
					'JavaScript code to execute. Use require() to import packages like pptxgenjs, docx, exceljs.',
				required: true,
			},
			{
				name: 'description',
				type: 'string',
				description: 'What this code does (logged for audit trail)',
				required: false,
			},
		],
		timeout: 120_000,
	};

	return {
		definition,
		async execute(args) {
			const code = args['code'];
			if (typeof code !== 'string' || !code.trim()) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'code-execute: code parameter is required', {}),
				);
			}

			const sandboxDir = join(ctx.projectRoot, '.abf', 'sandbox');
			mkdirSync(sandboxDir, { recursive: true });

			const tempFile = join(sandboxDir, `${randomUUID()}.js`);
			writeFileSync(tempFile, code, 'utf-8');

			// Snapshot outputs/ before execution
			const outputsDir = join(ctx.projectRoot, 'outputs');
			const filesBefore = new Set(listFiles(outputsDir));

			const startMs = Date.now();

			try {
				const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
					(resolve, reject) => {
						const child = spawn('node', [tempFile], {
							cwd: ctx.projectRoot,
							env: {
								PATH: process.env['PATH'],
								NODE_PATH: process.env['NODE_PATH'],
								HOME: process.env['HOME'],
							},
							timeout: 120_000,
							stdio: ['ignore', 'pipe', 'pipe'],
						});

						const stdoutChunks: Buffer[] = [];
						const stderrChunks: Buffer[] = [];

						child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
						child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

						child.on('error', (err) => reject(err));
						child.on('close', (exitCode) => {
							resolve({
								stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
								stderr: Buffer.concat(stderrChunks).toString('utf-8'),
								exitCode: exitCode ?? 1,
							});
						});
					},
				);

				const durationMs = Date.now() - startMs;

				// Check for new files in outputs/
				const filesAfter = listFiles(outputsDir);
				const filesCreated = filesAfter.filter((f) => !filesBefore.has(f));

				return Ok({
					stdout: result.stdout,
					stderr: result.stderr,
					exitCode: result.exitCode,
					filesCreated,
					durationMs,
				});
			} catch (err) {
				const durationMs = Date.now() - startMs;
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`code-execute: process error: ${err instanceof Error ? err.message : String(err)}`,
						{ durationMs },
					),
				);
			} finally {
				try {
					unlinkSync(tempFile);
				} catch {
					// Temp file cleanup is best-effort
				}
			}
		},
	};
}
