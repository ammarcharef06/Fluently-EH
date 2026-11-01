import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { enqueueOperation, pendingOperations, acknowledgeOperations } from './index';
describe('offline outbox', () => {
  beforeEach(async () => {
    const databases = await indexedDB.databases();
    await Promise.all(databases.filter((db) => db.name === 'fluently-local').map((db) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(db.name!);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    })));
  });
  it('retains operations until explicitly acknowledged', async () => {
    const operation = { operationId: 'op-1', entityId: 'lesson-1', entityType: 'lesson_attempt' as const, schemaVersion: 1 as const, occurredAtLocal: '2026-01-01T00:00:00Z', payload: { correct: true }, status: 'pending' as const };
    await enqueueOperation(operation);
    expect((await pendingOperations()).map((item) => item.operationId)).toEqual(['op-1']);
    await acknowledgeOperations(['op-1']);
    expect(await pendingOperations()).toEqual([]);
  });
});
