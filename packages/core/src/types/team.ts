/**
 * Team types — groups of agents under an orchestrator.
 */

import type { AgentId, TeamId } from './common.js';

export interface TeamConfig {
	readonly name: string;
	readonly id: TeamId;
	readonly displayName: string;
	readonly description: string;
	readonly orchestrator: AgentId;
	readonly members: readonly AgentId[];
	readonly goals: readonly string[];
}
