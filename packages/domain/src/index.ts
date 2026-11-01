export type Skill = 'literacy' | 'reading' | 'writing' | 'listening' | 'speaking-practice' | 'grammar' | 'vocabulary';

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
  successfulAttempts: number;
  reasons: string[];
};

export function evaluateMastery(attempts: readonly AttemptResult[], rule: MasteryRule): MasteryResult {
  const relevant = attempts.filter((item) => item.objectiveId === rule.objectiveId);
  const questions = new Set(relevant.map((item) => item.questionId));
  const contexts = new Set(relevant.map((item) => item.contextId));
  const successfulAttempts = relevant.filter((item) => item.correct).length;
  const correctRate = relevant.length === 0 ? 0 : successfulAttempts / relevant.length;
  const reasons: string[] = [];
  if (questions.size < rule.minimumDistinctQuestions) reasons.push('أسئلة جديدة غير كافية');
  if (contexts.size < rule.minimumDistinctContexts) reasons.push('التطبيق في سياقات جديدة غير كافٍ');
  if (successfulAttempts < rule.minimumSuccessfulAttempts) reasons.push('عدد المحاولات الصحيحة غير كافٍ');
  if (correctRate < rule.minimumCorrectRate) reasons.push('معدل الإجابات الصحيحة دون الحد المعتمد');
  return { objectiveId: rule.objectiveId, mastered: reasons.length === 0, correctRate, distinctQuestions: questions.size, distinctContexts: contexts.size, successfulAttempts, reasons };
}

export type ChoiceQuestion = {
  id: string;
  objectiveId: string;
  prompt: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId: string;
  explanationCorrect: string;
  explanationIncorrect: string;
};
export type GradeResult = { correct: boolean; selectedOptionId: string; expectedOptionId: string; feedback: string };

export function gradeChoice(question: ChoiceQuestion, selectedOptionId: string): GradeResult {
  if (!question.options.some((item) => item.id === selectedOptionId)) throw new Error('الخيار المحدد غير موجود في السؤال');
  const correct = selectedOptionId === question.correctOptionId;
  return { correct, selectedOptionId, expectedOptionId: question.correctOptionId, feedback: correct ? question.explanationCorrect : question.explanationIncorrect };
}

export type ReviewState = { itemId: string; repetitions: number; intervalDays: number; ease: number; dueAt: string; version: 'fluently-srs-1' };

export function scheduleReview(previous: ReviewState | null, quality: 0 | 1 | 2 | 3 | 4 | 5, now: Date = new Date()): ReviewState {
  const repetitions = previous?.repetitions ?? 0;
  const ease = previous?.ease ?? 2.5;
  const nextEase = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  let intervalDays: number;
  let nextRepetitions: number;
  if (quality < 3) { intervalDays = 1; nextRepetitions = 0; }
  else {
    nextRepetitions = repetitions + 1;
    intervalDays = nextRepetitions === 1 ? 1 : nextRepetitions === 2 ? 3 : Math.max(1, Math.round((previous?.intervalDays ?? 3) * nextEase));
  }
  const due = new Date(now);
  due.setUTCDate(due.getUTCDate() + intervalDays);
  return { itemId: previous?.itemId ?? '', repetitions: nextRepetitions, intervalDays, ease: Number(nextEase.toFixed(2)), dueAt: due.toISOString(), version: 'fluently-srs-1' };
}

