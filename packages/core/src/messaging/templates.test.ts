import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as yamlStringify } from 'yaml';
import { MessageTemplateRegistry } from './templates.js';

describe('MessageTemplateRegistry', () => {
	let tempDir: string;
	let registry: MessageTemplateRegistry;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'abf-msg-tpl-'));
		registry = new MessageTemplateRegistry();
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	async function writeTemplate(filename: string, content: object): Promise<void> {
		await writeFile(join(tempDir, filename), yamlStringify(content));
	}

	describe('load', () => {
		it('loads *.template.yaml files from a directory', async () => {
			await writeTemplate('welcome.template.yaml', {
				name: 'welcome',
				channel: 'email',
				body: 'Hello {{customerName}}, welcome!',
				variables: ['customerName'],
			});
			await writeTemplate('alert.template.yaml', {
				name: 'alert',
				channel: 'slack',
				body: 'Alert: {{message}}',
				variables: ['message'],
			});

			registry.load(tempDir);

			const templates = registry.list();
			expect(templates).toHaveLength(2);
		});

		it('ignores files that do not end with .template.yaml', async () => {
			await writeTemplate('welcome.template.yaml', {
				name: 'welcome',
				channel: 'email',
				body: 'Hello!',
				variables: [],
			});
			await writeFile(join(tempDir, 'readme.md'), '# Templates');
			await writeFile(join(tempDir, 'other.yaml'), 'key: value');

			registry.load(tempDir);

			expect(registry.list()).toHaveLength(1);
		});

		it('returns empty list for non-existent directory', () => {
			registry.load('/tmp/this-path-does-not-exist-at-all');
			expect(registry.list()).toHaveLength(0);
		});

		it('skips malformed template files gracefully', async () => {
			await writeFile(join(tempDir, 'bad.template.yaml'), '}{not valid yaml');
			await writeTemplate('good.template.yaml', {
				name: 'good',
				channel: 'slack',
				body: 'Works!',
				variables: [],
			});

			registry.load(tempDir);
			expect(registry.list()).toHaveLength(1);
			expect(registry.get('good')).toBeDefined();
		});
	});

	describe('get', () => {
		it('returns the template by name', async () => {
			await writeTemplate('notify.template.yaml', {
				name: 'notify',
				channel: 'discord',
				body: 'Notification: {{content}}',
				variables: ['content'],
			});

			registry.load(tempDir);

			const template = registry.get('notify');
			expect(template).toBeDefined();
			expect(template!.name).toBe('notify');
			expect(template!.channel).toBe('discord');
			expect(template!.body).toBe('Notification: {{content}}');
		});

		it('returns undefined for unknown template', async () => {
			registry.load(tempDir);
			expect(registry.get('nonexistent')).toBeUndefined();
		});
	});

	describe('list', () => {
		it('returns all loaded templates', async () => {
			await writeTemplate('a.template.yaml', {
				name: 'a',
				channel: 'email',
				body: 'A',
				variables: [],
			});
			await writeTemplate('b.template.yaml', {
				name: 'b',
				channel: 'slack',
				body: 'B',
				variables: [],
			});

			registry.load(tempDir);

			const list = registry.list();
			expect(list).toHaveLength(2);
			const names = list.map((t) => t.name);
			expect(names).toContain('a');
			expect(names).toContain('b');
		});
	});

	describe('resolve', () => {
		it('substitutes {{varName}} with provided values', async () => {
			await writeTemplate('greeting.template.yaml', {
				name: 'greeting',
				channel: 'email',
				subject: 'Hello {{name}}',
				body: 'Dear {{name}}, your order {{orderId}} is confirmed.',
				variables: ['name', 'orderId'],
			});

			registry.load(tempDir);

			const result = registry.resolve('greeting', {
				name: 'Alice',
				orderId: '12345',
			});

			expect(result).toBeDefined();
			expect(result!.body).toBe('Dear Alice, your order 12345 is confirmed.');
			expect(result!.subject).toBe('Hello Alice');
		});

		it('leaves missing variables as-is', async () => {
			await writeTemplate('partial.template.yaml', {
				name: 'partial',
				channel: 'slack',
				body: 'Hi {{name}}, your code is {{code}}.',
				variables: ['name', 'code'],
			});

			registry.load(tempDir);

			const result = registry.resolve('partial', { name: 'Bob' });

			expect(result).toBeDefined();
			expect(result!.body).toBe('Hi Bob, your code is {{code}}.');
		});

		it('returns undefined for non-existent template name', async () => {
			registry.load(tempDir);
			expect(registry.resolve('missing', {})).toBeUndefined();
		});

		it('handles templates without a subject', async () => {
			await writeTemplate('no-subject.template.yaml', {
				name: 'no-subject',
				channel: 'slack',
				body: 'Just a body with {{value}}.',
				variables: ['value'],
			});

			registry.load(tempDir);

			const result = registry.resolve('no-subject', { value: 'test' });

			expect(result).toBeDefined();
			expect(result!.body).toBe('Just a body with test.');
			expect(result!.subject).toBeUndefined();
		});

		it('resolves subject variables independently of body', async () => {
			await writeTemplate('dual.template.yaml', {
				name: 'dual',
				channel: 'email',
				subject: 'Re: {{topic}}',
				body: '{{sender}} wrote about {{topic}}.',
				variables: ['topic', 'sender'],
			});

			registry.load(tempDir);

			const result = registry.resolve('dual', { topic: 'update', sender: 'Eve' });

			expect(result).toBeDefined();
			expect(result!.subject).toBe('Re: update');
			expect(result!.body).toBe('Eve wrote about update.');
		});
	});

	describe('subject is optional', () => {
		it('loads a template without subject field', async () => {
			await writeTemplate('minimal.template.yaml', {
				name: 'minimal',
				channel: 'slack',
				body: 'Just a message.',
				variables: [],
			});

			registry.load(tempDir);

			const template = registry.get('minimal');
			expect(template).toBeDefined();
			expect(template!.subject).toBeUndefined();
		});

		it('loads a template with subject field', async () => {
			await writeTemplate('with-subject.template.yaml', {
				name: 'with-subject',
				channel: 'email',
				subject: 'Important!',
				body: 'Read this.',
				variables: [],
			});

			registry.load(tempDir);

			const template = registry.get('with-subject');
			expect(template).toBeDefined();
			expect(template!.subject).toBe('Important!');
		});
	});
});
