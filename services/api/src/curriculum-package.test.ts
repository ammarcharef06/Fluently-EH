import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { LessonSchema, validateCurriculumManifest, verifyPackageFiles } from '@fluently/content-schema';
import { buildCurriculumArchive } from './curriculum-package';

function lesson(id: string, status: 'approved' | 'published' | 'draft' = 'approved') {
  return {
    id,
    type: 'lesson',
    title: 'A reviewed lesson',
    description: 'A test lesson for archive verification.',
    stage: 'pre-a1',
    skills: ['vocabulary'],
    objectives: [{ id: id + '.objective', description: 'Recognize a familiar word.' }],
    prerequisites: [],
    estimatedMinutes: 5,
    steps: [{
      id: id + '.step',
      type: 'explanation',
      heading: 'A word',
      body: 'Learn one familiar word.'
    }],
    status,
    contentVersion: '1.0.0',
    source: { kind: 'original', note: 'Synthetic test fixture.', license: 'CC0-1.0' },
    review: {
      reviewerId: status === 'draft' ? null : 'reviewer-test',
      reviewedAt: status === 'draft' ? null : '2026-11-02T10:00:00.000Z',
      approvalNote: status === 'draft' ? null : 'Approved synthetic test fixture.'
    }
  };
}

describe('trusted curriculum ZIP package builder', () => {
  it('builds a ZIP containing a trusted manifest, aggregate content, and individually hashed lessons', async () => {
    const built = await buildCurriculumArchive([
      lesson('pre-a1.lesson-one'),
      lesson('pre-a1.lesson-two', 'published')
    ], '1.2.3', '2026-11-02T10:00:00.000Z');

    const entries = unzipSync(built.archive);
    expect(Object.keys(entries).sort()).toEqual([
      'content.json',
      'lessons/pre-a1.lesson-one.json',
      'lessons/pre-a1.lesson-two.json',
      'manifest.json'
    ]);

    const embeddedManifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']!)) as unknown;
    expect(validateCurriculumManifest(embeddedManifest).ok).toBe(true);
    const verified = await verifyPackageFiles(embeddedManifest, new Map(
      Object.entries(entries)
        .filter(([path]) => path !== 'manifest.json')
        .map(([path, bytes]) => [path, bytes])
    ));
    expect(verified.ok).toBe(true);
    expect(built.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(built.archiveSha256).toMatch(/^[a-f0-9]{64}$/);

    const aggregate = JSON.parse(new TextDecoder().decode(entries['content.json']!)) as { lessons: unknown[] };
    expect(aggregate.lessons).toHaveLength(2);
    expect(LessonSchema.safeParse(JSON.parse(new TextDecoder().decode(entries['lessons/pre-a1.lesson-one.json']!))).success).toBe(true);
  });

  it('refuses to create a release without lessons', async () => {
    await expect(buildCurriculumArchive([], '1.0.0')).rejects.toThrow('requires human-approved lessons');
  });

  it('refuses draft or incompletely reviewed lessons', async () => {
    await expect(buildCurriculumArchive([lesson('pre-a1.draft', 'draft')], '1.0.0'))
      .rejects.toThrow('without complete human approval');
  });

  it('refuses duplicate lesson IDs and invalid content versions', async () => {
    await expect(buildCurriculumArchive([lesson('pre-a1.same'), lesson('pre-a1.same')], '1.0.0'))
      .rejects.toThrow('duplicate lesson IDs');
    await expect(buildCurriculumArchive([lesson('pre-a1.valid')], 'v1'))
      .rejects.toThrow('MAJOR.MINOR.PATCH');
  });
});
