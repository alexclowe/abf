/**
 * MCP client — connects to a single MCP server and exposes its tools.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { MCPServerConfig } from '../../schemas/mcp-servers.schema.js';

export interface MCPTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export class MCPClient {
	private client: Client;
	private connected = false;

	constructor(private readonly config: MCPServerConfig) {
		this.client = new Client(
			{ name: 'abf-runtime', version: '0.2.0' },
			{ capabilities: {} },
		);
	}

	async connect(): Promise<void> {
		let transport;
		if (this.config.transport === 'stdio') {
			transport = new StdioClientTransport({
				command: this.config.command!,
				args: this.config.args ?? [],
				...(this.config.env != null ? { env: this.config.env } : {}),
			});
		} else {
			transport = new SSEClientTransport(new URL(this.config.url!));
		}
		await this.client.connect(transport);
		this.connected = true;
	}

	async listTools(): Promise<MCPTool[]> {
		if (!this.connected) throw new Error(`MCPClient ${this.config.id} not connected`);
		const result = await this.client.listTools();
		return result.tools.map((t) => ({
			name: t.name,
			description: t.description ?? '',
			inputSchema: t.inputSchema as Record<string, unknown>,
		}));
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
		if (!this.connected) throw new Error(`MCPClient ${this.config.id} not connected`);
		const result = await this.client.callTool({ name, arguments: args });
		return result.content;
	}

	async disconnect(): Promise<void> {
		if (this.connected) {
			await this.client.close();
			this.connected = false;
		}
	}
}
