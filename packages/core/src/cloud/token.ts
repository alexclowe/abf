/**
 * ABF Cloud Token System — generate, validate, and manage API tokens.
 *
 * Token format: abf_live_<32chars> (production) / abf_test_<32chars> (test)
 */

import { randomBytes, createHash } from 'node:crypto';
import type { ISOTimestamp } from '../types/common.js';
import { toISOTimestamp } from '../util/id.js';

export interface CloudToken {
	/** The hashed token (never store raw tokens). */
	readonly tokenHash: string;
	/** Token prefix for identification (first 12 chars). */
	readonly tokenPrefix: string;
	/** Display label set by the user. */
	readonly label: string;
	/** Whether this is a test or live token. */
	readonly mode: 'live' | 'test';
	/** Account/organization ID. */
	readonly accountId: string;
	/** When the token was created. */
	readonly createdAt: ISOTimestamp;
	/** When the token was last used. */
	lastUsedAt: ISOTimestamp | null;
	/** Whether the token is active. */
	active: boolean;
	/** Rate limit: requests per minute. */
	readonly rateLimit: number;
}

export interface TokenValidationResult {
	readonly valid: boolean;
	readonly token?: CloudToken;
	readonly reason?: string;
}

export interface ITokenStore {
	/** Store a new token. */
	create(token: CloudToken): Promise<void>;
	/** Look up a token by its hash. */
	getByHash(tokenHash: string): Promise<CloudToken | null>;
	/** List all tokens for an account. */
	listByAccount(accountId: string): Promise<readonly CloudToken[]>;
	/** Revoke a token. */
	revoke(tokenHash: string): Promise<boolean>;
	/** Update last-used timestamp. */
	touch(tokenHash: string): Promise<void>;
}

/** Hash a raw token for storage. */
export function hashToken(rawToken: string): string {
	return createHash('sha256').update(rawToken).digest('hex');
}

/** Generate a new ABF Cloud token. Returns both the raw token (show once) and metadata. */
export function generateToken(
	accountId: string,
	label: string,
	mode: 'live' | 'test' = 'live',
	rateLimit = 60,
): { rawToken: string; token: CloudToken } {
	const prefix = mode === 'live' ? 'abf_live_' : 'abf_test_';
	const random = randomBytes(24).toString('base64url'); // 32 chars
	const rawToken = `${prefix}${random}`;

	const token: CloudToken = {
		tokenHash: hashToken(rawToken),
		tokenPrefix: rawToken.slice(0, 12),
		label,
		mode,
		accountId,
		createdAt: toISOTimestamp(),
		lastUsedAt: null,
		active: true,
		rateLimit,
	};

	return { rawToken, token };
}

/** Validate a raw token against the store. */
export async function validateToken(
	rawToken: string,
	store: ITokenStore,
): Promise<TokenValidationResult> {
	if (!rawToken.startsWith('abf_live_') && !rawToken.startsWith('abf_test_')) {
		return { valid: false, reason: 'Invalid token format' };
	}

	const hash = hashToken(rawToken);
	const token = await store.getByHash(hash);

	if (!token) {
		return { valid: false, reason: 'Token not found' };
	}

	if (!token.active) {
		return { valid: false, reason: 'Token revoked' };
	}

	// Update last used timestamp (fire-and-forget)
	void store.touch(hash);

	return { valid: true, token };
}

/**
 * In-memory token store for development / self-hosted use.
 */
export class InMemoryTokenStore implements ITokenStore {
	private readonly tokens = new Map<string, CloudToken>();

	async create(token: CloudToken): Promise<void> {
		this.tokens.set(token.tokenHash, token);
	}

	async getByHash(tokenHash: string): Promise<CloudToken | null> {
		return this.tokens.get(tokenHash) ?? null;
	}

	async listByAccount(accountId: string): Promise<readonly CloudToken[]> {
		return [...this.tokens.values()].filter((t) => t.accountId === accountId);
	}

	async revoke(tokenHash: string): Promise<boolean> {
		const token = this.tokens.get(tokenHash);
		if (!token) return false;
		token.active = false;
		return true;
	}

	async touch(tokenHash: string): Promise<void> {
		const token = this.tokens.get(tokenHash);
		if (token) {
			token.lastUsedAt = toISOTimestamp();
		}
	}
}
