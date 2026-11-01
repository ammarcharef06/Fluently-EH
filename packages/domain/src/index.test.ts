import { describe, expect, it } from 'vitest';
import { evaluateMastery, gradeChoice, scheduleReview } from './index';

describe('mastery engine', () => {
  it('requires new questions, different contexts and repeated success', () => {
    const rule = { version: 'test-1', objectiveId: 'pronouns.subject', minimumDistinctQuestions: 3, minimumDistinctContexts: 2, minimumCorrectRate: 0.8, minimumSuccessfulAttempts: 3 };
    const attempts = [
      { questionId: 'q1', objectiveId: rule.objectiveId, contextId: 'lesson', correct: true, attemptedAt: '2026-01-01T00:00:00Z' },
      { questionId: 'q2', objectiveId: rule.objectiveId, contextId: 'lesson', correct: true, attemptedAt: '2026-01-02T00:00:00Z' },
      { questionId: 'q3', objectiveId: rule.objectiveId, contextId: 'dialogue', correct: true, attemptedAt: '2026-01-03T00:00:00Z' }
    ];
    expect(evaluateMastery(attempts, rule).mastered).toBe(true);
    expect(evaluateMastery(attempts.slice(0, 2), rule).mastered).toBe(false);
  });
});
describe('grading', () => {
  it('returns corrective feedback', () => {
    const result = gradeChoice({
      id: 'q1', objectiveId: 'pronouns.subject', prompt: 'Select the correct word.',
      options: [{ id: 'a', text: 'She' }, { id: 'b', text: 'He' }],
      correctOptionId: 'a', explanationCorrect: 'Correct.', explanationIncorrect: 'Try again.'
    }, 'b');
    expect(result.correct).toBe(false);
    expect(result.feedback).toBe('Try again.');
  });
});
describe('spaced repetition', () => {
  it('schedules a lapse for one day', () => {
    const result = scheduleReview({ itemId: 'card-1', repetitions: 4, intervalDays: 20, ease: 2.5, dueAt: '2026-01-01T00:00:00Z', version: 'fluently-srs-1' }, 1, new Date('2026-01-01T00:00:00Z'));
    expect(result.intervalDays).toBe(1);
    expect(result.repetitions).toBe(0);
  });
});
