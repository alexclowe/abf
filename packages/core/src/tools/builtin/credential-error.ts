/**
 * credential-error -- deployment-aware credential error messages.
 * Returns structured metadata that tools spread into their Ok() response.
 * The `authRequired` object lets the dashboard render a "Connect" button.
 */

export interface CredentialHint {
	/** Provider slug used in `abf auth <provider>`. */
	provider: string;
	/** Environment variable name (e.g. 'GITHUB_TOKEN'). */
	envVar: string;
	/** Dashboard path for the integrations page. */
	dashboardPath: string;
	/** Human-friendly provider name (e.g. 'GitHub'). */
	displayName: string;
}

/**
 * Build a deployment-aware credential error response.
 *
 * - **Cloud mode**: directs operators to the dashboard integrations page.
 * - **Self-hosted mode**: directs builders to env vars / `abf auth`.
 *
 * Returns a plain object that tools spread into their `Ok()` payload.
 */
export function credentialError(
	isCloud: boolean,
	hint: CredentialHint,
): Record<string, unknown> {
	const message = isCloud
		? `${hint.displayName} is not connected. Go to Settings \u2192 Integrations to connect your ${hint.displayName} account.`
		: `${hint.displayName} credentials not found. Set ${hint.envVar} via environment variable or run: abf auth ${hint.provider}`;

	return {
		error: message,
		authRequired: {
			provider: hint.provider,
			dashboardPath: hint.dashboardPath,
			isCloud,
		},
	};
}
