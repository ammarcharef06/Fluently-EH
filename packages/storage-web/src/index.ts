import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SyncOperation } from '@fluently/domain';

type ProgressRecord = { lessonId: string; completedStepIds: string[]; updatedAt: string; contentVersion: string };
type ReviewRecord = { itemId: string; repetitions: number; intervalDays: number; ease: number; dueAt: string; version: 'fluently-srs-1' };
interface FluentlyDB extends DBSchema {
  progress: { key: string; value: ProgressRecord };
  outbox: { key: string; value: SyncOperation };
  reviews: { key: string; value: ReviewRecord };
  settings: { key: string; value: string | number | boolean };
}
let databasePromise: Promise<IDBPDatabase<FluentlyDB>> | undefined;

export function openFluentlyDB(): Promise<IDBPDatabase<FluentlyDB>> {
  if (!('indexedDB' in globalThis)) throw new Error('IndexedDB is unavailable in this environment.');
  databasePromise ??= openDB<FluentlyDB>('fluently-local', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'lessonId' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'operationId' });
      if (!db.objectStoreNames.contains('reviews')) db.createObjectStore('reviews', { keyPath: 'itemId' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    },
    blocked() { console.warn('A newer Fluently tab is waiting for the database to close.'); },
    blocking() { databasePromise = undefined; }
  });
  return databasePromise;
}
export async function saveLessonProgress(record: ProgressRecord): Promise<void> {
  const db = await openFluentlyDB();
  await db.put('progress', record);
}
export async function readLessonProgress(lessonId: string): Promise<ProgressRecord | undefined> {
  const db = await openFluentlyDB();
  return db.get('progress', lessonId);
}
export async function listLessonProgress(): Promise<ProgressRecord[]> {
  const db = await openFluentlyDB();
  return db.getAll('progress');
}
export async function enqueueOperation(operation: SyncOperation): Promise<void> {
  const db = await openFluentlyDB();
  await db.put('outbox', operation);
}
export async function pendingOperations(limit = 100): Promise<SyncOperation[]> {
  const db = await openFluentlyDB();
  return (await db.getAll('outbox')).filter((item) => item.status === 'pending').slice(0, limit);
}
export async function acknowledgeOperations(operationIds: readonly string[]): Promise<void> {
  const db = await openFluentlyDB();
  const tx = db.transaction('outbox', 'readwrite');
  for (const operationId of operationIds) {
    const operation = await tx.store.get(operationId);
    if (operation) await tx.store.put({ ...operation, status: 'acknowledged' });
  }
  await tx.done;
}
export async function saveReviewState(record: ReviewRecord): Promise<void> {
  const db = await openFluentlyDB();
  await db.put('reviews', record);
}
export async function listReviewStates(): Promise<ReviewRecord[]> {
  const db = await openFluentlyDB();
  return db.getAll('reviews');
}
export async function clearLocalLearningData(): Promise<void> {
  const db = await openFluentlyDB();
  const tx = db.transaction(['progress', 'outbox', 'reviews'], 'readwrite');
  await Promise.all([tx.objectStore('progress').clear(), tx.objectStore('outbox').clear(), tx.objectStore('reviews').clear()]);
  await tx.done;
}
export function requestPersistentStorage(): Promise<boolean> {
  if (!('storage' in navigator) || !navigator.storage?.persist) return Promise.resolve(false);
  return navigator.storage.persist();
}
