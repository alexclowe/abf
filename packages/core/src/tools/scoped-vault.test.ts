import { describe, expect, it, vi } from 'vitest';
import { ScopedVault, deriveAllowedProviders } from './scoped-vault.js';
import type { ICredentialVault } from '../credentials/vault.js';

function createMockVault(data: Record<string, Record<string, string>> = {}): ICredentialVault {
	return {
		get: vi.fn(async (provider: string, key: string) => data[provider]?.[key]),
		set: vi.fn(async () => {}),
		delete: vi.fn(async () => {}),
		list: vi.fn(async () => Object.keys(data)),
	};
}

describe('ScopedVault', () => {
	it('allows get for permitted providers', async () => {
		const inner = createMockVault({ stripe: { api_key: 'sk_test_123' } });
		const scoped = new ScopedVault(inner, ['stripe']);

		const result = await scoped.get('stripe', 'api_key');
		expect(result).toBe('sk_test_123');
		expect(inner.get).toHaveBeenCalledWith('stripe', 'api_key');
	});

	it('returns undefined for denied provider get', async () => {
		const inner = createMockVault({ stripe: { api_key: 'sk_test_123' } });
		const onDenied = vi.fn();
		const scoped = new ScopedVault(inner, ['brave-search'], onDenied);

		const result = await scoped.get('stripe', 'api_key');
		expect(result).toBeUndefined();
		expect(inner.get).not.toHaveBeenCalled();
		expect(onDenied).toHaveBeenCalledWith('stripe', 'get');
	});

	it('allows set for any provider (tools can store own credentials)', async () => {
		const inner = createMockVault();
		const scoped = new ScopedVault(inner, ['brave-search']);

		await scoped.set('new-provider', 'token', 'abc');
		expect(inner.set).toHaveBeenCalledWith('new-provider', 'token', 'abc');
	});

	it('blocks delete for denied providers', async () => {
		const inner = createMockVault({ stripe: { api_key: 'sk_test_123' } });
		const onDenied = vi.fn();
		const scoped = new ScopedVault(inner, ['brave-search'], onDenied);

		await scoped.delete('stripe', 'api_key');
		expect(inner.delete).not.toHaveBeenCalled();
		expect(onDenied).toHaveBeenCalledWith('stripe', 'delete');
	});

	it('allows delete for permitted providers', async () => {
		const inner = createMockVault({ stripe: { api_key: 'sk_test_123' } });
		const scoped = new ScopedVault(inner, ['stripe']);

		await scoped.delete('stripe', 'api_key');
		expect(inner.delete).toHaveBeenCalledWith('stripe', 'api_key');
	});

	it('filters list to only allowed providers', async () => {
		const inner = createMockVault({
			stripe: { api_key: 'sk_123' },
			github: { token: 'gh_123' },
			'brave-search': { api_key: 'bsk_123' },
		});
		const scoped = new ScopedVault(inner, ['brave-search']);

		const result = await scoped.list();
		expect(result).toEqual(['brave-search']);
	});

	it('works with empty allowed providers', async () => {
		const inner = createMockVault({ stripe: { api_key: 'sk_123' } });
		const scoped = new ScopedVault(inner, []);

		expect(await scoped.get('stripe', 'api_key')).toBeUndefined();
		expect(await scoped.list()).toEqual([]);
	});
});

describe('deriveAllowedProviders', () => {
	it('maps tool IDs to credential providers', () => {
		const providers = deriveAllowedProviders(['web-search', 'stripe-billing']);
		expect(providers).toContain('brave-search');
		expect(providers).toContain('stripe');
	});

	it('deduplicates providers', () => {
		const providers = deriveAllowedProviders(['code-generate', 'code-generate']);
		const unique = new Set(providers);
		expect(providers.length).toBe(unique.size);
	});

	it('returns empty for tools with no credential needs', () => {
		const providers = deriveAllowedProviders(['web-fetch', 'browse']);
		expect(providers).toEqual([]);
	});

	it('ignores unknown tool IDs', () => {
		const providers = deriveAllowedProviders(['unknown-tool', 'made-up']);
		expect(providers).toEqual([]);
	});

	it('merges multiple providers from email-send', () => {
		const providers = deriveAllowedProviders(['email-send']);
		expect(providers).toContain('google');
		expect(providers).toContain('resend');
	});
});
