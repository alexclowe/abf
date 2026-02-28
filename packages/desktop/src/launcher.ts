/**
 * ABF Desktop Launcher — starts the ABF runtime as a background process.
 *
 * Used by the Tauri desktop app to manage the Node.js runtime lifecycle.
 * The runtime starts on app launch and stops on app quit.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

let runtimeProcess: ChildProcess | null = null;

export interface LauncherConfig {
	/** Path to the ABF project root. */
	readonly projectRoot: string;
	/** Port for the gateway API. Default: 3000. */
	readonly port: number;
	/** Port for the dashboard. Default: 3001. */
	readonly dashboardPort: number;
}

/**
 * Start the ABF runtime in the background.
 */
export function startRuntime(config: LauncherConfig): void {
	if (runtimeProcess) {
		console.log('[ABF Desktop] Runtime already running');
		return;
	}

	const abfBin = resolve(config.projectRoot, 'node_modules', '.bin', 'abf');

	runtimeProcess = spawn(abfBin, ['dev'], {
		cwd: config.projectRoot,
		env: {
			...process.env,
			ABF_GATEWAY_PORT: String(config.port),
			ABF_DASHBOARD_PORT: String(config.dashboardPort),
			NODE_ENV: 'production',
		},
		stdio: 'pipe',
	});

	runtimeProcess.stdout?.on('data', (data: Buffer) => {
		console.log(`[ABF Runtime] ${data.toString().trim()}`);
	});

	runtimeProcess.stderr?.on('data', (data: Buffer) => {
		console.error(`[ABF Runtime] ${data.toString().trim()}`);
	});

	runtimeProcess.on('exit', (code) => {
		console.log(`[ABF Desktop] Runtime exited with code ${code}`);
		runtimeProcess = null;
	});

	console.log(`[ABF Desktop] Runtime started (PID: ${runtimeProcess.pid})`);
}

/**
 * Stop the ABF runtime gracefully.
 */
export function stopRuntime(): void {
	if (!runtimeProcess) return;

	console.log('[ABF Desktop] Stopping runtime...');
	runtimeProcess.kill('SIGTERM');

	// Force kill after 5 seconds if it doesn't exit gracefully
	const forceKillTimer = setTimeout(() => {
		if (runtimeProcess) {
			runtimeProcess.kill('SIGKILL');
			runtimeProcess = null;
		}
	}, 5000);

	runtimeProcess.on('exit', () => {
		clearTimeout(forceKillTimer);
		runtimeProcess = null;
	});
}

/**
 * Check if the runtime is currently running.
 */
export function isRuntimeRunning(): boolean {
	return runtimeProcess !== null;
}
