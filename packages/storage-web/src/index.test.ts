import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeOperations,
  clearLocalLearningData,
  enqueueOperation,
  listLessonProgress,
  listReviewStates,
  openFluentlyDB,
  pendingOperations,
  readLessonProgress,
  readSetting,
  saveLessonProgress,
  saveReviewState,
  saveSetting
} from './index';

describe('web IndexedDB learning storage', () => {
  beforeEach(async () => {
    delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
    const db = await openFluentlyDB();
    await Promise.all([
      db.clear('progress'),
      db.clear('outbox'),
      db.clear('reviews'),
      db.clear('settings')
    ]);
  });

  it('persists lesson progress and reads it back by lesson id', async () => {
    const progress = {
      lessonId: 'lesson-1',
      completedStepIds: ['step-1', 'step-2'],
      updatedAt: '2026-01-01T00:00:00.000Z',
      contentVersion: 'draft-1'
    };

    await saveLessonProgress(progress);

    await expect(readLessonProgress('lesson-1')).resolves.toEqual(progress);
    await expect(listLessonProgress()).resolves.toEqual([progress]);
  });

  it('updates an existing lesson progress record instead of creating a duplicate', async () => {
    await saveLessonProgress({
      lessonId: 'lesson-1',
      completedStepIds: ['step-1'],
      updatedAt: '2026-01-01T00:00:00.000Z',
      contentVersion: 'draft-1'
    });
    const updated = {
      lessonId: 'lesson-1',
      completedStepIds: ['step-1', 'step-2'],
      updatedAt: '2026-01-02T00:00:00.000Z',
      contentVersion: 'draft-2'
    };

    await saveLessonProgress(updated);

    await expect(listLessonProgress()).resolves.toEqual([updated]);
  });

  it('retains operations until explicitly acknowledged', async () => {
    const operation = {
      operationId: 'op-1',
      entityId: 'lesson-1',
      entityType: 'lesson_attempt' as const,
      schemaVersion: 1 as const,
      occurredAtLocal: '2026-01-01T00:00:00Z',
      payload: { correct: true },
      status: 'pending' as const
    };

    await enqueueOperation(operation);

    await expect(pendingOperations()).resolves.toEqual([operation]);

    await acknowledgeOperations(['op-1']);

    await expect(pendingOperations()).resolves.toEqual([]);
  });

  it('persists review state and learner settings', async () => {
    const review = {
      itemId: 'question-1',
      repetitions: 2,
      intervalDays: 3,
      ease: 2.5,
      dueAt: '2026-01-04T00:00:00.000Z',
      version: 'fluently-srs-1' as const
    };

    await saveReviewState(review);
    await saveSetting('interfaceLocale', 'en-GB');

    await expect(listReviewStates()).resolves.toEqual([review]);
    await expect(readSetting('interfaceLocale')).resolves.toBe('en-GB');
  });

  it('clears progress, outbox, review state, and settings', async () => {
    const db = await openFluentlyDB();
    await saveLessonProgress({
      lessonId: 'lesson-1',
      completedStepIds: ['step-1'],
      updatedAt: '2026-01-01T00:00:00.000Z',
      contentVersion: 'draft-1'
    });
    await enqueueOperation({
      operationId: 'op-1',
      entityId: 'lesson-1',
      entityType: 'lesson_attempt',
      schemaVersion: 1,
      occurredAtLocal: '2026-01-01T00:00:00Z',
      payload: { correct: true },
      status: 'pending'
    });
    await saveReviewState({
      itemId: 'question-1',
      repetitions: 1,
      intervalDays: 1,
      ease: 2.5,
      dueAt: '2026-01-02T00:00:00.000Z',
      version: 'fluently-srs-1'
    });
    await saveSetting('interfaceLocale', 'ar');

    await clearLocalLearningData();

    await expect(listLessonProgress()).resolves.toEqual([]);
    await expect(db.getAll('outbox')).resolves.toEqual([]);
    await expect(listReviewStates()).resolves.toEqual([]);
    await expect(readSetting('interfaceLocale')).resolves.toBeUndefined();
  });
});

