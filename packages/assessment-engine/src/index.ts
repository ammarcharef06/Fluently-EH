export const LEARNING_STAGES = ['literacy', 'pre-a1', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2'] as const;

export type LearningStage = typeof LEARNING_STAGES[number];

export const ASSESSMENT_SKILLS = [
  'literacy',
  'reading',
  'writing',
  'listening',
  'grammar',
  'vocabulary'
] as const;

export type AssessmentSkill = typeof ASSESSMENT_SKILLS[number];

export type AttemptResult = {
  questionId: string;
  objectiveId: string;
  contextId: string;
  correct: boolean;
  attemptedAt: string;
};

export type MasteryRule = {
  version: string;
  objectiveId: string;
  minimumDistinctQuestions: number;
  minimumDistinctContexts: number;
  minimumCorrectRate: number;
  minimumSuccessfulAttempts: number;
};

export type MasteryResult = {
  objectiveId: string;
  mastered: boolean;
  correctRate: number;
  distinctQuestions: number;
  distinctContexts: number;
  /**
   * Kept for compatibility. This is the number of distinct questions
   * whose latest recorded response is correct, not the raw retry count.
   */
  successfulAttempts: number;
  reasons: string[];
};

export type FeedbackContent = {
  correct: string;
  incorrect: string;
  example?: string;
  remediationObjectiveId?: string;
};

export type FeedbackResult = {
  correct: boolean;
  message: string;
  example: string | null;
  remediationObjectiveId: string | null;
};

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(field + ' must be a non-empty string.');
  }
}

function assertScore(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(field + ' must be between 0 and 1.');
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(field + ' must be a positive integer.');
  }
}

function assertMasteryRule(rule: MasteryRule): void {
  assertNonEmpty(rule.version, 'Mastery rule version');
  assertNonEmpty(rule.objectiveId, 'Mastery objectiveId');
  assertPositiveInteger(rule.minimumDistinctQuestions, 'minimumDistinctQuestions');
  assertPositiveInteger(rule.minimumDistinctContexts, 'minimumDistinctContexts');
  assertPositiveInteger(rule.minimumSuccessfulAttempts, 'minimumSuccessfulAttempts');
  assertScore(rule.minimumCorrectRate, 'minimumCorrectRate');
}

function assertAttempt(attempt: AttemptResult): void {
  assertNonEmpty(attempt.questionId, 'Attempt questionId');
  assertNonEmpty(attempt.objectiveId, 'Attempt objectiveId');
  assertNonEmpty(attempt.contextId, 'Attempt contextId');
  if (typeof attempt.correct !== 'boolean') {
    throw new TypeError('Attempt correct must be a boolean.');
  }
  if (!Number.isFinite(Date.parse(attempt.attemptedAt))) {
    throw new TypeError('Attempt attemptedAt must be a valid date string.');
  }
}

/**
 * Evaluates configured mastery rules without supplying product defaults.
 *
 * Only the latest attempt for each question ID contributes evidence.
 * Retries therefore cannot inflate question, context, success, or rate counts,
 * and a later incorrect retry can no longer be masked by an earlier success.
 */
