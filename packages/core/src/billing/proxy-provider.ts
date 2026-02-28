/**
 * ProxyBillingProvider — wraps any real provider with balance checking and usage tracking.
 * Used in ABF Cloud mode where ABF holds pooled API keys and users pay per-token.
 */

import type { AgentId, ProviderId, SessionId, USDCents } from '../types/common.js';
import { toISOTimestamp } from '../util/id.js';
import type { ChatChunk, ChatRequest, IProvider, ModelInfo } from '../types/provider.js';
import type { IBillingLedger, UsageRecord } from './types.js';

export class ProxyBillingProvider implements IProvider {
	readonly id: ProviderId;
	readonly name: string;
	readonly slug: string;
	readonly authType: 'api_key' | 'oauth' | 'local';

	constructor(
		private readonly inner: IProvider,
		private readonly ledger: IBillingLedger,
	) {
		this.id = inner.id;
		this.name = `${inner.name} (Billed)`;
		this.slug = inner.slug;
		this.authType = inner.authType;
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		// Pre-flight balance check
		const balance = await this.ledger.getBalance();
		if (balance.balanceCents <= 0) {
			yield {
				type: 'error',
				error: 'Insufficient balance. Please add credits to continue.',
			};
			return;
		}

		let inputTokens = 0;
		let outputTokens = 0;

		for await (const chunk of this.inner.chat(request)) {
			if (chunk.type === 'usage' && chunk.usage) {
				inputTokens = chunk.usage.inputTokens;
				outputTokens = chunk.usage.outputTokens;
			}
			yield chunk;
		}

		// Debit usage after completion
		if (inputTokens > 0 || outputTokens > 0) {
			const totalTokens = inputTokens + outputTokens;
			const costCents = this.inner.estimateCost(request.model, totalTokens);

			// Extract agent/session context from request metadata if available
			const agentId = ((request as unknown as Record<string, unknown>)['_agentId'] ?? 'unknown') as AgentId;
			const sessionId = ((request as unknown as Record<string, unknown>)['_sessionId'] ?? 'unknown') as SessionId;

			const record: UsageRecord = {
				agentId,
				sessionId,
				provider: this.slug,
				model: request.model,
				inputTokens,
				outputTokens,
				costCents,
				timestamp: toISOTimestamp(),
			};

			await this.ledger.debit(record);
		}
	}

	models(): Promise<readonly ModelInfo[]> {
		return this.inner.models();
	}

	estimateCost(model: string, tokens: number): USDCents {
		return this.inner.estimateCost(model, tokens);
	}
}
