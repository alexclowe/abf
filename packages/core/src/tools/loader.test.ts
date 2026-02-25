import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBuiltinTools, loadToolConfigs } from './loader.js';

describe('loadToolConfigs', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'abf-tools-test-'));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it('returns empty array for missing directory', async () => {
		const result = await loadToolConfigs('/nonexistent/dir');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toHaveLength(0);
	});

	it('returns empty array for empty directory', async () => {
		const result = await loadToolConfigs(tempDir);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toHaveLength(0);
	});

	it('loads a valid tool YAML', async () => {
		const toolYaml = `
name: fetch-url
description: Fetch content from a URL
source: custom
parameters:
  - name: url
    type: string
    description: URL to fetch
    required: true
`;
		await writeFile(join(tempDir, 'fetch-url.tool.yaml'), toolYaml, 'utf8');

		const result = await loadToolConfigs(tempDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value).toHaveLength(1);
		const tool = result.value[0]!;
		expect(tool.definition.name).toBe('fetch-url');
		expect(tool.definition.description).toBe('Fetch content from a URL');
		expect(tool.definition.parameters).toHaveLength(1);
	});

	it('executes as NoOpTool (returns metadata)', async () => {
		const toolYaml = `
name: my-tool
description: A test tool
parameters:
  - name: input
    type: string
    description: Input value
    required: true
`;
		await writeFile(join(tempDir, 'my-tool.tool.yaml'), toolYaml, 'utf8');

		const result = await loadToolConfigs(tempDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const tool = result.value[0]!;
		const execResult = await tool.execute({ input: 'hello' });
		expect(execResult.ok).toBe(true);
		if (execResult.ok) {
			expect((execResult.value as Record<string, unknown>).called).toBe(true);
			expect((execResult.value as Record<string, unknown>).toolName).toBe('my-tool');
		}
	});

	it('returns error for invalid tool YAML', async () => {
		const badYaml = `name: 123\n`;
		await writeFile(join(tempDir, 'bad.tool.yaml'), badYaml, 'utf8');

		const result = await loadToolConfigs(tempDir);
		expect(result.ok).toBe(false);
	});

	it('ignores non-.tool.yaml files', async () => {
		await writeFile(join(tempDir, 'readme.md'), '# readme', 'utf8');
		await writeFile(join(tempDir, 'config.yaml'), 'name: config', 'utf8');

		const result = await loadToolConfigs(tempDir);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toHaveLength(0);
	});
});

describe('createBuiltinTools', () => {
	it('includes web-search stub', () => {
		const tools = createBuiltinTools();
		const webSearch = tools.find((t) => t.definition.id === 'web-search');
		expect(webSearch).toBeDefined();
	});

	it('web-search returns stub result', async () => {
		const tools = createBuiltinTools();
		const webSearch = tools.find((t) => t.definition.id === 'web-search')!;
		const result = await webSearch.execute({ query: 'test' });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect((result.value as Record<string, unknown>).results).toBeDefined();
		}
	});
});
