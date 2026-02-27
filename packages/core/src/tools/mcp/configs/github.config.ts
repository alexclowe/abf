/**
 * MCP Config: GitHub — repositories, issues, PRs, actions, code search.
 */
import type { MCPLibraryEntry } from '../config-registry.js';

export const github: MCPLibraryEntry = {
	id: 'github',
	metadata: {
		name: 'GitHub',
		description: 'Manage repositories, issues, pull requests, code search, and GitHub Actions.',
		category: 'development',
		requiredCredentials: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
		documentationUrl: 'https://github.com/github/github-mcp-server',
	},
	config: {
		id: 'github',
		name: 'GitHub',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-github'],
		env: {
			GITHUB_PERSONAL_ACCESS_TOKEN: '{{GITHUB_PERSONAL_ACCESS_TOKEN}}',
		},
		tools: ['*'],
	},
};
