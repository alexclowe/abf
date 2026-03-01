/**
 * MCP Config: shadcn/ui — component library for React, Vue, and Svelte.
 */
import type { MCPLibraryEntry } from '../config-registry.js';

export const shadcn: MCPLibraryEntry = {
	id: 'shadcn',
	metadata: {
		name: 'shadcn/ui Components',
		description: 'Browse, search, and get source code for shadcn/ui components.',
		category: 'development',
		requiredCredentials: [],
		documentationUrl: 'https://ui.shadcn.com/docs/mcp',
	},
	config: {
		id: 'shadcn',
		name: 'shadcn/ui',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', 'shadcn-mcp-server'],
		tools: ['*'],
	},
};
