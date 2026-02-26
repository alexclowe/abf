/**
 * Monitor types — external source monitoring definitions.
 */

export interface MonitorDefinition {
	readonly name: string;
	readonly description?: string | undefined;
	readonly url: string;
	readonly intervalMs: number;
	readonly agentId: string;
	readonly task: string;
	readonly method?: 'GET' | 'POST' | undefined;
	readonly headers?: Readonly<Record<string, string>> | undefined;
}

export interface MonitorSnapshot {
	readonly monitorName: string;
	readonly url: string;
	readonly contentHash: string;
	readonly fetchedAt: string;
	readonly statusCode: number;
}
