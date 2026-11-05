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

  it('blocks Windows device names, alternate data streams, and non-portable characters', () => {
    expect(isSafePackagePath('CON.txt')).toBe(false);
    expect(isSafePackagePath('folder/NUL')).toBe(false);
    expect(isSafePackagePath('COM1.log')).toBe(false);
    expect(isSafePackagePath('lesson:payload.txt')).toBe(false);
    expect(isSafePackagePath('lesson?.md')).toBe(false);
    expect(isSafePackagePath('lesson.md.')).toBe(false);
    expect(isSafePackagePath('lesson.md ')).toBe(false);
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

  it('rejects manifests that exceed the declared file-count limit', () => {
    const files = Array.from({ length: 5001 }, (_, index) => ({
      path: 'lesson-' + index + '.md',
      bytes: 0
    }));
    expect(validateCurriculumManifest(manifestFor(files)).ok).toBe(false);
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


describe('lesson review lifecycle', () => {
  const lesson = {
    id: 'pre-a1.review-status-fixture',
    type: 'lesson',
    title: 'Review status fixture',
    description: 'A minimal valid lesson for lifecycle schema tests.',
    stage: 'pre-a1',
    skills: ['grammar'],
    objectives: [{ id: 'objective-1', description: 'Recognize the review lifecycle.' }],
    prerequisites: [],
    estimatedMinutes: 10,
    steps: [{
      id: 'step-1',
      type: 'explanation',
      heading: 'Review lifecycle',
      body: 'This fixture is used only to validate the lesson schema.'
    }],
    contentVersion: '0.1.0',
    source: {
      kind: 'original',
      note: 'Test fixture; not educational content.',
      license: 'CC0-1.0'
    },
    review: {
      reviewerId: null,
      reviewedAt: null,
      approvalNote: null
    }
  };

  it('accepts every content lifecycle state defined by the content standards', async () => {
    const { LessonSchema } = await import('./index');
    const statuses = [
      'draft',
      'in_review',
      'changes_requested',
      'approved',
      'published',
      'retired'
    ] as const;

    for (const status of statuses) {
      expect(LessonSchema.safeParse({ ...lesson, status }).success).toBe(true);
    }
  });

  it('rejects unknown content lifecycle states', async () => {
    const { LessonSchema } = await import('./index');

    expect(LessonSchema.safeParse({
      ...lesson,
      status: 'changes-requested'
    }).success).toBe(false);
  });
});
