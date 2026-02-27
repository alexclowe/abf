/**
 * ProactiveEvaluator — lightweight LLM evaluation for proactive triggers.
 * Runs the evaluation prompt to decide whether a full session should fire.
 */

import type { AgentConfig } from '../types/agent.js';
import type { IProviderRegistry } from '../types/provider.js';
import type { ProactiveTrigger } from '../types/trigger.js';

export interface EvaluationResult {
	readonly shouldAct: boolean;
	readonly reason: string;
}

export class ProactiveEvaluator {
	constructor(
		private readonly providerRegistry: IProviderRegistry,
	) {}

	/**
	 * Run the evaluation prompt and determine whether the agent should act.
	 */
	async evaluate(
		agent: AgentConfig,
		trigger: ProactiveTrigger,
	): Promise<EvaluationResult> {
		const provider = this.providerRegistry.getBySlug(agent.provider);
		if (!provider) {
			return { shouldAct: false, reason: `Provider ${agent.provider} not available` };
		}

		try {
			const chunks = provider.chat({
				model: agent.model,
				messages: [
					{
						role: 'system',
						content: `You are evaluating whether an agent should run a task. ${trigger.evaluationPrompt}\n\nRespond with JSON only: { "should_act": true/false, "reason": "..." }`,
					},
					{
						role: 'user',
						content: `Evaluate whether to run task: ${trigger.task}`,
					},
				],
				temperature: 0.1,
			});

			let text = '';
			for await (const chunk of chunks) {
				if (chunk.type === 'text' && chunk.text) {
					text += chunk.text;
				}
			}

			// Parse the JSON response
			const jsonMatch = text.match(/\{[\s\S]*\}/);
			if (!jsonMatch) {
				return { shouldAct: false, reason: 'Failed to parse evaluation response' };
			}

			const parsed = JSON.parse(jsonMatch[0]) as { should_act?: boolean; reason?: string };
			return {
				shouldAct: parsed.should_act === true,
				reason: parsed.reason ?? 'No reason provided',
			};
		} catch (e) {
			return {
				shouldAct: false,
				reason: `Evaluation error: ${e instanceof Error ? e.message : String(e)}`,
			};
		}
	}
}
