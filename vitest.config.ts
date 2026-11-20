import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		// The 'obsidian' npm package only has type definitions; DOM tests use a small mock.
		alias: { obsidian: fileURLToPath(new URL('./tests/mocks/obsidian.ts', import.meta.url)) },
	},
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
	},
});
