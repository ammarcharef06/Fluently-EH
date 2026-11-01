import { describe, expect, it } from 'vitest';
import worker from './index';
import type { Env } from './types';

const env: Env = { APP_ENV: 'development', CORS_ALLOWED_ORIGINS: 'https://app.fluently.test' };

describe('API defaults', () => {
  it('returns a health response without revealing secrets', async () => {
    const response = await worker.fetch(new Request('https://api.fluently.test/v1/health'), env);
    expect(response.status).toBe(200);
    const body = await response.json() as { integrations: Record<string, boolean> };
    expect(body.integrations.identity).toBe(false);
    expect(body.integrations.database).toBe(false);
    expect(body.integrations.curriculumStorage).toBe(false);
  });

  it('keeps sign-in disabled until identity setup is approved', async () => {
    const response = await worker.fetch(new Request('https://api.fluently.test/v1/auth/login', { method: 'POST' }), env);
    expect(response.status).toBe(503);
  });

  it('fails closed on synchronization without identity configuration', async () => {
    const response = await worker.fetch(new Request('https://api.fluently.test/v1/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations: [] })
    }), env);
    expect(response.status).toBe(503);
  });
});
