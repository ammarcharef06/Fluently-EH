import type { AssessmentSkill as MeasurableSkill } from '@fluently/assessment-engine';

export {
  ASSESSMENT_SKILLS,
  LEARNING_STAGES,
  buildFeedback,
  buildRemediationPlan,
  evaluateMastery,
  evaluatePlacement,
  evaluateStageUnlock,
  gradeChoice,
  gradeTextAnswer,
  revealNextHint
} from '@fluently/assessment-engine';

export type {
  AssessmentSkill,
  AttemptResult,
  CalibrationApproval,
  ChoiceQuestion,
  FeedbackContent,
  FeedbackResult,
  GradeResult,
  HintProgress,
  LearningStage,
  MasteryResult,
  MasteryRule,
  PlacementBlueprint,
  PlacementItem,
  PlacementResponse,
  PlacementResult,
  RemediationItem,
  StageUnlockResult,
  TextAnswerPolicy,
  TextAnswerQuestion,
  TextGradeResult,
  UnlockRequirement
} from '@fluently/assessment-engine';

/** Learning activity skills include self-practice, which is never scored. */
export type Skill = MeasurableSkill | 'speaking-practice';

export type ReviewState = {
  itemId: string;
  repetitions: number;
  intervalDays: number;
  ease: number;
  dueAt: string;
  version: 'fluently-srs-1';
};

export function scheduleReview(
  previous: ReviewState | null,
  quality: 0 | 1 | 2 | 3 | 4 | 5,
  now: Date = new Date()
): ReviewState {
  const repetitions = previous?.repetitions ?? 0;
  const ease = previous?.ease ?? 2.5;
  const nextEase = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  let intervalDays: number;
  let nextRepetitions: number;

  if (quality < 3) {
    intervalDays = 1;
    nextRepetitions = 0;
  } else {
    nextRepetitions = repetitions + 1;
    intervalDays = nextRepetitions === 1
      ? 1
      : nextRepetitions === 2
        ? 3
        : Math.max(1, Math.round((previous?.intervalDays ?? 3) * nextEase));
  }

  const due = new Date(now);
  due.setUTCDate(due.getUTCDate() + intervalDays);
  return {
    itemId: previous?.itemId ?? '',
    repetitions: nextRepetitions,
    intervalDays,
    ease: Number(nextEase.toFixed(2)),
    dueAt: due.toISOString(),
    version: 'fluently-srs-1'
  };
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

export function createSyncOperation<T>(
  input: Omit<SyncOperation<T>, 'operationId' | 'schemaVersion' | 'status'>
): SyncOperation<T> {
  return {
    ...input,
    operationId: crypto.randomUUID(),
    schemaVersion: 1,
    status: 'pending'
  };
}

export function selectDueReviews<T extends { dueAt: string }>(
  items: readonly T[],
  now: Date = new Date()
): T[] {
  const timestamp = now.getTime();
  return items
    .filter((item) => Number.isFinite(Date.parse(item.dueAt)) && Date.parse(item.dueAt) <= timestamp)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

export type LearningTrack = 'comprehensive' | 'academic' | 'professional' | 'conversation' | 'ielts-prep' | 'toefl-prep';

export const TRACKS: ReadonlyArray<{
  id: LearningTrack;
  title: string;
  certificate: false;
  replacesCore: false;
}> = [
  { id: 'comprehensive', title: 'المسار الشامل من الصفر إلى C2', certificate: false, replacesCore: false },
  { id: 'academic', title: 'الإنجليزية الأكاديمية', certificate: false, replacesCore: false },
  { id: 'professional', title: 'الإنجليزية المهنية', certificate: false, replacesCore: false },
  { id: 'conversation', title: 'المحادثة والتواصل', certificate: false, replacesCore: false },
  { id: 'ielts-prep', title: 'التهيئة لمهارات IELTS', certificate: false, replacesCore: false },
  { id: 'toefl-prep', title: 'التهيئة لمهارات TOEFL', certificate: false, replacesCore: false }
];
