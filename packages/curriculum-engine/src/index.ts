import { LessonSchema, type Lesson } from '@fluently/content-schema';

export type DeepReadonly<T> =
  T extends readonly (infer TElement)[]
    ? readonly DeepReadonly<TElement>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T;

export type IndexedLesson = DeepReadonly<Lesson>;

export type CurriculumIssueCode =
  | 'invalid_lesson'
  | 'duplicate_lesson_id'
  | 'duplicate_prerequisite'
  | 'self_prerequisite'
  | 'unknown_prerequisite'
  | 'published_prerequisite_not_published'
  | 'prerequisite_cycle';

export type CurriculumIssue = Readonly<{
  code: CurriculumIssueCode;
  lessonId: string | null;
  relatedLessonId: string | null;
  inputIndex: number | null;
  message: string;
  details: readonly string[];
}>;

export interface CurriculumIndex {
  readonly lessons: readonly IndexedLesson[];
  getLesson(lessonId: string): IndexedLesson | undefined;
  getPrerequisites(lessonId: string): readonly string[] | undefined;
  listPublishedLessons(): readonly IndexedLesson[];
}

export type CurriculumCompilation =
  | Readonly<{ ok: true; index: CurriculumIndex }>
  | Readonly<{ ok: false; issues: readonly CurriculumIssue[] }>;

export type LessonAvailability =
  | Readonly<{ status: 'not_found'; lessonId: string }>
  | Readonly<{ status: 'not_published'; lessonId: string; lessonStatus: Lesson['status'] }>
  | Readonly<{ status: 'blocked'; lessonId: string; missingPrerequisiteIds: readonly string[] }>
  | Readonly<{ status: 'available'; lesson: IndexedLesson }>;

function freezeDeep<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach((child) => {
      freezeDeep(child);
    });
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function makeIssue(
  code: CurriculumIssueCode,
  message: string,
  lessonId: string | null = null,
  relatedLessonId: string | null = null,
  inputIndex: number | null = null,
  details: readonly string[] = []
): CurriculumIssue {
  return Object.freeze({
    code,
    lessonId,
    relatedLessonId,
    inputIndex,
    message,
    details: Object.freeze([...details])
  });
}

/**
 * Compiles and validates the supplied lesson graph.
 *
 * The input may be untrusted data. Every lesson is parsed by LessonSchema
 * before it participates in graph validation.
 */
