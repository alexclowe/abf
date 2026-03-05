/**
 * Runtime — top-level orchestrator that wires the 5 components together.
 * Implements IRuntime: start/stop lifecycle, agent loading, health.
 */

import { join } from 'node:path';
import type { ICredentialVault } from '../credentials/vault.js';
import { loadAgentConfigs } from '../config/loader.js';
import { loadToolConfigs } from '../tools/loader.js';
import type { AgentConfig } from '../types/agent.js';
import type { AgentId, HealthStatus, SessionId } from '../types/common.js';
import type { AbfConfig } from '../types/config.js';
import type { ABFError, Result } from '../types/errors.js';
import { Ok } from '../types/errors.js';
import type { SecurityContext } from '../types/security.js';
import type { IRuntime, RuntimeComponents } from './interfaces.js';

export class Runtime implements IRuntime {
	constructor(
		readonly config: AbfConfig,
		private readonly projectRoot: string,
		readonly components: RuntimeComponents,
		private readonly vault: ICredentialVault,
	) {}

	async start(): Promise<void> {
		await this.loadAgents();
		await this.loadTools();

		if (this.config.gateway.enabled) {
			await this.components.gateway.start();
		}

		this.components.scheduler.start();

		// Start channel router (R10) — listens for inbound messages from external channels
		if (this.components.channelRouter) {
			await this.components.channelRouter.start();
		}

		// Start monitor polling AFTER agents are loaded to avoid dispatching
		// activations for agents that don't exist yet (race condition M5).
		if (this.components.monitorRunner) {
			this.components.monitorRunner.start((activation) => {
				void this.components.dispatcher.dispatch(activation);
			});
		}
	}

	async stop(): Promise<void> {
		this.components.scheduler.stop();
		// Clear any pending heartbeat timers before shutdown
		this.components.dispatcher.clearHeartbeats();
		// Stop monitor polling to clean up interval timers
		this.components.monitorRunner?.stop();
		// Stop channel router (R10)
		if (this.components.channelRouter) {
			await this.components.channelRouter.stop();
		}

		if (this.config.gateway.enabled) {
			await this.components.gateway.stop();
		}
	}

	health(): HealthStatus {
		const activeSessions = this.components.dispatcher.getActiveSessions().length;
		return activeSessions >= this.config.runtime.maxConcurrentSessions ? 'degraded' : 'healthy';
	}

	async loadAgents(): Promise<Result<readonly AgentConfig[], ABFError>> {
		const agentsDir = join(this.projectRoot, this.config.agentsDir);
		const result = await loadAgentConfigs(agentsDir);

		if (!result.ok) return result;

		const { agents, warnings } = result.value;

		// Log warnings for agents that failed validation (partial success)
		for (const warning of warnings) {
			console.warn(`[runtime] Agent skipped: ${warning}`);
		}

		const agentsMap = this.components.agentsMap as Map<string, AgentConfig>;

		for (const agent of agents) {
			agentsMap.set(agent.id, agent);
			// Register with scheduler (for cron triggers) and dispatcher (for state tracking)
			this.components.scheduler.registerAgent(agent);
			// Load persisted stats (cost, session count) so they survive restarts
			const stats = await this.components.sessionStore?.getAgentStats(agent.id);
			this.components.dispatcher.registerAgent(agent, stats);
		}

		return Ok(agents);
	}

	async loadTools(): Promise<void> {
		const toolsDir = join(this.projectRoot, this.config.toolsDir);
		const result = await loadToolConfigs(toolsDir);

		if (result.ok) {
			for (const tool of result.value) {
				this.components.toolRegistry.register(tool);
			}
		}
		// Silently continue if no custom tools — builtins are already registered
	}

	createSecurityContext(agentId: AgentId, sessionId: SessionId): SecurityContext {
		const agentsMap = this.components.agentsMap as Map<string, AgentConfig>;
		const agent = agentsMap.get(agentId);

		return {
			agentId,
			sessionId,
			allowedActions: agent?.behavioralBounds.allowedActions ?? [],
			forbiddenActions: agent?.behavioralBounds.forbiddenActions ?? [],
			requiresApproval: agent?.behavioralBounds.requiresApproval ?? [],
		};
	}

	/** Convenience: check which providers have credentials available. */
	async getProviderStatus(): Promise<readonly { slug: string; available: boolean }[]> {
		const checks = [
			{
				slug: 'anthropic',
				envKey: 'ANTHROPIC_API_KEY',
				vaultProvider: 'anthropic',
				vaultKey: 'api_key',
			},
			{
				slug: 'openai',
				envKey: 'OPENAI_API_KEY',
				vaultProvider: 'openai',
				vaultKey: 'api_key',
			},
			{
				slug: 'ollama',
				envKey: 'OLLAMA_BASE_URL',
				vaultProvider: 'ollama',
				vaultKey: 'base_url',
			},
		];

		const results = await Promise.all(
			checks.map(async ({ slug, envKey, vaultProvider, vaultKey }) => {
				const hasEnv = Boolean(process.env[envKey]);
				const hasVault = Boolean(await this.vault.get(vaultProvider, vaultKey));

				// For Ollama, presence of base URL doesn't guarantee connectivity — just indicate configured
				// For others, having a key = available
				return { slug, available: hasEnv || hasVault || slug === 'ollama' };
			}),
		);

		return results;
	}
}
