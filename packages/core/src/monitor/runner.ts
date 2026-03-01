/**
 * MonitorRunner — fetches URLs, hashes content, compares snapshots,
 * and triggers agents on change.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { MonitorDefinition, MonitorSnapshot } from '../types/monitor.js';
import type { AgentId } from '../types/common.js';
import { monitorYamlSchema, transformMonitorYaml } from '../schemas/monitor.schema.js';
import { createActivationId, toISOTimestamp } from '../util/id.js';

type DispatchFn = (activation: import('../types/trigger.js').Activation) => void;

export class MonitorRunner {
	private readonly monitors: MonitorDefinition[] = [];
	private readonly snapshots = new Map<string, MonitorSnapshot>();
	private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
	private dispatchFn: DispatchFn | null = null;

	/**
	 * Load monitor definitions from a directory.
	 */
	loadMonitors(dir: string): void {
		if (!existsSync(dir)) return;

		const files = readdirSync(dir).filter((f) => f.endsWith('.monitor.yaml'));
		for (const file of files) {
			try {
				const raw = parse(readFileSync(join(dir, file), 'utf-8'));
				const parsed = monitorYamlSchema.safeParse(raw);
				if (parsed.success) {
					this.monitors.push(transformMonitorYaml(parsed.data));
				}
			} catch {
				// Skip malformed files
			}
		}
	}

	/**
	 * Start all monitors. Requires a dispatch function to trigger agents.
	 */
	start(dispatchFn: DispatchFn): void {
		this.dispatchFn = dispatchFn;

		for (const monitor of this.monitors) {
			const timer = setInterval(() => {
				void this.check(monitor);
			}, monitor.intervalMs);

			this.timers.set(monitor.name, timer);

			// Also run immediately
			void this.check(monitor);
		}
	}

	/**
	 * Stop all monitors.
	 */
	stop(): void {
		for (const timer of this.timers.values()) {
			clearInterval(timer);
		}
		this.timers.clear();
	}

	/**
	 * Get all loaded monitor definitions.
	 */
	getMonitors(): readonly MonitorDefinition[] {
		return this.monitors;
	}

	/**
	 * Get snapshot for a monitor.
	 */
	getSnapshot(name: string): MonitorSnapshot | undefined {
		return this.snapshots.get(name);
	}

	private async check(monitor: MonitorDefinition): Promise<void> {
		try {
			const fetchOpts: RequestInit = { method: monitor.method ?? 'GET' };
			if (monitor.headers) {
				fetchOpts.headers = { ...monitor.headers };
			}
			const response = await fetch(monitor.url, fetchOpts);

			const text = await response.text();
			const contentHash = createHash('sha256').update(text).digest('hex');

			const prevSnapshot = this.snapshots.get(monitor.name);
			const newSnapshot: MonitorSnapshot = {
				monitorName: monitor.name,
				url: monitor.url,
				contentHash,
				fetchedAt: toISOTimestamp(),
				statusCode: response.status,
			};

			this.snapshots.set(monitor.name, newSnapshot);

			// If content changed (and we had a previous snapshot), trigger the agent
			if (prevSnapshot && prevSnapshot.contentHash !== contentHash && this.dispatchFn) {
				this.dispatchFn({
					id: createActivationId(),
					agentId: monitor.agentId as AgentId,
					trigger: {
						type: 'event',
						event: `monitor:${monitor.name}`,
						task: monitor.task,
					},
					payload: {
						monitorName: monitor.name,
						url: monitor.url,
						previousHash: prevSnapshot.contentHash,
						currentHash: contentHash,
						statusCode: response.status,
					},
					timestamp: toISOTimestamp(),
				});
			}
		} catch {
			// Silently skip fetch errors (network issues, etc.)
		}
	}
}
