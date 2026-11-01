import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enqueueOperation, pendingOperations } from './index';
import { syncPendingOperations } from './sync';

const operation = (id: string) => ({
  operationId: id,
  entityId: 'lesson-1',
  entityType: 'lesson_attempt' as const,
  schemaVersion: 1 as const,
  occurredAtLocal: '2026-11-01T12:00:00.000Z',
  payload: { contentVersion: '0.1.0', correct: true },
  status: 'pending' as const
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('syncPendingOperations', () => {
  it('does not acknowledge local work when the server is unavailable', async () => {
    const item = operation('00000000-0000-4000-8000-000000000001');
    await enqueueOperation(item);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'database_not_configured' }), { status: 503 })));
    const result = await syncPendingOperations('/api');
    expect(result.status).toBe('service_unavailable');
    expect((await pendingOperations()).some((entry) => entry.operationId === item.operationId)).toBe(true);
  });

  it('acknowledges only IDs confirmed by the same server response', async () => {
    const item = operation('00000000-0000-4000-8000-000000000002');
    await enqueueOperation(item);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: [item.operationId], duplicates: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await syncPendingOperations('/api/');
    expect(result).toEqual({ status: 'synced', acknowledged: 1 });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/sync/push', expect.objectContaining({ method: 'POST', credentials: 'include' }));
    expect((await pendingOperations()).some((entry) => entry.operationId === item.operationId)).toBe(false);
  });

  it('rejects unknown IDs in an acknowledgement', async () => {
    const item = operation('00000000-0000-4000-8000-000000000003');
    await enqueueOperation(item);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: ['00000000-0000-4000-8000-000000000099'], duplicates: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })));
    const result = await syncPendingOperations();
    expect(result.status).toBe('invalid_response');
    expect((await pendingOperations()).some((entry) => entry.operationId === item.operationId)).toBe(true);
  });

  it('clears local learning data when the server confirms account deletion', async () => {
    const item = operation('00000000-0000-4000-8000-000000000004');
    await enqueueOperation(item);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'account_deletion_pending' }), { status: 410 })));
    const result = await syncPendingOperations();
    expect(result.status).toBe('account_deletion_pending');
    expect(await pendingOperations()).toEqual([]);
  });
});
