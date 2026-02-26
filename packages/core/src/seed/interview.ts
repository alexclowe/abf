/**
 * Interview engine — a stateful conversation that gathers business requirements
 * and produces a seed document through guided Q&A.
 *
 * The engine conducts 8-12 questions, building on previous answers to understand
 * the business. Once complete, it generates a comprehensive seed document that
 * can be fed into the analyzer.
 */

import { nanoid } from 'nanoid';
import type { IProviderRegistry } from '../types/provider.js';
import type { ChatMessage, ChatRequest } from '../types/provider.js';
import type { InterviewSession, InterviewStep } from './types.js';
import { INTERVIEW_SYSTEM_PROMPT } from './prompts.js';

// ─── Constants ──────────────────────────────────────────────────────

/** Maximum number of questions before forcing completion. */
const MAX_QUESTIONS = 15;

/** Session expiry time in milliseconds (1 hour). */
const SESSION_EXPIRY_MS = 60 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Collect all text chunks from a provider chat stream into a single string.
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
 * Extract JSON from a response string, handling markdown code fences.
 */
function extractJSON(raw: string): string {
	const trimmed = raw.trim();
	const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
	if (fenceMatch?.[1] != null) {
		return fenceMatch[1].trim();
	}
	return trimmed;
}

/**
 * Parse an LLM response into an InterviewStep.
 * Validates the expected shape and provides defaults for missing fields.
 */
function parseInterviewResponse(raw: string): InterviewStep {
	const json = extractJSON(raw);
	const parsed = JSON.parse(json) as Record<string, unknown>;

	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error('Interview response is not an object.');
	}

	const complete = parsed['complete'] === true;
	const seedText = complete && typeof parsed['seedText'] === 'string'
		? parsed['seedText']
		: undefined;

	const step: InterviewStep = {
		question: complete ? null : String(parsed['question'] ?? ''),
		progress: String(parsed['progress'] ?? 'unknown'),
		complete,
	};

	if (seedText !== undefined) {
		step.seedText = seedText;
	}

	return step;
}

// ─── Interview Engine ───────────────────────────────────────────────

export class InterviewEngine {
	private sessions = new Map<string, InterviewSession>();

	constructor(
		private readonly registry: IProviderRegistry,
		private readonly defaultProvider: string,
		private readonly defaultModel: string,
	) {}

	/**
	 * Start a new interview session.
	 * Returns the session ID and the first question from the LLM.
	 */
	async start(companyType: 'new' | 'existing'): Promise<{ sessionId: string; step: InterviewStep }> {
		const provider = this.registry.get(
			this.defaultProvider as import('../types/common.js').ProviderId,
		);
		if (!provider) {
			throw new Error(`Provider "${this.defaultProvider}" not found in registry.`);
		}

		const sessionId = nanoid();
		const now = new Date().toISOString();

		// Initial user message to kick off the interview
		const userMessage = companyType === 'new'
			? 'I want to set up agents for a brand new company. Please start the interview.'
			: 'I want to set up agents for an existing company. Please start the interview.';

		const messages: ChatMessage[] = [
			{ role: 'system', content: INTERVIEW_SYSTEM_PROMPT },
			{ role: 'user', content: userMessage },
		];

		const request: ChatRequest = {
			model: this.defaultModel,
			messages,
			temperature: 0.5,
			maxTokens: 2048,
		};

		const raw = await collectChatResponse(provider.chat(request));
		const step = parseInterviewResponse(raw);

		// Create the session
		const session: InterviewSession = {
			id: sessionId,
			status: step.complete ? 'completed' : 'active',
			companyType,
			answers: [],
			createdAt: now,
			updatedAt: now,
		};

		if (step.seedText !== undefined) {
			session.seedText = step.seedText;
		}

		// Store the conversation history as session-level data
		// We keep track of the raw LLM responses for building subsequent messages
		this.sessions.set(sessionId, session);
		this.setConversationHistory(sessionId, {
			userMessages: [userMessage],
			assistantResponses: [raw],
			questionCount: step.complete ? 0 : 1,
		});

		return { sessionId, step };
	}

