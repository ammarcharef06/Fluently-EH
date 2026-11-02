import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_LOCALE, getDirection, messages, resolveLocale, t as translate,
  type Locale, type TranslationKey
} from '@fluently/i18n';
import {
  ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronLeft, CircleHelp,
  Clock3, CloudOff, Flame, GraduationCap, Home, Layers3, Moon, Play,
  Settings2, ShieldCheck, Sparkles, Sun, Target, Volume2, X
} from 'lucide-react';
import { draftLessons, curriculumStages } from '@fluently/curriculum';
import { createSyncOperation, scheduleReview, selectDueReviews, type ReviewState } from '@fluently/domain';
import { gradeChoice, type ChoiceQuestion, type GradeResult } from '@fluently/assessment-engine';
import {
  enqueueOperation, listLessonProgress, listReviewStates, readLessonProgress, requestPersistentStorage,
  saveLessonProgress, saveReviewState
} from '@fluently/storage-web';
import { LessonSchema, type Lesson } from '@fluently/content-schema';
import { clearLocalLearningData, readSetting, saveSetting } from '@fluently/storage-web';
import { downloadAndActivateCurriculum, readActiveCurriculumPackage } from '@fluently/storage-web/curriculum';
import { syncPendingOperations } from '@fluently/storage-web/sync';

type Screen = 'home' | 'path' | 'lesson' | 'review' | 'settings';
const DEMO_ENABLED = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO !== 'false';

