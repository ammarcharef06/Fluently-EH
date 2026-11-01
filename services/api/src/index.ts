import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { requireRole, requireSession } from './auth';
import { getDatabase } from './db';
import type { Env, Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const SyncInput = z.object({
  operations: z.array(z.object({
    operationId: z.string().uuid(),
    entityId: z.string().min(1).max(128),
    entityType: z.enum(['lesson_attempt', 'review_event', 'profile_update', 'account_delete']),
    schemaVersion: z.literal(1),
    occurredAtLocal: z.string().datetime(),
    payload: z.record(z.unknown())
  })).min(1).max(100)
});

app.use('/v1/*', async (c, next) => {
  const allowed = (c.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const middleware = cors({
    origin: (origin) => allowed.includes(origin) ? origin : '',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 600
  });
  return middleware(c, next);
});

app.get('/v1/health', (c) => c.json({
  service: 'fluently-api',
  status: 'ok',
  environment: c.env.APP_ENV,
  integrations: {
    identity: Boolean(c.env.AUTH_SESSION_SECRET && c.env.AUTH_ISSUER && c.env.AUTH_AUDIENCE),
    database: Boolean(c.env.HYPERDRIVE),
    curriculumStorage: Boolean(c.env.CURRICULUM_BUCKET)
  }
}));

app.all('/v1/auth/*', (c) => c.json({
  error: 'identity_provider_not_configured',
  message: 'Sign-in endpoints remain disabled until an identity and email provider passes the no-card/no-billing review.'
}, 503));

app.get('/v1/curriculum/manifest', async (c) => {
  const bucket = c.env.CURRICULUM_BUCKET;
  if (!bucket) return c.json({ error: 'curriculum_storage_not_configured' }, 503);
  const object = await bucket.get('published/manifest.json');
  if (!object) return c.json({ error: 'no_published_curriculum' }, 404);
  return new Response(object.body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', ETag: object.httpEtag }
  });
});

app.get('/v1/curriculum/content.json', async (c) => {
  const bucket = c.env.CURRICULUM_BUCKET;
  if (!bucket) return c.json({ error: 'curriculum_storage_not_configured' }, 503);
  const object = await bucket.get('published/content.json');
  if (!object) return c.json({ error: 'no_published_curriculum' }, 404);
  return new Response(object.body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', ETag: object.httpEtag }
  });
});

app.get('/v1/me', requireSession, (c) => c.json({
  userId: c.get('userId'),
  emailVerified: c.get('emailVerified')
}));

app.post('/v1/sync/push', requireSession, async (c) => {
  if (!c.get('emailVerified')) return c.json({ error: 'email_verification_required_for_sync' }, 403);
  const parsed = SyncInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_sync_payload', details: parsed.error.issues }, 400);
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }

  const accepted: string[] = [];
  const duplicates: string[] = [];
  try {
    await sql.begin(async (tx) => {
      for (const operation of parsed.data.operations) {
        const inserted = await tx.unsafe(
          'insert into sync_operations (user_id, operation_id, entity_id, entity_type, schema_version, occurred_at_local, payload) values ($1,$2,$3,$4,$5,$6,$7::jsonb) on conflict (user_id, operation_id) do nothing returning operation_id',
          [c.get('userId'), operation.operationId, operation.entityId, operation.entityType, operation.schemaVersion, operation.occurredAtLocal, JSON.stringify(operation.payload)]
        );
        if (inserted.length > 0) accepted.push(operation.operationId);
        else duplicates.push(operation.operationId);
      }
    });
    return c.json({ accepted, duplicates });
  } catch {
    return c.json({ error: 'sync_write_failed' }, 503);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

app.get('/v1/admin/session', requireSession, requireRole('owner', 'editor', 'reviewer', 'publisher'), (c) => c.json({
  userId: c.get('userId'),
  roles: c.get('roles')
}));

app.get('/v1/admin/drafts', requireSession, requireRole('owner', 'editor', 'reviewer', 'publisher'), async (c) => {
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }
  try {
    const rows = await sql.unsafe(
      "select id, title, stage, status, content_version, updated_at from content_items where status in ('draft','in_review','approved','published') order by updated_at desc limit 200"
    );
    return c.json({ items: rows });
  } finally {
    await sql.end({ timeout: 1 });
  }
});

app.post('/v1/admin/content/:id/submit', requireSession, requireRole('owner', 'editor'), async (c) => {
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }
  try {
    const result = await sql.unsafe(
      "update content_items set status='in_review', updated_at=now() where id=$1 and status='draft' returning id,status",
      [c.req.param('id')]
    );
    if (!result.length) return c.json({ error: 'draft_not_found_or_not_editable' }, 409);
    await sql.unsafe(
      "insert into audit_events (actor_user_id, action, subject_id, metadata) values ($1,'content.submit_for_review',$2,'{}'::jsonb)",
      [c.get('userId'), c.req.param('id')]
    );
    return c.json({ item: result[0] });
  } finally {
    await sql.end({ timeout: 1 });
  }
});

app.post('/v1/admin/content/:id/review', requireSession, requireRole('owner', 'reviewer'), async (c) => {
  const body = z.object({ decision: z.enum(['approved', 'changes_requested']), note: z.string().min(10).max(2000) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid_review' }, 400);
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }
  try {
    const result = await sql.unsafe(
      "update content_items set status=$1, review_note=$2, reviewed_by=$3, reviewed_at=now(), updated_at=now() where id=$4 and status='in_review' returning id,status,reviewed_by,reviewed_at",
      [body.data.decision, body.data.note, c.get('userId'), c.req.param('id')]
    );
    if (!result.length) return c.json({ error: 'item_not_awaiting_review' }, 409);
    await sql.unsafe(
      "insert into audit_events (actor_user_id, action, subject_id, metadata) values ($1,'content.review',$2,$3::jsonb)",
      [c.get('userId'), c.req.param('id'), JSON.stringify({ decision: body.data.decision, note: body.data.note })]
    );
    return c.json({ item: result[0] });
  } finally {
    await sql.end({ timeout: 1 });
  }
});

app.post('/v1/admin/content/:id/publish', requireSession, requireRole('owner', 'publisher'), async (c) => {
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }
  try {
    const rows = await sql.unsafe('select id,status,content_version,reviewed_by from content_items where id=$1 for update', [c.req.param('id')]);
    const item = rows[0];
    if (!item || item.status !== 'approved' || !item.reviewed_by) return c.json({ error: 'human_approval_required' }, 409);
    const published = await sql.unsafe(
      "update content_items set status='published', published_by=$1, published_at=now(), updated_at=now() where id=$2 and status='approved' returning id,status,content_version,published_at",
      [c.get('userId'), item.id]
    );
    await sql.unsafe(
      "insert into audit_events (actor_user_id, action, subject_id, metadata) values ($1,'content.publish',$2,$3::jsonb)",
      [c.get('userId'), item.id, JSON.stringify({ contentVersion: item.content_version })]
    );
    return c.json({ item: published[0] });
  } finally {
    await sql.end({ timeout: 1 });
  }
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((error, c) => {
  console.error('API request failed', { name: error.name });
  return c.json({ error: 'internal_error' }, 500);
});
export default app;
