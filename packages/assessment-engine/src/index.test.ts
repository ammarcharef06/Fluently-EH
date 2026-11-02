import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_SKILLS,
  buildFeedback,
  buildRemediationPlan,
  evaluateMastery,
  evaluatePlacement,
  evaluateStageUnlock,
  gradeChoice,
  gradeTextAnswer,
  revealNextHint,
  type AttemptResult,
  type MasteryRule,
  type PlacementBlueprint,
  type TextAnswerQuestion,
  type TextAnswerPolicy
} from './index';

const masteryRule: MasteryRule = {
  version: 'test-mastery',
  objectiveId: 'objective.reading',
  minimumDistinctQuestions: 2,
  minimumDistinctContexts: 2,
  minimumCorrectRate: 1,
  minimumSuccessfulAttempts: 2
};

function makeAttempt(
  questionId: string,
  contextId: string,
  correct: boolean,
  objectiveId = masteryRule.objectiveId
): AttemptResult {
  return {
    questionId,
    objectiveId,
    contextId,
    correct,
    attemptedAt: '2026-11-01T10:00:00.000Z'
  };
}

describe('assessment skill boundary', () => {
  it('does not include speaking practice in measurable assessment skills', () => {
    expect(ASSESSMENT_SKILLS).not.toContain('speaking-practice');
  });
});

describe('mastery evaluation', () => {
  it('requires the question, context, success and score rules supplied by the blueprint', () => {
    const attempts = [
      makeAttempt('q1', 'lesson-context', true),
      makeAttempt('q2', 'dialogue-context', true)
    ];
    const result = evaluateMastery(attempts, masteryRule);

    expect(result.mastered).toBe(true);
    expect(result.distinctQuestions).toBe(2);
    expect(result.distinctContexts).toBe(2);
    expect(result.successfulAttempts).toBe(2);
    expect(result.correctRate).toBe(1);
  });

  it('does not let repeated attempts at one question inflate distinct-question evidence or success counts', () => {
    const result = evaluateMastery([
      makeAttempt('q1', 'lesson-context', false),
      makeAttempt('q1', 'dialogue-context', false),
      makeAttempt('q2', 'dialogue-context', true)
    ], masteryRule);

    expect(result.distinctQuestions).toBe(2);
    expect(result.distinctContexts).toBe(1);
    expect(result.successfulAttempts).toBe(1);
    expect(result.correctRate).toBe(0.5);
    expect(result.mastered).toBe(false);
  });

  it('uses the latest response for each question and its context as evidence', () => {
    const result = evaluateMastery([
      makeAttempt('q1', 'old-context', true),
      makeAttempt('q1', 'latest-context', false),
      makeAttempt('q2', 'another-context', true)
    ], masteryRule);

    expect(result.distinctQuestions).toBe(2);
    expect(result.distinctContexts).toBe(2);
    expect(result.successfulAttempts).toBe(1);
    expect(result.correctRate).toBe(0.5);
    expect(result.mastered).toBe(false);
  });

  it('rejects invalid mastery configuration instead of applying hidden defaults', () => {
    expect(() => evaluateMastery([], {
      ...masteryRule,
      minimumDistinctQuestions: 0
    })).toThrow('minimumDistinctQuestions');
  });

  it('ignores evidence for other objectives', () => {
    const result = evaluateMastery([
      makeAttempt('q1', 'context-a', true, 'objective.other')
    ], masteryRule);

    expect(result.distinctQuestions).toBe(0);
    expect(result.mastered).toBe(false);
  });
});

