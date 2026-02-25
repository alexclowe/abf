/**
 * Zod schema for interfaces/*.interface.yaml files.
 */

import { z } from 'zod';

const notifyOnSchema = z.array(
	z.enum(['escalation', 'alert', 'session_complete', 'approval_required']),
).default(['escalation', 'approval_required']);

const severitySchema = z.array(
	z.enum(['info', 'warn', 'error', 'critical']),
).default(['warn', 'error', 'critical']);

const slackConfigSchema = z.object({
	type: z.literal('slack'),
	webhookUrl: z.string().url(),
	channel: z.string().optional(),
	notifyOn: notifyOnSchema,
	severity: severitySchema,
});

const emailConfigSchema = z.object({
	type: z.literal('email'),
	smtp: z.object({
		host: z.string(),
		port: z.number().int().positive(),
		user: z.string(),
		pass: z.string(),
	}),
	to: z.array(z.string().email()),
	from: z.string().email().optional(),
	notifyOn: notifyOnSchema,
	severity: severitySchema,
});

const discordConfigSchema = z.object({
	type: z.literal('discord'),
	webhookUrl: z.string().url(),
	username: z.string().optional(),
	notifyOn: notifyOnSchema,
	severity: severitySchema,
});

export const interfaceConfigSchema = z.discriminatedUnion('type', [
	slackConfigSchema,
	emailConfigSchema,
	discordConfigSchema,
]);

export type InterfaceConfig = z.infer<typeof interfaceConfigSchema>;
