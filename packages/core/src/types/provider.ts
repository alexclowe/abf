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
	/** Tool calls made by the assistant — required for multi-turn tool use with OpenAI/Anthropic. */
	readonly toolCalls?: readonly { id: string; name: string; arguments: string }[] | undefined;
}

export interface ToolCallRequest {
	readonly id: string;
	readonly name: string;
	readonly arguments: string; // JSON string
}

/** Structured output format — forces the LLM to produce valid JSON matching a schema. */
export interface ResponseFormat {
	/** Currently only 'json_schema' is supported. */
	readonly type: 'json_schema';
	/** Schema name (required by OpenAI structured outputs). */
	readonly name: string;
	/** JSON Schema object defining the expected output shape. */
	readonly schema: Readonly<Record<string, unknown>>;
	/**
	 * When true, the model strictly follows the schema (no extra keys).
	 * Default: true. OpenAI supports this natively; other providers may ignore it.
	 */
	readonly strict?: boolean | undefined;
}

export interface ChatRequest {
	readonly model: string;
	readonly messages: readonly ChatMessage[];
	readonly temperature?: number | undefined;
	readonly maxTokens?: number | undefined;
	readonly tools?: readonly ChatToolDefinition[] | undefined;
	readonly stopSequences?: readonly string[] | undefined;
	/** Abort signal for cooperative cancellation (e.g., session timeout or manual abort). */
	readonly signal?: AbortSignal | undefined;
	/**
	 * Structured output format — when set, the provider will request JSON output
	 * matching the given schema. Currently best supported by OpenAI models.
	 * Providers that don't support it will ignore this field gracefully.
	 */
	readonly responseFormat?: ResponseFormat | undefined;
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
	readonly supportsStructuredOutput?: boolean | undefined;
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