describe('grading and feedback', () => {
  it('grades choice questions and returns the authored corrective feedback', () => {
    const result = gradeChoice({
      id: 'choice.1',
      objectiveId: 'objective.pronouns',
      prompt: 'Choose the correct pronoun.',
      options: [{ id: 'she', text: 'She' }, { id: 'he', text: 'He' }],
      correctOptionId: 'she',
      explanationCorrect: 'Correct choice.',
      explanationIncorrect: 'Review the subject pronoun.'
    }, 'he');

    expect(result.correct).toBe(false);
    expect(result.feedback).toBe('Review the subject pronoun.');
    expect(result.expectedOptionId).toBe('she');
  });

  it('rejects duplicate choice option identifiers', () => {
    expect(() => gradeChoice({
      id: 'choice.duplicate',
      objectiveId: 'objective.pronouns',
      prompt: 'Choose one.',
      options: [{ id: 'same', text: 'First' }, { id: 'same', text: 'Second' }],
      correctOptionId: 'same',
      explanationCorrect: 'Correct.',
      explanationIncorrect: 'Try again.'
    }, 'same')).toThrow('unique');
  });

  const textQuestion: TextAnswerQuestion = {
    id: 'text.1',
    objectiveId: 'objective.greetings',
    prompt: 'Enter the greeting.',
    acceptedAnswers: ['Hello', 'Hi'],
    explanationCorrect: 'That greeting is accepted.',
    explanationIncorrect: 'Review the example.',
    exampleOnIncorrect: 'Hello there.',
    remediationObjectiveId: 'objective.greetings.review'
  };

  const exactPolicy: TextAnswerPolicy = {
    caseSensitive: false,
    trimWhitespace: true,
    collapseWhitespace: false
  };

  it('grades text answers with only the normalization rules supplied by the caller', () => {
    const result = gradeTextAnswer(textQuestion, '  HELLO  ', exactPolicy);

    expect(result.correct).toBe(true);
    expect(result.normalizedAnswer).toBe('hello');
    expect(result.feedback).toBe('That greeting is accepted.');
    expect(result.example).toBeNull();
  });

  it('returns the configured example and remediation objective after a wrong text answer', () => {
    const result = gradeTextAnswer(textQuestion, 'Goodbye', exactPolicy);

    expect(result.correct).toBe(false);
    expect(result.feedback).toBe('Review the example.');
    expect(result.example).toBe('Hello there.');
    expect(result.remediationObjectiveId).toBe('objective.greetings.review');
  });

  it('does not collapse internal whitespace unless the policy enables it', () => {
    const result = gradeTextAnswer({
      ...textQuestion,
      acceptedAnswers: ['good morning']
    }, 'good  morning', {
      caseSensitive: true,
      trimWhitespace: true,
      collapseWhitespace: false
    });
    expect(result.correct).toBe(false);
  });

  it('collapses internal whitespace only when the policy enables it', () => {
    const result = gradeTextAnswer({
      ...textQuestion,
      acceptedAnswers: ['good morning']
    }, 'good  morning', {
      caseSensitive: true,
      trimWhitespace: true,
      collapseWhitespace: true
    });
    expect(result.correct).toBe(true);
  });

  it('builds feedback without inventing an example or remedial target', () => {
    expect(buildFeedback(false, {
      correct: 'Correct.',
      incorrect: 'Try again.'
    })).toEqual({
      correct: false,
      message: 'Try again.',
      example: null,
      remediationObjectiveId: null
    });
  });
});

describe('progressive hints', () => {
  it('reveals one hint at a time', () => {
    const hints = ['Read the subject.', 'Check the verb form.'];
    expect(revealNextHint(hints, 0)).toEqual({
      hint: hints[0],
      revealedCount: 1,
      remainingCount: 1,
      complete: false
    });
    expect(revealNextHint(hints, 1).hint).toBe(hints[1]);
    expect(revealNextHint(hints, 2)).toEqual({
      hint: null,
      revealedCount: 2,
      remainingCount: 0,
      complete: true
    });
  });

  it('rejects a hint cursor outside the available range', () => {
    expect(() => revealNextHint(['One hint.'], 2)).toThrow('revealedCount');
  });
});