export function evaluateMastery(
  attempts: readonly AttemptResult[],
  rule: MasteryRule
): MasteryResult {
  assertMasteryRule(rule);

  const relevant = attempts.filter((item) => item.objectiveId === rule.objectiveId);
  const latestAttemptByQuestion = new Map<string, AttemptResult>();

  for (const attempt of relevant) {
    assertAttempt(attempt);
    const previous = latestAttemptByQuestion.get(attempt.questionId);
    if (
      !previous ||
      Date.parse(attempt.attemptedAt) >= Date.parse(previous.attemptedAt)
    ) {
      latestAttemptByQuestion.set(attempt.questionId, attempt);
    }
  }

  const latestAttempts = [...latestAttemptByQuestion.values()];
  const questions = new Set(latestAttempts.map((attempt) => attempt.questionId));
  const contexts = new Set(latestAttempts.map((attempt) => attempt.contextId));
  const successfulAttempts = latestAttempts.filter((attempt) => attempt.correct).length;
  const correctRate = questions.size === 0 ? 0 : successfulAttempts / questions.size;
  const reasons: string[] = [];

  if (questions.size < rule.minimumDistinctQuestions) reasons.push('أسئلة جديدة غير كافية');
  if (contexts.size < rule.minimumDistinctContexts) reasons.push('التطبيق في سياقات جديدة غير كافٍ');
  if (successfulAttempts < rule.minimumSuccessfulAttempts) reasons.push('عدد الأسئلة الصحيحة المميزة غير كافٍ');
  if (correctRate < rule.minimumCorrectRate) reasons.push('معدل الإجابات الصحيحة دون الحد المعتمد');

  return {
    objectiveId: rule.objectiveId,
    mastered: reasons.length === 0,
    correctRate,
    distinctQuestions: questions.size,
    distinctContexts: contexts.size,
    successfulAttempts,
    reasons
  };
}

export type ChoiceQuestion = {
  id: string;
  objectiveId: string;
  prompt: string;
  options: readonly { id: string; text: string }[];
  correctOptionId: string;
  explanationCorrect: string;
  explanationIncorrect: string;
  exampleOnIncorrect?: string;
  remediationObjectiveId?: string;
};

export type GradeResult = {
  correct: boolean;
  selectedOptionId: string;
  expectedOptionId: string;
  feedback: string;
  example: string | null;
  remediationObjectiveId: string | null;
};

export function buildFeedback(correct: boolean, content: FeedbackContent): FeedbackResult {
  assertNonEmpty(content.correct, 'Correct feedback');
  assertNonEmpty(content.incorrect, 'Incorrect feedback');
  if (content.example !== undefined) assertNonEmpty(content.example, 'Feedback example');
  if (content.remediationObjectiveId !== undefined) {
    assertNonEmpty(content.remediationObjectiveId, 'Remediation objectiveId');
  }

  return {
    correct,
    message: correct ? content.correct : content.incorrect,
    example: correct ? null : content.example ?? null,
    remediationObjectiveId: correct ? null : content.remediationObjectiveId ?? null
  };
}

function validateChoiceQuestion(question: ChoiceQuestion): void {
  assertNonEmpty(question.id, 'Question id');
  assertNonEmpty(question.objectiveId, 'Question objectiveId');
  assertNonEmpty(question.prompt, 'Question prompt');
  assertNonEmpty(question.correctOptionId, 'Correct option id');
  assertNonEmpty(question.explanationCorrect, 'Correct explanation');
  assertNonEmpty(question.explanationIncorrect, 'Incorrect explanation');

  if (question.options.length < 2) {
    throw new RangeError('A choice question must contain at least two options.');
  }

  const optionIds = new Set<string>();
  for (const option of question.options) {
    assertNonEmpty(option.id, 'Option id');
    assertNonEmpty(option.text, 'Option text');
    if (optionIds.has(option.id)) throw new Error('Option IDs must be unique.');
    optionIds.add(option.id);
  }

  if (!optionIds.has(question.correctOptionId)) {
    throw new Error('The correct option must exist in the question options.');
  }
}

export function gradeChoice(question: ChoiceQuestion, selectedOptionId: string): GradeResult {
  validateChoiceQuestion(question);
  if (!question.options.some((item) => item.id === selectedOptionId)) {
    throw new Error('الخيار المحدد غير موجود في السؤال');
  }

  const correct = selectedOptionId === question.correctOptionId;
  const feedback = buildFeedback(correct, {
    correct: question.explanationCorrect,
    incorrect: question.explanationIncorrect,
    ...(question.exampleOnIncorrect === undefined ? {} : { example: question.exampleOnIncorrect }),
    ...(question.remediationObjectiveId === undefined ? {} : { remediationObjectiveId: question.remediationObjectiveId })
  });

  return {
    correct,
    selectedOptionId,
    expectedOptionId: question.correctOptionId,
    feedback: feedback.message,
    example: feedback.example,
    remediationObjectiveId: feedback.remediationObjectiveId
  };
}

