/**
 * MCP Config: Notion — pages, databases, blocks, search.
 */
import type { MCPLibraryEntry } from '../config-registry.js';

export const notion: MCPLibraryEntry = {
	id: 'notion',
	metadata: {
		name: 'Notion',
		description: 'Read and write Notion pages, query databases, manage blocks, and search workspace content.',
		category: 'productivity',
		requiredCredentials: ['NOTION_API_KEY'],
		documentationUrl: 'https://github.com/makenotion/notion-mcp-server',
	},
	config: {
		id: 'notion',
		name: 'Notion',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@notionhq/notion-mcp-server'],
		env: {
			NOTION_API_KEY: '{{NOTION_API_KEY}}',
		},
		tools: ['*'],
	},
};
