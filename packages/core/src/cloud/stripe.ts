/**
 * Stripe integration for ABF Cloud billing.
 *
 * Handles:
 * - Checkout session creation for credit top-ups
 * - Webhook processing for payment events
 * - Credit allocation after successful payment
 *
 * Requires: stripe npm package (optional peer dependency).
 * Uses dynamic import + unknown typing to avoid compile-time dependency.
 */

import type { IBillingLedger } from '../billing/types.js';

export interface StripeConfig {
	/** Stripe secret key (sk_live_xxx or sk_test_xxx). */
	readonly secretKey: string;
	/** Stripe webhook signing secret (whsec_xxx). */
	readonly webhookSecret: string;
	/** URL to redirect to after checkout. */
	readonly successUrl: string;
	/** URL to redirect to if checkout is cancelled. */
	readonly cancelUrl: string;
}

export interface StripeIntegration {
	/** Create a checkout session for purchasing credits. */
	createCheckoutSession(accountId: string, amountCents: number): Promise<{ url: string; sessionId: string }>;
	/** Process a Stripe webhook event. Returns true if the event was handled. */
	handleWebhook(payload: string, signature: string): Promise<boolean>;
}

/** Credit tier pricing. */
const CREDIT_TIERS = [
	{ amountCents: 500, label: '$5.00' },
	{ amountCents: 2000, label: '$20.00' },
	{ amountCents: 5000, label: '$50.00' },
	{ amountCents: 10000, label: '$100.00' },
] as const;

// Dynamic stripe types to avoid compile-time dependency
interface StripeClient {
	checkout: {
		sessions: {
			create(params: unknown): Promise<{ id: string; url: string | null }>;
		};
	};
	webhooks: {
		constructEvent(payload: string, signature: string, secret: string): {
			type: string;
			data: { object: { id: string; metadata?: Record<string, string> } };
		};
	};
}

/**
 * Create a Stripe integration.
 * Dynamically imports the stripe package — fails gracefully if not installed.
 */
export function createStripeIntegration(
	config: StripeConfig,
	ledger: IBillingLedger,
): StripeIntegration {
	let stripeInstance: StripeClient | null = null;

	async function getStripe(): Promise<StripeClient> {
		if (stripeInstance) return stripeInstance;
		try {
			// Dynamic import via variable to prevent TS static resolution
			const modPath = 'stripe';
			const mod = (await import(modPath)) as { default: new (key: string) => StripeClient };
			stripeInstance = new mod.default(config.secretKey);
			return stripeInstance;
		} catch {
			throw new Error(
				'Stripe package is not installed. Run: npm install stripe',
			);
		}
	}

	return {
		async createCheckoutSession(accountId: string, amountCents: number) {
			const stripe = await getStripe();

			const tier = CREDIT_TIERS.find((t) => t.amountCents === amountCents);

			const session = await stripe.checkout.sessions.create({
				mode: 'payment',
				success_url: config.successUrl,
				cancel_url: config.cancelUrl,
				metadata: {
					accountId,
					creditAmountCents: String(amountCents),
				},
				line_items: [
					{
						price_data: {
							currency: 'usd',
							product_data: {
								name: `ABF Cloud Credits — ${tier?.label ?? `$${(amountCents / 100).toFixed(2)}`}`,
								description: `${amountCents} credits for ABF Cloud AI agent usage`,
							},
							unit_amount: amountCents,
						},
						quantity: 1,
					},
				],
			});

			return {
				url: session.url ?? config.cancelUrl,
				sessionId: session.id,
			};
		},

		async handleWebhook(payload: string, signature: string) {
			const stripe = await getStripe();

			let event: ReturnType<StripeClient['webhooks']['constructEvent']>;
			try {
				event = stripe.webhooks.constructEvent(
					payload,
					signature,
					config.webhookSecret,
				);
			} catch {
				return false;
			}

			if (event.type === 'checkout.session.completed') {
				const session = event.data.object;
				const accountId = session.metadata?.['accountId'];
				const creditAmountStr = session.metadata?.['creditAmountCents'];

				if (accountId && creditAmountStr) {
					const amountCents = Number.parseInt(creditAmountStr, 10);
					if (amountCents > 0) {
						await ledger.credit(amountCents, `stripe:${session.id}`);
						return true;
					}
				}
			}

			return false;
		},
	};
}

export { CREDIT_TIERS };
