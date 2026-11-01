import { useState } from 'react';
import { ShieldAlert, FilePenLine, ClipboardCheck, PackageCheck, History, Users, LockKeyhole, ArrowUpRight } from 'lucide-react';

type AdminRole = 'owner' | 'editor' | 'reviewer' | 'publisher';
const roleDescriptions: Record<AdminRole, string> = {
  owner: 'المدير الرئيسي: إدارة الموظفين والأدوار وسجل التدقيق.',
  editor: 'محرر المحتوى: إنشاء المسودات وتعديلها وإرسالها للمراجعة.',
  reviewer: 'المراجع: فحص المحتوى وإضافة الملاحظات واعتماده أو طلب تعديله.',
  publisher: 'مسؤول النشر: بناء الحزم المنشورة وفحصها والتراجع عنها.'
};

const navigation: Array<[string, string]> = [
  ['overview', 'نظرة عامة'],
  ['content', 'المحتوى والمسودات'],
  ['review', 'المراجعة والاعتماد'],
  ['publishing', 'إصدارات الحزم'],
  ['people', 'الموظفون والأدوار'],
  ['audit', 'سجل التدقيق']
];

export default function AdminApp() {
  const [section, setSection] = useState('overview');
  const [status, setStatus] = useState('auth-disabled');
  const [items, setItems] = useState<Array<{ id: string; title: string; stage: string; status: string }>>([]);
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';

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
        const payload = await drafts.json() as { items: Array<{ id: string; title: string; stage: string; status: string }> };
        setItems(payload.items);
      }
    } catch {
      setStatus('offline');
    }
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand"><div>F</div><span><strong>Fluently</strong><small>منصة الإدارة</small></span></div>
        <nav>
          {navigation.map(([id, label]) => <button key={id} className={section === id ? 'selected' : ''} onClick={() => setSection(id)}>{label}</button>)}
        </nav>
        <small className="admin-version">Admin · 0.1.0</small>
      </aside>
      <main className="admin-main">
        <header><span>لوحة الإدارة / {section}</span><a href="/" target="_blank" rel="noreferrer">تطبيق المتعلم <ArrowUpRight size={14} /></a></header>
        <section className="admin-content">
          <div className="admin-alert"><ShieldAlert size={20} /><div><strong>اللوحة غير مفعّلة للإنتاج</strong><p>الواجهة مستقلة، لكن العمليات تتطلب جلسة هوية موثقة وصلاحية يتحقق منها الخادم. لا تمنح هذه الواجهة أي دور محلي.</p></div></div>
          <div className="admin-title"><span>FLUENTLY ADMIN</span><h1>{section === 'overview' ? 'مساحة إدارة المحتوى' : section === 'content' ? 'المحتوى والمسودات' : section === 'review' ? 'المراجعة والاعتماد' : section === 'publishing' ? 'إصدارات حزم المنهج' : section === 'people' ? 'الموظفون والأدوار' : 'سجل التدقيق'}</h1><p>الفصل بين الإنشاء والمراجعة والنشر إلزامي. لا يمكن نشر مادة قبل الاعتماد البشري.</p></div>
          <div className="admin-cards">
            <article><FilePenLine /><strong>المسودات</strong><span>3 مواد تأسيسية أولية للمراجعة</span><small>غير منشورة</small></article>
            <article><ClipboardCheck /><strong>المراجعة</strong><span>لا يوجد اعتماد بشري مسجل</span><small>بانتظار المراجع</small></article>
            <article><PackageCheck /><strong>الحزم المنشورة</strong><span>لا توجد حزمة منهج منشورة</span><small>النشر مغلق</small></article>
            <article><History /><strong>سجل التدقيق</strong><span>سيحفظ كل تغيير إداري بهوية موثقة</span><small>يتطلب API</small></article>
          </div>
          <div className="admin-panel"><h2>التحقق من الجلسة</h2><p>يطبق الخادم التفويض بحسب الدور. لا تُقبل أدوار مرسلة من المتصفح أو مخزنة محليًا.</p><button onClick={() => void checkAdminSession()}>فحص الجلسة</button><span className="status-chip">{status}</span></div>
          {items.length > 0 && <div className="admin-panel"><h2>المحتوى من الخادم</h2>{items.map((item) => <p key={item.id}>{item.title} · {item.stage} · {item.status}</p>)}</div>}
          <div className="admin-panel"><h2>مصفوفة الأدوار</h2>{(Object.keys(roleDescriptions) as AdminRole[]).map((role) => <p className="role-line" key={role}><LockKeyhole size={15} /><strong>{role}</strong><span>{roleDescriptions[role]}</span></p>)}</div>
          <div className="admin-foot"><Users size={16} /> إنشاء حسابات الموظفين يتم بدعوة المدير الرئيسي بعد تهيئة مزود الهوية.</div>
        </section>
      </main>
    </div>
  );
}
