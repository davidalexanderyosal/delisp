import { applyD1Migrations, env } from 'cloudflare:test';

// Each isolated storage scope starts from an empty database, so the schema has
// to be applied before anything runs.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
