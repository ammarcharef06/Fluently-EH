import { LessonSchema, type Lesson } from '@fluently/content-schema';
import { compileCurriculumIndex } from '@fluently/curriculum-engine';
import alphabetA from './drafts/literacy-alphabet-a.json';
import pronouns from './drafts/pre-a1-pronouns.json';
import needs from './drafts/pre-a1-i-need.json';

export const draftLessons: Lesson[] = [alphabetA, pronouns, needs].map((item) => LessonSchema.parse(item));
export const publishedLessons: Lesson[] = [];
export const curriculumIndex = compileCurriculumIndex([...draftLessons, ...publishedLessons]);
export const curriculumStages = [
  { id: 'literacy', title: 'محو الأمية الإنجليزية', description: 'الحروف والأصوات والدمج والقراءة والتهجئة والكتابة الأولى.' },
  { id: 'pre-a1', title: 'Pre-A1', description: 'التواصل الأساسي وفهم العبارات المألوفة.' },
  { id: 'a1', title: 'A1', description: 'مواقف الحياة اليومية والتواصل البسيط.' },
  { id: 'a2', title: 'A2', description: 'محادثات وروتينات ومواقف مألوفة.' },
  { id: 'b1', title: 'B1', description: 'الاستقلال في التواصل حول الحياة والدراسة والعمل.' },
  { id: 'b2', title: 'B2', description: 'التواصل بطلاقة أكبر مع نصوص وأفكار معقدة.' },
  { id: 'c1', title: 'C1', description: 'استخدام مرن ودقيق للغة في السياقات المتقدمة.' },
  { id: 'c2', title: 'C2', description: 'فهم وإنتاج لغة دقيقة وغنية في السياقات المتنوعة.' }
] as const;
export const curriculumStatus = {
  publishedLessonCount: publishedLessons.length,
  draftLessonCount: draftLessons.length,
  canPublish: false,
  note: 'المسودات لا تصبح محتوى منشورًا قبل المراجعة والاعتماد البشريين.'
} as const;
