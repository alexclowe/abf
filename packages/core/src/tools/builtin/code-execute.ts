/**
 * code-execute -- run JavaScript code in a sandboxed child process.
 * Used by agents to generate documents (PPTX, DOCX, XLSX) or run data processing.
 * The code runs with access to pptxgenjs, docx, and exceljs npm packages.
 * Output files should be written to the outputs/ directory.
 *
 * Security hardening:
 * - HOME stripped from child env (prevents access to ~/.abf/credentials.enc)
 * - Temp files written with 0o600 permissions (owner-only read/write)
 * - stdout/stderr capped at 10MB to prevent memory exhaustion
 * - Node 22+: --experimental-permission restricts fs/network access
 * - Node <22: best-effort env stripping + warning
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';

/** 10 MB cap on stdout/stderr to prevent memory exhaustion attacks. */
const MAX_BUFFER = 10 * 1024 * 1024;

function listFiles(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

/** Parse Node.js semver to [major, minor, patch]. */
function parseNodeVersion(): [number, number, number] {
	const parts = process.versions.node.split('.').map(Number);
	return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Build sandboxed node flags for Node 22+ permission model. */
function buildSandboxArgs(
	tempFile: string,
	projectRoot: string,
	outputsDir: string,
	sandboxDir: string,
): string[] {
	const [major] = parseNodeVersion();

	if (major >= 22) {
		return [
			'--experimental-permission',
			`--allow-fs-read=${projectRoot}`,
			`--allow-fs-write=${outputsDir}`,
			`--allow-fs-write=${sandboxDir}`,
			tempFile,
		];
	}

	// Node < 22: no permission model, just run the file
	return [tempFile];
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
			writeFileSync(tempFile, code, { encoding: 'utf-8', mode: 0o600 });

			// Snapshot outputs/ before execution
			const outputsDir = join(ctx.projectRoot, 'outputs');
			const filesBefore = new Set(listFiles(outputsDir));

			const startMs = Date.now();

			// Warn on Node < 22 (no permission model)
			const [major] = parseNodeVersion();
			if (major < 22) {
				console.warn(
					'[code-execute] Node.js < 22 detected — permission sandboxing unavailable. ' +
					'Upgrade to Node 22+ for --experimental-permission support.',
				);
			}

			const nodeArgs = buildSandboxArgs(tempFile, ctx.projectRoot, outputsDir, sandboxDir);

			try {
				const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
					(resolve, reject) => {
						let stdoutLen = 0;
						let stderrLen = 0;
						let truncated = false;

						const child = spawn('node', nodeArgs, {
							cwd: ctx.projectRoot,
							env: {
								PATH: process.env['PATH'],
								// HOME intentionally omitted — prevents access to ~/.abf/credentials.enc
								// NODE_PATH intentionally omitted — limits module resolution to project tree
							},
							timeout: 120_000,
							stdio: ['ignore', 'pipe', 'pipe'],
						});

						const stdoutChunks: Buffer[] = [];
						const stderrChunks: Buffer[] = [];

						child.stdout.on('data', (chunk: Buffer) => {
							if (stdoutLen + chunk.length <= MAX_BUFFER) {
								stdoutChunks.push(chunk);
								stdoutLen += chunk.length;
							} else if (!truncated) {
								truncated = true;
								const remaining = MAX_BUFFER - stdoutLen;
								if (remaining > 0) stdoutChunks.push(chunk.subarray(0, remaining));
							}
						});
						child.stderr.on('data', (chunk: Buffer) => {
							if (stderrLen + chunk.length <= MAX_BUFFER) {
								stderrChunks.push(chunk);
								stderrLen += chunk.length;
							}
						});

						child.on('error', (err) => reject(err));
						child.on('close', (exitCode) => {
							resolve({
								stdout: Buffer.concat(stdoutChunks).toString('utf-8') +
									(truncated ? '\n[truncated: output exceeded 10MB limit]' : ''),
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
