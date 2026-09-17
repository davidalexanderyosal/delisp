import type { D1Migration } from '@cloudflare/vitest-pool-workers/config';
import type { Env as WorkerEnv } from '../src/env';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends WorkerEnv {
    TEST_MIGRATIONS: D1Migration[];
  }
}
