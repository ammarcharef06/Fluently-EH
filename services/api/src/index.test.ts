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

  it('keeps manifest-declared curriculum file delivery behind authentication', async () => {
    const response = await worker.fetch(new Request(
      'https://api.fluently.test/v1/curriculum/files/lessons/unit-1/lesson.md'
    ), env);
    expect(response.status).toBe(503);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('identity_provider_not_configured');
  });

  it('keeps the curriculum ZIP endpoint behind authentication', async () => {
    const response = await worker.fetch(new Request(
      'https://api.fluently.test/v1/curriculum/package.zip'
    ), env);
    expect(response.status).toBe(503);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('identity_provider_not_configured');
  });
});
