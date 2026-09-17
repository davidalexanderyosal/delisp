import { fileURLToPath } from 'node:url';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

/**
 * Runs the tests inside workerd with a real D1 binding, so the SQL is exercised
 * against the same SQLite the deployed Worker uses rather than a mock.
 *
 * The bindings are declared here rather than read from wrangler.toml because the
 * Workers AI binding is a proxy to a remote service and cannot be instantiated
 * in the isolated test runtime. Nothing under test needs it: the routes that do
 * are covered by injecting a fake.
 */
const migrations = await readD1Migrations(
  fileURLToPath(new URL('../../packages/schema/migrations', import.meta.url)),
);

export default defineWorkersConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    poolOptions: {
      workers: {
        singleWorker: true,
        miniflare: {
          compatibilityDate: '2024-12-18',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
          r2Buckets: ['AUDIO'],
          bindings: {
            TEST_MIGRATIONS: migrations,
            ACCESS_TEAM_DOMAIN: '',
            ACCESS_AUD: '',
          },
        },
      },
    },
  },
});
