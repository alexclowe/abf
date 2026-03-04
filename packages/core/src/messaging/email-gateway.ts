/**
 * Email Gateway — bidirectional email using SMTP (outbound) and IMAP (inbound).
 * Outbound uses nodemailer (already a dependency). Inbound uses imapflow for polling.
 * Falls back to SMTP-only if IMAP is not configured.
 */

import { toISOTimestamp } from '../util/id.js';
import type { ChannelSendResult, IChannelGateway, InboundMessage } from './interfaces.js';

/** Minimal imapflow-compatible interface (optional dependency). */
interface ImapClient {
	connect(): Promise<void>;
	getMailboxLock(mailbox: string): Promise<{ release(): void }>;
	fetch(query: unknown, opts: unknown): AsyncIterable<{
		uid?: number;
		envelope?: { from?: Array<{ address?: string }>; to?: Array<{ address?: string }>; subject?: string };
		source?: Buffer;
	}>;
	messageFlagsAdd(query: unknown, flags: string[]): Promise<void>;
	logout(): Promise<void>;
}

export interface EmailGatewayConfig {
	readonly smtp: {
		readonly host: string;
		readonly port: number;
		readonly user: string;
		readonly pass: string;
	};
	readonly from: string;
	readonly imap?: {
		readonly host: string;
		readonly port: number;
		readonly user: string;
		readonly pass: string;
		readonly tls?: boolean;
		readonly pollIntervalMs?: number;
	};
}

export class EmailGateway implements IChannelGateway {
	readonly type = 'email' as const;
	private handlers: Array<(msg: InboundMessage) => void> = [];
	private connected = false;
	private transporter: unknown = null;
	private pollTimer: ReturnType<typeof setInterval> | null = null;

	constructor(private readonly config: EmailGatewayConfig) {}

	onMessage(handler: (msg: InboundMessage) => void): void {
		this.handlers.push(handler);
	}

	async send(to: string, text: string, metadata?: Record<string, unknown>): Promise<ChannelSendResult> {
		if (!this.transporter) {
			throw new Error('Email transporter not initialized');
		}

		const subject = (metadata?.['subject'] as string) ?? 'Message from ABF Agent';
		const transport = this.transporter as { sendMail: (opts: unknown) => Promise<{ messageId?: string }> };
		const info = await transport.sendMail({
			from: this.config.from,
			to,
			subject,
			text,
		});
		return { messageId: info.messageId };
	}

	async start(): Promise<void> {
		try {
			// Dynamic import nodemailer (already a dependency)
			const { createTransport } = await import('nodemailer');
			this.transporter = createTransport({
				host: this.config.smtp.host,
				port: this.config.smtp.port,
				secure: this.config.smtp.port === 465,
				auth: {
					user: this.config.smtp.user,
					pass: this.config.smtp.pass,
				},
			});
			this.connected = true;
		} catch {
			this.connected = false;
			return;
		}

		// IMAP polling for inbound (optional)
		if (this.config.imap) {
			const pollInterval = this.config.imap.pollIntervalMs ?? 60_000;
			this.pollTimer = setInterval(() => {
				void this.pollImap();
			}, pollInterval);
			// Run initial poll
			void this.pollImap();
		}
	}

	async stop(): Promise<void> {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		this.connected = false;
	}

	isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Handle an inbound email forwarded via webhook.
	 * Useful when IMAP is not configured but a mail forwarding service is used.
	 */
	async handleWebhookEmail(email: { from: string; to: string; subject: string; text: string; inReplyTo?: string }): Promise<void> {
		const msg: InboundMessage = {
			channel: 'email',
			senderId: email.from,
			text: email.text,
			timestamp: toISOTimestamp(),
			metadata: {
				subject: email.subject,
				to: email.to,
				inReplyTo: email.inReplyTo,
			},
		};

		for (const handler of this.handlers) {
			try {
				await handler(msg);
			} catch {
				// Don't let handler errors propagate
			}
		}
	}

	private async pollImap(): Promise<void> {
		if (!this.config.imap) return;

		try {
			const modPath = 'imapflow';
			const { ImapFlow } = await import(modPath) as { ImapFlow: new (opts: unknown) => ImapClient };
			const client = new ImapFlow({
				host: this.config.imap.host,
				port: this.config.imap.port,
				secure: this.config.imap.tls ?? true,
				auth: {
					user: this.config.imap.user,
					pass: this.config.imap.pass,
				},
				logger: false,
			});

			await client.connect();
			const lock = await client.getMailboxLock('INBOX');

			try {
				// Fetch unseen messages
				const messages = client.fetch({ seen: false }, { source: true, envelope: true });
				for await (const message of messages) {
					const envelope = message.envelope;
					if (!envelope) continue;

					const from = envelope.from?.[0]?.address ?? 'unknown';
					const to = envelope.to?.[0]?.address ?? '';
					const subject = envelope.subject ?? '';
					// Extract text content from source
					const source = message.source?.toString() ?? '';
					const textMatch = source.match(/\r?\n\r?\n([\s\S]*)/);
					const text = textMatch?.[1]?.trim() ?? '';

					if (!text) continue;

					const inbound: InboundMessage = {
						channel: 'email',
						senderId: from,
						text,
						timestamp: toISOTimestamp(),
						metadata: { subject, to },
					};

					for (const handler of this.handlers) {
						try {
							await handler(inbound);
						} catch {
							// Don't let handler errors propagate
						}
					}

					// Mark as seen
					if (message.uid) {
						await client.messageFlagsAdd({ uid: message.uid }, ['\\Seen']);
					}
				}
			} finally {
				lock.release();
			}

			await client.logout();
		} catch {
			// IMAP polling error — will retry next interval
		}
	}
}