export type TextAnswerQuestion = {
  id: string;
  objectiveId: string;
  prompt: string;
  acceptedAnswers: readonly string[];
  explanationCorrect: string;
  explanationIncorrect: string;
  exampleOnIncorrect?: string;
  remediationObjectiveId?: string;
};

export type TextAnswerPolicy = {
  caseSensitive: boolean;
  trimWhitespace: boolean;
  collapseWhitespace: boolean;
};

export type TextGradeResult = {
  correct: boolean;
  feedback: string;
  normalizedAnswer: string;
  example: string | null;
  remediationObjectiveId: string | null;
};

function normalizeTextAnswer(value: string, policy: TextAnswerPolicy): string {
  let normalized = value;
  if (policy.trimWhitespace) normalized = normalized.trim();
  if (policy.collapseWhitespace) normalized = normalized.replace(/\s+/gu, ' ');
  if (!policy.caseSensitive) normalized = normalized.toLowerCase();
  return normalized;
}

export function gradeTextAnswer(
  question: TextAnswerQuestion,
  answer: string,
  policy: TextAnswerPolicy
): TextGradeResult {
  assertNonEmpty(question.id, 'Question id');
  assertNonEmpty(question.objectiveId, 'Question objectiveId');
  assertNonEmpty(question.prompt, 'Question prompt');
  assertNonEmpty(question.explanationCorrect, 'Correct explanation');
  assertNonEmpty(question.explanationIncorrect, 'Incorrect explanation');

  if (question.acceptedAnswers.length === 0) {
    throw new RangeError('A text question must define at least one accepted answer.');
  }

  const normalizedAcceptedAnswers = question.acceptedAnswers.map((acceptedAnswer) => {
    assertNonEmpty(acceptedAnswer, 'Accepted answer');
    return normalizeTextAnswer(acceptedAnswer, policy);
  });

  const normalizedAnswer = normalizeTextAnswer(answer, policy);
  const correct = normalizedAcceptedAnswers.includes(normalizedAnswer);
  const feedback = buildFeedback(correct, {
    correct: question.explanationCorrect,
    incorrect: question.explanationIncorrect,
    ...(question.exampleOnIncorrect === undefined ? {} : { example: question.exampleOnIncorrect }),
    ...(question.remediationObjectiveId === undefined ? {} : { remediationObjectiveId: question.remediationObjectiveId })
  });

  return {
    correct,
    feedback: feedback.message,
    normalizedAnswer,
    example: feedback.example,
    remediationObjectiveId: feedback.remediationObjectiveId
  };
}

export type HintProgress = {
  hint: string | null;
  revealedCount: number;
  remainingCount: number;
  complete: boolean;
};

/** Reveals one hint per call and never returns an unrevealed later hint. */
export function revealNextHint(hints: readonly string[], revealedCount: number): HintProgress {
  if (!Number.isInteger(revealedCount) || revealedCount < 0 || revealedCount > hints.length) {
    throw new RangeError('revealedCount must be within the available hints.');
  }

  const hint = hints[revealedCount] ?? null;
  const nextCount = hint === null ? revealedCount : revealedCount + 1;
  return {
    hint,
    revealedCount: nextCount,
    remainingCount: hints.length - nextCount,
    complete: hint === null
  };
}

export type PlacementItem = {
  id: string;
  stage: LearningStage;
  skill: AssessmentSkill;
  objectiveId: string;
  weight: number;
};

export type PlacementResponse = {
  itemId: string;
  skill: AssessmentSkill;
  objectiveId: string;
  correct: boolean;
  contextId: string;
  answeredAt: string;
};

