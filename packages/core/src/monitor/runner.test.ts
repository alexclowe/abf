import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MonitorRunner } from './runner.js';
import { transformMonitorYaml } from '../schemas/monitor.schema.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function sha256(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}

function makeMonitorYaml(overrides: Record<string, string> = {}): string {
	const defaults: Record<string, string> = {
		name: 'test-monitor',
		url: 'https://example.com/status',
		interval: '5m',
		agent: 'scout',
		task: 'check_status',
	};
	const merged = { ...defaults, ...overrides };
	return Object.entries(merged)
		.map(([k, v]) => `${k}: ${v}`)
		.join('\n');
}

/**
 * Flush microtask queue so that the async `check()` calls resolve.
 * We advance fake timers by 0ms to process pending timer callbacks,
 * then yield the microtask queue multiple times for the async chain
 * (fetch -> response.text() -> dynamic import -> dispatch).
 */
async function flushAsync(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await new Promise<void>((r) => {
			queueMicrotask(r);
		});
	}
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('MonitorRunner', () => {
	let tempDir: string;
	let runner: MonitorRunner;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'abf-monitor-test-'));
		runner = new MonitorRunner();
	});

	afterEach(async () => {
		runner.stop();
		await rm(tempDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	// ── loadMonitors ───────────────────────────────────────────────────

	describe('loadMonitors', () => {
		it('loads valid monitor YAML files from a directory', async () => {
			await writeFile(
				join(tempDir, 'status.monitor.yaml'),
				makeMonitorYaml({ name: 'status-check', url: 'https://example.com/health' }),
			);
			await writeFile(
				join(tempDir, 'pricing.monitor.yaml'),
				makeMonitorYaml({ name: 'pricing-check', url: 'https://example.com/pricing' }),
			);

			runner.loadMonitors(tempDir);
			const monitors = runner.getMonitors();

			expect(monitors).toHaveLength(2);
			const names = monitors.map((m) => m.name);
			expect(names).toContain('status-check');
			expect(names).toContain('pricing-check');
		});

		it('returns empty for non-existent directory', () => {
			runner.loadMonitors('/nonexistent/dir/does/not/exist');
			expect(runner.getMonitors()).toHaveLength(0);
		});

		it('returns empty for directory with no monitor files', async () => {
			await writeFile(join(tempDir, 'readme.md'), '# Not a monitor');
			await writeFile(join(tempDir, 'config.yaml'), 'name: config');

			runner.loadMonitors(tempDir);
			expect(runner.getMonitors()).toHaveLength(0);
		});

		it('skips malformed YAML files', async () => {
			await writeFile(join(tempDir, 'bad.monitor.yaml'), '}{not valid yaml');
			await writeFile(
				join(tempDir, 'good.monitor.yaml'),
				makeMonitorYaml({ name: 'good' }),
			);

			runner.loadMonitors(tempDir);
			expect(runner.getMonitors()).toHaveLength(1);
			expect(runner.getMonitors()[0]!.name).toBe('good');
		});

		it('skips monitor files that fail schema validation', async () => {
			// Missing required fields (no url)
			await writeFile(
				join(tempDir, 'invalid.monitor.yaml'),
				'name: invalid-monitor\nagent: scout\ntask: check\n',
			);

			runner.loadMonitors(tempDir);
			expect(runner.getMonitors()).toHaveLength(0);
		});
	});

	// ── start / stop lifecycle ────────────────────────────────────────

	describe('start / stop lifecycle', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('starts polling with setInterval and runs an immediate check', async () => {
			const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue(
				new Response('initial content', { status: 200 }),
			);
			vi.stubGlobal('fetch', fetchMock);

			await writeFile(
				join(tempDir, 'site.monitor.yaml'),
				makeMonitorYaml({ name: 'site', interval: '30s' }),
			);
			runner.loadMonitors(tempDir);

			const dispatchFn = vi.fn();
			runner.start(dispatchFn);

			// Flush the immediate async check
			await flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
			// First check should NOT dispatch (no previous snapshot)
			expect(dispatchFn).not.toHaveBeenCalled();
		});

		it('stop clears all timers', async () => {
			const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue(
				new Response('content', { status: 200 }),
			);
			vi.stubGlobal('fetch', fetchMock);

			await writeFile(
				join(tempDir, 'a.monitor.yaml'),
				makeMonitorYaml({ name: 'a', interval: '30s' }),
			);
			runner.loadMonitors(tempDir);

			const dispatchFn = vi.fn();
			runner.start(dispatchFn);

			// Process the immediate check
			await flushAsync();
			const callCountAfterStart = fetchMock.mock.calls.length;

			runner.stop();

			// Advance time well past the interval — no more calls should happen
			vi.advanceTimersByTime(60_000);
			await flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(callCountAfterStart);
		});
	});

	// ── check (fetch + hash + dispatch) ───────────────────────────────

	describe('check method (fetch + hash + dispatch)', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('first check stores snapshot but does NOT dispatch', async () => {
			const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue(
				new Response('page content v1', { status: 200 }),
			);
			vi.stubGlobal('fetch', fetchMock);

			await writeFile(
				join(tempDir, 'm.monitor.yaml'),
				makeMonitorYaml({ name: 'my-site', interval: '30s' }),
			);
			runner.loadMonitors(tempDir);

			const dispatchFn = vi.fn();
			runner.start(dispatchFn);

			// Flush immediate check
			await flushAsync();

			expect(dispatchFn).not.toHaveBeenCalled();

			const snapshot = runner.getSnapshot('my-site');
			expect(snapshot).toBeDefined();
			expect(snapshot!.contentHash).toBe(sha256('page content v1'));
			expect(snapshot!.statusCode).toBe(200);
		});

		it('second check with different content triggers dispatch with correct payload', async () => {
			let callCount = 0;
			const fetchMock = vi.fn<() => Promise<Response>>().mockImplementation(async () => {
				callCount++;
				const body = callCount === 1 ? 'content-v1' : 'content-v2';
				return new Response(body, { status: 200 });
			});
			vi.stubGlobal('fetch', fetchMock);

			await writeFile(
				join(tempDir, 'm.monitor.yaml'),
				makeMonitorYaml({ name: 'tracker', interval: '30s' }),
			);
			runner.loadMonitors(tempDir);

			const dispatchFn = vi.fn();
			runner.start(dispatchFn);

			// First check (immediate)
			await flushAsync();
			expect(dispatchFn).not.toHaveBeenCalled();

			// Advance past the 30s interval to trigger the second check
			vi.advanceTimersByTime(30_000);
			await flushAsync();

			expect(dispatchFn).toHaveBeenCalledTimes(1);

			const activation = dispatchFn.mock.calls[0]![0];
			expect(activation.agentId).toBe('scout');
			expect(activation.trigger.type).toBe('event');
			expect(activation.trigger.event).toBe('monitor:tracker');
			expect(activation.trigger.task).toBe('check_status');
			expect(activation.payload).toEqual(
				expect.objectContaining({
					monitorName: 'tracker',
					previousHash: sha256('content-v1'),
					currentHash: sha256('content-v2'),
					statusCode: 200,
				}),
			);
		});

		it('second check with SAME content does NOT dispatch', async () => {
			const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue(
				new Response('same content', { status: 200 }),
			);
			vi.stubGlobal('fetch', fetchMock);

			await writeFile(
				join(tempDir, 'x.monitor.yaml'),
				makeMonitorYaml({ name: 'no-change', interval: '30s' }),
			);
			runner.loadMonitors(tempDir);

			const dispatchFn = vi.fn();
			runner.start(dispatchFn);

			// First check
			await flushAsync();

			// Second check (same content)
			vi.advanceTimersByTime(30_000);
			await flushAsync();

			expect(dispatchFn).not.toHaveBeenCalled();
		});

		it('handles fetch errors gracefully (no crash, no dispatch)', async () => {
			const fetchMock = vi.fn<() => Promise<Response>>().mockRejectedValue(
				new Error('Network error'),
			);
			vi.stubGlobal('fetch', fetchMock);

			await writeFile(
				join(tempDir, 'err.monitor.yaml'),
				makeMonitorYaml({ name: 'error-site', interval: '30s' }),
			);
			runner.loadMonitors(tempDir);

			const dispatchFn = vi.fn();

			// Should not throw
			expect(() => runner.start(dispatchFn)).not.toThrow();

			await flushAsync();

			// Second tick — still errors
			vi.advanceTimersByTime(30_000);
			await flushAsync();

			expect(dispatchFn).not.toHaveBeenCalled();
			expect(runner.getSnapshot('error-site')).toBeUndefined();
		});
	});

	// ── parseInterval (tested via transformMonitorYaml) ───────────────

	describe('parseInterval (via transformMonitorYaml)', () => {
		it('parses "30s" to 30000ms', () => {
			const def = transformMonitorYaml({
				name: 'x',
				url: 'https://example.com',
				interval: '30s',
				agent: 'a',
				task: 't',
			});
			expect(def.intervalMs).toBe(30_000);
		});

		it('parses "5m" to 300000ms', () => {
			const def = transformMonitorYaml({
				name: 'x',
				url: 'https://example.com',
				interval: '5m',
				agent: 'a',
				task: 't',
			});
			expect(def.intervalMs).toBe(300_000);
		});

		it('parses "1h" to 3600000ms', () => {
			const def = transformMonitorYaml({
				name: 'x',
				url: 'https://example.com',
				interval: '1h',
				agent: 'a',
				task: 't',
			});
			expect(def.intervalMs).toBe(3_600_000);
		});

		it('defaults to 300000ms (5m) for invalid interval', () => {
			const def = transformMonitorYaml({
				name: 'x',
				url: 'https://example.com',
				interval: 'invalid',
				agent: 'a',
				task: 't',
			});
			expect(def.intervalMs).toBe(300_000);
		});
	});

	// ── getSnapshot ───────────────────────────────────────────────────

	describe('getSnapshot', () => {
		it('returns undefined for unknown monitor name', () => {
			expect(runner.getSnapshot('nonexistent')).toBeUndefined();
		});

		it('returns snapshot after a successful check', async () => {
			vi.useFakeTimers();

			const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue(
				new Response('hello world', { status: 200 }),
			);
			vi.stubGlobal('fetch', fetchMock);

			await writeFile(
				join(tempDir, 's.monitor.yaml'),
				makeMonitorYaml({ name: 'snap-test', interval: '1h' }),
			);
			runner.loadMonitors(tempDir);
			runner.start(vi.fn());

			await flushAsync();

			const snapshot = runner.getSnapshot('snap-test');
			expect(snapshot).toBeDefined();
			expect(snapshot!.monitorName).toBe('snap-test');
			expect(snapshot!.url).toBe('https://example.com/status');
			expect(snapshot!.contentHash).toBe(sha256('hello world'));
			expect(snapshot!.statusCode).toBe(200);
			expect(snapshot!.fetchedAt).toBeDefined();

			vi.useRealTimers();
		});
	});
});
