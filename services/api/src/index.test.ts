import { describe, expect, it } from 'vitest';
import app from './index';

describe('API safety defaults', () => {
  it('exposes health without revealing secrets', async () => {
    const response = await app.request('/v1/health', {}, { APP_ENV: 'development' });
    expect(response.status).toBe(200);
    const body = await response.json() as { integrations: Record<string, boolean> };
    expect(body.integrations.identity).toBe(false);
    expect(body.integrations.database).toBe(false);
  });
  it('keeps authentication routes disabled until configured', async () => {
    const response = await app.request('/v1/auth/login', {}, { APP_ENV: 'development' });
    expect(response.status).toBe(503);
  });
  it('does not allow sync without a session', async () => {
    const response = await app.request('/v1/sync/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operations: [] }) }, { APP_ENV: 'development' });
    expect(response.status).toBe(503);
  });
});
