/**
 * Built-in provider presets for popular OpenAI-compatible APIs.
 *
 * Each preset is a complete OpenAICompatConfig ready to instantiate.
 * Presets are registered automatically in factory.ts — agents reference
 * them via `provider: moonshot` (or deepseek, groq, together, openrouter).
 */

import type { OpenAICompatConfig } from './adapters/openai-compat.js';

export const PROVIDER_PRESETS: Readonly<Record<string, OpenAICompatConfig>> = {
	moonshot: {
		id: 'moonshot',
		name: 'Moonshot AI',
		slug: 'moonshot',
		baseUrl: 'https://api.moonshot.cn/v1',
		authType: 'api_key',
		envVar: 'MOONSHOT_API_KEY',
		defaultModel: 'kimi-k2.5',
		models: [
			{
				id: 'kimi-k2.5',
				name: 'Kimi K2.5',
				contextWindow: 131_072,
				maxOutputTokens: 8192,
				supportsTools: true,
				supportsStreaming: true,
				costPerInputToken: 0.0000006,
				costPerOutputToken: 0.000003,
			},
		],
	},

	deepseek: {
		id: 'deepseek',
		name: 'DeepSeek',
		slug: 'deepseek',
		baseUrl: 'https://api.deepseek.com/v1',
		authType: 'api_key',
		envVar: 'DEEPSEEK_API_KEY',
		defaultModel: 'deepseek-chat',
		models: [
			{
				id: 'deepseek-chat',
				name: 'DeepSeek V3',
				contextWindow: 128_000,
				maxOutputTokens: 8192,
				supportsTools: true,
				supportsStreaming: true,
				costPerInputToken: 0.00000027,
				costPerOutputToken: 0.0000011,
			},
			{
				id: 'deepseek-reasoner',
				name: 'DeepSeek R1',
				contextWindow: 128_000,
				maxOutputTokens: 8192,
				supportsTools: false,
				supportsStreaming: true,
				costPerInputToken: 0.00000055,
				costPerOutputToken: 0.0000022,
			},
		],
	},

	groq: {
		id: 'groq',
		name: 'Groq',
		slug: 'groq',
		baseUrl: 'https://api.groq.com/openai/v1',
		authType: 'api_key',
		envVar: 'GROQ_API_KEY',
		models: [
			{
				id: 'llama-3.3-70b-versatile',
				name: 'Llama 3.3 70B',
				contextWindow: 128_000,
				maxOutputTokens: 32_768,
				supportsTools: true,
				supportsStreaming: true,
				costPerInputToken: 0.00000059,
				costPerOutputToken: 0.00000079,
			},
			{
				id: 'mixtral-8x7b-32768',
				name: 'Mixtral 8x7B',
				contextWindow: 32_768,
				maxOutputTokens: 32_768,
				supportsTools: true,
				supportsStreaming: true,
				costPerInputToken: 0.00000024,
				costPerOutputToken: 0.00000024,
			},
		],
	},

	together: {
		id: 'together',
		name: 'Together AI',
		slug: 'together',
		baseUrl: 'https://api.together.xyz/v1',
		authType: 'api_key',
		envVar: 'TOGETHER_API_KEY',
		models: [
			{
				id: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
				name: 'Llama 3.1 70B Turbo',
				contextWindow: 131_072,
				maxOutputTokens: 4096,
				supportsTools: true,
				supportsStreaming: true,
				costPerInputToken: 0.00000088,
				costPerOutputToken: 0.00000088,
			},
			{
				id: 'Qwen/Qwen2.5-72B-Instruct-Turbo',
				name: 'Qwen 2.5 72B Turbo',
				contextWindow: 131_072,
				maxOutputTokens: 4096,
				supportsTools: true,
				supportsStreaming: true,
				costPerInputToken: 0.0000012,
				costPerOutputToken: 0.0000012,
			},
		],
	},

	openrouter: {
		id: 'openrouter',
		name: 'OpenRouter',
		slug: 'openrouter',
		baseUrl: 'https://openrouter.ai/api/v1',
		authType: 'api_key',
		envVar: 'OPENROUTER_API_KEY',
		headers: {
			'HTTP-Referer': 'https://github.com/alexclowe/abf',
		},
		// OpenRouter has 300+ models — fetch dynamically via /v1/models
	},
};

/** Look up a preset by slug. Returns undefined if not found. */
export function getPreset(slug: string): OpenAICompatConfig | undefined {
	return PROVIDER_PRESETS[slug];
}

/** All preset slugs. */
export function getPresetSlugs(): readonly string[] {
	return Object.keys(PROVIDER_PRESETS);
}
