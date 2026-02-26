/**
 * Zod schema for *.template.yaml message template definitions.
 */

import { z } from 'zod';

export const messageTemplateSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	channel: z.string(), // 'email' | 'slack' | 'discord' | etc.
	subject: z.string().optional(),
	body: z.string(),
	variables: z.array(z.string()).default([]),
});

export type MessageTemplateInput = z.input<typeof messageTemplateSchema>;

export interface MessageTemplate {
	readonly name: string;
	readonly description?: string | undefined;
	readonly channel: string;
	readonly subject?: string | undefined;
	readonly body: string;
	readonly variables: readonly string[];
}
