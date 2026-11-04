import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SyncOperation } from '@fluently/domain';
import type { CurriculumManifest } from '@fluently/content-schema';

type ProgressRecord = { lessonId: string; completedStepIds: string[]; updatedAt: string; contentVersion: string };
type ReviewRecord = { itemId: string; repetitions: number; intervalDays: number; ease: number; dueAt: string; version: 'fluently-srs-1' };
interface FluentlyDB extends DBSchema {
  progress: { key: string; value: ProgressRecord };
  outbox: { key: string; value: SyncOperation };
  reviews: { key: string; value: ReviewRecord };
  settings: { key: string; value: string | number | boolean };
  curriculumPackages: { key: string; value: { packageId: string; contentVersion: string; manifest: CurriculumManifest; activatedAt: string } };
  curriculumFiles: { key: string; value: { id: string; packageId: string; path: string; contentVersion: string; bytes: ArrayBuffer; sha256: string } };
}
type NativeTauriBridge = {
  core?: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
};

type NativeInvocation<T> =
  | { available: false }
  | { available: true; value: T };

let nativeProgressMigrationCore: NativeTauriBridge['core'] | undefined;
let nativeProgressMigrationPromise: Promise<void> | undefined;

let storageOperationQueue: Promise<void> = Promise.resolve();

function withStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = nativeOperationQueue.then(operation, operation);
  nativeOperationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function getNativeCore(): NonNullable<NativeTauriBridge['core']> | undefined {
  if (typeof window === 'undefined') return undefined;
  const core = (window as Window & { __TAURI__?: NativeTauriBridge }).__TAURI__?.core;
  return typeof core?.invoke === 'function' ? core : undefined;
}

async function ensureNativeProgressMigrated(
  core: NonNullable<NativeTauriBridge['core']>
): Promise<void> {
  if (nativeProgressMigrationCore !== core) {
    nativeProgressMigrationCore = core;
    nativeProgressMigrationPromise = undefined;
  }

  if (!nativeProgressMigrationPromise) {
    const migration = (async () => {
      const db = await openFluentlyDB();
      const legacyProgress = await db.getAll('progress');
      await core.invoke<boolean>('import_legacy_lesson_progress', {
        progress: legacyProgress
      });

      // SQLite has committed the one-time import marker. Only now remove the
      // IndexedDB source so old progress cannot linger as a second authority.
      const transaction = db.transaction('progress', 'readwrite');
      await transaction.store.clear();
      await transaction.done;
    })();
    nativeProgressMigrationPromise = migration;
  }

  try {
    await nativeProgressMigrationPromise;
  } catch (error) {
    nativeProgressMigrationPromise = undefined;
    throw error;
  }
}

async function nativeInvoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<NativeInvocation<T>> {
  const core = getNativeCore();
  if (!core) return { available: false };
  await ensureNativeProgressMigrated(core);
  return { available: true, value: await core.invoke<T>(command, args) };
}

let databasePromise: Promise<IDBPDatabase<FluentlyDB>> | undefined;

