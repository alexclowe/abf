/**
 * MCP Config Library — curated pre-built MCP server configurations.
 *
 * Operators can browse via `GET /api/tools/mcp-library` or install via
 * `abf tools add <id>` which merges the config into mcp-servers.yaml.
 */

import type { MCPServerConfig } from '../../schemas/mcp-servers.schema.js';

export interface MCPConfigMetadata {
	readonly name: string;
	readonly description: string;
	readonly category: string;
	readonly requiredCredentials: readonly string[];
	readonly documentationUrl?: string | undefined;
}

export interface MCPLibraryEntry {
	readonly id: string;
	readonly metadata: MCPConfigMetadata;
	readonly config: Omit<MCPServerConfig, 'tools'> & { readonly tools: readonly string[] };
}

// ─── Library ────────────────────────────────────────────────────────────

import { stripe } from './configs/stripe.config.js';
import { googleCalendar } from './configs/google-calendar.config.js';
import { hubspot } from './configs/hubspot.config.js';
import { notion } from './configs/notion.config.js';
import { github } from './configs/github.config.js';
import { linear } from './configs/linear.config.js';

export const MCP_CONFIG_LIBRARY: readonly MCPLibraryEntry[] = [
	stripe,
	googleCalendar,
	hubspot,
	notion,
	github,
	linear,
];

/** Get a config by ID. */
export function getMCPConfig(id: string): MCPLibraryEntry | undefined {
	return MCP_CONFIG_LIBRARY.find((entry) => entry.id === id);
}

/** List configs, optionally filtered by category. */
export function listMCPConfigs(category?: string): readonly MCPLibraryEntry[] {
	if (!category) return MCP_CONFIG_LIBRARY;
	return MCP_CONFIG_LIBRARY.filter((entry) => entry.metadata.category === category);
}
