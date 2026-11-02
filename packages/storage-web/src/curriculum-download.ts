import { validateCurriculumManifest, type CurriculumManifest } from '@fluently/content-schema';
import { importCurriculumZip, MAX_CURRICULUM_ZIP_BYTES } from './curriculum-zip';
import { readBoundedResponse } from './curriculum';

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

export type CurriculumZipDownloadResult =
  | { ok: true; manifest: CurriculumManifest }
  | {
      ok: false;
      reason:
        | 'authentication_required'
        | 'not_found'
        | 'provider_unavailable'
        | 'archive_unavailable'
        | 'invalid_manifest'
        | 'archive_too_large'
        | 'integrity_failed';
    };

/**
 * Downloads the trusted manifest separately from the ZIP archive, then lets the
 * ZIP importer validate all archive entries and atomically activate the package.
 */
export async function downloadAndActivateCurriculumZip(apiBase = '/api'): Promise<CurriculumZipDownloadResult> {
  const base = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
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

    const manifestBytes = await readBoundedResponse(manifestResponse, MAX_MANIFEST_BYTES);
    if (!manifestBytes) return { ok: false, reason: 'invalid_manifest' };

    let manifestInput: unknown;
    try {
      manifestInput = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as unknown;
    } catch {
      return { ok: false, reason: 'invalid_manifest' };
    }
    const validation = validateCurriculumManifest(manifestInput);
    if (!validation.ok) return { ok: false, reason: 'invalid_manifest' };

    const archiveResponse = await fetch(base + '/v1/curriculum/package.zip', {
      credentials: 'include',
      headers: { Accept: 'application/zip' }
    });
    if (archiveResponse.status === 401 || archiveResponse.status === 403) {
      return { ok: false, reason: 'authentication_required' };
    }
    if (archiveResponse.status === 404 || archiveResponse.status === 503) {
      return { ok: false, reason: 'archive_unavailable' };
    }
    if (!archiveResponse.ok) return { ok: false, reason: 'provider_unavailable' };

    const contentType = archiveResponse.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/zip') return { ok: false, reason: 'integrity_failed' };

    const archive = await readBoundedResponse(archiveResponse, MAX_CURRICULUM_ZIP_BYTES);
    if (!archive) return { ok: false, reason: 'archive_too_large' };

    const imported = await importCurriculumZip(archive, validation.manifest);
    if (!imported.ok) {
      if (imported.reason === 'invalid_manifest') return { ok: false, reason: 'invalid_manifest' };
      if (imported.reason === 'archive_too_large') return { ok: false, reason: 'archive_too_large' };
      return { ok: false, reason: 'integrity_failed' };
    }

    return { ok: true, manifest: imported.manifest };
  } catch {
    return { ok: false, reason: 'provider_unavailable' };
  }
}
