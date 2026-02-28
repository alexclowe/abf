/**
 * Ollama utilities — detection, model selection, installation, and model pulling.
 *
 * Used by `abf dev --provider ollama` and `abf init --provider ollama` to
 * ensure Ollama is available and has a working model before starting the runtime.
 *
 * Also used by the desktop app's setup flow for one-click local LLM setup.
 */

import { spawn } from 'node:child_process';
import { platform } from 'node:os';

const OLLAMA_BASE = process.env['OLLAMA_BASE_URL'] || 'http://localhost:11434';

/**
 * Model preference order for agent tasks. When multiple models are installed,
 * we pick the most capable one. Order is: newest/best first.
 */
const MODEL_PREFERENCE = [
	'llama3.3',
	'llama3.1',
	'qwen2.5',
	'deepseek-r1',
	'mistral',
	'llama3.2',
	'gemma2',
	'phi3',
	'llama3',
	'llama2',
];

/**
 * Default model to pull when nothing is installed.
 * llama3.2 is ~2GB, runs on 8GB RAM, good enough for agent tasks.
 */
export const DEFAULT_PULL_MODEL = 'llama3.2';

// ─── Detection ──────────────────────────────────────────────────────────────

/** Check if the Ollama API is responding. */
export async function isOllamaRunning(): Promise<boolean> {
	try {
		const resp = await fetch(`${OLLAMA_BASE}/api/tags`, {
			signal: AbortSignal.timeout(3000),
		});
		return resp.ok;
	} catch {
		return false;
	}
}

/** Check if the `ollama` binary is on PATH (installed but maybe not running). */
export async function isOllamaInstalled(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn('ollama', ['--version'], { stdio: 'pipe' });
		proc.on('close', (code) => resolve(code === 0));
		proc.on('error', () => resolve(false));
	});
}

// ─── Model Management ───────────────────────────────────────────────────────

interface OllamaModelInfo {
	name: string;
	size: number;
	modified_at: string;
}

/** List all models installed in Ollama. Returns model names like "llama3.2:latest". */
export async function listModels(): Promise<string[]> {
	try {
		const resp = await fetch(`${OLLAMA_BASE}/api/tags`, {
			signal: AbortSignal.timeout(5000),
		});
		if (!resp.ok) return [];
		const data = (await resp.json()) as { models?: OllamaModelInfo[] };
		return (data.models ?? []).map((m) => m.name);
	} catch {
		return [];
	}
}

/**
 * Pick the best model from a list of installed models.
 * Matches against MODEL_PREFERENCE by prefix (e.g. "llama3.1" matches "llama3.1:latest").
 * Falls back to the first model if none match the preference list.
 */
export function pickBestModel(installed: string[]): string | null {
	if (installed.length === 0) return null;

	for (const preferred of MODEL_PREFERENCE) {
		const match = installed.find(
			(m) => m === preferred || m.startsWith(`${preferred}:`),
		);
		if (match) return match;
	}

	// No preferred model found — use whatever is available
	return installed[0];
}

/** Strip the ":latest" or ":tag" suffix for display and YAML config. */
export function modelBaseName(model: string): string {
	return model.replace(/:latest$/, '');
}

// ─── Installation ───────────────────────────────────────────────────────────

/**
 * Install Ollama on the current platform.
 * - Linux/macOS: `curl -fsSL https://ollama.com/install.sh | sh`
 * - Windows: downloads and runs OllamaSetup.exe
 */
export async function installOllama(
	onProgress?: (msg: string) => void,
): Promise<boolean> {
	const os = platform();

	if (os === 'win32') {
		onProgress?.('Downloading Ollama installer...');
		return new Promise((resolve) => {
			const ps = spawn(
				'powershell',
				[
					'-NoProfile',
					'-Command',
					'$installer = "$env:TEMP\\OllamaSetup.exe"; ' +
						'Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile $installer; ' +
						'Start-Process $installer -Wait',
				],
				{ stdio: 'pipe' },
			);

			ps.stdout?.on('data', (data) => {
				const line = data.toString().trim();
				if (line) onProgress?.(line);
			});

			ps.on('close', (code) => {
				if (code === 0) {
					onProgress?.('Ollama installed');
					resolve(true);
				} else {
					onProgress?.('Installation failed');
					resolve(false);
				}
			});
			ps.on('error', () => resolve(false));
		});
	}

	// Linux/macOS
	onProgress?.('Downloading and installing Ollama...');
	return new Promise((resolve) => {
		const proc = spawn(
			'sh',
			['-c', 'curl -fsSL https://ollama.com/install.sh | sh'],
			{ stdio: 'pipe' },
		);

		proc.stdout?.on('data', (data) => {
			const line = data.toString().trim();
			if (line) onProgress?.(line);
		});
		proc.stderr?.on('data', (data) => {
			const line = data.toString().trim();
			if (line) onProgress?.(line);
		});

		proc.on('close', (code) => {
			if (code === 0) {
				onProgress?.('Ollama installed');
				resolve(true);
			} else {
				onProgress?.(
					'Installation failed — try: curl -fsSL https://ollama.com/install.sh | sh',
				);
				resolve(false);
			}
		});
		proc.on('error', () => resolve(false));
	});
}

// ─── Server Management ──────────────────────────────────────────────────────

