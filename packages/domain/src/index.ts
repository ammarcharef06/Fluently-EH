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
