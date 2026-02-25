/**
 * Provider registry — manages LLM providers.
 */

import type { ProviderId } from '../types/common.js';
import type { IProvider, IProviderRegistry } from '../types/provider.js';

export class ProviderRegistry implements IProviderRegistry {
	private readonly providers = new Map<string, IProvider>();
	private readonly slugIndex = new Map<string, IProvider>();

	register(provider: IProvider): void {
		this.providers.set(provider.id, provider);
		this.slugIndex.set(provider.slug, provider);
	}

	get(id: ProviderId): IProvider | undefined {
		return this.providers.get(id);
	}

	getBySlug(slug: string): IProvider | undefined {
		return this.slugIndex.get(slug);
	}

	getAll(): readonly IProvider[] {
		return [...this.providers.values()];
	}
}
