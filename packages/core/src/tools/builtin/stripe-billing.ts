/**
 * stripe-billing -- Stripe payments and billing operations.
 * Supports create-checkout, create-subscription, list-invoices, list-charges,
 * refund, verify-webhook, get-customer, and list-subscriptions actions.
 * Write actions (create-checkout, create-subscription, refund) require approval.
 */
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { AgentId, SessionId, ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import { toISOTimestamp } from '../../util/id.js';
import type { BuiltinToolContext } from './context.js';
import { credentialError } from './credential-error.js';

const WRITE_ACTIONS = ['create-checkout', 'create-subscription', 'refund'];
const ALL_ACTIONS = [...WRITE_ACTIONS, 'list-invoices', 'list-charges', 'verify-webhook', 'get-customer', 'list-subscriptions'];

export function createStripeBillingTool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'stripe-billing' as ToolId,
		name: 'stripe-billing',
		description:
			'Manage Stripe billing: create checkouts, subscriptions, list invoices/charges, ' +
			'process refunds, and verify webhooks.',
		source: 'registry',
		parameters: [
			{ name: 'action', type: 'string', description: 'Action to perform: create-checkout, create-subscription, list-invoices, list-charges, refund, verify-webhook, get-customer, list-subscriptions', required: true },
			{ name: 'customer_id', type: 'string', description: 'Stripe customer ID', required: false },
			{ name: 'price_id', type: 'string', description: 'Stripe price ID (for create-checkout, create-subscription)', required: false },
			{ name: 'amount', type: 'number', description: 'Amount in cents (for refund)', required: false },
			{ name: 'currency', type: 'string', description: "Currency code (default 'usd')", required: false },
			{ name: 'success_url', type: 'string', description: 'Redirect URL after successful checkout', required: false },
			{ name: 'cancel_url', type: 'string', description: 'Redirect URL after cancelled checkout', required: false },
			{ name: 'charge_id', type: 'string', description: 'Stripe charge ID (for refund)', required: false },
			{ name: 'refund_amount', type: 'number', description: 'Partial refund amount in cents (optional for refund)', required: false },
			{ name: 'webhook_payload', type: 'string', description: 'Raw webhook body (for verify-webhook)', required: false },
			{ name: 'webhook_signature', type: 'string', description: 'Stripe-Signature header value (for verify-webhook)', required: false },
			{ name: 'limit', type: 'number', description: 'Number of results (default 10)', required: false },
		],
		estimatedCost: 1 as USDCents,
		timeout: 30_000,
	};

	return {
		definition,
		async execute(args) {
			const action = args['action'];
			if (typeof action !== 'string' || !ALL_ACTIONS.includes(action)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`stripe-billing: action must be one of: ${ALL_ACTIONS.join(', ')}`,
						{},
					),
				);
			}

			// Queue write actions for approval if approval store is configured
			if (WRITE_ACTIONS.includes(action) && ctx.approvalStore) {
				const approvalId = ctx.approvalStore.create({
					agentId: (args['_agentId'] as AgentId) ?? ('unknown' as AgentId),
					sessionId: (args['_sessionId'] as SessionId) ?? ('unknown' as SessionId),
					toolId: 'stripe-billing' as ToolId,
					toolName: 'stripe-billing',
					arguments: {
						action,
						customer_id: args['customer_id'],
						price_id: args['price_id'],
						charge_id: args['charge_id'],
						refund_amount: args['refund_amount'],
						success_url: args['success_url'],
						cancel_url: args['cancel_url'],
					},
					createdAt: toISOTimestamp(),
				});
				return Ok({
					queued: true,
					approvalId,
					action,
					message: `${action} queued for approval`,
				});
			}

			// Get Stripe API key: env var first, then vault
			let apiKey = process.env['STRIPE_SECRET_KEY'];
			if (!apiKey) {
				const vaultKey = await ctx.vault.get('stripe', 'api_key');
				if (vaultKey) apiKey = vaultKey;
			}
			if (!apiKey) {
				return Ok(credentialError(ctx.isCloud, {
					provider: 'stripe',
					envVar: 'STRIPE_SECRET_KEY',
					dashboardPath: '/settings/integrations/stripe',
					displayName: 'Stripe',
				}));
			}

			// Dynamic import Stripe
			const { default: Stripe } = await import('stripe');
			const stripe = new Stripe(apiKey);

			switch (action) {
				case 'create-checkout':
					return createCheckout(stripe, args);
				case 'create-subscription':
					return createSubscription(stripe, args);
				case 'list-invoices':
					return listInvoices(stripe, args);
				case 'list-charges':
					return listCharges(stripe, args);
				case 'refund':
					return processRefund(stripe, args);
				case 'verify-webhook':
					return verifyWebhook(ctx, stripe, args);
				case 'get-customer':
					return getCustomer(stripe, args);
				case 'list-subscriptions':
					return listSubscriptions(stripe, args);
				default:
					return Err(
						new ToolError('TOOL_EXECUTION_FAILED', `stripe-billing: unknown action '${action}'`, {}),
					);
			}
		},
	};
}

type StripeInstance = any;

