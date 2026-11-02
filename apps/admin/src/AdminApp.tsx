import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ClipboardCheck,
  FilePenLine,
  History,
  LockKeyhole,
  PackageCheck,
  ShieldAlert,
  Users
} from 'lucide-react';
import {
  DEFAULT_LOCALE,
  getDirection,
  messages,
  resolveLocale,
  t as translate,
  type Locale,
  type TranslationKey
} from '@fluently/i18n';

type AdminRole = 'owner' | 'editor' | 'reviewer' | 'publisher';
type AdminSection = 'overview' | 'content' | 'review' | 'publishing' | 'people' | 'audit';
type AdminStatus =
  | 'auth-disabled'
  | 'unauthenticated'
  | 'provider-not-configured'
  | 'authenticated'
  | 'offline';

type AdminItem = {
  id: string;
  title: string;
  stage: string;
  status: string;
};

const navigation: Array<{ id: AdminSection; label: TranslationKey }> = [
  { id: 'overview', label: 'adminNavOverview' },
  { id: 'content', label: 'adminNavContent' },
  { id: 'review', label: 'adminNavReview' },
  { id: 'publishing', label: 'adminNavPublishing' },
  { id: 'people', label: 'adminNavPeople' },
  { id: 'audit', label: 'adminNavAudit' }
];

const sectionTitles: Record<AdminSection, TranslationKey> = {
  overview: 'adminOverviewTitle',
  content: 'adminContentTitle',
  review: 'adminReviewTitle',
  publishing: 'adminPublishingTitle',
  people: 'adminPeopleTitle',
  audit: 'adminAuditTitle'
};

const roleMetadata: Array<{
  id: AdminRole;
  name: TranslationKey;
  description: TranslationKey;
}> = [
  { id: 'owner', name: 'adminRoleOwner', description: 'adminRoleOwnerDescription' },
  { id: 'editor', name: 'adminRoleEditor', description: 'adminRoleEditorDescription' },
  { id: 'reviewer', name: 'adminRoleReviewer', description: 'adminRoleReviewerDescription' },
  { id: 'publisher', name: 'adminRolePublisher', description: 'adminRolePublisherDescription' }
];

const statusLabels: Record<AdminStatus, TranslationKey> = {
  'auth-disabled': 'adminStatusAuthDisabled',
  unauthenticated: 'adminStatusUnauthenticated',
  'provider-not-configured': 'adminStatusProviderNotConfigured',
  authenticated: 'adminStatusAuthenticated',
  offline: 'adminStatusOffline'
};

export default function AdminApp() {
  const [locale, setLocale] = useState<Locale>(() => {
    try {
      const stored = typeof window === 'undefined'
        ? null
        : window.localStorage.getItem('adminInterfaceLocale');
      return resolveLocale(stored);
    } catch {
      return DEFAULT_LOCALE;
    }
  });
  const [section, setSection] = useState<AdminSection>('overview');
  const [status, setStatus] = useState<AdminStatus>('auth-disabled');
  const [items, setItems] = useState<AdminItem[]>([]);
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';

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
    document.documentElement.lang = locale;
    document.documentElement.dir = getDirection(locale);
    try {
      window.localStorage.setItem('adminInterfaceLocale', locale);
    } catch {
      // The console remains usable when browser preference storage is unavailable.
    }
  }, [locale]);

  async function checkAdminSession() {
    try {
      const response = await fetch(apiBase + '/v1/admin/session', { credentials: 'include' });
      if (!response.ok) {
        setStatus(response.status === 401 ? 'unauthenticated' : 'provider-not-configured');
        return;
      }
      setStatus('authenticated');
      const drafts = await fetch(apiBase + '/v1/admin/drafts', { credentials: 'include' });
      if (drafts.ok) {
        const payload = await drafts.json() as { items: AdminItem[] };
        setItems(payload.items);
      }
    } catch {
      setStatus('offline');
    }
  }

  const cards = [
    {
      icon: <FilePenLine />,
      title: t.adminDrafts,
      description: t.adminDraftSummary,
      status: t.adminDraftStatus
    },
    {
      icon: <ClipboardCheck />,
      title: t.adminReviewCard,
      description: t.adminNoHumanApproval,
      status: t.adminAwaitingReviewer
    },
    {
      icon: <PackageCheck />,
      title: t.adminPublishedPackages,
      description: t.adminNoPublishedPackages,
      status: t.adminPublishingClosed
    },
    {
      icon: <History />,
      title: t.adminAuditCard,
      description: t.adminAuditDescription,
      status: t.adminRequiresApi
    }
  ];

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <div>F</div>
          <span>
            <strong>Fluently</strong>
            <small>{t.adminSubtitle}</small>
          </span>
        </div>
        <nav aria-label={t.adminNavigation}>
          {navigation.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={section === id ? 'selected' : ''}
              aria-current={section === id ? 'page' : undefined}
              onClick={() => setSection(id)}
            >
              {t[label]}
            </button>
          ))}
        </nav>
        <div className="admin-language">
          <span>{t.language}</span>
          <button
            type="button"
            aria-label={locale === 'ar' ? t.englishLanguage : t.arabicLanguage}
            title={t.language}
            onClick={() => setLocale((current) => current === 'ar' ? 'en' : 'ar')}
          >
            {locale === 'ar' ? t.englishLanguage : t.arabicLanguage}
          </button>
        </div>
        <small className="admin-version">Admin · 0.1.0</small>
      </aside>
      <main className="admin-main">
        <header>
          <span>{t.adminBreadcrumb} / {t[sectionTitles[section]]}</span>
          <a href="/" target="_blank" rel="noreferrer">
            {t.adminLearnerApp} <ArrowUpRight size={14} />
          </a>
        </header>
        <section className="admin-content">
          <div className="admin-alert">
            <ShieldAlert size={20} />
            <div>
              <strong>{t.adminProductionDisabledTitle}</strong>
              <p>{t.adminProductionDisabledText}</p>
            </div>
          </div>
          <div className="admin-title">
            <span>FLUENTLY ADMIN</span>
            <h1>{t[sectionTitles[section]]}</h1>
            <p>{t.adminProcessDescription}</p>
          </div>
          <div className="admin-cards">
            {cards.map((card) => (
              <article key={card.title}>
                {card.icon}
                <strong>{card.title}</strong>
                <span>{card.description}</span>
                <small>{card.status}</small>
              </article>
            ))}
          </div>
          <div className="admin-panel">
            <h2>{t.adminSessionHeading}</h2>
            <p>{t.adminSessionDescription}</p>
            <button type="button" onClick={() => void checkAdminSession()}>
              {t.adminCheckSession}
            </button>
            <span className="status-chip" role="status" aria-live="polite">
              {t[statusLabels[status]]}
            </span>
          </div>
          {items.length > 0 && (
            <div className="admin-panel">
              <h2>{t.adminServerContentHeading}</h2>
              {items.map((item) => (
                <p key={item.id}>{item.title} · {item.stage} · {item.status}</p>
              ))}
            </div>
          )}
          <div className="admin-panel">
            <h2>{t.adminRoleMatrixHeading}</h2>
            {roleMetadata.map((role) => (
              <p className="role-line" key={role.id}>
                <LockKeyhole size={15} />
                <strong>{t[role.name]}</strong>
                <span>{t[role.description]}</span>
              </p>
            ))}
          </div>
          <div className="admin-foot">
            <Users size={16} /> {t.adminInvitePolicy}
          </div>
        </section>
      </main>
    </div>
  );
}
