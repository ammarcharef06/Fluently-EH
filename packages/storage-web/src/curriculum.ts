import { CurriculumManifestSchema, verifyPackageFiles, type CurriculumManifest } from '@fluently/content-schema';
import { openFluentlyDB } from './index';

type StoredPackage = { packageId: string; contentVersion: string; manifest: CurriculumManifest; activatedAt: string };

export async function activateCurriculumPackage(
  manifestInput: unknown,
  files: ReadonlyMap<string, Uint8Array>
): Promise<{ ok: true; manifest: CurriculumManifest } | { ok: false; errors: string[] }> {
  const verified = await verifyPackageFiles(manifestInput, files);
  if (!verified.ok) return verified;

  const db = await openFluentlyDB();
  const manifest = verified.manifest;
  const tx = db.transaction(['curriculumPackages', 'curriculumFiles'], 'readwrite');
  const fileStore = tx.objectStore('curriculumFiles');
  const existing = await fileStore.getAll();
  for (const item of existing) {
    if (item.packageId === manifest.packageId) await fileStore.delete(item.id);
  }

  for (const entry of manifest.files) {
    const bytes = files.get(entry.path);
    if (!bytes) {
      tx.abort();
      return { ok: false, errors: ['Missing file after integrity verification: ' + entry.path] };
    }
    const copy = bytes.slice();
    await fileStore.put({
      id: manifest.packageId + ':' + entry.path,
      packageId: manifest.packageId,
      path: entry.path,
      contentVersion: manifest.contentVersion,
      bytes: copy.buffer,
      sha256: entry.sha256
    });
  }
  await tx.objectStore('curriculumPackages').put({
    packageId: manifest.packageId,
    contentVersion: manifest.contentVersion,
    manifest,
    activatedAt: new Date().toISOString()
  });
  await tx.done;
  return { ok: true, manifest };
}

export async function readActiveCurriculumPackage(packageId: string): Promise<{
  package: StoredPackage;
  files: Map<string, Uint8Array>;
} | null> {
  const db = await openFluentlyDB();
  const packageRecord = await db.get('curriculumPackages', packageId);
  if (!packageRecord) return null;
  const allFiles = await db.getAll('curriculumFiles');
  const files = new Map<string, Uint8Array>();
  for (const file of allFiles) {
    if (file.packageId === packageId && file.contentVersion === packageRecord.contentVersion) {
      files.set(file.path, new Uint8Array(file.bytes));
    }
  }
  return { package: packageRecord, files };
}

export async function downloadAndActivateCurriculum(apiBase = '/api'): Promise<{
  ok: true; manifest: CurriculumManifest
} | { ok: false; reason: 'authentication_required' | 'not_found' | 'provider_unavailable' | 'unsupported_package' | 'invalid_manifest' | 'integrity_failed' }> {
  const base = apiBase.replace(/\/$/, '');
  try {
    const manifestResponse = await fetch(base + '/v1/curriculum/manifest', { credentials: 'include', headers: { Accept: 'application/json' } });
    if (manifestResponse.status === 401 || manifestResponse.status === 403) return { ok: false, reason: 'authentication_required' };
    if (manifestResponse.status === 404) return { ok: false, reason: 'not_found' };
    if (manifestResponse.status === 503) return { ok: false, reason: 'provider_unavailable' };
    if (!manifestResponse.ok) return { ok: false, reason: 'provider_unavailable' };

    const parsed = CurriculumManifestSchema.safeParse(await manifestResponse.json());
    if (!parsed.success) return { ok: false, reason: 'invalid_manifest' };
    const manifest = parsed.data;
    if (manifest.files.length !== 1 || manifest.files[0]?.path !== 'content.json') {
      return { ok: false, reason: 'unsupported_package' };
    }

    const contentResponse = await fetch(base + '/v1/curriculum/content.json', {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    if (contentResponse.status === 401 || contentResponse.status === 403) return { ok: false, reason: 'authentication_required' };
    if (contentResponse.status === 503 || !contentResponse.ok) return { ok: false, reason: 'provider_unavailable' };
    const bytes = new Uint8Array(await contentResponse.arrayBuffer());
    const result = await activateCurriculumPackage(manifest, new Map([['content.json', bytes]]));
    if (!result.ok) return { ok: false, reason: 'integrity_failed' };
    return { ok: true, manifest: result.manifest };
  } catch {
    return { ok: false, reason: 'provider_unavailable' };
  }
}
