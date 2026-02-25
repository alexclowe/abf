import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm'],
	dts: false,
	sourcemap: true,
	clean: true,
	target: 'node20',
	outDir: 'dist',
	// CLI is an executable — externalize all deps (they're installed alongside)
	external: [/^[^./]/],
	banner: {
		js: '#!/usr/bin/env node',
	},
});
