import { describe, expect, it } from 'vitest';
import {
  curriculumIndex,
  draftLessons,
  publishedLessons
} from './index';

describe('draft curriculum index', () => {
  it('validates current draft prerequisites without making drafts available to learners', () => {
    expect(curriculumIndex.ok).toBe(true);
    expect(publishedLessons).toEqual([]);

    if (!curriculumIndex.ok) return;

    expect(curriculumIndex.index.lessons).toHaveLength(draftLessons.length);
    expect(curriculumIndex.index.getPrerequisites('pre-a1.subject-pronouns')).toEqual([
      'literacy.alphabet.a'
    ]);
    expect(curriculumIndex.index.getPrerequisites('pre-a1.i-need')).toEqual([
      'pre-a1.subject-pronouns'
    ]);
    expect(curriculumIndex.index.listPublishedLessons()).toEqual([]);
  });
});
