/**
 * MCP Config: Google Calendar — event management, scheduling, availability.
 */
import type { MCPLibraryEntry } from '../config-registry.js';

export const googleCalendar: MCPLibraryEntry = {
	id: 'google-calendar',
	metadata: {
		name: 'Google Calendar',
		description: 'Create, read, update, and delete calendar events. Check availability and manage schedules.',
		category: 'productivity',
		requiredCredentials: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
		documentationUrl: 'https://github.com/nicholasgriffintn/google-calendar-mcp',
	},
	config: {
		id: 'google-calendar',
		name: 'Google Calendar',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@nicholasgriffintn/google-calendar-mcp'],
		env: {
			GOOGLE_CLIENT_ID: '{{GOOGLE_CLIENT_ID}}',
			GOOGLE_CLIENT_SECRET: '{{GOOGLE_CLIENT_SECRET}}',
			GOOGLE_REFRESH_TOKEN: '{{GOOGLE_REFRESH_TOKEN}}',
		},
		tools: ['*'],
	},
};
