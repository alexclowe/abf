/**
 * MCP Config: HubSpot — CRM, contacts, deals, companies, email tracking.
 */
import type { MCPLibraryEntry } from '../config-registry.js';

export const hubspot: MCPLibraryEntry = {
	id: 'hubspot',
	metadata: {
		name: 'HubSpot',
		description: 'CRM operations: manage contacts, deals, companies, and track email engagement.',
		category: 'crm',
		requiredCredentials: ['HUBSPOT_ACCESS_TOKEN'],
		documentationUrl: 'https://github.com/hubspot/hubspot-mcp',
	},
	config: {
		id: 'hubspot',
		name: 'HubSpot',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@hubspot/mcp-server'],
		env: {
			HUBSPOT_ACCESS_TOKEN: '{{HUBSPOT_ACCESS_TOKEN}}',
		},
		tools: ['*'],
	},
};
