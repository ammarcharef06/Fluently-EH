import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueOperation, pendingOperations, acknowledgeOperations, saveLessonProgress, readLessonProgress, listLessonProgress } from './index';
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


describe('Windows native progress bridge', () => {
  beforeEach(() => {
    delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
  });

  it('saves lesson progress through SQLite without accepting a learner ID', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: { core: { invoke } }
    });

    const progress = {
      lessonId: 'lesson-001',
      completedStepIds: ['step-1', 'step-2'],
      updatedAt: '2026-11-04T06:00:00Z',
      contentVersion: 'content-1'
    };
    await saveLessonProgress(progress);

    expect(invoke).toHaveBeenCalledWith('save_lesson_progress', { progress });
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty('learnerId');
  });

  it('reads one lesson from the native local database', async () => {
    const restored = {
      learnerId: '00000000-0000-4000-8000-000000000001',
      lessonId: 'lesson-001',
      completedStepIds: ['step-1'],
      updatedAt: '2026-11-04T06:00:00Z',
      contentVersion: 'content-1'
    };
    const invoke = vi.fn().mockResolvedValue(restored);
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: { core: { invoke } }
    });

    await expect(readLessonProgress('lesson-001')).resolves.toEqual(restored);
    expect(invoke).toHaveBeenCalledWith('read_lesson_progress', { lessonId: 'lesson-001' });
  });

  it('lists the current native learner progress without a webview identity argument', async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: { core: { invoke } }
    });

    await expect(listLessonProgress()).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledWith('list_lesson_progress', undefined);
  });
});
