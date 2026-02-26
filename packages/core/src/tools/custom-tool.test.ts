import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync, } from 'node:fs';
import { tmpdir } from 'node:os';
import type { ToolId } from '../types/common.js';
import type { ToolDefinition } from '../types/tool.js';
import { CustomTool, isCustomToolModule } from './custom-tool.js';
import type { CustomToolContext } from './custom-tool.js';

function makeDefinition(name = 'test-tool'): ToolDefinition {
	return {
		id: name as ToolId,
		name,
		description: 'A test tool',
		source: 'custom',
		parameters: [{ name: 'query', type: 'string', description: 'Search query', required: true }],
	};
}

function makeCtx(overrides?: Partial<CustomToolContext>): CustomToolContext {
	return {
		projectRoot: '/tmp/test-project',
		vault: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), list: vi.fn() } as unknown as CustomToolContext['vault'],
		log: vi.fn(),
		...overrides,
	};
}

describe('isCustomToolModule', () => {
	it('returns true for objects with execute function', () => {
		expect(isCustomToolModule({ execute: async () => ({}) })).toBe(true);
	});

	it('returns false for null', () => {
		expect(isCustomToolModule(null)).toBe(false);
	});

	it('returns false for objects without execute', () => {
		expect(isCustomToolModule({ run: async () => ({}) })).toBe(false);
	});

	it('returns false for objects where execute is not a function', () => {
		expect(isCustomToolModule({ execute: 'not-a-function' })).toBe(false);
	});

	it('returns false for primitives', () => {
		expect(isCustomToolModule('string')).toBe(false);
		expect(isCustomToolModule(42)).toBe(false);
		expect(isCustomToolModule(undefined)).toBe(false);
	});
});

describe('CustomTool', () => {
	it('executes module and returns Ok on success', async () => {
		const mod = { execute: vi.fn().mockResolvedValue({ results: ['a', 'b'] }) };
		const tool = new CustomTool(makeDefinition(), mod, makeCtx());

		const result = await tool.execute({ query: 'test' });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ results: ['a', 'b'] });
		}
		expect(mod.execute).toHaveBeenCalledWith(
			{ query: 'test' },
			expect.objectContaining({ projectRoot: '/tmp/test-project' }),
		);
	});

	it('passes context to module execute', async () => {
		const mod = { execute: vi.fn().mockResolvedValue('ok') };
		const ctx = makeCtx({ projectRoot: '/my/project' });
		const tool = new CustomTool(makeDefinition(), mod, ctx);

		await tool.execute({});

		expect(mod.execute).toHaveBeenCalledWith({}, ctx);
	});

	it('returns Err when module throws', async () => {
		const mod = { execute: vi.fn().mockRejectedValue(new Error('connection refused')) };
		const tool = new CustomTool(makeDefinition('failing-tool'), mod, makeCtx());

		const result = await tool.execute({});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain('connection refused');
			expect(result.error.message).toContain('failing-tool');
		}
	});

	it('returns Err when module throws non-Error', async () => {
		const mod = { execute: vi.fn().mockRejectedValue('string error') };
		const tool = new CustomTool(makeDefinition(), mod, makeCtx());

		const result = await tool.execute({});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain('string error');
		}
	});

	it('exposes the tool definition', () => {
		const def = makeDefinition('my-tool');
		const tool = new CustomTool(def, { execute: vi.fn() }, makeCtx());

		expect(tool.definition).toBe(def);
		expect(tool.definition.name).toBe('my-tool');
		expect(tool.definition.source).toBe('custom');
	});

	it('does not mutate the original args object', async () => {
		const mod = {
			execute: vi.fn().mockImplementation(async (args: Record<string, unknown>) => {
				args['injected'] = true;
				return args;
			}),
		};
		const tool = new CustomTool(makeDefinition(), mod, makeCtx());
		const originalArgs = Object.freeze({ query: 'test' });

		// Should not throw even though module mutates — we spread a copy
		const result = await tool.execute(originalArgs);
		expect(result.ok).toBe(true);
	});
});

describe('loadToolConfigs with CustomTool', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'abf-custom-tools-'));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('loads .tool.yaml with co-located .tool.js as CustomTool', async () => {
		// Write YAML definition
		writeFileSync(
			join(tmpDir, 'greet.tool.yaml'),
			`name: greet
description: Greets someone
source: custom
parameters:
  - name: name
    type: string
    description: Who to greet
    required: true
`,
		);

		// Write JS implementation
		writeFileSync(
			join(tmpDir, 'greet.tool.js'),
			`export async function execute(args) { return { greeting: 'Hello ' + args.name }; }`,
		);

		const { loadToolConfigs } = await import('./loader.js');
		const ctx = makeCtx();
		const result = await loadToolConfigs(tmpDir, ctx);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toHaveLength(1);
		expect(result.value[0]!.definition.name).toBe('greet');

		// Verify it's a real CustomTool, not NoOp
		const execResult = await result.value[0]!.execute({ name: 'World' });
		expect(execResult.ok).toBe(true);
		if (execResult.ok) {
			expect(execResult.value).toEqual({ greeting: 'Hello World' });
		}
	});

	it('falls back to NoOpTool when no .tool.js exists', async () => {
		writeFileSync(
			join(tmpDir, 'stub.tool.yaml'),
			`name: stub
description: A stub tool
source: custom
parameters: []
`,
		);

		const { loadToolConfigs } = await import('./loader.js');
		const ctx = makeCtx();
		const result = await loadToolConfigs(tmpDir, ctx);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toHaveLength(1);

		const execResult = await result.value[0]!.execute({});
		expect(execResult.ok).toBe(true);
		if (execResult.ok) {
			const val = execResult.value as Record<string, unknown>;
			expect(val.note).toContain('NoOpTool');
		}
	});

	it('falls back to NoOpTool when .tool.js has no execute export', async () => {
		writeFileSync(
			join(tmpDir, 'bad.tool.yaml'),
			`name: bad
description: Bad module
source: custom
parameters: []
`,
		);
		writeFileSync(join(tmpDir, 'bad.tool.js'), `export const name = 'bad';`);

		const { loadToolConfigs } = await import('./loader.js');
		const ctx = makeCtx();
		const result = await loadToolConfigs(tmpDir, ctx);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const execResult = await result.value[0]!.execute({});
		expect(execResult.ok).toBe(true);
		if (execResult.ok) {
			const val = execResult.value as Record<string, unknown>;
			expect(val.note).toContain('NoOpTool');
		}
		expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('does not export'));
	});

	it('returns empty array when tools directory does not exist', async () => {
		const { loadToolConfigs } = await import('./loader.js');
		const result = await loadToolConfigs('/nonexistent/path');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});

	it('works without customCtx (no .tool.js loading attempted)', async () => {
		writeFileSync(
			join(tmpDir, 'noctx.tool.yaml'),
			`name: noctx
description: No context provided
source: custom
parameters: []
`,
		);
		writeFileSync(join(tmpDir, 'noctx.tool.js'), `export async function execute() { return 'real'; }`);

		const { loadToolConfigs } = await import('./loader.js');
		// No ctx passed — should use NoOp even though .js exists
		const result = await loadToolConfigs(tmpDir);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const execResult = await result.value[0]!.execute({});
		expect(execResult.ok).toBe(true);
		if (execResult.ok) {
			const val = execResult.value as Record<string, unknown>;
			expect(val.note).toContain('NoOpTool');
		}
	});
});