async function createCheckout(
	stripe: StripeInstance,
	args: Readonly<Record<string, unknown>>,
) {
	const priceId = args['price_id'] as string;
	const successUrl = args['success_url'] as string;
	const cancelUrl = args['cancel_url'] as string;
	const customerId = args['customer_id'] as string | undefined;

	if (!priceId || !successUrl || !cancelUrl) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'stripe-billing: create-checkout requires price_id, success_url, and cancel_url',
				{},
			),
		);
	}

	try {
		const session = await stripe.checkout.sessions.create({
			mode: 'payment',
			line_items: [{ price: priceId, quantity: 1 }],
			success_url: successUrl,
			cancel_url: cancelUrl,
			...(customerId ? { customer: customerId } : {}),
		});
		return Ok({ id: session.id, url: session.url, created: true });
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`stripe-billing: create-checkout failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function createSubscription(
	stripe: StripeInstance,
	args: Readonly<Record<string, unknown>>,
) {
	const customerId = args['customer_id'] as string;
	const priceId = args['price_id'] as string;

	if (!customerId || !priceId) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'stripe-billing: create-subscription requires customer_id and price_id',
				{},
			),
		);
	}

	try {
		const subscription = await stripe.subscriptions.create({
			customer: customerId,
			items: [{ price: priceId }],
		});
		return Ok({ id: subscription.id, status: subscription.status, created: true });
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`stripe-billing: create-subscription failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function listInvoices(
	stripe: StripeInstance,
	args: Readonly<Record<string, unknown>>,
) {
	const customerId = args['customer_id'] as string | undefined;
	const limit = (args['limit'] as number) || 10;

	try {
		const invoices = await stripe.invoices.list({
			...(customerId ? { customer: customerId } : {}),
			limit,
		});
		return Ok({
			invoices: invoices.data.map((i: { id: string; amount_due: number; status: string | null; created: number }) => ({
				id: i.id,
				amount_due: i.amount_due,
				status: i.status,
				created: i.created,
			})),
			hasMore: invoices.has_more,
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`stripe-billing: list-invoices failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function listCharges(
	stripe: StripeInstance,
	args: Readonly<Record<string, unknown>>,
) {
	const customerId = args['customer_id'] as string | undefined;
	const limit = (args['limit'] as number) || 10;

	try {
		const charges = await stripe.charges.list({
			...(customerId ? { customer: customerId } : {}),
			limit,
		});
		return Ok({
			charges: charges.data.map((c: { id: string; amount: number; status: string; created: number }) => ({
				id: c.id,
				amount: c.amount,
				status: c.status,
				created: c.created,
			})),
			hasMore: charges.has_more,
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`stripe-billing: list-charges failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function processRefund(
	stripe: StripeInstance,
	args: Readonly<Record<string, unknown>>,
) {
	const chargeId = args['charge_id'] as string;
	const refundAmount = args['refund_amount'] as number | undefined;

	if (!chargeId) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'stripe-billing: refund requires charge_id', {}),
		);
	}

	try {
		const refund = await stripe.refunds.create({
			charge: chargeId,
			...(refundAmount ? { amount: refundAmount } : {}),
		});
		return Ok({ id: refund.id, amount: refund.amount, status: refund.status });
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`stripe-billing: refund failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function verifyWebhook(
	ctx: BuiltinToolContext,
	stripe: StripeInstance,
	args: Readonly<Record<string, unknown>>,
) {
	const webhookPayload = args['webhook_payload'] as string;
	const webhookSignature = args['webhook_signature'] as string;

	if (!webhookPayload || !webhookSignature) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				'stripe-billing: verify-webhook requires webhook_payload and webhook_signature',
				{},
			),
		);
	}

	// Get webhook secret: env var first, then vault
	let webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
	if (!webhookSecret) {
		const vaultSecret = await ctx.vault.get('stripe', 'webhook_secret');
		if (vaultSecret) webhookSecret = vaultSecret;
	}
	if (!webhookSecret) {
		return Ok(credentialError(ctx.isCloud, {
			provider: 'stripe',
			envVar: 'STRIPE_WEBHOOK_SECRET',
			dashboardPath: '/settings/integrations/stripe',
			displayName: 'Stripe Webhook',
		}));
	}

	try {
		const event = stripe.webhooks.constructEvent(webhookPayload, webhookSignature, webhookSecret);
		return Ok({ verified: true, type: event.type, id: event.id });
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`stripe-billing: verify-webhook failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function getCustomer(
	stripe: StripeInstance,
	args: Readonly<Record<string, unknown>>,
) {
	const customerId = args['customer_id'] as string;

	if (!customerId) {
		return Err(
			new ToolError('TOOL_EXECUTION_FAILED', 'stripe-billing: get-customer requires customer_id', {}),
		);
	}

	try {
		const customer = await stripe.customers.retrieve(customerId);
		if ((customer as { deleted?: boolean }).deleted) {
			return Ok({ id: customerId, deleted: true });
		}
		const c = customer as { id: string; email?: string | null; name?: string | null; phone?: string | null; created: number; metadata?: Record<string, string> };
		return Ok({
			id: c.id,
			email: c.email,
			name: c.name,
			phone: c.phone,
			created: c.created,
			metadata: c.metadata,
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`stripe-billing: get-customer failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}

async function listSubscriptions(
	stripe: StripeInstance,
	args: Readonly<Record<string, unknown>>,
) {
	const customerId = args['customer_id'] as string | undefined;
	const limit = (args['limit'] as number) || 10;

	try {
		const subs = await stripe.subscriptions.list({
			...(customerId ? { customer: customerId } : {}),
			limit,
		});
		return Ok({
			subscriptions: subs.data.map((s: { id: string; status: string; current_period_start: number; current_period_end: number; created: number }) => ({
				id: s.id,
				status: s.status,
				current_period_start: s.current_period_start,
				current_period_end: s.current_period_end,
				created: s.created,
			})),
			hasMore: subs.has_more,
		});
	} catch (err) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`stripe-billing: list-subscriptions failed: ${err instanceof Error ? err.message : String(err)}`,
				{},
			),
		);
	}
}
