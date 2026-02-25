/**
 * Common types shared across all ABF modules.
 * Branded types, tagged content, input sources.
 */

// ─── Branded Types ────────────────────────────────────────────────────
// Branded types use a unique symbol to prevent type confusion at compile time.
// You can't accidentally pass an AgentId where a SessionId is expected.

declare const __brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type AgentId = Brand<string, 'AgentId'>;
export type TeamId = Brand<string, 'TeamId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type ToolId = Brand<string, 'ToolId'>;
export type ActivationId = Brand<string, 'ActivationId'>;
export type ProviderId = Brand<string, 'ProviderId'>;
export type WorkflowId = Brand<string, 'WorkflowId'>;

// ─── Value Types ──────────────────────────────────────────────────────

/** ISO 8601 timestamp string */
export type ISOTimestamp = Brand<string, 'ISOTimestamp'>;

/** Cost in USD cents (avoids floating-point issues) */
export type USDCents = Brand<number, 'USDCents'>;

/** SHA-256 hex string for memory integrity */
export type Checksum = Brand<string, 'Checksum'>;

// ─── Input Source Tagging ─────────────────────────────────────────────
// Every piece of content entering the system is tagged with its origin.
// This is the foundation of prompt injection defense.

export type InputSource =
	| 'user'
	| 'agent'
	| 'system'
	| 'email'
	| 'web'
	| 'api'
	| 'webhook'
	| 'file';

export interface TaggedContent {
	readonly source: InputSource;
	readonly content: string;
	readonly timestamp: ISOTimestamp;
	readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

// ─── Common Enums ─────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';