export function compileCurriculumIndex(input: readonly unknown[]): CurriculumCompilation {
  const issues: CurriculumIssue[] = [];
  const parsedLessons: Array<{ lesson: Lesson; inputIndex: number }> = [];

  input.forEach((candidate, inputIndex) => {
    const parsed = LessonSchema.safeParse(candidate);
    if (!parsed.success) {
      const rawId = typeof candidate === 'object' && candidate !== null && 'id' in candidate &&
        typeof candidate.id === 'string'
        ? candidate.id
        : null;
      issues.push(makeIssue(
        'invalid_lesson',
        'Lesson data does not match the supported lesson schema.',
        rawId,
        null,
        inputIndex,
        parsed.error.issues.map((item) => {
          const path = item.path.length > 0 ? item.path.join('.') : '(root)';
          return path + ': ' + item.message;
        })
      ));
      return;
    }
    parsedLessons.push({ lesson: parsed.data, inputIndex });
  });

  const lessonById = new Map<string, Lesson>();
  const inputIndexById = new Map<string, number>();

  parsedLessons.forEach(({ lesson, inputIndex }) => {
    if (lessonById.has(lesson.id)) {
      issues.push(makeIssue(
        'duplicate_lesson_id',
        'Lesson IDs must be unique within a curriculum package.',
        lesson.id,
        lesson.id,
        inputIndex
      ));
      return;
    }
    lessonById.set(lesson.id, lesson);
    inputIndexById.set(lesson.id, inputIndex);
  });

  const prerequisiteIdsByLessonId = new Map<string, readonly string[]>();

  for (const lesson of lessonById.values()) {
    prerequisiteIdsByLessonId.set(lesson.id, lesson.prerequisites);

    const seenPrerequisites = new Set<string>();
    for (const prerequisiteId of lesson.prerequisites) {
      if (seenPrerequisites.has(prerequisiteId)) {
        issues.push(makeIssue(
          'duplicate_prerequisite',
          'A lesson cannot list the same prerequisite more than once.',
          lesson.id,
          prerequisiteId,
          inputIndexById.get(lesson.id) ?? null
        ));
        continue;
      }
      seenPrerequisites.add(prerequisiteId);

      if (prerequisiteId === lesson.id) {
        issues.push(makeIssue(
          'self_prerequisite',
          'A lesson cannot depend on itself.',
          lesson.id,
          prerequisiteId,
          inputIndexById.get(lesson.id) ?? null
        ));
        continue;
      }

      const prerequisite = lessonById.get(prerequisiteId);
      if (!prerequisite) {
        issues.push(makeIssue(
          'unknown_prerequisite',
          'A prerequisite must reference a lesson in the same curriculum index.',
          lesson.id,
          prerequisiteId,
          inputIndexById.get(lesson.id) ?? null
        ));
        continue;
      }

      if (lesson.status === 'published' && prerequisite.status !== 'published') {
        issues.push(makeIssue(
          'published_prerequisite_not_published',
          'A published lesson cannot depend on a lesson that is not published.',
          lesson.id,
          prerequisiteId,
          inputIndexById.get(lesson.id) ?? null
        ));
      }
    }
  }

  const visitState = new Map<string, 'visiting' | 'visited'>();
  const visitStack: string[] = [];
  const reportedCycles = new Set<string>();

  const visit = (lessonId: string): void => {
    visitState.set(lessonId, 'visiting');
    visitStack.push(lessonId);

    for (const prerequisiteId of prerequisiteIdsByLessonId.get(lessonId) ?? []) {
      if (!lessonById.has(prerequisiteId) || prerequisiteId === lessonId) continue;

      const state = visitState.get(prerequisiteId);
      if (state === 'visiting') {
        const cycleStart = visitStack.indexOf(prerequisiteId);
        const cycle = [...visitStack.slice(cycleStart), prerequisiteId];
        const cycleKey = [...new Set(cycle.slice(0, -1))].sort().join('|');
        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          issues.push(makeIssue(
            'prerequisite_cycle',
            'Curriculum prerequisites must form an acyclic graph.',
            lessonId,
            prerequisiteId,
            inputIndexById.get(lessonId) ?? null,
            cycle
          ));
        }
        continue;
      }

      if (state !== 'visited') visit(prerequisiteId);
    }

    visitStack.pop();
    visitState.set(lessonId, 'visited');
  };

  for (const lessonId of lessonById.keys()) {
    if (!visitState.has(lessonId)) visit(lessonId);
  }

  if (issues.length > 0) {
    return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  }

  const indexedLessons = [...lessonById.values()].map((lesson) => freezeDeep(lesson));
  const lessons = Object.freeze(indexedLessons);
  const indexedById = new Map(indexedLessons.map((lesson) => [lesson.id, lesson]));
  const frozenPrerequisites = new Map<string, readonly string[]>();
  for (const [lessonId, prerequisites] of prerequisiteIdsByLessonId) {
    frozenPrerequisites.set(lessonId, Object.freeze([...prerequisites]));
  }
  const publishedLessons = Object.freeze(indexedLessons.filter((lesson) => lesson.status === 'published'));

  const index: CurriculumIndex = Object.freeze({
    lessons,
    getLesson: (lessonId: string) => indexedById.get(lessonId),
    getPrerequisites: (lessonId: string) => frozenPrerequisites.get(lessonId),
    listPublishedLessons: () => publishedLessons
  });

  return Object.freeze({ ok: true, index });
}

/**
 * Checks learner availability without making an assessment or mastery decision.
 *
 * satisfiedPrerequisiteIds must be supplied by the caller from lesson completion
 * or independently approved diagnostic evidence.
 */
export function getLessonAvailability(
  index: CurriculumIndex,
  lessonId: string,
  satisfiedPrerequisiteIds: ReadonlySet<string>
): LessonAvailability {
  const lesson = index.getLesson(lessonId);
  if (!lesson) return Object.freeze({ status: 'not_found', lessonId });

  if (lesson.status !== 'published') {
    return Object.freeze({
      status: 'not_published',
      lessonId,
      lessonStatus: lesson.status
    });
  }

  const prerequisites = index.getPrerequisites(lessonId) ?? [];
  const missingPrerequisiteIds = prerequisites.filter((id) => !satisfiedPrerequisiteIds.has(id));

  if (missingPrerequisiteIds.length > 0) {
    return Object.freeze({
      status: 'blocked',
      lessonId,
      missingPrerequisiteIds: Object.freeze(missingPrerequisiteIds)
    });
  }

  return Object.freeze({ status: 'available', lesson });
}

/**
 * Returns published lessons whose prerequisites are all satisfied.
 * The original content order is preserved; this function invents no stage
 * ordering, CEFR thresholds, or mastery rules.
 */
export function listAvailableLessons(
  index: CurriculumIndex,
  satisfiedPrerequisiteIds: ReadonlySet<string>
): readonly IndexedLesson[] {
  const available = index.lessons.filter((lesson) =>
    getLessonAvailability(index, lesson.id, satisfiedPrerequisiteIds).status === 'available'
  );
  return Object.freeze(available);
}