describe('Windows native progress bridge', () => {
  beforeEach(async () => {
    delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
    const db = await openFluentlyDB();
    await db.clear('progress');
  });

  it('imports existing IndexedDB progress once before saving through SQLite', async () => {
    const legacy = {
      lessonId: 'lesson-legacy',
      completedStepIds: ['step-1'],
      updatedAt: '2026-11-03T06:00:00Z',
      contentVersion: 'content-legacy'
    };
    await saveLessonProgress(legacy);

    const invoke = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      if (command === 'import_legacy_lesson_progress') return true;
      return undefined;
    });
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

    expect(invoke).toHaveBeenNthCalledWith(1, 'import_legacy_lesson_progress', {
      progress: [legacy]
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'save_lesson_progress', { progress });
    expect(invoke.mock.calls[1]?.[1]).not.toHaveProperty('learnerId');
    const db = await openFluentlyDB();
    await expect(db.getAll('progress')).resolves.toEqual([]);
  });

  it('retains IndexedDB progress when import fails and clears it only after a successful retry', async () => {
    const legacy = {
      lessonId: 'lesson-retry',
      completedStepIds: ['step-1'],
      updatedAt: '2026-11-03T06:00:00Z',
      contentVersion: 'content-legacy'
    };
    await saveLessonProgress(legacy);

    let importAttempts = 0;
    const invoke = vi.fn(async (command: string) => {
      if (command === 'import_legacy_lesson_progress') {
        importAttempts += 1;
        if (importAttempts === 1) throw new Error('temporary SQLite import failure');
        return true;
      }
      return undefined;
    });
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: { core: { invoke } }
    });

    const current = {
      lessonId: 'lesson-current',
      completedStepIds: ['step-2'],
      updatedAt: '2026-11-04T06:00:00Z',
      contentVersion: 'content-1'
    };

    await expect(saveLessonProgress(current)).rejects.toThrow('temporary SQLite import failure');
    const db = await openFluentlyDB();
    await expect(db.getAll('progress')).resolves.toEqual([legacy]);

    await expect(saveLessonProgress(current)).resolves.toBeUndefined();
    expect(importAttempts).toBe(2);
    expect(invoke).toHaveBeenCalledTimes(3);
    await expect(db.getAll('progress')).resolves.toEqual([]);
    expect(invoke).toHaveBeenLastCalledWith('save_lesson_progress', { progress: current });
  });

  it('reads one lesson from the native local database after the one-time migration', async () => {
    const restored = {
      learnerId: '00000000-0000-4000-8000-000000000001',
      lessonId: 'lesson-001',
      completedStepIds: ['step-1'],
      updatedAt: '2026-11-04T06:00:00Z',
      contentVersion: 'content-1'
    };
    const invoke = vi.fn(async (command: string) => {
      if (command === 'import_legacy_lesson_progress') return true;
      if (command === 'read_lesson_progress') return restored;
      return undefined;
    });
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: { core: { invoke } }
    });

    await expect(readLessonProgress('lesson-001')).resolves.toEqual(restored);
    expect(invoke).toHaveBeenNthCalledWith(1, 'import_legacy_lesson_progress', { progress: [] });
    expect(invoke).toHaveBeenNthCalledWith(2, 'read_lesson_progress', { lessonId: 'lesson-001' });
  });

  it('clears native SQLite progress when local learning data is deleted', async () => {
    const legacy = {
      lessonId: 'lesson-legacy',
      completedStepIds: ['step-1'],
      updatedAt: '2026-11-03T06:00:00Z',
      contentVersion: 'content-legacy'
    };
    await saveLessonProgress(legacy);

    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      calls.push([command, args]);
      return undefined;
    });
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: { core: { invoke } }
    });

    await clearLocalLearningData();

    expect(calls[0]).toEqual(['import_legacy_lesson_progress', { progress: [] }]);
    expect(calls[1]).toEqual(['clear_local_learning_data', undefined]);
    const db = await openFluentlyDB();
    await expect(db.getAll('progress')).resolves.toEqual([]);

    await saveLessonProgress({
      lessonId: 'lesson-after-clear',
      completedStepIds: ['step-new'],
      updatedAt: '2026-11-04T07:00:00Z',
      contentVersion: 'content-2'
    });
    expect(calls[2]).toEqual(['import_legacy_lesson_progress', { progress: [] }]);
    expect(calls[3]?.[0]).toBe('save_lesson_progress');
  });

  it('lists current native learner progress without a webview identity argument', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'import_legacy_lesson_progress') return true;
      return [];
    });
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: { core: { invoke } }
    });

    await expect(listLessonProgress()).resolves.toEqual([]);
    expect(invoke).toHaveBeenNthCalledWith(1, 'import_legacy_lesson_progress', { progress: [] });
    expect(invoke).toHaveBeenNthCalledWith(2, 'list_lesson_progress', undefined);
  });
});
