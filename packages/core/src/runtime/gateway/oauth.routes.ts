/**
 * OAuth routes — handles OAuth PKCE flows for providers (OpenRouter, Slack, Discord, Gmail).
 *
 * GET  /auth/oauth/:provider/start    — redirect to provider's authorization URL
 * GET  /auth/oauth/:provider/callback  — handle callback, store token in vault
 * GET  /auth/oauth/:provider/status    — check if OAuth token exists
 */

import type { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { ICredentialVault } from '../../credentials/vault.js';
import { escapeHtml } from './auth-utils.js';

// ─── Provider OAuth configs ────────────────────────────────────────

interface OAuthProviderConfig {
	readonly name: string;
	readonly authorizationUrl: string;
	readonly callbackPath: string;
	readonly keyExtractionMode: 'query_code' | 'query_key';
}

const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
	openrouter: {
		name: 'OpenRouter',
		authorizationUrl: 'https://openrouter.ai/auth',
		callbackPath: '/auth/oauth/openrouter/callback',
		keyExtractionMode: 'query_key',
	},
	slack: {
		name: 'Slack',
		authorizationUrl: 'https://slack.com/oauth/v2/authorize',
		callbackPath: '/auth/oauth/slack/callback',
		keyExtractionMode: 'query_code',
	},
	discord: {
		name: 'Discord',
		authorizationUrl: 'https://discord.com/api/oauth2/authorize',
		callbackPath: '/auth/oauth/discord/callback',
		keyExtractionMode: 'query_code',
	},
	google: {
		name: 'Google',
		authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
		callbackPath: '/auth/oauth/google/callback',
		keyExtractionMode: 'query_code',
	},
};

// ─── State store (in-memory, short-lived CSRF tokens) ───────────

const pendingStates = new Map<string, { provider: string; createdAt: number }>();

// Clean up expired states (5 minute TTL)
function cleanupStates(): void {
	const now = Date.now();
	for (const [key, val] of pendingStates) {
		if (now - val.createdAt > 300_000) pendingStates.delete(key);
	}
}

// ─── Route registration ─────────────────────────────────────────

export interface OAuthRoutesDeps {
	readonly vault: ICredentialVault;
	readonly dashboardPort?: number | undefined;
}

