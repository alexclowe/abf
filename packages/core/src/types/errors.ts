/**
 * Error hierarchy and Result type for explicit error handling.
 *
 * Dual-track error strategy:
 * - Result<T,E> for expected failures (validation, bounds, provider errors)
 * - Thrown ABFError for unexpected/unrecoverable failures (programmer errors)
 */

// ─── Error Codes ──────────────────────────────────────────────────────

export type ABFErrorCode =
	// Config
	| 'CONFIG_NOT_FOUND'
	| 'CONFIG_INVALID'
	| 'CONFIG_PARSE_ERROR'
	// Agent
	| 'AGENT_NOT_FOUND'
	| 'AGENT_INVALID'
	| 'AGENT_ALREADY_RUNNING'
	// Provider
	| 'PROVIDER_NOT_FOUND'
	| 'PROVIDER_AUTH_FAILED'
	| 'PROVIDER_RATE_LIMITED'
	| 'PROVIDER_ERROR'
	// Tool
	| 'TOOL_NOT_FOUND'
	| 'TOOL_EXECUTION_FAILED'
	| 'TOOL_TIMEOUT'
	// Security
	| 'BOUNDS_VIOLATION'
	| 'ACTION_FORBIDDEN'
	| 'APPROVAL_REQUIRED'
	| 'COST_LIMIT_EXCEEDED'
	| 'INJECTION_DETECTED'
	// Memory
	| 'MEMORY_READ_FAILED'
	| 'MEMORY_WRITE_FAILED'
	| 'MEMORY_INTEGRITY_FAILED'
	// Session
	| 'SESSION_FAILED'
	| 'SESSION_TIMEOUT'
	// Bus
	| 'MESSAGE_DELIVERY_FAILED'
	| 'MESSAGE_TIMEOUT'
	// Runtime
	| 'RUNTIME_ERROR'
	| 'SCHEDULER_ERROR'
	| 'GATEWAY_ERROR';

// ─── Error Class Hierarchy ────────────────────────────────────────────

export class ABFError extends Error {
	public readonly code: ABFErrorCode;
	public readonly context: Readonly<Record<string, unknown>> | undefined;
	public readonly timestamp: string;

	constructor(code: ABFErrorCode, message: string, context?: Record<string, unknown>) {
		super(message);
		this.name = 'ABFError';
		this.code = code;
		this.context = context ?? undefined;
		this.timestamp = new Date().toISOString();
	}
}

export class ConfigError extends ABFError {
	constructor(
		code: Extract<ABFErrorCode, 'CONFIG_NOT_FOUND' | 'CONFIG_INVALID' | 'CONFIG_PARSE_ERROR'>,
		message: string,
		context?: Record<string, unknown>,
	) {
		super(code, message, context);
		this.name = 'ConfigError';
	}
}

export class ProviderError extends ABFError {
	constructor(
		code: Extract<
			ABFErrorCode,
			'PROVIDER_NOT_FOUND' | 'PROVIDER_AUTH_FAILED' | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_ERROR'
		>,
		message: string,
		context?: Record<string, unknown>,
	) {
		super(code, message, context);
		this.name = 'ProviderError';
	}
}

export class SecurityError extends ABFError {
	constructor(
		code: Extract<
			ABFErrorCode,
			| 'BOUNDS_VIOLATION'
			| 'ACTION_FORBIDDEN'
			| 'APPROVAL_REQUIRED'
			| 'COST_LIMIT_EXCEEDED'
			| 'INJECTION_DETECTED'
		>,
		message: string,
		context?: Record<string, unknown>,
	) {
		super(code, message, context);
		this.name = 'SecurityError';
	}
}

export class ToolError extends ABFError {
	constructor(
		code: Extract<ABFErrorCode, 'TOOL_NOT_FOUND' | 'TOOL_EXECUTION_FAILED' | 'TOOL_TIMEOUT'>,
		message: string,
		context?: Record<string, unknown>,
	) {
		super(code, message, context);
		this.name = 'ToolError';
	}
}

export class MemoryError extends ABFError {
	constructor(
		code: Extract<
			ABFErrorCode,
			'MEMORY_READ_FAILED' | 'MEMORY_WRITE_FAILED' | 'MEMORY_INTEGRITY_FAILED'
		>,
		message: string,
		context?: Record<string, unknown>,
	) {
		super(code, message, context);
		this.name = 'MemoryError';
	}
}

// ─── Result Type ──────────────────────────────────────────────────────
// Discriminated union for explicit error handling.
// Use Ok() and Err() factories — never construct directly.

export type Result<T, E extends ABFError = ABFError> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E };

export function Ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}

export function Err<E extends ABFError>(error: E): Result<never, E> {
	return { ok: false, error };
}

/** Unwrap a Result, throwing on error. Use only when failure is unrecoverable. */
export function unwrap<T, E extends ABFError>(result: Result<T, E>): T {
	if (result.ok) return result.value;
	throw result.error;
}

/** Map the success value of a Result. */
export function mapResult<T, U, E extends ABFError>(
	result: Result<T, E>,
	fn: (value: T) => U,
): Result<U, E> {
	if (result.ok) return Ok(fn(result.value));
	return result;
}

/** Chain Results (flatMap). */
export function flatMapResult<T, U, E extends ABFError>(
	result: Result<T, E>,
	fn: (value: T) => Result<U, E>,
): Result<U, E> {
	if (result.ok) return fn(result.value);
	return result;
}