function App() {
  const [signedIn, setSignedIn] = useState(DEMO_ENABLED);
  const [screen, setScreen] = useState<Screen>('home');
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [progressCount, setProgressCount] = useState(0);
  const [serverLessons, setServerLessons] = useState<Lesson[]>([]);
  const [dueReviews, setDueReviews] = useState<ReviewState[]>([]);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [localeReady, setLocaleReady] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [demoNotice, setDemoNotice] = useState(true);
  const [isPersistent, setIsPersistent] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readSetting('interfaceLocale')
      .then((savedLocale) => {
        if (!cancelled && typeof savedLocale === 'string') {
          setLocale(resolveLocale(savedLocale));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLocaleReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = getDirection(locale);
    document.documentElement.dataset.theme = theme;
  }, [locale, theme]);

  useEffect(() => {
    if (!localeReady) return;
    void saveSetting('interfaceLocale', locale).catch(() => undefined);
  }, [locale, localeReady]);

  useEffect(() => {
    if (!signedIn) return;
    void listLessonProgress()
      .then((items) => setProgressCount(items.filter((item) => item.completedStepIds.length > 0).length))
      .catch(() => undefined);
    void requestPersistentStorage().then(setIsPersistent).catch(() => setIsPersistent(false));
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const refresh = async () => {
      const records = await listReviewStates().catch(() => []);
      if (!cancelled) setDueReviews(selectDueReviews(records));
    };
    const synchronize = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (!cancelled) setSyncStatus('offline');
        return;
      }
      const result = await syncPendingOperations('/api');
      if (!cancelled) setSyncStatus(result.status);
      await refresh();
    };
    const onOnline = () => { void synchronize(); };
    void refresh();
    if (typeof navigator !== 'undefined' && navigator.onLine) void synchronize();
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
    };
  }, [signedIn]);

  const t = useMemo(
    () => Object.fromEntries(
      Object.keys(messages[locale]).map((key) => [
        key,
        translate(key as TranslationKey, locale)
      ])
    ) as Record<TranslationKey, string>,
    [locale]
  );

  useEffect(() => {
    if (DEMO_ENABLED) return;
    let cancelled = false;
    async function restoreAccount() {
      const loadLocalPackage = async (): Promise<boolean> => {
        const local = await readActiveCurriculumPackage('fluently.core').catch(() => null);
        const bytes = local?.files.get('content.json');
        if (!bytes) return false;
        try {
          const data = JSON.parse(new TextDecoder().decode(bytes)) as { lessons?: unknown };
          if (!Array.isArray(data.lessons)) return false;
          const validated = data.lessons.map((item) => LessonSchema.safeParse(item));
          const validLessons = validated.flatMap((result) => result.success ? [result.data] : []);
          if (cancelled) return false;
          setServerLessons(validLessons);
          return validLessons.length > 0;
        } catch {
          return false;
        }
      };

      const response = await fetch('/api/v1/me', { credentials: 'include' }).catch(() => null);
      if (response?.ok) {
        await saveSetting('lastAuthenticatedAt', Date.now());
        if (cancelled) return;
        setSignedIn(true);
        const localReady = await loadLocalPackage();
        if (!localReady) {
          const downloaded = await downloadAndActivateCurriculum();
          if (downloaded.ok) await loadLocalPackage();
        }
        return;
      }
      if (response?.status === 410) {
        await clearLocalLearningData();
        if (!cancelled) setSignedIn(false);
        return;
      }

      const lastAuthenticatedAt = await readSetting('lastAuthenticatedAt').catch(() => undefined);
      const recentlyAuthenticated = typeof lastAuthenticatedAt === 'number' && Date.now() - lastAuthenticatedAt < 180 * 24 * 60 * 60 * 1000;
      if (!response && recentlyAuthenticated) {
        const localReady = await loadLocalPackage();
        if (localReady && !cancelled) {
          setSignedIn(true);
          return;
        }
      }
      if (!cancelled) setSignedIn(false);
    }
    void restoreAccount().catch(() => { if (!cancelled) setSignedIn(false); });
    return () => { cancelled = true; };
  }, []);

  const lessons = DEMO_ENABLED ? draftLessons : serverLessons;
  const currentStep = activeLesson?.steps[stepIndex];

  async function openLesson(lesson: Lesson) {
    setActiveLesson(lesson);
    setStepIndex(0);
    setCompleted([]);
    setScreen('lesson');
    const saved = await readLessonProgress(lesson.id).catch(() => undefined);
    if (saved) setCompleted(saved.completedStepIds);
  }

  async function recordStep(stepId: string) {
    if (!activeLesson) return;
    const next = Array.from(new Set([...completed, stepId]));
    setCompleted(next);
    await saveLessonProgress({
      lessonId: activeLesson.id,
      completedStepIds: next,
      updatedAt: new Date().toISOString(),
      contentVersion: activeLesson.contentVersion
    });
    setProgressCount((value) => Math.max(value, 1));
  }

  async function recordChoiceAttempt(questionId: string, correct: boolean, stepId: string) {
    if (!activeLesson) return;
    const occurredAtLocal = new Date().toISOString();
    const objectiveId = activeLesson.objectives[0]?.id ?? questionId;
    const skill = activeLesson.skills[0] ?? 'reading';
    const attempt = createSyncOperation({
      entityId: questionId,
      entityType: 'lesson_attempt',
      occurredAtLocal,
      payload: {
        contentVersion: activeLesson.contentVersion,
        questionId,
        objectiveId,
        contextId: activeLesson.id + ':' + stepId,
        skill,
        correct
      }
    });
    await enqueueOperation(attempt);

    const previous = (await listReviewStates()).find((item) => item.itemId === questionId) ?? null;
    const nextReview: ReviewState = {
      ...scheduleReview(previous, correct ? 5 : 2, new Date(occurredAtLocal)),
      itemId: questionId
    };
    await saveReviewState(nextReview);
    const reviewOperation = createSyncOperation({
      entityId: questionId,
      entityType: 'review_event',
      occurredAtLocal,
      payload: {
        contentVersion: activeLesson.contentVersion,
        questionId,
        reviewState: nextReview
      }
    });
    await enqueueOperation(reviewOperation);
    setDueReviews(selectDueReviews(await listReviewStates()));
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const result = await syncPendingOperations('/api');
      setSyncStatus(result.status);
    }
  }

  async function syncNow() {
    const result = await syncPendingOperations('/api');
    setSyncStatus(result.status);
    setDueReviews(selectDueReviews(await listReviewStates().catch(() => [])));
  }

  async function startDueReview(itemId: string) {
    const source = lessons.find((lesson) =>
      lesson.steps.some((step) => step.type === 'choice' && step.questionId === itemId)
    );
    if (!source) return;
    await openLesson(source);
    const index = source.steps.findIndex((step) => step.type === 'choice' && step.questionId === itemId);
    setStepIndex(Math.max(0, index));
  }

  async function advanceStep() {
    if (!activeLesson || !currentStep) return;
    await recordStep(currentStep.id);
    if (stepIndex >= activeLesson.steps.length - 1) {
      setActiveLesson(null);
      setScreen('home');
      return;
    }
    setStepIndex((value) => value + 1);
  }

  if (!signedIn) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="brand-mark"><GraduationCap size={28} /></div>
          <span className="eyebrow">FLUENTLY</span>
          <h1>{t.loginTitle}</h1>
          <p>{t.loginText}</p>
          <div className="auth-warning"><ShieldCheck size={20} /><div><strong>{t.authPending}</strong><span>{t.authText}</span></div></div>
          <button className="button button-primary" disabled>{t.previewOnly}</button>
          <small>{t.admin}: <a href="/admin/">/admin</a></small>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); setScreen('home'); }}>
          <span className="brand-mark"><GraduationCap size={25} /></span>
          <span><strong>{t.brand}</strong><small>{t.subtitle}</small></span>
        </a>
        <nav className="side-nav" aria-label={t.mainNavigation}>
          <button className={screen === 'home' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('home')}><Home size={18} />{t.home}</button>
          <button className={screen === 'path' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('path')}><Layers3 size={18} />{t.path}</button>
          <button className={screen === 'review' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('review')}><Clock3 size={18} />{t.review}<span className="nav-count">{dueReviews.length}</span></button>
          <button className={screen === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('settings')}><Settings2 size={18} />{t.settings}</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="offline-card"><CloudOff size={17} /><div><strong>{t.offline}</strong><span>{t.offlineText}</span></div></div>
          <div className="sidebar-user"><div className="avatar">F</div><div><strong>Fluently</strong><small>{t.previewOnly}</small></div><button aria-label={t.settings} onClick={() => setScreen('settings')}><Settings2 size={17} /></button></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div><span className="breadcrumb">{screen === 'home' ? t.home : screen === 'path' ? t.path : screen === 'review' ? t.review : screen === 'settings' ? t.settings : t.library}</span></div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} title={t.language}>{locale === 'ar' ? t.englishLanguage : t.arabicLanguage}</button>
            <button className="icon-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title={theme === 'light' ? t.dark : t.light}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button>
            <div className="avatar avatar-small">F</div>
          </div>
        </header>

        {DEMO_ENABLED && demoNotice && <div className="demo-banner"><Sparkles size={17} /><span>{t.demo}</span><button aria-label={t.close} onClick={() => setDemoNotice(false)}><X size={17} /></button></div>}

        {screen === 'home' && (
          <>
            <section className="welcome-row">
              <div><span className="eyebrow">{t.greeting}</span><h1>{t.hero}</h1><p>{t.heroText}</p></div>
              <div className="welcome-art"><div className="art-circle"><BookOpen size={45} /></div><span className="art-star star-one">✦</span><span className="art-star star-two">✧</span></div>
            </section>
            <section className="goal-grid">
              <article className="goal-card goal-main"><div className="goal-icon"><Target size={20} /></div><div><span>{t.goals}</span><strong>{t.minutes}</strong><small>{t.mastery}</small></div><div className="goal-ring"><span>0/10</span></div></article>
              <article className="stat-card"><div className="stat-icon green"><BookOpen size={19} /></div><span>{t.progress}</span><strong>{progressCount}</strong><small>{t.lessons}</small></article>
              <article className="stat-card"><div className="stat-icon amber"><Flame size={19} /></div><span>{t.streak}</span><strong>0 <small>{t.days}</small></strong><small>{t.mastery}</small></article>
            </section>
            <section className="section-block">
              <div className="section-heading"><div><span className="eyebrow">{t.learning}</span><h2>{t.stages}</h2></div><button className="text-button" onClick={() => setScreen('path')}>{t.seeAll}<ChevronLeft size={17} /></button></div>
              <div className="stage-strip">{curriculumStages.slice(0, 4).map((stage, index) => <div className={index === 0 ? 'stage-card stage-current' : 'stage-card'} key={stage.id}><span className="stage-number">{index + 1}</span><strong>{stage.title}</strong><small>{stage.description}</small><div className="stage-line"><span style={{ width: index === 0 ? '12%' : '0%' }} /></div></div>)}</div>
            </section>
            <section className="section-block">
              <div className="section-heading"><div><span className="eyebrow">{t.library}</span><h2>{t.continue}</h2></div><button className="text-button" onClick={() => setScreen('path')}>{t.seeAll}<ChevronLeft size={17} /></button></div>
              {lessons.length ? <LessonList lessons={lessons} openLesson={openLesson} t={t} /> : <EmptyState title={t.noContent} text={t.emptyText} />}
            </section>
          </>
        )}

        {screen === 'path' && (
          <section className="page-section"><div className="page-intro"><span className="eyebrow">{t.learning}</span><h1>{t.path}</h1><p>{t.heroText}</p></div>
            <div className="path-list">{curriculumStages.map((stage, index) => <article className="path-stage" key={stage.id}><div className="path-stage-number">{index + 1}</div><div className="path-stage-copy"><strong>{stage.title}</strong><p>{stage.description}</p>{(DEMO_ENABLED ? draftLessons : serverLessons).filter((lesson) => lesson.stage === stage.id).length > 0 && <LessonList lessons={(DEMO_ENABLED ? draftLessons : serverLessons).filter((lesson) => lesson.stage === stage.id)} openLesson={openLesson} t={t} />}</div><span className="locked-label">{index === 0 ? t.previewOnly : '—'}</span></article>)}</div>
          </section>
        )}

        {screen === 'review' && (
          <section className="page-section">
            <div className="page-intro"><span className="eyebrow">{t.review}</span><h1>{t.review}</h1><p>{dueReviews.length ? translate('dueReviewsAvailable', locale, { count: dueReviews.length }) : t.reviewQueue}</p></div>
            {dueReviews.length === 0
              ? <EmptyState title={t.reviewQueue} text={t.emptyText} />
              : <div className="lesson-list">{dueReviews.map((item) => (
                <article className="lesson-row" key={item.itemId}>
                  <div className="lesson-row-icon"><Clock3 size={19} /></div>
                  <div className="lesson-row-copy"><strong>{item.itemId}</strong><span>{translate('spacedReviewInterval', locale, { days: item.intervalDays })}</span><small>{item.version}</small></div>
                  <button className="button button-secondary" onClick={() => void startDueReview(item.itemId)}>{t.startReview}</button>
                </article>
              ))}</div>}
          </section>
        )}

        {screen === 'settings' && (
          <section className="page-section"><div className="page-intro"><span className="eyebrow">{t.settings}</span><h1>{t.settings}</h1></div>
            <div className="settings-list">
              <div className="setting-row"><div><strong>{t.language}</strong><small>{locale === 'ar' ? t.arabicLanguage : t.englishLanguage}</small></div><button className="button button-secondary" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>{locale === 'ar' ? t.englishLanguage : t.arabicLanguage}</button></div>
              <div className="setting-row"><div><strong>{t.dark}</strong><small>{theme === 'light' ? t.light : t.dark}</small></div><button className="button button-secondary" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? t.dark : t.light}</button></div>
              <div className="setting-row"><div><strong>{t.storage}</strong><small>{isPersistent ? t.persistent : t.notPersistent}</small></div><span className="setting-check">{isPersistent ? <CheckCircle2 size={19} /> : <CircleHelp size={19} />}</span></div>
              <div className="setting-row"><div><strong>{t.syncStatus}</strong><small>{({ idle: t.syncIdle, empty: t.syncEmpty, offline: t.syncOffline, authentication_required: t.syncAuthenticationRequired, email_verification_required: t.syncEmailVerificationRequired, account_deletion_pending: t.syncAccountDeletionPending, service_unavailable: t.syncServiceUnavailable, invalid_response: t.syncInvalidResponse, network_error: t.syncNetworkError, synced: t.syncSynced } as Record<string, string>)[syncStatus] ?? syncStatus}</small></div><button className="button button-secondary" onClick={() => void syncNow()}>{t.syncNow}</button></div>
              <div className="setting-row"><div><strong>{t.admin}</strong><small>/admin — {t.separateBuildTarget}</small></div><a className="button button-secondary" href="/admin/">{t.open}</a></div>
              <p className="privacy-note">{t.noMicrophone}</p>
            </div>
          </section>
        )}

        {screen === 'lesson' && activeLesson && currentStep && (
          <section className="lesson-shell">
            <div className="lesson-head"><button className="back-button" onClick={() => setScreen('path')}><ArrowRight size={17} />{t.back}</button><div><span className="eyebrow">{activeLesson.stage}</span><h1>{activeLesson.title}</h1></div><span className="lesson-duration"><Clock3 size={15} />{activeLesson.estimatedMinutes} {t.minutesShort}</span></div>
            <div className="lesson-progress"><div><span style={{ width: (Math.round(((stepIndex + 1) / activeLesson.steps.length) * 100)) + '%' }} /></div><small>{t.step} {stepIndex + 1} {t.of} {activeLesson.steps.length}</small></div>
            <div className="lesson-body">
              <div className="lesson-step-card">
                {currentStep.type === 'explanation' && <><span className="step-type"><BookOpen size={16} />{t.objective}</span><h2>{currentStep.heading}</h2><p className="lesson-explanation">{currentStep.body}</p></>}
                {currentStep.type === 'example' && <><span className="step-type"><Volume2 size={16} />{t.objective}</span><div className="example-english">{currentStep.english}</div><p className="example-arabic">{currentStep.arabic}</p>{currentStep.note && <div className="note-box">{currentStep.note}</div>}</>}
                {currentStep.type === 'choice' && <ChoiceActivity step={currentStep} objectiveId={activeLesson.objectives[0]?.id ?? currentStep.questionId} onAttempt={(correct) => void recordChoiceAttempt(currentStep.questionId, correct, currentStep.id)} onComplete={() => void recordStep(currentStep.id)} t={t} />}
              </div>
              {currentStep.type !== 'choice' && <button className="button button-primary next-button" onClick={() => void advanceStep()}>{stepIndex === activeLesson.steps.length - 1 ? t.finish : t.next}<ArrowLeft size={17} /></button>}
              {currentStep.type === 'choice' && stepIndex < activeLesson.steps.length - 1 && <button className="button button-primary next-button" disabled={!completed.includes(currentStep.id)} onClick={() => setStepIndex((value) => value + 1)}>{t.next}<ArrowLeft size={17} /></button>}
              {currentStep.type === 'choice' && stepIndex === activeLesson.steps.length - 1 && completed.includes(currentStep.id) && <button className="button button-primary next-button" onClick={() => { setActiveLesson(null); setScreen('home'); }}>{t.finish}<Check size={17} /></button>}
            </div>
          </section>
        )}
        <footer className="app-footer"><span>Fluently · {t.previewOnly}</span><span>{t.mastery}</span></footer>
      </main>
    </div>
  );
}

