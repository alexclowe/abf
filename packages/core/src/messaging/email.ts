/**
 * Email messaging plugin — sends notifications via SMTP.
 */

import * as nodemailer from 'nodemailer';
import type { IMessagingPlugin, AgentNotification, EmailPluginConfig } from './interfaces.js';
import { createLogger } from '../util/logger.js';

const logger = createLogger({ level: 'info', format: 'json', name: 'messaging:email' });

export class EmailPlugin implements IMessagingPlugin {
	readonly type = 'email' as const;
	private readonly transporter: nodemailer.Transporter;

	constructor(private readonly config: EmailPluginConfig) {
		this.transporter = nodemailer.createTransport({
			host: config.smtp.host,
			port: config.smtp.port,
			secure: config.smtp.port === 465,
			auth: { user: config.smtp.user, pass: config.smtp.pass },
		});
	}

	async send(notification: AgentNotification): Promise<void> {
		const subject = `[ABF ${notification.severity.toUpperCase()}] ${notification.type} -- ${notification.agentId}`;
		const html = [
			'<h2>ABF Agent Notification</h2>',
			'<table>',
			`  <tr><th>Type</th><td>${notification.type}</td></tr>`,
			`  <tr><th>Agent</th><td>${notification.agentId}</td></tr>`,
			`  <tr><th>Session</th><td>${notification.sessionId}</td></tr>`,
			`  <tr><th>Severity</th><td>${notification.severity}</td></tr>`,
			`  <tr><th>Time</th><td>${notification.timestamp}</td></tr>`,
			'</table>',
			'<hr />',
			`<p>${notification.message}</p>`,
			...(notification.context !== undefined
				? [`<pre>${JSON.stringify(notification.context, null, 2)}</pre>`]
				: []),
		].join('\n');

		await this.transporter.sendMail({
			from: this.config.from ?? this.config.smtp.user,
			to: [...this.config.to].join(', '),
			subject,
			html,
		});

		logger.info({ agentId: notification.agentId, type: notification.type }, 'Email notification sent');
	}
}
