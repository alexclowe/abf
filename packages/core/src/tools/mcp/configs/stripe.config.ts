/**
 * MCP Config: Stripe — payment processing, subscriptions, invoicing.
 */
import type { MCPLibraryEntry } from '../config-registry.js';

export const stripe: MCPLibraryEntry = {
	id: 'stripe',
	metadata: {
		name: 'Stripe',
		description: 'Payment processing, subscriptions, invoicing, and customer management via Stripe API.',
		category: 'payments',
		requiredCredentials: ['STRIPE_API_KEY'],
		documentationUrl: 'https://github.com/stripe/agent-toolkit',
	},
	config: {
		id: 'stripe',
		name: 'Stripe',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@stripe/agent-toolkit', '--api-key', '{{STRIPE_API_KEY}}'],
		tools: ['*'],
	},
};
