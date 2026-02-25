import { describe, expect, it } from 'vitest';
import { agentYamlSchema, transformAgentYaml } from './agent.schema.js';

describe('Agent Schema', () => {
	const scoutYaml = {
		name: 'scout',
		display_name: 'Research & Analytics',
		role: 'Citation Monitor',
		description: 'Monitors AI search engine citations for client brands.',
		provider: 'anthropic',
		model: 'claude-sonnet-4-5',
		temperature: 0.3,
		team: 'product',
		reports_to: 'atlas',
		tools: ['llm-orchestration', 'database', 'redis-cache', 'web-search'],
		triggers: [
			{ type: 'cron', schedule: '0 */2 * * *', task: 'run_monitoring_cycle' },
			{ type: 'message', from: 'atlas', task: 'on_demand_scan' },
		],
		escalation_rules: [{ condition: 'api_costs > budget_threshold', target: 'human' }],
		behavioral_bounds: {
			allowed_actions: ['read_data', 'write_report', 'send_alert'],
			forbidden_actions: ['delete_data', 'modify_billing'],
			max_cost_per_session: '$2.00',
			requires_approval: ['publish_content', 'send_client_email'],
		},
		kpis: [{ metric: 'monitoring_coverage', target: '100%', review: 'daily' }],
		charter: '# Scout — Citation Monitor\nYou are Scout...',
	};

	it('parses a complete agent YAML', () => {
		const parsed = agentYamlSchema.parse(scoutYaml);
		expect(parsed.name).toBe('scout');
		expect(parsed.tools).toHaveLength(4);
		expect(parsed.triggers).toHaveLength(2);
	});

	it('transforms snake_case to camelCase AgentConfig', () => {
		const parsed = agentYamlSchema.parse(scoutYaml);
		const config = transformAgentYaml(parsed);

		expect(config.id).toBe('scout');
		expect(config.displayName).toBe('Research & Analytics');
		expect(config.reportsTo).toBe('atlas');
		expect(config.team).toBe('product');
	});

	it('converts "$2.00" to 200 cents', () => {
		const parsed = agentYamlSchema.parse(scoutYaml);
		const config = transformAgentYaml(parsed);

		expect(config.behavioralBounds.maxCostPerSession).toBe(200);
	});

	it('applies defaults for minimal input', () => {
		const minimal = {
			name: 'test',
			display_name: 'Test Agent',
			role: 'Tester',
			description: 'A test agent',
		};

		const parsed = agentYamlSchema.parse(minimal);
		const config = transformAgentYaml(parsed);

		expect(config.provider).toBe('anthropic');
		expect(config.model).toBe('claude-sonnet-4-5');
		expect(config.tools).toEqual([]);
		expect(config.triggers).toEqual([]);
		expect(config.behavioralBounds.maxCostPerSession).toBe(200); // default $2.00
	});

	it('rejects invalid trigger types', () => {
		const bad = {
			...scoutYaml,
			triggers: [{ type: 'invalid', task: 'foo' }],
		};

		expect(() => agentYamlSchema.parse(bad)).toThrow();
	});
});