/** Start Ollama server in the background and wait for it to be ready. */
export async function startOllamaServer(
	onProgress?: (msg: string) => void,
): Promise<boolean> {
	onProgress?.('Starting Ollama server...');

	const proc = spawn('ollama', ['serve'], {
		stdio: 'ignore',
		detached: true,
	});
	proc.unref();

	// Poll until ready (up to 15 seconds)
	for (let i = 0; i < 15; i++) {
		await new Promise((r) => setTimeout(r, 1000));
		if (await isOllamaRunning()) {
			onProgress?.('Ollama server started');
			return true;
		}
	}

	onProgress?.('Ollama server failed to start');
	return false;
}

// ─── Model Pulling ──────────────────────────────────────────────────────────

/** Pull a model from the Ollama registry. Shows download progress via callback. */
export async function pullModel(
	model: string,
	onProgress?: (msg: string) => void,
): Promise<boolean> {
	onProgress?.(`Downloading ${model} (this may take a few minutes)...`);

	return new Promise((resolve) => {
		const proc = spawn('ollama', ['pull', model], { stdio: 'pipe' });

		proc.stdout?.on('data', (data) => {
			const line = data.toString().trim();
			if (line) onProgress?.(line);
		});
		proc.stderr?.on('data', (data) => {
			const line = data.toString().trim();
			if (line) onProgress?.(line);
		});

		proc.on('close', (code) => {
			if (code === 0) {
				onProgress?.(`${model} ready`);
				resolve(true);
			} else {
				onProgress?.(`Failed to download ${model}`);
				resolve(false);
			}
		});
		proc.on('error', () => {
			onProgress?.('Failed to run ollama pull — is Ollama installed?');
			resolve(false);
		});
	});
}

// ─── High-Level Orchestration ───────────────────────────────────────────────

export interface EnsureOllamaResult {
	ok: boolean;
	model: string;
	installed: boolean; // true if we installed Ollama during this call
	pulled: boolean; // true if we pulled a model during this call
	message?: string;
}

/**
 * Full Ollama setup: check availability → install if needed → start server →
 * detect or pull model → return best model name.
 *
 * @param autoInstall - If true, install Ollama automatically. If false, return
 *   an error when Ollama is not installed (for CLI prompting).
 */
export async function ensureOllama(options?: {
	onProgress?: (msg: string) => void;
	autoInstall?: boolean;
}): Promise<EnsureOllamaResult> {
	const { onProgress, autoInstall = false } = options ?? {};
	let didPull = false;

	// 1. Check if Ollama API is running
	if (await isOllamaRunning()) {
		const models = await listModels();
		if (models.length > 0) {
			const best = pickBestModel(models)!;
			onProgress?.(`Using ${modelBaseName(best)}`);
			return { ok: true, model: modelBaseName(best), installed: false, pulled: false };
		}

		// Running but no models — pull the default
		didPull = true;
		const pulled = await pullModel(DEFAULT_PULL_MODEL, onProgress);
		if (pulled) {
			return { ok: true, model: DEFAULT_PULL_MODEL, installed: false, pulled: true };
		}
		return {
			ok: false,
			model: DEFAULT_PULL_MODEL,
			installed: false,
			pulled: false,
			message: `Failed to download ${DEFAULT_PULL_MODEL}`,
		};
	}

	// 2. Check if installed but not running
	if (await isOllamaInstalled()) {
		const started = await startOllamaServer(onProgress);
		if (started) {
			const models = await listModels();
			if (models.length > 0) {
				const best = pickBestModel(models)!;
				onProgress?.(`Using ${modelBaseName(best)}`);
				return { ok: true, model: modelBaseName(best), installed: false, pulled: false };
			}

			didPull = true;
			const pulled = await pullModel(DEFAULT_PULL_MODEL, onProgress);
			if (pulled) {
				return { ok: true, model: DEFAULT_PULL_MODEL, installed: false, pulled: true };
			}
		}
		return {
			ok: false,
			model: DEFAULT_PULL_MODEL,
			installed: false,
			pulled: didPull,
			message: 'Ollama is installed but failed to start. Try running: ollama serve',
		};
	}

	// 3. Not installed
	if (!autoInstall) {
		return {
			ok: false,
			model: DEFAULT_PULL_MODEL,
			installed: false,
			pulled: false,
			message: 'not_installed',
		};
	}

	// 4. Auto-install
	const installed = await installOllama(onProgress);
	if (!installed) {
		return {
			ok: false,
			model: DEFAULT_PULL_MODEL,
			installed: false,
			pulled: false,
			message: 'Failed to install Ollama. Visit https://ollama.com/download for manual installation.',
		};
	}

	// 5. Start server after install
	const started = await startOllamaServer(onProgress);
	if (!started) {
		return {
			ok: false,
			model: DEFAULT_PULL_MODEL,
			installed: true,
			pulled: false,
			message: 'Installed Ollama but server failed to start. Try running: ollama serve',
		};
	}

	// 6. Pull a model
	didPull = true;
	const pulled = await pullModel(DEFAULT_PULL_MODEL, onProgress);
	if (pulled) {
		return { ok: true, model: DEFAULT_PULL_MODEL, installed: true, pulled: true };
	}

	return {
		ok: false,
		model: DEFAULT_PULL_MODEL,
		installed: true,
		pulled: false,
		message: `Installed Ollama but failed to download ${DEFAULT_PULL_MODEL}`,
	};
}