export type CalibrationApproval = {
  blueprintVersion: string;
  sampleSize: number;
  approvedBy: string;
  approvedAt: string;
  thresholdsByStageSkill: Partial<Record<LearningStage, Partial<Record<AssessmentSkill, number>>>>;
  minimumResponsesByStageSkill: Partial<Record<LearningStage, Partial<Record<AssessmentSkill, number>>>>;
};

export type PlacementBlueprint = {
  version: string;
  status: 'draft' | 'calibrated';
  items: readonly PlacementItem[];
  calibration: CalibrationApproval | null;
};

export type StageSkillRates = Partial<Record<LearningStage, Partial<Record<AssessmentSkill, number>>>>;

export type PlacementResult =
  | { status: 'calibration_required'; blueprintVersion: string; missingSkills: AssessmentSkill[] }
  | { status: 'insufficient_evidence'; blueprintVersion: string; missingSkills: AssessmentSkill[] }
  | {
      status: 'below_placement_range';
      blueprintVersion: string;
      skillRates: Partial<Record<AssessmentSkill, number>>;
      stageSkillRates: StageSkillRates;
      evidenceCount: number;
    }
  | {
      status: 'placed';
      blueprintVersion: string;
      recommendedStage: LearningStage;
      skillRates: Partial<Record<AssessmentSkill, number>>;
      stageSkillRates: StageSkillRates;
      evidenceCount: number;
    };

function validatePlacementItems(blueprint: PlacementBlueprint): AssessmentSkill[] {
  assertNonEmpty(blueprint.version, 'Placement blueprint version');
  if (blueprint.status !== 'draft' && blueprint.status !== 'calibrated') {
    throw new TypeError('Placement blueprint status is not supported.');
  }

  const itemIds = new Set<string>();
  for (const item of blueprint.items) {
    assertNonEmpty(item.id, 'Placement item id');
    assertNonEmpty(item.objectiveId, 'Placement item objectiveId');
    if (!LEARNING_STAGES.includes(item.stage)) {
      throw new TypeError('Placement item stage is not supported.');
    }
    if (!ASSESSMENT_SKILLS.includes(item.skill)) {
      throw new TypeError('Placement item skill is not measurable.');
    }
    if (!Number.isFinite(item.weight) || item.weight <= 0) {
      throw new RangeError('Placement item weight must be a finite positive number.');
    }
    if (itemIds.has(item.id)) throw new Error('Placement item IDs must be unique.');
    itemIds.add(item.id);
  }
  return [...new Set(blueprint.items.map((item) => item.skill))];
}

function isValidThreshold(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isValidResponseCount(value: unknown, maximum: number): value is number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= maximum;
}