function LessonList({ lessons, openLesson, t }: { lessons: Lesson[]; openLesson: (lesson: Lesson) => void; t: Record<TranslationKey, string> }) {
  return <div className="lesson-list">{lessons.map((lesson) => <article className="lesson-row" key={lesson.id}><div className="lesson-row-icon"><BookOpen size={19} /></div><div className="lesson-row-copy"><strong>{lesson.title}</strong><span>{lesson.description}</span><small>{lesson.estimatedMinutes} {t.minutesShort} · {t.draft}</small></div><button className="round-action" aria-label={t.next} onClick={() => openLesson(lesson)}><Play size={17} /></button></article>)}</div>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><div><BookOpen size={23} /></div><strong>{title}</strong><p>{text}</p></div>;
}

function ChoiceActivity({ step, objectiveId, onAttempt, onComplete, t }: { step: Extract<Lesson['steps'][number], { type: 'choice' }>; objectiveId: string; onAttempt: (correct: boolean) => void; onComplete: () => void; t: Record<TranslationKey, string> }) {
  const [selected, setSelected] = useState('');
  const [feedback, setFeedback] = useState<GradeResult | null>(null);
  function check() {
    const question: ChoiceQuestion = {
      id: step.questionId, objectiveId, prompt: step.prompt,
      options: step.options, correctOptionId: step.answerId,
      explanationCorrect: step.explanation, explanationIncorrect: t.incorrectChoicePrefix + step.explanation
    };
    const result = gradeChoice(question, selected);
    setFeedback(result);
    onAttempt(result.correct);
    if (result.correct) onComplete();
  }
  return <div className="choice-activity"><span className="step-type"><CircleHelp size={16} />{t.objective}</span><h2>{step.prompt}</h2><div className="choice-options">{step.options.map((option) => <button key={option.id} className={selected === option.id ? 'choice-option selected' : 'choice-option'} onClick={() => { setSelected(option.id); setFeedback(null); }}><span className="choice-radio">{selected === option.id ? <Check size={14} /> : null}</span>{option.text}</button>)}</div><button className="button button-primary" disabled={!selected} onClick={check}>{t.answer}</button>{feedback && <div className={feedback.correct ? 'feedback correct' : 'feedback incorrect'}><div className="feedback-message">{feedback.correct ? <CheckCircle2 size={18} /> : <CircleHelp size={18} />}{feedback.feedback}</div>{feedback.example && <p className="feedback-example">{feedback.example}</p>}</div>}</div>;
}

export default App;
