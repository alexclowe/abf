/**
 * Tests for provider presets — validates all preset configs are well-formed.
 */

import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS, getPreset, getPresetSlugs } from './presets.js';

describe('PROVIDER_PRESETS', () => {
	it('contains 5 presets', () => {
		expect(Object.keys(PROVIDER_PRESETS).length).toBe(5);
	});

	it('all presets have required fields', () => {
		for (const [slug, config] of Object.entries(PROVIDER_PRESETS)) {
			expect(config.id, `${slug}.id`).toBeTruthy();
			expect(config.name, `${slug}.name`).toBeTruthy();
			expect(config.slug, `${slug}.slug`).toBe(slug);
			expect(config.baseUrl, `${slug}.baseUrl`).toMatch(/^https:\/\//);
			expect(config.authType, `${slug}.authType`).toBe('api_key');
			expect(config.envVar, `${slug}.envVar`).toMatch(/_API_KEY$/);
		}
	});

	it('moonshot preset has Kimi K2.5 model with pricing', () => {
		const moonshot = PROVIDER_PRESETS['moonshot']!;
		expect(moonshot.defaultModel).toBe('kimi-k2.5');
		expect(moonshot.models).toBeDefined();
		expect(moonshot.models!.length).toBeGreaterThan(0);

		const kimi = moonshot.models![0]!;
		expect(kimi.id).toBe('kimi-k2.5');
		expect(kimi.supportsTools).toBe(true);
		expect(kimi.costPerInputToken).toBeGreaterThan(0);
		expect(kimi.costPerOutputToken).toBeGreaterThan(0);
	});

	it('deepseek preset has chat and reasoner models', () => {
		const deepseek = PROVIDER_PRESETS['deepseek']!;
		expect(deepseek.models!.length).toBe(2);
		expect(deepseek.models!.map((m) => m.id)).toContain('deepseek-chat');
		expect(deepseek.models!.map((m) => m.id)).toContain('deepseek-reasoner');
	});

	it('openrouter preset has extra headers', () => {
		const openrouter = PROVIDER_PRESETS['openrouter']!;
		expect(openrouter.headers).toBeDefined();
		expect(openrouter.headers!['HTTP-Referer']).toBeTruthy();
	});

	it('openrouter preset has no static models (fetches dynamically)', () => {
		const openrouter = PROVIDER_PRESETS['openrouter']!;
		expect(openrouter.models).toBeUndefined();
	});
});

describe('getPreset()', () => {
	it('returns config for known slugs', () => {
		expect(getPreset('moonshot')?.name).toBe('Moonshot AI');
		expect(getPreset('deepseek')?.name).toBe('DeepSeek');
		expect(getPreset('groq')?.name).toBe('Groq');
		expect(getPreset('together')?.name).toBe('Together AI');
		expect(getPreset('openrouter')?.name).toBe('OpenRouter');
	});

	it('returns undefined for unknown slugs', () => {
		expect(getPreset('unknown')).toBeUndefined();
		expect(getPreset('')).toBeUndefined();
	});
});

describe('getPresetSlugs()', () => {
	it('returns all preset slugs', () => {
		const slugs = getPresetSlugs();
		expect(slugs).toContain('moonshot');
		expect(slugs).toContain('deepseek');
		expect(slugs).toContain('groq');
		expect(slugs).toContain('together');
		expect(slugs).toContain('openrouter');
		expect(slugs.length).toBe(5);
	});
});
