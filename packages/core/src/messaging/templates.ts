/**
 * MessageTemplateRegistry — loads *.template.yaml files and resolves {{variables}}.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { messageTemplateSchema } from '../schemas/message-template.schema.js';
import type { MessageTemplate } from '../schemas/message-template.schema.js';

export class MessageTemplateRegistry {
	private readonly templates = new Map<string, MessageTemplate>();

	/**
	 * Load all *.template.yaml files from a directory.
	 */
	load(dir: string): void {
		if (!existsSync(dir)) return;

		const files = readdirSync(dir).filter((f) => f.endsWith('.template.yaml'));
		for (const file of files) {
			try {
				const raw = parse(readFileSync(join(dir, file), 'utf-8'));
				const parsed = messageTemplateSchema.safeParse(raw);
				if (parsed.success) {
					this.templates.set(parsed.data.name, {
						name: parsed.data.name,
						description: parsed.data.description,
						channel: parsed.data.channel,
						subject: parsed.data.subject,
						body: parsed.data.body,
						variables: parsed.data.variables,
					});
				}
			} catch {
				// Skip malformed template files
			}
		}
	}

	/**
	 * Get a template by name.
	 */
	get(name: string): MessageTemplate | undefined {
		return this.templates.get(name);
	}

	/**
	 * List all loaded templates.
	 */
	list(): readonly MessageTemplate[] {
		return [...this.templates.values()];
	}

	/**
	 * Resolve a template with variables, returning the final body and optional subject.
	 */
	resolve(
		name: string,
		variables: Record<string, string>,
	): { body: string; subject?: string } | undefined {
		const template = this.templates.get(name);
		if (!template) return undefined;

		const resolveVars = (text: string): string =>
			text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? `{{${key}}}`);

		const result: { body: string; subject?: string } = {
			body: resolveVars(template.body),
		};
		if (template.subject) {
			result.subject = resolveVars(template.subject);
		}
		return result;
	}
}
