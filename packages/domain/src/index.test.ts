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

import {
  buildRemediationPlan,
  evaluatePlacement,
  evaluateStageUnlock,
  type PlacementBlueprint
} from './index';

describe('placement calibration and evidence', () => {
  const blueprint: PlacementBlueprint = {
    version: 'placement-0.1.0',
    status: 'draft',
    items: [
      { id: 'r1', stage: 'a1', skill: 'reading', objectiveId: 'read.a1', weight: 1 },
      { id: 'r2', stage: 'a1', skill: 'reading', objectiveId: 'read.a1', weight: 1 },
      { id: 'g1', stage: 'a1', skill: 'grammar', objectiveId: 'grammar.a1', weight: 1 },
      { id: 'g2', stage: 'a1', skill: 'grammar', objectiveId: 'grammar.a1', weight: 1 }
    ],
    calibration: null
  };

  it('does not assign a CEFR stage before human calibration', () => {
    expect(evaluatePlacement(blueprint, []).status).toBe('calibration_required');
  });

  it('requires evidence for each measured skill before placement', () => {
    const calibrated: PlacementBlueprint = {
      ...blueprint,
      status: 'calibrated',
      calibration: {
        blueprintVersion: 'placement-0.1.0',
        sampleSize: 300,
        approvedBy: 'reviewer',
        approvedAt: '2026-10-01T00:00:00Z',
        thresholds: { reading: 0.75, grammar: 0.75 }
      }
    };
    const result = evaluatePlacement(calibrated, [
      { itemId: 'r1', skill: 'reading', objectiveId: 'read.a1', correct: true, contextId: 'story', answeredAt: '2026-11-01T10:00:00Z' },
      { itemId: 'r2', skill: 'reading', objectiveId: 'read.a1', correct: true, contextId: 'sign', answeredAt: '2026-11-01T10:01:00Z' },
      { itemId: 'g1', skill: 'grammar', objectiveId: 'grammar.a1', correct: true, contextId: 'chat', answeredAt: '2026-11-01T10:02:00Z' },
      { itemId: 'g2', skill: 'grammar', objectiveId: 'grammar.a1', correct: true, contextId: 'dialogue', answeredAt: '2026-11-01T10:03:00Z' }
    ]);
    expect(result.status).toBe('placed');
    if (result.status === 'placed') expect(result.recommendedStage).toBe('a1');
  });
});

describe('stage unlock and remediation', () => {
  it('does not unlock the next stage without the matching final assessment', () => {
    const result = evaluateStageUnlock({
      stage: 'a1',
      objectives: [{
        version: 'mastery-1',
        objectiveId: 'g.a1',
        minimumDistinctQuestions: 1,
        minimumDistinctContexts: 1,
        minimumCorrectRate: 1,
        minimumSuccessfulAttempts: 1
      }],
      assessment: { blueprintVersion: 'a1-final-v1', minimumScore: 0.8, requiredSkills: ['grammar'] }
    }, [
      { questionId: 'q1', objectiveId: 'g.a1', contextId: 'exercise', correct: true, attemptedAt: '2026-11-01T00:00:00Z' }
    ], null);
    expect(result.unlocked).toBe(false);
  });

  it('prioritizes repeated misconceptions in remediation', () => {
    const plan = buildRemediationPlan(
      new Map([['pronouns.i', 1], ['articles.a-an', 4]]),
      new Map([
        ['pronouns.i', { lessonIds: ['lesson-i'], reason: 'راجع الضمير.' }],
        ['articles.a-an', { lessonIds: ['lesson-articles'], reason: 'راجع أدوات التنكير.' }]
      ])
    );
    expect(plan[0]?.objectiveId).toBe('articles.a-an');
  });
});
