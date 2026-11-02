import {
  validateCurriculumManifest,
  verifyPackageFiles,
  type CurriculumManifest
} from '@fluently/content-schema';
import { openFluentlyDB } from './index';

type StoredPackage = {
  packageId: string;
  contentVersion: string;
  manifest: CurriculumManifest;
  activatedAt: string;
};

type DownloadResult =
  | { ok: true; manifest: CurriculumManifest }
  | {
      ok: false;
      reason:
        | 'authentication_required'
        | 'not_found'
        | 'provider_unavailable'
        | 'invalid_manifest'
        | 'integrity_failed';
    };

async function readBoundedResponse(
  response: Response,
  maxBytes: number
): Promise<Uint8Array | null> {
  const contentLengthHeader = response.headers.get('Content-Length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= maxBytes ? bytes : null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

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

export async function downloadAndActivateCurriculum(apiBase = '/api'): Promise<DownloadResult> {
  const base = apiBase.replace(/\\/$/, '');
  try {
    const manifestResponse = await fetch(base + '/v1/curriculum/manifest', {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    if (manifestResponse.status === 401 || manifestResponse.status === 403) {
      return { ok: false, reason: 'authentication_required' };
    }
    if (manifestResponse.status === 404) return { ok: false, reason: 'not_found' };
    if (!manifestResponse.ok) return { ok: false, reason: 'provider_unavailable' };

    let manifestInput: unknown;
    try {
      manifestInput = await manifestResponse.json() as unknown;
    } catch {
      return { ok: false, reason: 'invalid_manifest' };
    }

    const validation = validateCurriculumManifest(manifestInput);
    if (!validation.ok) return { ok: false, reason: 'invalid_manifest' };
    const manifest = validation.manifest;
    const files = new Map<string, Uint8Array>();

    for (const entry of manifest.files) {
      const encodedPath = entry.path.split('/').map(encodeURIComponent).join('/');
      const endpoint = entry.path === 'content.json'
        ? base + '/v1/curriculum/content.json'
        : base + '/v1/curriculum/files/' + encodedPath;
      const response = await fetch(endpoint, {
        credentials: 'include',
        headers: { Accept: '*/*' }
      });

      if (response.status === 401 || response.status === 403) {
        return { ok: false, reason: 'authentication_required' };
      }
      if (response.status === 404) return { ok: false, reason: 'not_found' };
      if (!response.ok) return { ok: false, reason: 'provider_unavailable' };

      const bytes = await readBoundedResponse(response, entry.bytes);
      if (!bytes || bytes.byteLength !== entry.bytes) {
        return { ok: false, reason: 'integrity_failed' };
      }
      files.set(entry.path, bytes);
    }

    const activated = await activateCurriculumPackage(manifest, files);
    if (!activated.ok) return { ok: false, reason: 'integrity_failed' };
    return { ok: true, manifest: activated.manifest };
  } catch {
    return { ok: false, reason: 'provider_unavailable' };
  }
}
