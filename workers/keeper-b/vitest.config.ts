import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { bindings: { BELL_TEST_MODE: '1', BELL_ORACLE_MODE: 'push' } },
  })],
  test: {
    include: ['test/**/*.test.ts'],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
