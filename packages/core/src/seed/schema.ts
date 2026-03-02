/**
 * JSON Schema for CompanyPlan — used for structured output (OpenAI response_format).
 *
 * OpenAI structured output requires:
 * - `additionalProperties: false` on every object
 * - All properties in `required` (use nullable types instead of optional)
 * - No `$ref` or schema composition (`anyOf` for nullability is OK)
 * - No dynamic-key objects (Record<string, string> is NOT allowed)
 *
 * This schema represents the LLM's output — it omits metadata fields (generatedAt,
 * seedVersion, seedText) that the analyzer adds after parsing.
 *
 * NOTE: `knowledge` is represented as an array of { filename, content } pairs
 * because OpenAI strict mode doesn't support dynamic-key maps. The analyzer
 * converts this back to Record<string, string> after parsing via
 * `normalizeStructuredOutput()`.
 */

export const COMPANY_PLAN_JSON_SCHEMA: Record<string, unknown> = {
	type: 'object',
	additionalProperties: false,
	required: ['company', 'agents', 'teams', 'knowledge', 'workflows', 'escalationRules', 'toolGaps', 'buildPlan'],
	properties: {
		company: {
			type: 'object',
			additionalProperties: false,
			required: ['name', 'description', 'mission', 'targetCustomer', 'revenueModel', 'industry', 'stage'],
			properties: {
				name: { type: 'string' },
				description: { type: 'string' },
				mission: { anyOf: [{ type: 'string' }, { type: 'null' }] },
				targetCustomer: { anyOf: [{ type: 'string' }, { type: 'null' }] },
				revenueModel: { anyOf: [{ type: 'string' }, { type: 'null' }] },
				industry: { anyOf: [{ type: 'string' }, { type: 'null' }] },
				stage: { anyOf: [{ type: 'string', enum: ['idea', 'pre-launch', 'launched', 'growing', 'established'] }, { type: 'null' }] },
			},
		},
		agents: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['name', 'displayName', 'role', 'roleArchetype', 'description', 'charter', 'provider', 'model', 'temperature', 'team', 'reportsTo', 'tools', 'triggers', 'kpis', 'behavioralBounds'],
				properties: {
					name: { type: 'string' },
					displayName: { type: 'string' },
					role: { type: 'string' },
					roleArchetype: { anyOf: [{ type: 'string' }, { type: 'null' }] },
					description: { type: 'string' },
					charter: { type: 'string' },
					provider: { type: 'string' },
					model: { type: 'string' },
					temperature: { type: 'number' },
					team: { type: 'string' },
					reportsTo: { anyOf: [{ type: 'string' }, { type: 'null' }] },
					tools: { type: 'array', items: { type: 'string' } },
					triggers: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							required: ['type', 'task', 'schedule', 'interval', 'from', 'path'],
							properties: {
								type: { type: 'string', enum: ['cron', 'manual', 'message', 'webhook', 'event', 'heartbeat'] },
								task: { type: 'string' },
								schedule: { anyOf: [{ type: 'string' }, { type: 'null' }] },
								interval: { anyOf: [{ type: 'number' }, { type: 'null' }] },
								from: { anyOf: [{ type: 'string' }, { type: 'null' }] },
								path: { anyOf: [{ type: 'string' }, { type: 'null' }] },
							},
						},
					},
					kpis: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							required: ['metric', 'target', 'review'],
							properties: {
								metric: { type: 'string' },
								target: { type: 'string' },
								review: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
							},
						},
					},
					behavioralBounds: {
						type: 'object',
						additionalProperties: false,
						required: ['allowedActions', 'forbiddenActions', 'maxCostPerSession', 'requiresApproval'],
						properties: {
							allowedActions: { type: 'array', items: { type: 'string' } },
							forbiddenActions: { type: 'array', items: { type: 'string' } },
							maxCostPerSession: { type: 'string' },
							requiresApproval: { type: 'array', items: { type: 'string' } },
						},
					},
				},
			},
		},
		teams: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['name', 'displayName', 'description', 'orchestrator', 'members'],
				properties: {
					name: { type: 'string' },
					displayName: { type: 'string' },
					description: { type: 'string' },
					orchestrator: { type: 'string' },
					members: { type: 'array', items: { type: 'string' } },
				},
			},
		},
		knowledge: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['filename', 'content'],
				properties: {
					filename: { type: 'string' },
					content: { type: 'string' },
				},
			},
		},
		workflows: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['name', 'displayName', 'description', 'steps', 'timeout', 'onFailure'],
				properties: {
					name: { type: 'string' },
					displayName: { type: 'string' },
					description: { type: 'string' },
					steps: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							required: ['id', 'agent', 'task', 'dependsOn'],
							properties: {
								id: { type: 'string' },
								agent: { type: 'string' },
								task: { type: 'string' },
								dependsOn: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
							},
						},
					},
					timeout: { type: 'number' },
					onFailure: { type: 'string', enum: ['stop', 'skip', 'escalate'] },
				},
			},
		},
		escalationRules: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['condition', 'target', 'description'],
				properties: {
					condition: { type: 'string' },
					target: { type: 'string' },
					description: { type: 'string' },
				},
			},
		},
		toolGaps: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['capability', 'mentionedIn', 'suggestion', 'priority'],
				properties: {
					capability: { type: 'string' },
					mentionedIn: { type: 'string' },
					suggestion: { type: 'string' },
					priority: { type: 'string', enum: ['required', 'important', 'nice-to-have'] },
				},
			},
		},
		buildPlan: {
			anyOf: [
				{
					type: 'object',
					additionalProperties: false,
					required: ['goal', 'strategy', 'totalSteps', 'phases'],
					properties: {
						goal: { type: 'string' },
						strategy: { type: 'string' },
						totalSteps: { type: 'number' },
						phases: {
							type: 'array',
							items: {
								type: 'object',
								additionalProperties: false,
								required: ['id', 'name', 'description', 'steps', 'dependsOn'],
								properties: {
									id: { type: 'string' },
									name: { type: 'string' },
									description: { type: 'string' },
									steps: {
										type: 'array',
										items: {
											type: 'object',
											additionalProperties: false,
											required: ['id', 'description', 'agent', 'task', 'tools', 'requiresApproval', 'approvalQuestion', 'dependsOn', 'complexity'],
											properties: {
												id: { type: 'string' },
												description: { type: 'string' },
												agent: { type: 'string' },
												task: { type: 'string' },
												tools: { type: 'array', items: { type: 'string' } },
												requiresApproval: { type: 'boolean' },
												approvalQuestion: { anyOf: [{ type: 'string' }, { type: 'null' }] },
												dependsOn: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
												complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
											},
										},
									},
									dependsOn: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
								},
							},
						},
					},
				},
				{ type: 'null' },
			],
		},
	},
};

/**
 * Normalize structured output from OpenAI back to the CompanyPlan shape.
 *
 * OpenAI strict mode can't represent `Record<string, string>`, so the schema
 * uses `knowledge: [{ filename, content }]` instead. This function converts
 * the array back to a Record. Safe to call on non-structured output (no-ops
 * if knowledge is already a Record).
 */
export function normalizeStructuredOutput(parsed: Record<string, unknown>): void {
	const knowledge = parsed['knowledge'];
	if (Array.isArray(knowledge)) {
		const map: Record<string, string> = {};
		for (const entry of knowledge) {
			if (
				typeof entry === 'object' &&
				entry !== null &&
				typeof (entry as Record<string, unknown>)['filename'] === 'string' &&
				typeof (entry as Record<string, unknown>)['content'] === 'string'
			) {
				map[(entry as Record<string, string>)['filename']!] = (entry as Record<string, string>)['content']!;
			}
		}
		parsed['knowledge'] = map;
	}
}
