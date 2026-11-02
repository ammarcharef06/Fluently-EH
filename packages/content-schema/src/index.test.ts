import { describe, expect, it } from 'vitest';
import {
  isSafePackagePath,
  validateCurriculumManifest,
  verifyPackageFiles
} from './index';

function manifestFor(
  files: Array<{ path: string; bytes: number; sha256?: string }>,
  schemaVersion = 1
) {
  return {
    packageId: 'fluently.test',
    contentVersion: '0.1.0',
    schemaVersion,
    minAppVersion: '0.1.0',
    maxAppVersion: null,
    generatedAt: '2026-01-01T00:00:00.000Z',
    files: files.map((file) => ({
      path: file.path,
      bytes: file.bytes,
      sha256: file.sha256 ?? '0'.repeat(64)
    })),
    rights: []
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

describe('package paths', () => {
  it('blocks traversal and absolute paths', () => {
    expect(isSafePackagePath('../secret')).toBe(false);
    expect(isSafePackagePath('/etc/passwd')).toBe(false);
    expect(isSafePackagePath('C:/Windows/system.ini')).toBe(false);
    expect(isSafePackagePath('lesson/content.json')).toBe(true);
  });

  it('blocks backslashes and control characters', () => {
    expect(isSafePackagePath('lesson\\\\content.json')).toBe(false);
    expect(isSafePackagePath('lesson/\\u0000secret.txt')).toBe(false);
  });
});

describe('curriculum manifest preflight', () => {
  it('accepts a bounded manifest with multiple nested files', () => {
    const result = validateCurriculumManifest(manifestFor([
      { path: 'content.json', bytes: 128 },
      { path: 'lessons/unit-1/lesson.md', bytes: 512 },
      { path: 'media/example.webp', bytes: 1024 }
    ]));

    expect(result.ok).toBe(true);
  });

  it('rejects an unsupported schema version before file transfer', () => {
    const result = validateCurriculumManifest(manifestFor([
      { path: 'content.json', bytes: 128 }
    ], 2));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('Unsupported schema version.');
  });

  it('rejects traversal, duplicate paths, and the root manifest file', () => {
    const unsafePath = validateCurriculumManifest(manifestFor([
      { path: '../secret.txt', bytes: 1 }
    ]));
    const duplicate = validateCurriculumManifest(manifestFor([
      { path: 'lessons/One.md', bytes: 1 },
      { path: 'lessons/one.md', bytes: 1 }
    ]));
    const reserved = validateCurriculumManifest(manifestFor([
      { path: 'manifest.json', bytes: 1 }
    ]));

    expect(unsafePath.ok).toBe(false);
    expect(duplicate.ok).toBe(false);
    expect(reserved.ok).toBe(false);
  });

  it('rejects empty manifests and declared file sizes beyond package limits', () => {
    expect(validateCurriculumManifest(manifestFor([])).ok).toBe(false);
    expect(validateCurriculumManifest(manifestFor([
      { path: 'large.bin', bytes: 100 * 1024 * 1024 + 1 }
    ])).ok).toBe(false);
    expect(validateCurriculumManifest(manifestFor([
      { path: 'a.bin', bytes: 100 * 1024 * 1024 },
      { path: 'b.bin', bytes: 100 * 1024 * 1024 },
      { path: 'c.bin', bytes: 50 * 1024 * 1024 + 1 }
    ])).ok).toBe(false);
  });
});

describe('package integrity', () => {
  it('accepts multiple files when their declared sizes and SHA-256 values match', async () => {
    const content = new TextEncoder().encode('fluently content');
    const lesson = new TextEncoder().encode('# First reviewed lesson');
    const manifest = manifestFor([
      { path: 'content.json', bytes: content.byteLength, sha256: await sha256(content) },
      { path: 'lessons/first.md', bytes: lesson.byteLength, sha256: await sha256(lesson) }
    ]);

    const result = await verifyPackageFiles(manifest, new Map([
      ['content.json', content],
      ['lessons/first.md', lesson]
    ]));

    expect(result.ok).toBe(true);
  });

  it('rejects altered content against the original manifest hash', async () => {
    const good = new TextEncoder().encode('fluently content');
    const manifest = manifestFor([
      { path: 'content.json', bytes: good.byteLength, sha256: await sha256(good) }
    ]);
    const altered = new TextEncoder().encode('Fluently content');

    const result = await verifyPackageFiles(manifest, new Map([['content.json', altered]]));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('SHA-256 mismatch: content.json');
  });

  it('rejects a missing declared file and an undeclared extra file', async () => {
    const content = new TextEncoder().encode('content');
    const lesson = new TextEncoder().encode('lesson');
    const manifest = manifestFor([
      { path: 'content.json', bytes: content.byteLength, sha256: await sha256(content) },
      { path: 'lesson.md', bytes: lesson.byteLength, sha256: await sha256(lesson) }
    ]);

    const missing = await verifyPackageFiles(manifest, new Map([['content.json', content]]));
    const extra = await verifyPackageFiles(manifest, new Map([
      ['content.json', content],
      ['lesson.md', lesson],
      ['unexpected.txt', new TextEncoder().encode('extra')]
    ]));

    expect(missing.ok).toBe(false);
    expect(extra.ok).toBe(false);
  });
});