export function evaluatePlacement(
  blueprint: PlacementBlueprint,
  responses: readonly PlacementResponse[]
): PlacementResult {
  const skills = validatePlacementItems(blueprint);
  if (skills.length === 0) {
    return { status: 'calibration_required', blueprintVersion: blueprint.version, missingSkills: [] };
  }

  const stages = LEARNING_STAGES.filter((stage) => blueprint.items.some((item) => item.stage === stage));
  const calibration = blueprint.calibration;
  if (
    blueprint.status !== 'calibrated' ||
    !calibration ||
    calibration.blueprintVersion !== blueprint.version ||
    typeof calibration.approvedBy !== 'string' ||
    calibration.approvedBy.trim().length === 0 ||
    !Number.isFinite(Date.parse(calibration.approvedAt)) ||
    !Number.isInteger(calibration.sampleSize) ||
    calibration.sampleSize <= 0
  ) {
    return { status: 'calibration_required', blueprintVersion: blueprint.version, missingSkills: skills };
  }

  const missingConfiguration = new Set<AssessmentSkill>();
  for (const stage of stages) {
    const stageItems = blueprint.items.filter((item) => item.stage === stage);
    const stageSkills = [...new Set(stageItems.map((item) => item.skill))];
    for (const skill of stageSkills) {
      const itemCount = stageItems.filter((item) => item.skill === skill).length;
      const threshold = calibration.thresholdsByStageSkill[stage]?.[skill];
      const minimumResponses = calibration.minimumResponsesByStageSkill[stage]?.[skill];
      const minimumDistinctContexts = calibration.minimumDistinctContextsByStageSkill[stage]?.[skill];
      if (
        !isValidThreshold(threshold) ||
        !isValidResponseCount(minimumResponses, itemCount) ||
        !isValidResponseCount(minimumDistinctContexts, itemCount)
      ) {
        missingConfiguration.add(skill);
      }
    }
  }

  if (missingConfiguration.size > 0) {
    return {
      status: 'calibration_required',
      blueprintVersion: blueprint.version,
      missingSkills: [...missingConfiguration]
    };
  }

  const itemById = new Map(blueprint.items.map((item) => [item.id, item]));
  const latestResponseByItem = new Map<string, PlacementResponse>();

  for (const response of responses) {
    const item = itemById.get(response.itemId);
    if (
      !item ||
      item.skill !== response.skill ||
      item.objectiveId !== response.objectiveId ||
      typeof response.correct !== 'boolean' ||
      typeof response.contextId !== 'string' ||
      response.contextId.trim().length === 0 ||
      !Number.isFinite(Date.parse(response.answeredAt))
    ) {
      continue;
    }

    const previous = latestResponseByItem.get(response.itemId);
    if (!previous || Date.parse(response.answeredAt) >= Date.parse(previous.answeredAt)) {
      latestResponseByItem.set(response.itemId, response);
    }
  }

  const relevant = [...latestResponseByItem.values()];
  const missingEvidence = new Set<AssessmentSkill>();
  const stageSkillRates: StageSkillRates = {};

  for (const stage of stages) {
    const stageItems = blueprint.items.filter((item) => item.stage === stage);
    const stageSkills = [...new Set(stageItems.map((item) => item.skill))];
    const ratesForStage: Partial<Record<AssessmentSkill, number>> = {};

    for (const skill of stageSkills) {
      const itemsForSkill = stageItems.filter((item) => item.skill === skill);
      const itemIdsForSkill = new Set(itemsForSkill.map((item) => item.id));
      const answers = relevant.filter((response) => itemIdsForSkill.has(response.itemId));
      const minimumResponses = calibration.minimumResponsesByStageSkill[stage]?.[skill] as number;
      const minimumDistinctContexts = calibration.minimumDistinctContextsByStageSkill[stage]?.[skill] as number;
      const distinctContexts = new Set(answers.map((response) => response.contextId));

      if (answers.length < minimumResponses || distinctContexts.size < minimumDistinctContexts) {
        missingEvidence.add(skill);
        continue;
      }

      const itemWeights = new Map(itemsForSkill.map((item) => [item.id, item.weight]));
      const achieved = answers.reduce(
        (sum, response) => sum + (response.correct ? (itemWeights.get(response.itemId) ?? 0) : 0),
        0
      );
      const possible = answers.reduce((sum, response) => sum + (itemWeights.get(response.itemId) ?? 0), 0);
      ratesForStage[skill] = possible === 0 ? 0 : achieved / possible;
    }

    stageSkillRates[stage] = ratesForStage;
  }

  if (missingEvidence.size > 0) {
    return {
      status: 'insufficient_evidence',
      blueprintVersion: blueprint.version,
      missingSkills: [...missingEvidence]
    };
  }

  const skillRates: Partial<Record<AssessmentSkill, number>> = {};
  for (const skill of skills) {
    const skillItems = blueprint.items.filter((item) => item.skill === skill);
    const itemWeights = new Map(skillItems.map((item) => [item.id, item.weight]));
    const answers = relevant.filter((response) => itemWeights.has(response.itemId));
    const achieved = answers.reduce(
      (sum, response) => sum + (response.correct ? (itemWeights.get(response.itemId) ?? 0) : 0),
      0
    );
    const possible = answers.reduce((sum, response) => sum + (itemWeights.get(response.itemId) ?? 0), 0);
    skillRates[skill] = possible === 0 ? 0 : achieved / possible;
  }

  let recommendedStage: LearningStage | null = null;
  for (const stage of stages) {
    const stageSkills = [...new Set(blueprint.items.filter((item) => item.stage === stage).map((item) => item.skill))];
    const passed = stageSkills.every((skill) => {
      const rate = stageSkillRates[stage]?.[skill];
      const threshold = calibration.thresholdsByStageSkill[stage]?.[skill];
      return typeof rate === 'number' && typeof threshold === 'number' && rate >= threshold;
    });
    if (!passed) break;
    recommendedStage = stage;
  }

  if (recommendedStage === null) {
    return {
      status: 'below_placement_range',
      blueprintVersion: blueprint.version,
      skillRates,
      stageSkillRates,
      evidenceCount: relevant.length
    };
  }

  return {
    status: 'placed',
    blueprintVersion: blueprint.version,
    recommendedStage,
    skillRates,
    stageSkillRates,
    evidenceCount: relevant.length
  };
}

