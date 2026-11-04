import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
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