export type SyncOperation<T = unknown> = {
  operationId: string;
  entityId: string;
  entityType: 'lesson_attempt' | 'review_event' | 'profile_update' | 'account_delete';
  schemaVersion: 1;
  occurredAtLocal: string;
  payload: T;
  status: 'pending' | 'acknowledged' | 'conflict';
};
export function createSyncOperation<T>(input: Omit<SyncOperation<T>, 'operationId' | 'schemaVersion' | 'status'>): SyncOperation<T> {
  return { ...input, operationId: crypto.randomUUID(), schemaVersion: 1, status: 'pending' };
}
export function selectDueReviews<T extends { dueAt: string }>(items: readonly T[], now: Date = new Date()): T[] {
  const timestamp = now.getTime();
  return items.filter((item) => Number.isFinite(Date.parse(item.dueAt)) && Date.parse(item.dueAt) <= timestamp).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

export const LEARNING_STAGES = ['literacy', 'pre-a1', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2'] as const;
export type LearningStage = typeof LEARNING_STAGES[number];
export type AssessmentSkill = Skill;

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
  thresholds: Partial<Record<AssessmentSkill, number>>;
};

export type PlacementBlueprint = {
  version: string;
  status: 'draft' | 'calibrated';
  items: PlacementItem[];
  calibration: CalibrationApproval | null;
};

export type PlacementResult =
  | { status: 'calibration_required'; blueprintVersion: string; missingSkills: AssessmentSkill[] }
  | { status: 'insufficient_evidence'; blueprintVersion: string; missingSkills: AssessmentSkill[] }
  | { status: 'placed'; blueprintVersion: string; recommendedStage: LearningStage; skillRates: Partial<Record<AssessmentSkill, number>>; evidenceCount: number };

export function evaluatePlacement(
  blueprint: PlacementBlueprint,
  responses: readonly PlacementResponse[]
): PlacementResult {
  const skills = [...new Set(blueprint.items.map((item) => item.skill))];
  const calibration = blueprint.calibration;
  if (blueprint.status !== 'calibrated' || !calibration?.approvedBy || !calibration.approvedAt || calibration.sampleSize < 1) {
    return { status: 'calibration_required', blueprintVersion: blueprint.version, missingSkills: skills };
  }
  const missingThresholds = skills.filter((skill) => {
    const threshold = calibration.thresholds[skill];
    return typeof threshold !== 'number' || threshold < 0 || threshold > 1;
  });
  if (missingThresholds.length) {
    return { status: 'calibration_required', blueprintVersion: blueprint.version, missingSkills: missingThresholds };
  }

  const itemById = new Map(blueprint.items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const relevant = responses.filter((response) => {
    const item = itemById.get(response.itemId);
    if (!item || seen.has(response.itemId) || item.skill !== response.skill || item.objectiveId !== response.objectiveId) return false;
    seen.add(response.itemId);
    return true;
  });
  const rates: Partial<Record<AssessmentSkill, number>> = {};
  const missingEvidence: AssessmentSkill[] = [];
  for (const skill of skills) {
    const items = blueprint.items.filter((item) => item.skill === skill);
    const answers = relevant.filter((response) => response.skill === skill);
    const minimum = Math.max(2, Math.ceil(items.length * 0.5));
    if (answers.length < minimum) {
      missingEvidence.push(skill);
      continue;
    }
    const achieved = answers.reduce((sum, response) => sum + (response.correct ? (itemById.get(response.itemId)?.weight ?? 1) : 0), 0);
    const possible = answers.reduce((sum, response) => sum + (itemById.get(response.itemId)?.weight ?? 1), 0);
    rates[skill] = possible === 0 ? 0 : achieved / possible;
  }
  if (missingEvidence.length) {
    return { status: 'insufficient_evidence', blueprintVersion: blueprint.version, missingSkills: missingEvidence };
  }

  const passedStages = LEARNING_STAGES.filter((stage) => {
    const stageItems = blueprint.items.filter((item) => item.stage === stage);
    if (!stageItems.length) return false;
    const stageSkills = [...new Set(stageItems.map((item) => item.skill))];
    return stageSkills.every((skill) => (rates[skill] ?? 0) >= (calibration.thresholds[skill] ?? 1));
  });
  const highest = passedStages.at(-1) ?? 'literacy';
  return { status: 'placed', blueprintVersion: blueprint.version, recommendedStage: highest, skillRates: rates, evidenceCount: relevant.length };
}

export type UnlockRequirement = {
  stage: LearningStage;
  objectives: MasteryRule[];
  assessment: {
    blueprintVersion: string;
    minimumScore: number;
    requiredSkills: AssessmentSkill[];
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
  assessment: { blueprintVersion: string; skillRates: Partial<Record<AssessmentSkill, number>> } | null
): StageUnlockResult {
  const objectiveResults = requirement.objectives.map((rule) => evaluateMastery(attempts, rule));
  const reasons: string[] = [];
  for (const result of objectiveResults) {
    if (!result.mastered) reasons.push(...result.reasons.map((reason) => result.objectiveId + ': ' + reason));
  }
  if (!assessment) {
    reasons.push('لم يُجرَ اختبار المستوى النهائي.');
  } else {
    if (assessment.blueprintVersion !== requirement.assessment.blueprintVersion) reasons.push('إصدار الاختبار لا يطابق المخطط المعتمد.');
    for (const skill of requirement.assessment.requiredSkills) {
      const rate = assessment.skillRates[skill];
      if (typeof rate !== 'number' || rate < requirement.assessment.minimumScore) reasons.push('لم يتحقق حد الإتقان للمهارة: ' + skill);
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
  mapping: ReadonlyMap<string, { lessonIds: string[]; reason: string }>
): RemediationItem[] {
  return [...incorrectObjectiveCounts.entries()]
    .filter(([, count]) => count > 0)
    .map(([objectiveId, count]) => {
      const target = mapping.get(objectiveId);
      return {
        objectiveId,
        lessonIds: target?.lessonIds ?? [],
        reason: target?.reason ?? 'يحتاج هذا الهدف إلى مراجعة تشخيصية.',
        priority: count
      };
    })
    .sort((a, b) => b.priority - a.priority);
}

export type LearningTrack = 'comprehensive' | 'academic' | 'professional' | 'conversation' | 'ielts-prep' | 'toefl-prep';
export const TRACKS: ReadonlyArray<{ id: LearningTrack; title: string; certificate: false; replacesCore: false }> = [
  { id: 'comprehensive', title: 'المسار الشامل من الصفر إلى C2', certificate: false, replacesCore: false },
  { id: 'academic', title: 'الإنجليزية الأكاديمية', certificate: false, replacesCore: false },
  { id: 'professional', title: 'الإنجليزية المهنية', certificate: false, replacesCore: false },
  { id: 'conversation', title: 'المحادثة والتواصل', certificate: false, replacesCore: false },
  { id: 'ielts-prep', title: 'التهيئة لمهارات IELTS', certificate: false, replacesCore: false },
  { id: 'toefl-prep', title: 'التهيئة لمهارات TOEFL', certificate: false, replacesCore: false }
];