export function openFluentlyDB(): Promise<IDBPDatabase<FluentlyDB>> {
  if (!('indexedDB' in globalThis)) throw new Error('IndexedDB is unavailable in this environment.');
  databasePromise ??= openDB<FluentlyDB>('fluently-local', 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'lessonId' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'operationId' });
      if (!db.objectStoreNames.contains('reviews')) db.createObjectStore('reviews', { keyPath: 'itemId' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      if (!db.objectStoreNames.contains('curriculumPackages')) db.createObjectStore('curriculumPackages', { keyPath: 'packageId' });
      if (!db.objectStoreNames.contains('curriculumFiles')) db.createObjectStore('curriculumFiles', { keyPath: 'id' });
    },
    blocked() { console.warn('A newer Fluently tab is waiting for the database to close.'); },
    blocking() { databasePromise = undefined; }
  });
  return databasePromise;
}
export async function saveLessonProgress(record: ProgressRecord): Promise<void> {
  await withStorageOperation(async () => {
    const native = await nativeInvoke<void>('save_lesson_progress', { progress: record });
    if (native.available) return;
    const db = await openFluentlyDB();
    await db.put('progress', record);
  });
}
export async function readLessonProgress(lessonId: string): Promise<ProgressRecord | undefined> {
  return withStorageOperation(async () => {
    const native = await nativeInvoke<ProgressRecord | null>('read_lesson_progress', { lessonId });
    if (native.available) return native.value ?? undefined;
    const db = await openFluentlyDB();
    return db.get('progress', lessonId);
  });
}
export async function listLessonProgress(): Promise<ProgressRecord[]> {
  return withStorageOperation(async () => {
    const native = await nativeInvoke<ProgressRecord[]>('list_lesson_progress');
    if (native.available) return native.value;
    const db = await openFluentlyDB();
    return db.getAll('progress');
  });
}
export async function enqueueOperation(operation: SyncOperation): Promise<void> {
  await withStorageOperation(async () => {
    const db = await openFluentlyDB();
    await db.put('outbox', operation);
  });
}
export async function pendingOperations(limit = 100): Promise<SyncOperation[]> {
  return withStorageOperation(async () => {
    const db = await openFluentlyDB();
    return (await db.getAll('outbox')).filter((item) => item.status === 'pending').slice(0, limit);
  });
}
export async function acknowledgeOperations(operationIds: readonly string[]): Promise<void> {
  await withStorageOperation(async () => {
    const db = await openFluentlyDB();
    const tx = db.transaction('outbox', 'readwrite');
    for (const operationId of operationIds) {
      const operation = await tx.store.get(operationId);
      if (operation) await tx.store.put({ ...operation, status: 'acknowledged' });
    }
    await tx.done;
  });
}
export async function saveReviewState(record: ReviewRecord): Promise<void> {
  await withStorageOperation(async () => {
    const db = await openFluentlyDB();
    await db.put('reviews', record);
  });
}
export async function listReviewStates(): Promise<ReviewRecord[]> {
  return withStorageOperation(async () => {
    const db = await openFluentlyDB();
    return db.getAll('reviews');
  });
}
export async function saveSetting(key: string, value: string | number | boolean): Promise<void> {
  await withStorageOperation(async () => {
    const db = await openFluentlyDB();
    await db.put('settings', value, key);
  });
}
export async function readSetting(key: string): Promise<string | number | boolean | undefined> {
  return withStorageOperation(async () => {
    const db = await openFluentlyDB();
    return db.get('settings', key);
  });
}
export async function clearLocalLearningData(): Promise<void> {
  const core = getNativeCore();
  const storeNames = ['progress', 'outbox', 'reviews', 'settings'] as const;

  await withStorageOperation(async () => {
    const db = await openFluentlyDB();
    if (!core) {
      const tx = db.transaction(storeNames, 'readwrite');
      await Promise.all([
        tx.objectStore('progress').clear(),
        tx.objectStore('outbox').clear(),
        tx.objectStore('reviews').clear(),
        tx.objectStore('settings').clear()
      ]);
      await tx.done;
      return;
    }

    // Serialize all storage reads and writes with the snapshot/wipe/rollback sequence.
    const tx = db.transaction(storeNames, 'readwrite');
    const [progressSnapshot, outboxSnapshot, reviewSnapshot, settingSnapshot, settingKeys] =
      await Promise.all([
        tx.objectStore('progress').getAll(),
        tx.objectStore('outbox').getAll(),
        tx.objectStore('reviews').getAll(),
        tx.objectStore('settings').getAll(),
        tx.objectStore('settings').getAllKeys()
      ]);
    await Promise.all([
      tx.objectStore('progress').clear(),
      tx.objectStore('outbox').clear(),
      tx.objectStore('reviews').clear(),
      tx.objectStore('settings').clear()
    ]);
    await tx.done;

    try {
      await core.invoke<void>('clear_local_learning_data');
    } catch (error) {
      // SQLite deletion is atomic. Restore the IndexedDB snapshot if the native
      // transaction fails so a partial cross-store wipe does not discard data.
      const rollback = db.transaction(storeNames, 'readwrite');
      const restoreRequests: Promise<unknown>[] = [
        ...progressSnapshot.map((record) => rollback.objectStore('progress').put(record)),
        ...outboxSnapshot.map((record) => rollback.objectStore('outbox').put(record)),
        ...reviewSnapshot.map((record) => rollback.objectStore('reviews').put(record)),
        ...settingSnapshot.map((value, index) =>
          rollback.objectStore('settings').put(value, settingKeys[index])
        )
      ];
      try {
        await Promise.all(restoreRequests);
        await rollback.done;
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Native local-data deletion and IndexedDB restoration both failed.',
          { cause: rollbackError }
        );
      }
      throw error;
    }

    nativeProgressMigrationCore = undefined;
    nativeProgressMigrationPromise = undefined;
  });
}
export function requestPersistentStorage(): Promise<boolean> {
  if (!('storage' in navigator) || !navigator.storage?.persist) return Promise.resolve(false);
  return navigator.storage.persist();
}
