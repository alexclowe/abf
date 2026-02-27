/**
 * LLM Provider types.
 * Provider-agnostic interface that supports Anthropic, OpenAI, Ollama, any OpenAI-compatible.
 */

import type { ProviderId, USDCents } from './common.js';
import type { TaggedContent } from './common.js';

// ─── Content Part Types (Multimodal) ──────────────────────────────────

export interface TextContent {
	readonly type: 'text';
	readonly text: string;
}

export interface ImageContent {
	readonly type: 'image';
	readonly mediaType: string;
	readonly data: string; // base64
}

export type ContentPart = TextContent | ImageContent;

// ─── Chat Types ───────────────────────────────────────────────────────

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
	readonly role: ChatRole;
	readonly content: string | readonly ContentPart[] | readonly TaggedContent[];
	readonly name?: string | undefined;
	readonly toolCallId?: string | undefined;
}

export interface ToolCallRequest {
	readonly id: string;
	readonly name: string;
	readonly arguments: string; // JSON string
}

export interface ChatRequest {
	readonly model: string;
	readonly messages: readonly ChatMessage[];
	readonly temperature?: number | undefined;
	readonly maxTokens?: number | undefined;
	readonly tools?: readonly ChatToolDefinition[] | undefined;
	readonly stopSequences?: readonly string[] | undefined;
}

export interface ChatToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly parameters: Readonly<Record<string, unknown>>; // JSON Schema
}

// ─── Streaming Response ───────────────────────────────────────────────

export type ChatChunkType = 'text' | 'tool_call' | 'usage' | 'done' | 'error';

export interface ChatChunk {
	readonly type: ChatChunkType;
	readonly text?: string | undefined;
	readonly toolCall?: ToolCallRequest | undefined;
	readonly usage?: TokenUsage | undefined;
	readonly error?: string | undefined;
}

export interface TokenUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly totalTokens: number;
}

// ─── Model Info ───────────────────────────────────────────────────────

export interface ModelInfo {
	readonly id: string;
	readonly name: string;
	readonly contextWindow: number;
	readonly maxOutputTokens?: number | undefined;
	readonly supportsTools: boolean;
	readonly supportsStreaming: boolean;
	readonly costPerInputToken?: number | undefined;
	readonly costPerOutputToken?: number | undefined;
}

// ─── Provider Interface ───────────────────────────────────────────────

export type ProviderAuthType = 'oauth' | 'api_key' | 'local';

export interface IProvider {
	readonly id: ProviderId;
	readonly name: string;
	readonly slug: string;
	readonly authType: ProviderAuthType;
	chat(request: ChatRequest): AsyncIterable<ChatChunk>;
	models(): Promise<readonly ModelInfo[]>;
	estimateCost(model: string, tokens: number): USDCents;
}

export interface IProviderRegistry {
	register(provider: IProvider): void;
	get(id: ProviderId): IProvider | undefined;
	getBySlug(slug: string): IProvider | undefined;
	getAll(): readonly IProvider[];
}
