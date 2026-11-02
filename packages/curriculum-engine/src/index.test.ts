import { describe, expect, it } from 'vitest';
import type { Lesson } from '@fluently/content-schema';
import {
  compileCurriculumIndex,
  getLessonAvailability,
  listAvailableLessons
} from './index';

function makeLesson(id: string, overrides: Partial<Lesson> = {}): Lesson {
  return {
    id,
    type: 'lesson',
    title: 'Test lesson',
    description: 'A schema-valid lesson used only in unit tests.',
    stage: 'literacy',
    skills: ['literacy'],
    objectives: [{ id: id + '.objective', description: 'Test objective' }],
    prerequisites: [],
    estimatedMinutes: 10,
    steps: [{
      id: id + '.step',
      type: 'explanation',
      heading: 'Test heading',
      body: 'Test body'
    }],
    status: 'published',
    contentVersion: 'test-1',
    source: {
      kind: 'original',
      note: 'Test fixture; not educational release content.',
      license: 'TEST-ONLY'
    },
    review: {
      reviewerId: 'test-reviewer',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      approvalNote: 'Approved only as a unit-test fixture.'
    },
    ...overrides
  };
}

function compiled(lessons: readonly unknown[]) {
  const result = compileCurriculumIndex(lessons);
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.code + ': ' + issue.message).join('\n'));
  return result.index;
}

describe('compileCurriculumIndex', () => {
  it('builds an immutable index for a valid prerequisite graph', () => {
    const first = makeLesson('lesson.first');
    const second = makeLesson('lesson.second', { prerequisites: ['lesson.first'] });
    const index = compiled([first, second]);

    expect(index.lessons.map((lesson) => lesson.id)).toEqual(['lesson.first', 'lesson.second']);
    expect(index.getLesson('lesson.first')?.title).toBe('Test lesson');
    expect(index.getPrerequisites('lesson.second')).toEqual(['lesson.first']);
    expect(index.getLesson('missing')).toBeUndefined();
    expect(index.getPrerequisites('missing')).toBeUndefined();
    expect(index.listPublishedLessons().map((lesson) => lesson.id)).toEqual(['lesson.first', 'lesson.second']);
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.isFrozen(index.lessons)).toBe(true);
    expect(Object.isFrozen(index.getLesson('lesson.first'))).toBe(true);
  });

  it('rejects lesson data that does not match LessonSchema', () => {
    const result = compileCurriculumIndex([{ id: 'bad.lesson', type: 'not-a-lesson' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe('invalid_lesson');
  });

  it('rejects duplicate lesson IDs', () => {
    const result = compileCurriculumIndex([
      makeLesson('lesson.duplicate'),
      makeLesson('lesson.duplicate')
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain('duplicate_lesson_id');
  });

  it('rejects duplicate prerequisite references', () => {
    const result = compileCurriculumIndex([
      makeLesson('lesson.first'),
      makeLesson('lesson.second', { prerequisites: ['lesson.first', 'lesson.first'] })
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain('duplicate_prerequisite');
  });

  it('rejects self-referencing prerequisites', () => {
    const result = compileCurriculumIndex([
      makeLesson('lesson.self', { prerequisites: ['lesson.self'] })
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain('self_prerequisite');
  });

  it('rejects prerequisites that do not exist in the same curriculum index', () => {
    const result = compileCurriculumIndex([
      makeLesson('lesson.child', { prerequisites: ['lesson.missing'] })
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain('unknown_prerequisite');
  });

  it('rejects prerequisite cycles', () => {
    const first = makeLesson('lesson.first', { prerequisites: ['lesson.second'] });
    const second = makeLesson('lesson.second', { prerequisites: ['lesson.first'] });
    const result = compileCurriculumIndex([first, second]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const cycle = result.issues.find((issue) => issue.code === 'prerequisite_cycle');
      expect(cycle?.details).toEqual(expect.arrayContaining(['lesson.first', 'lesson.second']));
    }
  });

  it('rejects a published lesson that depends on a non-published lesson', () => {
    const draft = makeLesson('lesson.draft', { status: 'draft' });
    const published = makeLesson('lesson.published', { prerequisites: ['lesson.draft'] });
    const result = compileCurriculumIndex([draft, published]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('published_prerequisite_not_published');
    }
  });
});

describe('lesson availability', () => {
  const first = makeLesson('lesson.first');
  const second = makeLesson('lesson.second', { prerequisites: ['lesson.first'] });
  const draft = makeLesson('lesson.draft', {
    status: 'draft',
    review: { reviewerId: null, reviewedAt: null, approvalNote: null }
  });
  const index = compiled([first, second, draft]);

  it('blocks a published lesson until the caller reports its prerequisite as satisfied', () => {
    expect(getLessonAvailability(index, 'lesson.second', new Set()).status).toBe('blocked');
    expect(getLessonAvailability(index, 'lesson.second', new Set(['lesson.first'])).status).toBe('available');
  });

  it('does not expose drafts as learner-available lessons', () => {
    expect(getLessonAvailability(index, 'lesson.draft', new Set(['lesson.first'])).status).toBe('not_published');
    expect(listAvailableLessons(index, new Set()).map((lesson) => lesson.id)).toEqual(['lesson.first']);
  });

  it('returns a distinct not-found result', () => {
    expect(getLessonAvailability(index, 'lesson.unknown', new Set())).toEqual({
      status: 'not_found',
      lessonId: 'lesson.unknown'
    });
  });

  it('preserves source order when listing available lessons', () => {
    const later = makeLesson('lesson.later');
    const earlier = makeLesson('lesson.earlier');
    const orderedIndex = compiled([later, earlier]);

    expect(listAvailableLessons(orderedIndex, new Set()).map((lesson) => lesson.id)).toEqual([
      'lesson.later',
      'lesson.earlier'
    ]);
  });
});
