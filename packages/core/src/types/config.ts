/**
 * Configuration types — the global abf.config.yaml structure.
 */

import type { LogLevel } from './common.js';

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
	readonly agentsDir: string;
	readonly teamsDir: string;
	readonly toolsDir: string;
	readonly memoryDir: string;
	readonly logsDir: string;
}
