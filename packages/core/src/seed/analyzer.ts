/**
 * Seed document analyzer — the core LLM-powered analysis engine.
 *
 * Reads a seed document (free-form text describing a business) and produces
 * a structured CompanyPlan via LLM analysis. Also supports re-analysis when
 * the seed document is updated (seed versioning).
 */

import type { IProviderRegistry } from '../types/provider.js';
import type { ChatMessage, ChatRequest } from '../types/provider.js';
import type { CompanyPlan } from './types.js';
import { ANALYZER_SYSTEM_PROMPT, REANALYZE_SYSTEM_PROMPT } from './prompts.js';

// ─── Options ────────────────────────────────────────────────────────

export interface AnalyzerOptions {
	/** LLM provider id (e.g. 'anthropic'). */
	provider: string;
	/** Model id (e.g. 'claude-sonnet-4-5'). */
	model: string;
	/** The extracted text from the seed document. */
	seedText: string;
	/** Maximum retries for JSON parsing failures. Default: 2. */
	maxRetries?: number;
}

export interface ReanalyzeOptions extends AnalyzerOptions {
	/** The original seed text (before edits). */
	originalSeedText: string;
	/** The current company plan to update. */
	currentPlan: CompanyPlan;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Collect all text chunks from a provider chat stream into a single string.
 * Throws on error chunks.
 */
async function collectChatResponse(
	stream: AsyncIterable<import('../types/provider.js').ChatChunk>,
): Promise<string> {
	let response = '';
	for await (const chunk of stream) {
		if (chunk.type === 'text') {
			response += chunk.text;
		} else if (chunk.type === 'error') {
			throw new Error(`LLM error: ${chunk.error ?? 'unknown error'}`);
		}
	}
	return response;
}

/**
 * Extract JSON from a response string. Handles cases where the LLM wraps
 * the JSON in a markdown code fence (```json ... ```).
 */
function extractJSON(raw: string): string {
	const trimmed = raw.trim();

	// Strip markdown code fences if present
	const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
	if (fenceMatch?.[1] != null) {
		return fenceMatch[1].trim();
	}

	return trimmed;
}

/**
 * Validate that a parsed object has the required CompanyPlan fields
 * (before we add our metadata).
 */
function validatePlanShape(obj: unknown): boolean {
	if (typeof obj !== 'object' || obj === null) return false;
	const plan = obj as Record<string, unknown>;

	if (!plan['company'] || typeof plan['company'] !== 'object') return false;
	if (!Array.isArray(plan['agents']) || plan['agents'].length === 0) return false;
	if (!Array.isArray(plan['teams']) || plan['teams'].length === 0) return false;

	// Validate company has required fields
	const company = plan['company'] as Record<string, unknown>;
	if (typeof company['name'] !== 'string' || !company['name']) return false;
	if (typeof company['description'] !== 'string' || !company['description']) return false;

	return true;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Analyze a seed document and produce a company plan.
 *
 * Sends the seed text to an LLM with the analyzer system prompt,
 * parses the structured JSON response, and enriches it with metadata.
 * Retries on JSON parse failures.
 */
export async function analyzeSeedDoc(
	registry: IProviderRegistry,
	options: AnalyzerOptions,
): Promise<CompanyPlan> {
	const { provider: providerId, model, seedText, maxRetries = 2 } = options;

	const provider = registry.get(providerId as import('../types/common.js').ProviderId);
	if (!provider) {
		throw new Error(`Provider "${providerId}" not found in registry.`);
	}

	// Build the initial conversation
	const messages: ChatMessage[] = [
		{ role: 'system', content: ANALYZER_SYSTEM_PROMPT },
		{
			role: 'user',
			content: `Provider: ${providerId}\nModel: ${model}\n\n--- SEED DOCUMENT ---\n\n${seedText}`,
		},
	];

	const request: ChatRequest = {
		model,
		messages,
		temperature: 0.3,
		maxTokens: 16384,
	};

	let response = await collectChatResponse(provider.chat(request));
	let lastError: Error | null = null;

	// Try to parse, with retries on failure
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const json = extractJSON(response);
			const parsed = JSON.parse(json);

			if (!validatePlanShape(parsed)) {
				throw new Error(
					'Invalid company plan: missing required fields (company, agents[], teams[]).',
				);
			}

			// Add metadata fields
			const plan: CompanyPlan = {
				...parsed,
				generatedAt: new Date().toISOString(),
				seedVersion: 1,
				seedText,
			};

			return plan;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));