export type UnlockRequirement = {
  stage: LearningStage;
  objectives: readonly MasteryRule[];
  assessment: {
    blueprintVersion: string;
    minimumScore: number;
    requiredSkills: readonly AssessmentSkill[];
  };
};

export type StageUnlockResult = {
  unlocked: boolean;
  reasons: string[];
  objectiveResults: MasteryResult[];
};

export function evaluateStageUnlock(
  requirement: UnlockRequirement,
  attempts: readonly AttemptResult[],
  assessment: {
    blueprintVersion: string;
    skillRates: Partial<Record<AssessmentSkill, number>>;
  } | null
): StageUnlockResult {
  assertNonEmpty(requirement.assessment.blueprintVersion, 'Required assessment blueprintVersion');
  assertScore(requirement.assessment.minimumScore, 'Stage minimumScore');
  if (requirement.objectives.length === 0) {
    throw new RangeError('A stage unlock must define at least one objective mastery rule.');
  }

  const uniqueRequiredSkills = [...new Set(requirement.assessment.requiredSkills)];
  const objectiveResults = requirement.objectives.map((rule) => evaluateMastery(attempts, rule));
  const reasons: string[] = [];

  for (const result of objectiveResults) {
    if (!result.mastered) {
      reasons.push(...result.reasons.map((reason) => result.objectiveId + ': ' + reason));
    }
  }

  if (!assessment) {
    reasons.push('لم يُجرَ اختبار المستوى النهائي.');
  } else {
    if (assessment.blueprintVersion !== requirement.assessment.blueprintVersion) {
      reasons.push('إصدار الاختبار لا يطابق المخطط المعتمد.');
    }
    for (const skill of uniqueRequiredSkills) {
      const rate = assessment.skillRates[skill];
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < requirement.assessment.minimumScore || rate > 1) {
        reasons.push('لم يتحقق حد الإتقان للمهارة: ' + skill);
      }
    }
  }

  return { unlocked: reasons.length === 0, reasons, objectiveResults };
}

export type RemediationItem = {
  objectiveId: string;
  lessonIds: string[];
  reason: string;
  priority: number;
};

export function buildRemediationPlan(
  incorrectObjectiveCounts: ReadonlyMap<string, number>,
  mapping: ReadonlyMap<string, { lessonIds: readonly string[]; reason: string }>
): RemediationItem[] {
  return [...incorrectObjectiveCounts.entries()]
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .map(([objectiveId, count]) => {
      const target = mapping.get(objectiveId);
      return {
        objectiveId,
        lessonIds: target ? [...target.lessonIds] : [],
        reason: target?.reason ?? 'يحتاج هذا الهدف إلى مراجعة تشخيصية.',
        priority: count
      };
    })
    .sort((a, b) => b.priority - a.priority);
}
