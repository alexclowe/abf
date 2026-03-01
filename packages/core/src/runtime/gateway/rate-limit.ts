/**
 * Sliding-window rate limiter for gateway routes.
 * Per-IP tracking with configurable limits per endpoint group.
 */

/** Rate limit configuration per route group. */
export interface RateLimitConfig {
	/** Maximum requests per window. */
	readonly maxRequests: number;
	/** Window duration in milliseconds. */
	readonly windowMs: number;
}

/** Default rate limits by route pattern. */
export const RATE_LIMITS = {
	/** Standard API endpoints. */
	default: { maxRequests: 100, windowMs: 60_000 } as RateLimitConfig,
	/** Expensive endpoints (LLM calls, workflow runs). */
	expensive: { maxRequests: 10, windowMs: 60_000 } as RateLimitConfig,
} as const;

/** Expensive endpoint patterns that get stricter rate limiting. */
const EXPENSIVE_PATTERNS = [
	'/api/agents/',  // matches /api/agents/:id/run and /api/agents/:id/chat
	'/api/seed/analyze',
	'/api/workflows/',  // matches /api/workflows/:name/run
	'/api/agents/generate-charter',
];

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

const ipState = new Map<string, RateLimitEntry>();
const MAX_TRACKED_IPS = 10_000;

/** Prune expired entries to prevent unbounded growth. */
function prune(): void {
	if (ipState.size < MAX_TRACKED_IPS) return;
	const now = Date.now();
	for (const [key, entry] of ipState) {
		if (now > entry.resetAt) ipState.delete(key);
	}
}

/** Determine which rate limit config applies to a given path. */
function getLimit(path: string): RateLimitConfig {
	for (const pattern of EXPENSIVE_PATTERNS) {
		if (path.includes(pattern)) return RATE_LIMITS.expensive;
	}
	return RATE_LIMITS.default;
}

/**
 * Check and consume a rate limit token for the given IP and path.
 * Returns remaining requests, or -1 if rate limited.
 */
export function checkRateLimit(ip: string, path: string): { allowed: boolean; remaining: number; resetAt: number } {
	prune();
	const limit = getLimit(path);
	const key = `${ip}:${path.split('/').slice(0, 4).join('/')}`;
	const now = Date.now();

	const entry = ipState.get(key);
	if (!entry || now > entry.resetAt) {
		ipState.set(key, { count: 1, resetAt: now + limit.windowMs });
		return { allowed: true, remaining: limit.maxRequests - 1, resetAt: now + limit.windowMs };
	}

	if (entry.count >= limit.maxRequests) {
		return { allowed: false, remaining: 0, resetAt: entry.resetAt };
	}

	entry.count++;
	return { allowed: true, remaining: limit.maxRequests - entry.count, resetAt: entry.resetAt };
}