			if (attempt < maxRetries) {
				// Ask the LLM to fix its JSON
				const retryMessages: ChatMessage[] = [
					...messages,
					{ role: 'assistant', content: response },
					{
						role: 'user',
						content: `Your response was not valid JSON. Error: ${lastError.message}\n\nPlease respond with ONLY valid JSON matching the schema. No markdown fences, no explanation — just the JSON object.`,
					},
				];

				const retryRequest: ChatRequest = {
					model,
					messages: retryMessages,
					temperature: 0.2,
					maxTokens: 16384,
				};

				response = await collectChatResponse(provider.chat(retryRequest));
			}
		}
	}

	throw new Error(
		`Failed to parse company plan after ${maxRetries + 1} attempts. Last error: ${lastError?.message}`,
	);
}

/**
 * Re-analyze an updated seed document against the current plan.
 *
 * Used for seed doc versioning: when a user edits their seed document,
 * this produces an updated plan that preserves existing structure where
 * possible and focuses on the delta.
 */
export async function reanalyzeSeedDoc(
	registry: IProviderRegistry,
	options: ReanalyzeOptions,
): Promise<CompanyPlan> {
	const {
		provider: providerId,
		model,
		seedText,
		originalSeedText,
		currentPlan,
		maxRetries = 2,
	} = options;

	const provider = registry.get(providerId as import('../types/common.js').ProviderId);
	if (!provider) {
		throw new Error(`Provider "${providerId}" not found in registry.`);
	}

	const userContent = [
		`Provider: ${providerId}`,
		`Model: ${model}`,
		'',
		'--- ORIGINAL SEED DOCUMENT ---',
		'',
		originalSeedText,
		'',
		'--- UPDATED SEED DOCUMENT ---',
		'',
		seedText,
		'',
		'--- CURRENT COMPANY PLAN ---',
		'',
		JSON.stringify(currentPlan, null, 2),
	].join('\n');

	const messages: ChatMessage[] = [
		{ role: 'system', content: REANALYZE_SYSTEM_PROMPT },
		{ role: 'user', content: userContent },
	];

	const request: ChatRequest = {
		model,
		messages,
		temperature: 0.3,
		maxTokens: 16384,
	};

	let response = await collectChatResponse(provider.chat(request));
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const json = extractJSON(response);
			const parsed = JSON.parse(json);

			if (!validatePlanShape(parsed)) {
				throw new Error(
					'Invalid company plan: missing required fields (company, agents[], teams[]).',
				);
			}

			// Add metadata — increment seedVersion
			const plan: CompanyPlan = {
				...parsed,
				generatedAt: new Date().toISOString(),
				seedVersion: currentPlan.seedVersion + 1,
				seedText,
			};

			return plan;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));

			if (attempt < maxRetries) {
				const retryMessages: ChatMessage[] = [
					...messages,
					{ role: 'assistant', content: response },
					{
						role: 'user',
						content: `Your response was not valid JSON. Error: ${lastError.message}\n\nPlease respond with ONLY valid JSON matching the schema. No markdown fences, no explanation — just the JSON object.`,
					},
				];

				const retryRequest: ChatRequest = {
					model,
					messages: retryMessages,
					temperature: 0.2,
					maxTokens: 16384,
				};

				response = await collectChatResponse(provider.chat(retryRequest));
			}
		}
	}

	throw new Error(
		`Failed to parse updated company plan after ${maxRetries + 1} attempts. Last error: ${lastError?.message}`,
	);
}
