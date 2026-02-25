/**
 * Zod schema for tools/mcp-servers.yaml configuration.
 */

import { z } from 'zod';

export const mcpServerSchema = z
	.object({
		id: z.string().min(1),
		name: z.string().optional(),
		transport: z.enum(['stdio', 'http']),
		// stdio transport
		command: z.string().optional(),
		args: z.array(z.string()).optional(),
		env: z.record(z.string()).optional(),
		// http transport
		url: z.string().url().optional(),
		apiKey: z.string().optional(),
		// shared
		tools: z.array(z.string()).default(['*']),
	})
	.refine((s) => (s.transport === 'stdio' ? !!s.command : !!s.url), {
		message: 'stdio requires command, http requires url',
	});

export const mcpServersFileSchema = z.object({
	servers: z.array(mcpServerSchema),
});

export type MCPServerConfig = z.infer<typeof mcpServerSchema>;
export type MCPServersFile = z.infer<typeof mcpServersFileSchema>;
