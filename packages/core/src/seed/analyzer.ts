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
 *
 * If a buildPlan is present but malformed, it is stripped with a
 * console warning rather than failing the entire validation.
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

	// Validate buildPlan if present (optional — strip if malformed)
	if (plan['buildPlan'] != null) {
		if (!validateBuildPlanShape(plan['buildPlan'], plan['agents'] as Array<Record<string, unknown>>)) {
			console.warn('[seed-analyzer] buildPlan is malformed and will be removed from the plan.');
			delete plan['buildPlan'];
		}
	}

	return true;
}

/**
 * Validate the shape of a buildPlan object.
 * Returns false if the plan is malformed (caller should strip it).
 */
function validateBuildPlanShape(
	buildPlan: unknown,
	agents: Array<Record<string, unknown>>,
): boolean {
	if (typeof buildPlan !== 'object' || buildPlan === null) return false;
	const bp = buildPlan as Record<string, unknown>;

	// Must have goal and at least one phase
	if (typeof bp['goal'] !== 'string' || !bp['goal']) return false;
	if (!Array.isArray(bp['phases']) || bp['phases'].length === 0) return false;

	// Collect known agent names for cross-validation
	const agentNames = new Set(agents.map((a) => a['name'] as string));

	for (const phase of bp['phases'] as Array<Record<string, unknown>>) {
		if (typeof phase['id'] !== 'string' || !phase['id']) return false;
		if (!Array.isArray(phase['steps']) || phase['steps'].length === 0) return false;

		for (const step of phase['steps'] as Array<Record<string, unknown>>) {
			if (typeof step['id'] !== 'string' || !step['id']) return false;
			if (typeof step['agent'] !== 'string' || !step['agent']) return false;

			// Warn (but don't fail) if step references an unknown agent
			if (!agentNames.has(step['agent'] as string)) {
				console.warn(
					`[seed-analyzer] buildPlan step "${step['id']}" references unknown agent "${step['agent']}".`,
				);
			}
		}
	}

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
