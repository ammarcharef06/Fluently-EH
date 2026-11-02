export const SUPPORTED_LOCALES = ['ar', 'en'] as const;

export type Locale = typeof SUPPORTED_LOCALES[number];
export type TextDirection = 'rtl' | 'ltr';
export type TranslationParameters = Readonly<Record<string, string | number>>;

export const DEFAULT_LOCALE: Locale = 'ar';

const arabicMessages = {
  brand: 'Fluently',
  subtitle: 'خطوتك الواثقة نحو الإنجليزية',
  greeting: 'أهلًا بك في رحلتك',
  hero: 'ابدأ من الصفر، وتقدّم بثبات.',
  heroText: 'تعلّم الإنجليزية الأمريكية بخطة واضحة، ودروس قصيرة، ومراجعة متدرجة.',
  continue: 'تابع التعلّم',
  path: 'المسار التعليمي',
  review: 'المراجعة اليومية',
  library: 'مكتبة الدروس',
  home: 'الرئيسية',
  goals: 'هدف اليوم',
  minutes: '10 دقائق',
  stages: 'مراحل رحلتك',
  seeAll: 'عرض المسار',
  progress: 'تقدّمك',
  lessons: 'دروس بدأت',
  streak: 'استمرارية التعلّم',
  days: 'يوم',
  mastery: 'الإتقان أهم من السرعة',
  draft: 'مسودة للمراجعة البشرية',
  offline: 'التعلّم المحلي',
  offlineText: 'يحفظ التقدم على هذا الجهاز.',
  storage: 'تخزين المتصفح',
  persistent: 'طلبنا الاحتفاظ الدائم بالتخزين',
  notPersistent: 'قد يزيل المتصفح البيانات عند ضيق المساحة',
  back: 'رجوع',
  next: 'التالي',
  finish: 'إنهاء الدرس',
  correct: 'إجابة صحيحة',
  incorrect: 'راجع الشرح ثم حاول مجددًا',
  answer: 'تحقق من الإجابة',
  step: 'الخطوة',
  of: 'من',
  stepProgress: 'الخطوة {current} من {total}',
  settings: 'الإعدادات',
  language: 'لغة الواجهة',
  dark: 'الوضع الداكن',
  light: 'الوضع الفاتح',
  demo: 'وضع معاينة تطويري — المحتوى الظاهر مسودات تعليمية غير منشورة.',
  loginTitle: 'ابدأ رحلتك مع Fluently',
  loginText: 'يتطلب الاستخدام الكامل تسجيل دخول أول مرة ثم تنزيل حزمة المنهج.',
  authPending: 'إعداد تسجيل الدخول قيد الاعتماد اليدوي',
  authText: 'لم نفعّل مزود هوية أو بريد قبل التحقق من شروط البطاقة والفوترة والمجانية.',
  admin: 'لوحة الإدارة مستقلة',
  noContent: 'لا توجد دروس منشورة حتى الآن.',
  emptyText: 'تظهر الدروس هنا بعد المراجعة والاعتماد وإصدار حزمة المنهج.',
  learning: 'مسار التعلّم',
  objective: 'هدف الدرس',
  reviewQueue: 'لا توجد مراجعات مستحقة في المعاينة.',
  previewOnly: 'معاينة فقط',
  close: 'إغلاق',
  noMicrophone: 'لا يستخدم التطبيق الميكروفون ولا يقيّم صوت المتعلم.'
} as const;

export type TranslationKey = keyof typeof arabicMessages;

const englishMessages: Record<TranslationKey, string> = {
  brand: 'Fluently',
  subtitle: 'Your confident path to English',
  greeting: 'Welcome to your journey',
  hero: 'Start from zero. Progress with confidence.',
  heroText: 'Learn American English through a clear path, focused lessons, and thoughtful review.',
  continue: 'Continue learning',
  path: 'Learning path',
  review: 'Daily review',
  library: 'Lesson library',
  home: 'Home',
  goals: 'Today’s goal',
  minutes: '10 minutes',
  stages: 'Your learning journey',
  seeAll: 'View path',
  progress: 'Your progress',
  lessons: 'Lessons started',
  streak: 'Learning consistency',
  days: 'days',
  mastery: 'Mastery matters more than speed',
  draft: 'Draft for human review',
  offline: 'Local learning',
  offlineText: 'Progress is saved on this device.',
  storage: 'Browser storage',
  persistent: 'Persistent storage requested',
  notPersistent: 'The browser may evict data when space is low',
  back: 'Back',
  next: 'Next',
  finish: 'Finish lesson',
  correct: 'Correct answer',
  incorrect: 'Review the explanation and try again',
  answer: 'Check answer',
  step: 'Step',
  of: 'of',
  stepProgress: 'Step {current} of {total}',
  settings: 'Settings',
  language: 'Interface language',
  dark: 'Dark mode',
  light: 'Light mode',
  demo: 'Development preview — visible content consists of unpublished learning drafts.',
  loginTitle: 'Start your Fluently journey',
  loginText: 'Full access requires a first sign-in and then a curriculum package download.',
  authPending: 'Sign-in setup awaits manual approval',
  authText: 'No identity or email provider is enabled until card, billing, and free-tier requirements are verified.',
  admin: 'Admin is a separate application',
  noContent: 'There are no published lessons yet.',
  emptyText: 'Lessons appear here after human review, approval, and curriculum package release.',
  learning: 'Learning path',
  objective: 'Lesson objective',
  reviewQueue: 'No reviews are due in this preview.',
  previewOnly: 'Preview only',
  close: 'Close',
  noMicrophone: 'The app does not request microphone access or score learner speech.'
};

export const messages: Readonly<Record<Locale, Readonly<Record<TranslationKey, string>>>> = Object.freeze({
  ar: Object.freeze(arabicMessages),
  en: Object.freeze(englishMessages)
});

/**
 * Resolves an interface locale from a language tag.
 * Unsupported languages use the requested fallback (Arabic by default).
 */
export function resolveLocale(
  value: string | null | undefined,
  fallback: Locale = DEFAULT_LOCALE
): Locale {
  const normalized = value?.trim().toLowerCase().replace(/_/g, '-') ?? '';

  if (normalized === 'ar' || normalized.startsWith('ar-')) return 'ar';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';

  return fallback;
}

/** Returns the writing direction for the selected interface locale. */
export function getDirection(locale: Locale): TextDirection {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Returns a localized plain-text message.
 * Missing interpolation values leave their placeholder visible.
 */
export function t(
  key: TranslationKey,
  locale: Locale = DEFAULT_LOCALE,
  parameters?: TranslationParameters
): string {
  const message = messages[locale][key];
  if (!parameters) return message;

  return message.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (placeholder, name: string) => {
    const value = parameters[name];
    return value === undefined ? placeholder : String(value);
  });
}