	/**
	 * Respond to a question in an active interview session.
	 * Returns the next question or the completed seed document.
	 */
	async respond(sessionId: string, answer: string): Promise<InterviewStep> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Interview session "${sessionId}" not found.`);
		}

		// Check for expiry
		const elapsed = Date.now() - new Date(session.createdAt).getTime();
		if (elapsed > SESSION_EXPIRY_MS) {
			session.status = 'abandoned';
			session.updatedAt = new Date().toISOString();
			throw new Error(`Interview session "${sessionId}" has expired (1 hour limit).`);
		}

		if (session.status !== 'active') {
			throw new Error(
				`Interview session "${sessionId}" is ${session.status}, not active.`,
			);
		}

		const provider = this.registry.get(
			this.defaultProvider as import('../types/common.js').ProviderId,
		);
		if (!provider) {
			throw new Error(`Provider "${this.defaultProvider}" not found in registry.`);
		}

		const history = this.getConversationHistory(sessionId);
		if (!history) {
			throw new Error(`Conversation history for session "${sessionId}" not found.`);
		}

		// Check if we've hit the question cap
		const forceCompletion = history.questionCount >= MAX_QUESTIONS;

		// Build the full message history for the LLM
		const messages: ChatMessage[] = [
			{ role: 'system', content: INTERVIEW_SYSTEM_PROMPT },
		];

		// Interleave user messages and assistant responses
		for (let i = 0; i < history.userMessages.length; i++) {
			const userMsg = history.userMessages[i];
			if (userMsg !== undefined) {
				messages.push({ role: 'user', content: userMsg });
			}
			const assistantMsg = history.assistantResponses[i];
			if (assistantMsg !== undefined) {
				messages.push({ role: 'assistant', content: assistantMsg });
			}
		}

		// Build the current user message
		const currentUserMessage = forceCompletion
			? `${answer}\n\n[SYSTEM NOTE: This is question ${history.questionCount} of a maximum ${MAX_QUESTIONS}. You MUST complete the interview now. Generate the seed document with the information you have. Respond with { "question": null, "progress": "complete", "complete": true, "seedText": "..." }]`
			: answer;

		messages.push({ role: 'user', content: currentUserMessage });

		const request: ChatRequest = {
			model: this.defaultModel,
			messages,
			temperature: 0.5,
			maxTokens: forceCompletion ? 8192 : 2048,
		};

		const raw = await collectChatResponse(provider.chat(request));
		const step = parseInterviewResponse(raw);

		// Record the answer in the session
		const lastResponse = history.assistantResponses[history.assistantResponses.length - 1];
		session.answers.push({
			question: lastResponse !== undefined
				? this.extractQuestionText(lastResponse)
				: '',
			answer,
			timestamp: new Date().toISOString(),
		});

		// Update conversation history
		history.userMessages.push(currentUserMessage);
		history.assistantResponses.push(raw);

		if (!step.complete) {
			history.questionCount++;
		}

		// Update session state
		session.updatedAt = new Date().toISOString();

		if (step.complete) {
			session.status = 'completed';
			if (step.seedText !== undefined) {
				session.seedText = step.seedText;
			}
		}

		return step;
	}

	/**
	 * Get the current state of a session.
	 */
	getSession(sessionId: string): InterviewSession | undefined {
		return this.sessions.get(sessionId);
	}

	/**
	 * List all active sessions.
	 */
	listSessions(): InterviewSession[] {
		return [...this.sessions.values()];
	}

	// ─── Private conversation history management ─────────────────────

	/**
	 * We store conversation history separately from InterviewSession to keep
	 * the public type clean. This is internal engine state.
	 */
	private conversationHistories = new Map<string, ConversationHistory>();

	private setConversationHistory(sessionId: string, history: ConversationHistory): void {
		this.conversationHistories.set(sessionId, history);
	}

	private getConversationHistory(sessionId: string): ConversationHistory | undefined {
		return this.conversationHistories.get(sessionId);
	}

	/**
	 * Extract the question text from a raw LLM response for storing in answers.
	 */
	private extractQuestionText(rawResponse: string): string {
		try {
			const json = extractJSON(rawResponse);
			const parsed = JSON.parse(json) as Record<string, unknown>;
			return typeof parsed['question'] === 'string' ? parsed['question'] : '';
		} catch {
			return '';
		}
	}
}

// ─── Internal Types ─────────────────────────────────────────────────

interface ConversationHistory {
	/** All user messages in order (including the initial kickoff). */
	userMessages: string[];
	/** All assistant (LLM) responses in order (raw JSON strings). */
	assistantResponses: string[];
	/** Number of questions asked so far. */
	questionCount: number;
}
