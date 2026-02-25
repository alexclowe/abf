/**
 * MCP tools loader — reads mcp-servers.yaml, connects to servers, registers their tools.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { mcpServersFileSchema } from '../../schemas/mcp-servers.schema.js';
import type { IToolRegistry } from '../../types/tool.js';
import { createLogger } from '../../util/logger.js';
import { MCPClient } from './client.js';
import { MCPToolAdapter } from './adapter.js';

const logger = createLogger({ level: 'info', format: 'json', name: 'mcp-loader' });

export async function loadMCPTools(toolsDir: string, registry: IToolRegistry): Promise<void> {
	const configPath = join(toolsDir, 'mcp-servers.yaml');

	let raw: string;
	try {
		raw = await readFile(configPath, 'utf-8');
	} catch {
		// No mcp-servers.yaml — that's fine, MCP is optional
		return;
	}

	const parsed = mcpServersFileSchema.safeParse(parseYaml(raw));
	if (!parsed.success) {
		logger.warn({ errors: parsed.error.errors }, 'Invalid mcp-servers.yaml — skipping MCP');
		return;
	}

	const { servers } = parsed.data;
	logger.info({ count: servers.length }, 'Connecting to MCP servers');

	for (const serverConfig of servers) {
		const client = new MCPClient(serverConfig);
		try {
			await client.connect();
			const tools = await client.listTools();

			// Filter tools if specific list given (tools: ['*'] means all)
			const wantsAll = serverConfig.tools.includes('*');
			const toolsToRegister = wantsAll
				? tools
				: tools.filter((t) => serverConfig.tools.includes(t.name));

			for (const tool of toolsToRegister) {
				const adapter = new MCPToolAdapter(
					serverConfig.id,
					tool.name,
					tool.description,
					tool.inputSchema,
					client,
				);
				registry.register(adapter);
				logger.info({ toolId: adapter.definition.id }, 'Registered MCP tool');
			}
		} catch (error) {
			logger.error({ server: serverConfig.id, error }, 'Failed to connect to MCP server');
			// Don't throw — other servers should still work
		}
	}
}
