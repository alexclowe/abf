/**
 * Scheduler — evaluates cron triggers and emits Activations.
 * Uses croner for full cron expression support (standard 5-field syntax).
 * Evaluates every 5 seconds for sub-minute precision.
 */

import { Cron } from 'croner';
import type { AgentConfig } from '../types/agent.js';
import type { AgentId } from '../types/common.js';
import type { Activation } from '../types/trigger.js';
import { createActivationId, toISOTimestamp } from '../util/id.js';
import type { IScheduler } from './interfaces.js';

export type ActivationHandler = (activation: Activation) => void;

export class Scheduler implements IScheduler {
	private readonly agents = new Map<string, AgentConfig>();
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private readonly onActivation: ActivationHandler;
	private readonly intervalMs: number = 5_000;

	constructor(onActivation: ActivationHandler) {
		this.onActivation = onActivation;
	}

	start(): void {
		if (this.intervalId) return;

		// Check every 5 seconds for sub-minute precision
		this.intervalId = setInterval(() => {
			this.evaluate();
		}, this.intervalMs);

		// Run immediately on start
		this.evaluate();
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	registerAgent(agent: AgentConfig): void {
		this.agents.set(agent.id, agent);
	}

	unregisterAgent(agentId: AgentId): void {
		this.agents.delete(agentId);
	}

	private evaluate(): void {
		const now = new Date();

		for (const agent of this.agents.values()) {
			for (const trigger of agent.triggers) {
				if (trigger.type === 'cron' && this.matchesCron(trigger.schedule, now)) {
					this.onActivation({
						id: createActivationId(),
						agentId: agent.id,
						trigger,
						timestamp: toISOTimestamp(now),
					});
				}
			}
		}
	}

	private matchesCron(expression: string, now: Date): boolean {
		try {
			const cron = new Cron(expression, { timezone: 'UTC' });
			// Get the next scheduled time starting from one interval ago
			const windowStart = new Date(now.getTime() - this.intervalMs);
			const nextInWindow = cron.nextRun(windowStart);
			if (!nextInWindow) return false;
			// Fire if that next scheduled time falls within [windowStart, now]
			return nextInWindow.getTime() > windowStart.getTime() && nextInWindow.getTime() <= now.getTime();
		} catch {
			// Invalid cron expression — skip silently
			return false;
		}
	}
}
