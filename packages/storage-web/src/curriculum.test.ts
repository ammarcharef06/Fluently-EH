import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  activateCurriculumPackage,
  downloadAndActivateCurriculum,
  readActiveCurriculumPackage
} from './curriculum';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function packageManifest(
  packageId: string,
  contentVersion: string,
  files: Array<{ path: string; bytes: Uint8Array }>
) {
  return Promise.all(files.map(async (file) => ({
    path: file.path,
    bytes: file.bytes.byteLength,
    sha256: await sha256(file.bytes)
  }))).then((fileEntries) => ({
    packageId,
    contentVersion,
    schemaVersion: 1,
    minAppVersion: '0.1.0',
    maxAppVersion: null,
    generatedAt: '2026-11-01T00:00:00.000Z',
    files: fileEntries,
    rights: []
  }));
}

describe('atomic curriculum activation', () => {
  it('does not replace the active package when downloaded bytes fail the manifest hash', async () => {
    const original = new TextEncoder().encode('first reviewed package');
    const manifest = await packageManifest('fluently.test.integrity', '1.0.0', [
      { path: 'content.json', bytes: original }
    ]);
    const first = await activateCurriculumPackage(manifest, new Map([['content.json', original]]));
    expect(first.ok).toBe(true);

    const altered = new TextEncoder().encode('altered package');
    const failed = await activateCurriculumPackage(manifest, new Map([['content.json', altered]]));
    expect(failed.ok).toBe(false);

    const stored = await readActiveCurriculumPackage(manifest.packageId);
    expect(new TextDecoder().decode(stored?.files.get('content.json'))).toBe('first reviewed package');
  });

  it('downloads every manifest file and activates the complete multi-file package', async () => {
    const packageId = 'fluently.test.multifile.' + crypto.randomUUID();
    const content = new TextEncoder().encode('{"lessons":[]}');
    const lesson = new TextEncoder().encode('# A reviewed lesson');
    const manifest = await packageManifest(packageId, '2.0.0', [
      { path: 'content.json', bytes: content },
      { path: 'lessons/unit-1/lesson.md', bytes: lesson }
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/curriculum/manifest')) return new Response(JSON.stringify(manifest));
      if (url.endsWith('/v1/curriculum/content.json')) return new Response(content);
      if (url.endsWith('/v1/curriculum/files/lessons/unit-1/lesson.md')) return new Response(lesson);
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadAndActivateCurriculum('/api');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const stored = await readActiveCurriculumPackage(packageId);
    expect(new TextDecoder().decode(stored?.files.get('content.json'))).toBe('{"lessons":[]}');
    expect(new TextDecoder().decode(stored?.files.get('lessons/unit-1/lesson.md'))).toBe('# A reviewed lesson');
  });

  it('keeps the current active version when one file of an update cannot be downloaded', async () => {
    const packageId = 'fluently.test.failed-update.' + crypto.randomUUID();
    const currentContent = new TextEncoder().encode('active package v1');
    const currentManifest = await packageManifest(packageId, '1.0.0', [
      { path: 'content.json', bytes: currentContent }
    ]);
    expect((await activateCurriculumPackage(currentManifest, new Map([
      ['content.json', currentContent]
    ]))).ok).toBe(true);

    const nextContent = new TextEncoder().encode('candidate package v2');
    const nextLesson = new TextEncoder().encode('candidate lesson');
    const nextManifest = await packageManifest(packageId, '2.0.0', [
      { path: 'content.json', bytes: nextContent },
      { path: 'lessons/new.md', bytes: nextLesson }
    ]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/curriculum/manifest')) return new Response(JSON.stringify(nextManifest));
      if (url.endsWith('/v1/curriculum/content.json')) return new Response(nextContent);
      if (url.endsWith('/v1/curriculum/files/lessons/new.md')) return new Response('unavailable', { status: 503 });
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadAndActivateCurriculum('/api');

    expect(result).toEqual({ ok: false, reason: 'provider_unavailable' });
    const stored = await readActiveCurriculumPackage(packageId);
    expect(stored?.package.contentVersion).toBe('1.0.0');
    expect(new TextDecoder().decode(stored?.files.get('content.json'))).toBe('active package v1');
  });

  it('rejects invalid manifest metadata before requesting any package file', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      packageId: 'fluently.test.invalid',
      contentVersion: '1.0.0',
      schemaVersion: 2,
      minAppVersion: '0.1.0',
      maxAppVersion: null,
      generatedAt: '2026-11-01T00:00:00.000Z',
      files: [{ path: '../unsafe.txt', bytes: 1, sha256: '0'.repeat(64) }],
      rights: []
    })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadAndActivateCurriculum('/api');

    expect(result).toEqual({ ok: false, reason: 'invalid_manifest' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
