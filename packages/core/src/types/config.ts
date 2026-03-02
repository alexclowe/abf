/**
 * Configuration types — the global abf.config.yaml structure.
 */

import type { LogLevel } from './common.js';
import type { DatastoreConfig } from './datastore.js';

// ─── Storage Config ───────────────────────────────────────────────────

export type StorageBackend = 'filesystem' | 'postgres';

export interface FilesystemStorageConfig {
	readonly backend: 'filesystem';
	readonly basePath: string;
}

export interface PostgresStorageConfig {
	readonly backend: 'postgres';
	readonly connectionString: string;
	readonly poolSize?: number | undefined;
}

export type StorageConfig = FilesystemStorageConfig | PostgresStorageConfig;

// ─── Bus Config ───────────────────────────────────────────────────────

export type BusBackend = 'in-process' | 'redis';

export interface InProcessBusConfig {
	readonly backend: 'in-process';
}

export interface RedisBusConfig {
	readonly backend: 'redis';
	readonly url: string;
}

export type BusConfig = InProcessBusConfig | RedisBusConfig;

// ─── Security Config ──────────────────────────────────────────────────

export interface SecurityConfig {
	readonly injectionDetection: boolean;
	readonly boundsEnforcement: boolean;
	readonly auditLogging: boolean;
	readonly credentialRotationHours: number;
	readonly maxSessionCostDefault: number; // in dollars, converted to USDCents at parse
}

// ─── Gateway Config ───────────────────────────────────────────────────

export interface GatewayConfig {
	readonly enabled: boolean;
	readonly host: string;
	readonly port: number;
	readonly cors?: readonly string[] | undefined;
}

// ─── Runtime Config ───────────────────────────────────────────────────

export interface RuntimeConfig {
	readonly maxConcurrentSessions: number;
	readonly sessionTimeoutMs: number;
	readonly healthCheckIntervalMs: number;
}

// ─── Cloud Config ─────────────────────────────────────────────────────

export interface CloudConfig {
	readonly token: string;
	readonly endpoint?: string | undefined;
}

// ─── Custom Provider Config ──────────────────────────────────────────

export interface CustomProviderConfig {
	readonly id: string;
	readonly name: string;
	readonly baseUrl: string;
	readonly envVar?: string | undefined;
	readonly defaultModel?: string | undefined;
}

// ─── ABF Config (top-level) ───────────────────────────────────────────

export interface AbfConfig {
	readonly name: string;
	readonly version: string;
	readonly description?: string | undefined;
	readonly storage: StorageConfig;
	readonly bus: BusConfig;
	readonly security: SecurityConfig;
	readonly gateway: GatewayConfig;
	readonly runtime: RuntimeConfig;
	readonly logging: {
		readonly level: LogLevel;
		readonly format: 'json' | 'pretty';
	};
	readonly datastore?: DatastoreConfig | undefined;
	readonly agentsDir: string;
	readonly teamsDir: string;
	readonly toolsDir: string;
	readonly memoryDir: string;
	readonly logsDir: string;
	readonly knowledgeDir: string;
	readonly outputsDir: string;
	readonly cloud?: CloudConfig | undefined;
	readonly providers?: readonly CustomProviderConfig[] | undefined;
	readonly memoryWindowSize?: number | undefined;
	readonly memorySummarizationThreshold?: number | undefined;
	readonly memorySummarizationEnabled?: boolean | undefined;
	readonly channels?: readonly import('../messaging/interfaces.js').ChannelRoute[] | undefined;
	/**
	 * Mail security configuration.
	 * `allowedSenders` is a list of glob patterns for accepted external senders.
	 * Agent-to-agent and operator mail always bypass the allowlist.
	 * Examples: ["*@company.com", "support@partner.io", "operator"]
	 */
	readonly mail?: {
		readonly allowedSenders?: readonly string[] | undefined;
	} | undefined;
}
