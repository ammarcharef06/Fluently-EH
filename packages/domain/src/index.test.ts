import { describe, expect, it } from 'vitest';
import { gradeChoice, scheduleReview } from './index';

describe('assessment compatibility exports', () => {
  it('keeps the existing choice grading API available through domain', () => {
    const result = gradeChoice({
      id: 'q1',
      objectiveId: 'pronouns.subject',
      prompt: 'Select the correct word.',
      options: [{ id: 'a', text: 'She' }, { id: 'b', text: 'He' }],
      correctOptionId: 'a',
      explanationCorrect: 'Correct.',
      explanationIncorrect: 'Try again.'
    }, 'b');

    expect(result.correct).toBe(false);
    expect(result.feedback).toBe('Try again.');
  });
});

describe('spaced repetition', () => {
  it('schedules a lapse for one day', () => {
    const result = scheduleReview({
      itemId: 'card-1',
      repetitions: 4,
      intervalDays: 20,
      ease: 2.5,
      dueAt: '2026-01-01T00:00:00Z',
      version: 'fluently-srs-1'
    }, 1, new Date('2026-01-01T00:00:00Z'));

    expect(result.intervalDays).toBe(1);
    expect(result.repetitions).toBe(0);
  });
});