describe('placement calibration', () => {
  const draftBlueprint: PlacementBlueprint = {
    version: 'test-placement',
    status: 'draft',
    items: [
      { id: 'read.1', stage: 'a1', skill: 'reading', objectiveId: 'reading.a1', weight: 1 },
      { id: 'read.2', stage: 'a1', skill: 'reading', objectiveId: 'reading.a1', weight: 1 },
      { id: 'grammar.1', stage: 'a1', skill: 'grammar', objectiveId: 'grammar.a1', weight: 1 },
      { id: 'grammar.2', stage: 'a1', skill: 'grammar', objectiveId: 'grammar.a1', weight: 1 }
    ],
    calibration: null
  };

  const calibratedBlueprint: PlacementBlueprint = {
    ...draftBlueprint,
    status: 'calibrated',
    calibration: {
      blueprintVersion: 'test-placement',
      sampleSize: 20,
      approvedBy: 'unit-test-reviewer',
      approvedAt: '2026-10-01T00:00:00.000Z',
      thresholdsByStageSkill: { a1: { reading: 0.75, grammar: 0.75 } },
      minimumResponsesByStageSkill: { a1: { reading: 2, grammar: 2 } },
      minimumDistinctContextsByStageSkill: { a1: { reading: 2, grammar: 2 } }
    }
  };

  const placementResponses = [
    { itemId: 'read.1', skill: 'reading' as const, objectiveId: 'reading.a1', correct: true, contextId: 'story', answeredAt: '2026-11-01T10:00:00.000Z' },
    { itemId: 'read.2', skill: 'reading' as const, objectiveId: 'reading.a1', correct: true, contextId: 'sign', answeredAt: '2026-11-01T10:01:00.000Z' },
    { itemId: 'grammar.1', skill: 'grammar' as const, objectiveId: 'grammar.a1', correct: true, contextId: 'chat', answeredAt: '2026-11-01T10:02:00.000Z' },
    { itemId: 'grammar.2', skill: 'grammar' as const, objectiveId: 'grammar.a1', correct: true, contextId: 'dialogue', answeredAt: '2026-11-01T10:03:00.000Z' }
  ];

  it('requires human calibration before assigning a stage', () => {
    expect(evaluatePlacement(draftBlueprint, []).status).toBe('calibration_required');
  });

  it('requires explicit per-skill minimum response configuration', () => {
    const missingPolicy: PlacementBlueprint = {
      ...calibratedBlueprint,
      calibration: {
        ...calibratedBlueprint.calibration!,
        minimumResponsesByStageSkill: { a1: { reading: 2 } }
      }
    };
    const result = evaluatePlacement(missingPolicy, placementResponses);
    expect(result.status).toBe('calibration_required');
    if (result.status === 'calibration_required') {
      expect(result.missingSkills).toContain('grammar');
    }
  });

  it('rejects a calibration evidence requirement greater than the blueprint item count', () => {
    const invalidBlueprint: PlacementBlueprint = {
      ...calibratedBlueprint,
      calibration: {
        ...calibratedBlueprint.calibration!,
        minimumResponsesByStageSkill: { a1: { reading: 3, grammar: 2 } }
      }
    };
    expect(evaluatePlacement(invalidBlueprint, placementResponses).status).toBe('calibration_required');
  });

  it('requires explicit context-diversity policy for every stage and skill', () => {
    const missingContextPolicy: PlacementBlueprint = {
      ...calibratedBlueprint,
      calibration: {
        ...calibratedBlueprint.calibration!,
        minimumDistinctContextsByStageSkill: { a1: { reading: 2 } }
      }
    };
    expect(evaluatePlacement(missingContextPolicy, placementResponses).status).toBe('calibration_required');
  });

  it('does not apply a built-in evidence minimum to an empty blueprint', () => {
    const emptyBlueprint: PlacementBlueprint = {
      version: 'empty-placement',
      status: 'draft',
      items: [],
      calibration: null
    };
    expect(evaluatePlacement(emptyBlueprint, []).status).toBe('calibration_required');
  });

  it('returns insufficient evidence when the configured response count is not met', () => {
    const result = evaluatePlacement(calibratedBlueprint, placementResponses.slice(0, 1));
    expect(result.status).toBe('insufficient_evidence');
    if (result.status === 'insufficient_evidence') {
      expect(result.missingSkills).toContain('reading');
      expect(result.missingSkills).toContain('grammar');
    }
  });

  it('uses the approved thresholds and evidence counts without built-in numeric defaults', () => {
    const result = evaluatePlacement(calibratedBlueprint, placementResponses);
    expect(result.status).toBe('placed');
    if (result.status === 'placed') {
      expect(result.recommendedStage).toBe('a1');
      expect(result.skillRates).toEqual({ reading: 1, grammar: 1 });
      expect(result.evidenceCount).toBe(4);
    }
  });

  it('does not fall back to an unconfigured lowest stage when evidence fails its threshold', () => {
    const incorrectResponses = placementResponses.map((response) => ({ ...response, correct: false }));
    const result = evaluatePlacement(calibratedBlueprint, incorrectResponses);

    expect(result.status).toBe('below_placement_range');
    if (result.status === 'below_placement_range') {
      expect(result.stageSkillRates.a1).toEqual({ reading: 0, grammar: 0 });
    }
  });

  it('uses stage-specific evidence instead of applying one aggregate skill rate to every stage', () => {
    const multiStageBlueprint: PlacementBlueprint = {
      version: 'multi-stage-placement',
      status: 'calibrated',
      items: [
        { id: 'a1.read.1', stage: 'a1', skill: 'reading', objectiveId: 'reading.a1', weight: 1 },
        { id: 'a1.read.2', stage: 'a1', skill: 'reading', objectiveId: 'reading.a1', weight: 1 },
        { id: 'a1.grammar.1', stage: 'a1', skill: 'grammar', objectiveId: 'grammar.a1', weight: 1 },
        { id: 'a1.grammar.2', stage: 'a1', skill: 'grammar', objectiveId: 'grammar.a1', weight: 1 },
        { id: 'b1.read.1', stage: 'b1', skill: 'reading', objectiveId: 'reading.b1', weight: 1 },
        { id: 'b1.read.2', stage: 'b1', skill: 'reading', objectiveId: 'reading.b1', weight: 1 },
        { id: 'b1.grammar.1', stage: 'b1', skill: 'grammar', objectiveId: 'grammar.b1', weight: 1 },
        { id: 'b1.grammar.2', stage: 'b1', skill: 'grammar', objectiveId: 'grammar.b1', weight: 1 }
      ],
      calibration: {
        blueprintVersion: 'multi-stage-placement',
        sampleSize: 30,
        approvedBy: 'unit-test-reviewer',
        approvedAt: '2026-10-01T00:00:00.000Z',
        thresholdsByStageSkill: {
          a1: { reading: 0.75, grammar: 0.75 },
          b1: { reading: 0.75, grammar: 0.75 }
        },
        minimumResponsesByStageSkill: {
          a1: { reading: 2, grammar: 2 },
          b1: { reading: 2, grammar: 2 }
        },
        minimumDistinctContextsByStageSkill: {
          a1: { reading: 2, grammar: 2 },
          b1: { reading: 2, grammar: 2 }
        }
      }
    };
    const responses = [
      { itemId: 'a1.read.1', skill: 'reading' as const, objectiveId: 'reading.a1', correct: true, contextId: 'a1-story', answeredAt: '2026-11-01T10:00:00.000Z' },
      { itemId: 'a1.read.2', skill: 'reading' as const, objectiveId: 'reading.a1', correct: true, contextId: 'a1-sign', answeredAt: '2026-11-01T10:01:00.000Z' },
      { itemId: 'a1.grammar.1', skill: 'grammar' as const, objectiveId: 'grammar.a1', correct: true, contextId: 'a1-chat', answeredAt: '2026-11-01T10:02:00.000Z' },
      { itemId: 'a1.grammar.2', skill: 'grammar' as const, objectiveId: 'grammar.a1', correct: true, contextId: 'a1-dialogue', answeredAt: '2026-11-01T10:03:00.000Z' },
      { itemId: 'b1.read.1', skill: 'reading' as const, objectiveId: 'reading.b1', correct: false, contextId: 'b1-story', answeredAt: '2026-11-01T10:04:00.000Z' },
      { itemId: 'b1.read.2', skill: 'reading' as const, objectiveId: 'reading.b1', correct: false, contextId: 'b1-sign', answeredAt: '2026-11-01T10:05:00.000Z' },
      { itemId: 'b1.grammar.1', skill: 'grammar' as const, objectiveId: 'grammar.b1', correct: false, contextId: 'b1-chat', answeredAt: '2026-11-01T10:06:00.000Z' },
      { itemId: 'b1.grammar.2', skill: 'grammar' as const, objectiveId: 'grammar.b1', correct: false, contextId: 'b1-dialogue', answeredAt: '2026-11-01T10:07:00.000Z' }
    ];
    const result = evaluatePlacement(multiStageBlueprint, responses);

    expect(result.status).toBe('placed');
    if (result.status === 'placed') {
      expect(result.recommendedStage).toBe('a1');
      expect(result.skillRates).toEqual({ reading: 0.5, grammar: 0.5 });
      expect(result.stageSkillRates.a1).toEqual({ reading: 1, grammar: 1 });
      expect(result.stageSkillRates.b1).toEqual({ reading: 0, grammar: 0 });
    }
  });

  it('does not count a duplicate response for the same blueprint item twice', () => {
    const result = evaluatePlacement(calibratedBlueprint, [
      ...placementResponses,
      placementResponses[0]!
    ]);
    expect(result.status).toBe('placed');
    if (result.status === 'placed') expect(result.evidenceCount).toBe(4);
  });
});

describe('stage unlock and remediation', () => {
  it('does not unlock a stage without the matching final assessment', () => {
    const result = evaluateStageUnlock({
      stage: 'a1',
      objectives: [masteryRule],
      assessment: {
        blueprintVersion: 'a1-final-v1',
        minimumScore: 0.8,
        requiredSkills: ['grammar']
      }
    }, [
      makeAttempt('question.1', 'exercise', true),
      makeAttempt('question.2', 'dialogue', true)
    ], null);

    expect(result.unlocked).toBe(false);
    expect(result.reasons).toContain('لم يُجرَ اختبار المستوى النهائي.');
  });

  it('prioritizes repeated misconceptions in remediation', () => {
    const plan = buildRemediationPlan(
      new Map([['pronouns.subject', 1], ['articles.a-an', 4]]),
      new Map([
        ['pronouns.subject', { lessonIds: ['lesson-pronouns'], reason: 'راجع الضمائر.' }],
        ['articles.a-an', { lessonIds: ['lesson-articles'], reason: 'راجع أدوات التنكير.' }]
      ])
    );

    expect(plan[0]?.objectiveId).toBe('articles.a-an');
    expect(plan[0]?.priority).toBe(4);
  });
});
