import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { activateCurriculumPackage, readActiveCurriculumPackage } from './curriculum';
import { downloadAndActivateCurriculumZip, type CurriculumZipDownloadResult } from './curriculum-download';
import { MAX_CURRICULUM_ZIP_BYTES } from './curriculum-zip';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function manifestFor(packageId: string, contentVersion: string, content: Uint8Array) {
  return {
    packageId,
    contentVersion,
    schemaVersion: 1,
    minAppVersion: '0.1.0',
    maxAppVersion: null,
    generatedAt: '2026-11-02T10:00:00.000Z',
    files: [{ path: 'content.json', bytes: content.byteLength, sha256: await sha256(content) }],
    rights: []
  };
}

function archiveFor(manifest: unknown, content: Uint8Array): Uint8Array {
  return zipSync({
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'content.json': content
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
}

describe('first-run ZIP curriculum download', () => {
  it('fetches the trusted manifest separately and atomically activates the matching ZIP', async () => {
    const packageId = 'fluently.test.zip.' + crypto.randomUUID();
    const content = new TextEncoder().encode('{"lessons":[]}');
    const manifest = await manifestFor(packageId, '1.0.0', content);
    const archive = archiveFor(manifest, content);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/curriculum/manifest')) return jsonResponse(manifest);
      if (url.endsWith('/v1/curriculum/package.zip')) {
        return new Response(archive, { headers: { 'Content-Type': 'application/zip' } });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadAndActivateCurriculumZip('/api');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/v1/curriculum/manifest',
      '/api/v1/curriculum/package.zip'
    ]);
    const stored = await readActiveCurriculumPackage(packageId);
    expect(new TextDecoder().decode(stored?.files.get('content.json'))).toBe('{"lessons":[]}');
  });

  it('reports an unavailable archive so callers can use the manifest-file transport fallback', async () => {
    const content = new TextEncoder().encode('{"lessons":[]}');
    const manifest = await manifestFor('fluently.test.archive-unavailable', '1.0.0', content);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/v1/curriculum/manifest')) return jsonResponse(manifest);
      return new Response('archive not available', { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadAndActivateCurriculumZip('/api');

    expect(result).toEqual({ ok: false, reason: 'archive_unavailable' });
  });

  it('rejects an oversized ZIP from Content-Length before reading its body', async () => {
    const content = new TextEncoder().encode('{"lessons":[]}');
    const manifest = await manifestFor('fluently.test.zip-too-large', '1.0.0', content);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/v1/curriculum/manifest')) return jsonResponse(manifest);
      return new Response(new Uint8Array(), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': String(MAX_CURRICULUM_ZIP_BYTES + 1)
        }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadAndActivateCurriculumZip('/api');

    expect(result).toEqual({ ok: false, reason: 'archive_too_large' });
    expect(await readActiveCurriculumPackage(manifest.packageId)).toBeNull();
  });

  it('preserves the active package if a downloaded ZIP fails verification', async () => {
    const packageId = 'fluently.test.zip-failed-update.' + crypto.randomUUID();
    const activeContent = new TextEncoder().encode('active package v1');
    const activeManifest = await manifestFor(packageId, '1.0.0', activeContent);
    expect((await activateCurriculumPackage(activeManifest, new Map([
      ['content.json', activeContent]
    ]))).ok).toBe(true);

    const candidateContent = new TextEncoder().encode('candidate package v2');
    const candidateManifest = await manifestFor(packageId, '2.0.0', candidateContent);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/v1/curriculum/manifest')) return jsonResponse(candidateManifest);
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'application/zip' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result: CurriculumZipDownloadResult = await downloadAndActivateCurriculumZip('/api');

    expect(result).toEqual({ ok: false, reason: 'integrity_failed' });
    const stored = await readActiveCurriculumPackage(packageId);
    expect(stored?.package.contentVersion).toBe('1.0.0');
    expect(new TextDecoder().decode(stored?.files.get('content.json'))).toBe('active package v1');
  });
  
  it('stops before fetching the ZIP when the browser quota estimate is insufficient', async () => {
    const packageId = 'fluently.test.quota.' + crypto.randomUUID();
    const content = new TextEncoder().encode('{"lessons":[]}');
    const manifest = await manifestFor(packageId, '1.0.0', content);
    vi.stubGlobal('navigator', {
      storage: { estimate: vi.fn().mockResolvedValue({ quota: 1000, usage: 990 }) }
    });
    const fetchMock = vi.fn(async () => jsonResponse(manifest));
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadAndActivateCurriculumZip('/api');

    expect(result).toEqual({
      ok: false,
      reason: 'storage_quota_insufficient',
      requiredBytes: content.byteLength,
      availableBytes: 10
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readActiveCurriculumPackage(packageId)).toBeNull();
  });
});