export function registerOAuthRoutes(app: Hono, deps: OAuthRoutesDeps): void {
	// GET /auth/oauth/:provider/start — initiate OAuth flow
	app.get('/auth/oauth/:provider/start', (c) => {
		const provider = c.req.param('provider');
		const config = OAUTH_PROVIDERS[provider];
		if (!config) {
			return c.json({ error: 'Unknown OAuth provider' }, 400);
		}

		cleanupStates();

		const state = nanoid(32);
		pendingStates.set(state, { provider, createdAt: Date.now() });

		// Determine callback URL
		const host = c.req.header('host') ?? 'localhost:3457';
		const protocol = c.req.header('x-forwarded-proto') ?? 'http';
		const callbackUrl = `${protocol}://${host}${config.callbackPath}`;

		if (provider === 'openrouter') {
			// OpenRouter uses a simple auth page, not standard OAuth
			// Include state parameter for CSRF protection
			const authUrl = `${config.authorizationUrl}?callback_url=${encodeURIComponent(callbackUrl)}&state=${state}`;
			return c.redirect(authUrl);
		}

		if (provider === 'slack') {
			const clientId = process.env['SLACK_CLIENT_ID'] ?? '';
			const scopes = 'chat:write,channels:read,app_mentions:read,im:read,im:write';
			const authUrl = `${config.authorizationUrl}?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${state}`;
			return c.redirect(authUrl);
		}

		if (provider === 'discord') {
			const clientId = process.env['DISCORD_CLIENT_ID'] ?? '';
			const scopes = 'bot';
			const permissions = '2048'; // Send Messages
			const authUrl = `${config.authorizationUrl}?client_id=${clientId}&scope=${scopes}&permissions=${permissions}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&state=${state}`;
			return c.redirect(authUrl);
		}

		if (provider === 'google') {
			const clientId = process.env['GOOGLE_CLIENT_ID'] ?? '';
			const scopes = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets';
			const authUrl = `${config.authorizationUrl}?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&state=${state}`;
			return c.redirect(authUrl);
		}

		return c.json({ error: 'OAuth flow not implemented for this provider yet' }, 501);
	});

	// GET /auth/oauth/:provider/callback — handle OAuth redirect
	app.get('/auth/oauth/:provider/callback', async (c) => {
		const provider = c.req.param('provider');
		const config = OAUTH_PROVIDERS[provider];
		if (!config) {
			return c.html(errorPage('Unknown provider'));
		}

		if (provider === 'openrouter') {
			// Validate CSRF state parameter
			const orState = c.req.query('state');
			if (!orState) {
				return c.html(errorPage('Missing state parameter — possible CSRF attack'));
			}
			const orPendingState = pendingStates.get(orState);
			if (!orPendingState || orPendingState.provider !== provider) {
				return c.html(errorPage('Invalid state parameter — possible CSRF attack'));
			}
			pendingStates.delete(orState);

			// OpenRouter returns the API key directly in the URL
			const code = c.req.query('code');
			if (!code) {
				return c.html(errorPage('No API key received from OpenRouter'));
			}

			// Store the key in vault
			await deps.vault.set('openrouter', 'api_key', code);
			console.log(`[oauth] openrouter credential stored at=${new Date().toISOString()}`);

			// Redirect to dashboard
			const dashboardUrl = deps.dashboardPort
				? `http://localhost:${deps.dashboardPort}/setup?oauth=success&provider=openrouter`
				: '/setup?oauth=success&provider=openrouter';

			return c.html(successPage(dashboardUrl));
		}

		// Validate CSRF state parameter for standard OAuth flows
		const state = c.req.query('state');
		if (!state) {
			return c.html(errorPage('Missing state parameter — possible CSRF attack'));
		}
		const pendingState = pendingStates.get(state);
		if (!pendingState || pendingState.provider !== provider) {
			return c.html(errorPage('Invalid state parameter — possible CSRF attack'));
		}
		pendingStates.delete(state);

		// Standard OAuth code exchange for Slack, Discord, Google
		const code = c.req.query('code');
		if (!code) {
			return c.html(errorPage('No authorization code received'));
		}

		const host = c.req.header('host') ?? 'localhost:3457';
		const protocol = c.req.header('x-forwarded-proto') ?? 'http';
		const callbackUrl = `${protocol}://${host}${config.callbackPath}`;

		try {
			const { OAuthEngine } = await import('../../auth/oauth-engine.js');
			const engine = new OAuthEngine(deps.vault);

			const providerDef = {
				name: config.name,
				authorizationUrl: config.authorizationUrl,
				tokenUrl: getTokenUrl(provider),
				clientId: process.env[`${provider.toUpperCase()}_CLIENT_ID`] ?? '',
				clientSecret: process.env[`${provider.toUpperCase()}_CLIENT_SECRET`] ?? '',
				scopes: [],
				callbackPath: config.callbackPath,
			};

			const tokens = await engine.exchangeCode(providerDef, code, callbackUrl);

			if (tokens.accessToken) {
				await engine.storeTokens(provider, tokens);
				// Also store as channel credential for channel router
				await deps.vault.set('channel', provider, JSON.stringify({ token: tokens.accessToken }));
				console.log(`[oauth] ${provider} credential stored at=${new Date().toISOString()}`);
			}

			const dashboardUrl = deps.dashboardPort
				? `http://localhost:${deps.dashboardPort}/channels?oauth=success&provider=${provider}`
				: `/channels?oauth=success&provider=${provider}`;
			return c.html(successPage(dashboardUrl));
		} catch (err) {
			return c.html(errorPage(`Token exchange failed: ${err instanceof Error ? err.message : String(err)}`));
		}
	});

	// GET /auth/oauth/:provider/status — check if token exists
	app.get('/auth/oauth/:provider/status', async (c) => {
		const provider = c.req.param('provider');
		const key = await deps.vault.get(provider, 'api_key');
		return c.json({ connected: Boolean(key), provider });
	});
}

function successPage(redirectUrl: string): string {
	// Validate redirect URL — only allow relative paths or localhost origins
	const safeUrl = isAllowedRedirect(redirectUrl) ? escapeHtml(redirectUrl) : '/';
	return `<!DOCTYPE html>
<html><head><title>Connected!</title></head>
<body style="background:#0f172a;color:#f1f5f9;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center">
<h1 style="color:#38bdf8">Connected!</h1>
<p>Your provider has been connected. Redirecting...</p>
<script>setTimeout(()=>window.location.href='${safeUrl}',1500)</script>
</div>
</body></html>`;
}

/** Only allow relative paths or localhost URLs as redirects. */
function isAllowedRedirect(url: string): boolean {
	if (url.startsWith('/') && !url.startsWith('//')) return true;
	try {
		const parsed = new URL(url);
		return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
	} catch {
		return false;
	}
}

function getTokenUrl(provider: string): string {
	switch (provider) {
		case 'slack': return 'https://slack.com/api/oauth.v2.access';
		case 'discord': return 'https://discord.com/api/oauth2/token';
		case 'google': return 'https://oauth2.googleapis.com/token';
		default: return '';
	}
}

function errorPage(message: string): string {
	const safeMessage = escapeHtml(message);
	return `<!DOCTYPE html>
<html><head><title>Error</title></head>
<body style="background:#0f172a;color:#f1f5f9;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center">
<h1 style="color:#f87171">Connection Failed</h1>
<p>${safeMessage}</p>
<p><a href="/" style="color:#38bdf8">Return to Dashboard</a></p>
</div>
</body></html>`;
}
