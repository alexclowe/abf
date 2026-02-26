/**
 * Convention-over-configuration defaults.
 * These are applied when abf.config.yaml has minimal entries.
 */

import type { AbfConfig } from '../types/config.js';

export const DEFAULT_CONFIG: AbfConfig = {
	name: 'my-business',
	version: '0.1.0',
	description: undefined,
	storage: {
		backend: 'filesystem',
		basePath: '.',
	},
	bus: {
		backend: 'in-process',
	},
	security: {
		injectionDetection: true,
		boundsEnforcement: true,
		auditLogging: true,
		credentialRotationHours: 24,
		maxSessionCostDefault: 2.0,
	},
	gateway: {
		enabled: true,
		host: '0.0.0.0',
		port: 3000,
		cors: undefined,
	},
	runtime: {
		maxConcurrentSessions: 10,
		sessionTimeoutMs: 300_000, // 5 minutes
		healthCheckIntervalMs: 30_000, // 30 seconds
	},
	logging: {
		level: 'info',
		format: 'pretty',
	},
	agentsDir: 'agents',
	teamsDir: 'teams',
	toolsDir: 'tools',
	memoryDir: 'memory',
	logsDir: 'logs',
	knowledgeDir: 'knowledge',
	outputsDir: 'outputs',
};
