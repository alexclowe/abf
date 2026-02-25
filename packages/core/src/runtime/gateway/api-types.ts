/**
 * REST API response type definitions for the Gateway.
 */

import type { AgentConfig, AgentState } from '../../types/agent.js';
import type { SessionId } from '../../types/common.js';
import type { SessionResult } from '../../types/session.js';
import type { ModelInfo } from '../../types/provider.js';

export interface AgentListItem {
	config: AgentConfig;
	state: AgentState | undefined;
}

export interface AgentDetail extends AgentListItem {
	recentSessions: SessionResult[];
}

export interface StatusResponse {
	version: string;
	uptime: number;
	name: string;
	agents: number;
	activeSessions: number;
	configured: boolean;
}

export interface ProviderStatus {
	id: string;
	name: string;
	slug: string;
	authType: string;
	models: ModelInfo[];
}

export interface RunAgentRequest {
	task: string;
	payload?: Record<string, unknown>;
}

export interface RunAgentResponse {
	sessionId: SessionId;
}
