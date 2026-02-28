/**
 * OAuth Engine — reusable OAuth 2.0 handler for messaging platform connections.
 * Manages authorization URLs, code exchange, and token storage.
 */

import type { ICredentialVault } from '../credentials/vault.js';

export interface OAuthProviderDef {
	readonly name: string;
	readonly authorizationUrl: string;
	readonly tokenUrl: string;
	readonly clientId: string;
	readonly clientSecret: string;
	readonly scopes: readonly string[];
	readonly callbackPath: string;
}

export interface OAuthTokenResponse {
	readonly accessToken: string;
	readonly refreshToken?: string | undefined;
	readonly expiresIn?: number | undefined;
	readonly tokenType?: string | undefined;
	readonly scope?: string | undefined;
	readonly extra?: Record<string, unknown> | undefined;
}

export class OAuthEngine {
	constructor(private readonly vault: ICredentialVault) {}

	/**
	 * Generate the authorization URL for a provider.
	 */
	getAuthorizationUrl(
		provider: OAuthProviderDef,
		callbackUrl: string,
		state: string,
	): string {
		const params = new URLSearchParams({
			client_id: provider.clientId,
			redirect_uri: callbackUrl,
			response_type: 'code',
			scope: provider.scopes.join(' '),
			state,
		});

		return `${provider.authorizationUrl}?${params.toString()}`;
	}

	/**
	 * Exchange an authorization code for tokens.
	 */
	async exchangeCode(
		provider: OAuthProviderDef,
		code: string,
		callbackUrl: string,
	): Promise<OAuthTokenResponse> {
		const params = new URLSearchParams({
			client_id: provider.clientId,
			client_secret: provider.clientSecret,
			code,
			redirect_uri: callbackUrl,
			grant_type: 'authorization_code',
		});

		const res = await fetch(provider.tokenUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: params.toString(),
		});

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Token exchange failed: ${res.status} ${text}`);
		}

		const data = (await res.json()) as Record<string, unknown>;

		return {
			accessToken: (data['access_token'] as string) ?? (data['authed_user'] as Record<string, unknown>)?.['access_token'] as string ?? '',
			refreshToken: (data['refresh_token'] as string | undefined) ?? undefined,
			expiresIn: (data['expires_in'] as number | undefined) ?? undefined,
			tokenType: (data['token_type'] as string | undefined) ?? undefined,
			scope: (data['scope'] as string | undefined) ?? undefined,
			extra: data,
		};
	}

	/**
	 * Store OAuth tokens in the vault.
	 */
	async storeTokens(providerSlug: string, tokens: OAuthTokenResponse): Promise<void> {
		await this.vault.set(providerSlug, 'oauth_token', JSON.stringify({
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			expiresIn: tokens.expiresIn,
			storedAt: Date.now(),
		}));
	}

	/**
	 * Retrieve stored OAuth tokens.
	 */
	async getTokens(providerSlug: string): Promise<OAuthTokenResponse | null> {
		const raw = await this.vault.get(providerSlug, 'oauth_token');
		if (!raw) return null;
		try {
			return JSON.parse(raw) as OAuthTokenResponse;
		} catch {
			return null;
		}
	}

	/**
	 * Refresh an expired token using the refresh_token grant.
	 */
	async refreshToken(provider: OAuthProviderDef, refreshToken: string): Promise<OAuthTokenResponse> {
		const params = new URLSearchParams({
			client_id: provider.clientId,
			client_secret: provider.clientSecret,
			refresh_token: refreshToken,
			grant_type: 'refresh_token',
		});

		const res = await fetch(provider.tokenUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: params.toString(),
		});

		if (!res.ok) {
			throw new Error(`Token refresh failed: ${res.status}`);
		}

		const data = (await res.json()) as Record<string, unknown>;

		return {
			accessToken: data['access_token'] as string ?? '',
			refreshToken: (data['refresh_token'] as string | undefined) ?? refreshToken,
			expiresIn: (data['expires_in'] as number | undefined) ?? undefined,
		};
	}
}
