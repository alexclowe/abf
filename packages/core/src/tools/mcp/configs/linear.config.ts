/**
 * MCP Config: Linear — issue tracking, project management, team workflows.
 */
import type { MCPLibraryEntry } from '../config-registry.js';

export const linear: MCPLibraryEntry = {
	id: 'linear',
	metadata: {
		name: 'Linear',
		description: 'Create and manage issues, projects, and team workflows in Linear.',
		category: 'development',
		requiredCredentials: ['LINEAR_API_KEY'],
		documentationUrl: 'https://github.com/jerhadf/linear-mcp-server',
	},
	config: {
		id: 'linear',
		name: 'Linear',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', 'mcp-linear'],
		env: {
			LINEAR_API_KEY: '{{LINEAR_API_KEY}}',
		},
		tools: ['*'],
	},
};
