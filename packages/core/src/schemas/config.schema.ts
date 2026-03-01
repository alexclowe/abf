/**
 * Zod schema for abf.config.yaml.
 */

import { z } from 'zod';
import type { AbfConfig } from '../types/config.js';

const storageSchema = z.discriminatedUnion('backend', [
	z.object({
		backend: z.literal('filesystem'),
		base_path: z.string().default('.'),
	}),
	z.object({
		backend: z.literal('postgres'),
		connection_string: z.string(),
		pool_size: z.number().optional(),
	}),
]);

const busSchema = z.discriminatedUnion('backend', [
	z.object({ backend: z.literal('in-process') }),
	z.object({
		backend: z.literal('redis'),
		url: z.string(),
	}),
]);

const securitySchema = z.object({
	injection_detection: z.boolean().default(true),
	bounds_enforcement: z.boolean().default(true),
	audit_logging: z.boolean().default(true),
	credential_rotation_hours: z.number().default(24),
	max_session_cost_default: z.number().default(2.0),
});

const gatewaySchema = z.object({
	enabled: z.boolean().default(true),
	host: z.string().default('0.0.0.0'),
	port: z.number().default(3000),
	cors: z.array(z.string()).optional(),
});

const runtimeSchema = z.object({
	max_concurrent_sessions: z.number().default(10),
	session_timeout_ms: z.number().default(300_000),
	health_check_interval_ms: z.number().default(30_000),
});

const loggingSchema = z.object({
	level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
	format: z.enum(['json', 'pretty']).default('pretty'),
});

const datastoreSchema = z
	.object({
		backend: z.enum(['sqlite', 'postgres']).default('sqlite'),
		connection_string: z.string().optional(),
		sqlite_path: z.string().optional(),
		schemas_dir: z.string().default('datastore/schemas'),
		migrations_dir: z.string().default('datastore/migrations'),
	})
	.optional();

const cloudSchema = z
	.object({
		token: z.string(),
		endpoint: z.string().optional(),
	})
	.optional();

const customProviderSchema = z.object({
	id: z.string(),
	name: z.string(),
	base_url: z.string(),
	env_var: z.string().optional(),
	default_model: z.string().optional(),
});

export const configYamlSchema = z.object({
	name: z.string(),
	version: z.string().default('0.1.0'),
	description: z.string().optional(),
	storage: storageSchema.default({ backend: 'filesystem' }),
	bus: busSchema.default({ backend: 'in-process' }),
	security: securitySchema.default({}),
	gateway: gatewaySchema.default({}),
	runtime: runtimeSchema.default({}),
	logging: loggingSchema.default({}),
	datastore: datastoreSchema,
	agents_dir: z.string().default('agents'),
	teams_dir: z.string().default('teams'),
	tools_dir: z.string().default('tools'),
	memory_dir: z.string().default('memory'),
	logs_dir: z.string().default('logs'),
	knowledge_dir: z.string().default('knowledge'),
	outputs_dir: z.string().default('outputs'),
	cloud: cloudSchema,
	providers: z.array(customProviderSchema).optional(),
});

export type ConfigYamlInput = z.input<typeof configYamlSchema>;

export function transformConfigYaml(parsed: z.output<typeof configYamlSchema>): AbfConfig {
	const storage = parsed.storage;
	return {
		name: parsed.name,
		version: parsed.version,
		description: parsed.description,
		storage:
			storage.backend === 'filesystem'
				? { backend: 'filesystem', basePath: storage.base_path }
				: {
						backend: 'postgres',
						connectionString: storage.connection_string,
						poolSize: storage.pool_size,
					},
		bus: parsed.bus,
		security: {
			injectionDetection: parsed.security.injection_detection,
			boundsEnforcement: parsed.security.bounds_enforcement,
			auditLogging: parsed.security.audit_logging,
			credentialRotationHours: parsed.security.credential_rotation_hours,
			maxSessionCostDefault: parsed.security.max_session_cost_default,
		},
		gateway: {
			enabled: parsed.gateway.enabled,
			host: parsed.gateway.host,
			port: parsed.gateway.port,
			cors: parsed.gateway.cors,
		},
		runtime: {
			maxConcurrentSessions: parsed.runtime.max_concurrent_sessions,
			sessionTimeoutMs: parsed.runtime.session_timeout_ms,
			healthCheckIntervalMs: parsed.runtime.health_check_interval_ms,
		},
		logging: parsed.logging,
		datastore: parsed.datastore
			? {
					backend: parsed.datastore.backend as 'sqlite' | 'postgres',
					...(parsed.datastore.connection_string != null && {
						connectionString: parsed.datastore.connection_string,
					}),
					...(parsed.datastore.sqlite_path != null && {
						sqlitePath: parsed.datastore.sqlite_path,
					}),
					schemasDir: parsed.datastore.schemas_dir,
					migrationsDir: parsed.datastore.migrations_dir,
				}
			: undefined,
		agentsDir: parsed.agents_dir,
		teamsDir: parsed.teams_dir,
		toolsDir: parsed.tools_dir,
		memoryDir: parsed.memory_dir,
		logsDir: parsed.logs_dir,
		knowledgeDir: parsed.knowledge_dir,
		outputsDir: parsed.outputs_dir,
		...(parsed.cloud != null && {
			cloud: {
				token: parsed.cloud.token,
				...(parsed.cloud.endpoint != null && { endpoint: parsed.cloud.endpoint }),
			},
		}),
		...(parsed.providers != null && {
			providers: parsed.providers.map((p) => ({
				id: p.id,
				name: p.name,
				baseUrl: p.base_url,
				...(p.env_var != null && { envVar: p.env_var }),
				...(p.default_model != null && { defaultModel: p.default_model }),
			})),
		}),
	};
}
