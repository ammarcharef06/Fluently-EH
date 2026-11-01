import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { LessonSchema } from '@fluently/content-schema';
import { requireRole, requireSession } from './auth';
import { getDatabase } from './db';
import type { Env, Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const ReviewStateSchema = z.object({
  itemId: z.string().min(1).max(160),
  repetitions: z.number().int().nonnegative(),
  intervalDays: z.number().int().positive(),
  ease: z.number().min(1.3).max(4),
  dueAt: z.string().datetime(),
  version: z.literal('fluently-srs-1')
});

const SyncOperationSchema = z.object({
  operationId: z.string().uuid(),
  entityId: z.string().min(1).max(128),
  entityType: z.enum(['lesson_attempt', 'review_event', 'profile_update', 'account_delete']),
  schemaVersion: z.literal(1),
  occurredAtLocal: z.string().datetime(),
  payload: z.record(z.unknown())
}).superRefine((operation, context) => {
  if ((operation.entityType === 'lesson_attempt' || operation.entityType === 'review_event')
      && typeof operation.payload.contentVersion !== 'string') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['payload', 'contentVersion'], message: 'contentVersion is required for learning events' });
  }
  if (operation.entityType === 'review_event') {
    const state = ReviewStateSchema.safeParse(operation.payload.reviewState);
    if (!state.success) context.addIssue({ code: z.ZodIssueCode.custom, path: ['payload', 'reviewState'], message: 'Invalid versioned review state' });
  }
});

const SyncInput = z.object({ operations: z.array(SyncOperationSchema).min(1).max(100) });

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

function isApprovedLesson(raw: unknown): boolean {
  const parsed = LessonSchema.safeParse(raw);
  if (!parsed.success) return false;
  return (parsed.data.status === 'approved' || parsed.data.status === 'published') &&
    Boolean(parsed.data.review.reviewerId && parsed.data.review.reviewedAt && parsed.data.review.approvalNote) &&
    Boolean(parsed.data.source.license && parsed.data.source.note);
}

app.use('/v1/*', async (c, next) => {
  const allowed = (c.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return cors({
    origin: (origin) => allowed.includes(origin) ? origin : '',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 600
  })(c, next);
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

app.get('/v1/curriculum/manifest', requireSession, async (c) => {
  const bucket = c.env.CURRICULUM_BUCKET;
  if (!bucket) return c.json({ error: 'curriculum_storage_not_configured' }, 503);
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }
  try {
    const rows = await sql.unsafe(
      "select id from curriculum_releases where package_id='fluently.core' and status='published' order by published_at desc limit 1"
    );
    if (!rows.length) return c.json({ error: 'no_published_curriculum' }, 404);
    const object = await bucket.get('published/' + rows[0].id + '/manifest.json');
    if (!object) return c.json({ error: 'published_manifest_missing' }, 503);
    return new Response(object.body, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=60', ETag: object.httpEtag }
    });
  } finally {
    await sql.end({ timeout: 1 });
  }
});

app.get('/v1/curriculum/content.json', requireSession, async (c) => {
  const bucket = c.env.CURRICULUM_BUCKET;
  if (!bucket) return c.json({ error: 'curriculum_storage_not_configured' }, 503);
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }
  try {
    const rows = await sql.unsafe(
      "select id from curriculum_releases where package_id='fluently.core' and status='published' order by published_at desc limit 1"
    );
    if (!rows.length) return c.json({ error: 'no_published_curriculum' }, 404);
    const object = await bucket.get('published/' + rows[0].id + '/content.json');
    if (!object) return c.json({ error: 'published_content_missing' }, 503);
    return new Response(object.body, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=60', ETag: object.httpEtag }
    });
  } finally {
    await sql.end({ timeout: 1 });
  }
});

app.get('/v1/me', requireSession, (c) => c.json({
  userId: c.get('userId'),
  emailVerified: c.get('emailVerified')
}));

app.get('/v1/me/export', requireSession, async (c) => {
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }
  try {
    const data = await sql.begin(async (tx) => {
      await tx.unsafe("select set_config('app.user_id', $1, true)", [c.get('userId')]);
      const profile = await tx.unsafe("select nickname, locale, active_track, daily_goal_minutes, created_at, updated_at from learning_profiles where user_id = $1", [c.get('userId')]);
      const events = await tx.unsafe("select event_type, entity_id, content_version, payload, occurred_at_client, received_at_server from learning_events where user_id = $1 order by received_at_server", [c.get('userId')]);
      const reviews = await tx.unsafe("select item_id, state, algorithm_version, due_at, updated_at from review_states where user_id = $1 order by item_id", [c.get('userId')]);
      return { profile: profile[0] ?? null, learningEvents: events, reviewStates: reviews };
    });
    return c.json({ exportedAt: new Date().toISOString(), userId: c.get('userId'), ...data });
  } catch {
    return c.json({ error: 'data_export_unavailable' }, 503);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

app.delete('/v1/me', requireSession, async (c) => {
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }
  try {
    const request = await sql.begin(async (tx) => {
      await tx.unsafe("select set_config('app.user_id', $1, true)", [c.get('userId')]);
      const rows = await tx.unsafe(
        "insert into account_deletion_requests (user_id) values ($1) returning id, requested_at",
        [c.get('userId')]
      );
      await tx.unsafe("update app_users set status = 'deletion_requested', updated_at = now() where id = $1", [c.get('userId')]);
      await tx.unsafe("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [c.get('userId')]);
      await tx.unsafe(
        "insert into audit_events (actor_user_id, action, subject_id, metadata) values ($1, 'account.deletion_requested', $1::text, '{}'::jsonb)",
        [c.get('userId')]
      );
      return rows[0];
    });
    return c.json({ status: 'deletion_requested', requestId: request.id, requestedAt: request.requested_at }, 202);
  } catch {
    return c.json({ error: 'deletion_request_unavailable' }, 503);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

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
      await tx.unsafe("select set_config('app.user_id', $1, true)", [c.get('userId')]);
      for (const operation of parsed.data.operations) {
        const inserted = await tx.unsafe(
          "insert into sync_operations (user_id, operation_id, entity_id, entity_type, schema_version, occurred_at_local, payload) " +
          "values ($1,$2,$3,$4,$5,$6,$7::jsonb) on conflict (user_id, operation_id) do nothing returning operation_id",
          [c.get('userId'), operation.operationId, operation.entityId, operation.entityType, operation.schemaVersion, operation.occurredAtLocal, JSON.stringify(operation.payload)]
        );
        if (inserted.length === 0) {
          duplicates.push(operation.operationId);
          continue;
        }
        accepted.push(operation.operationId);

        if (operation.entityType === 'account_delete') {
          await tx.unsafe("insert into account_deletion_requests (user_id) values ($1)", [c.get('userId')]);
          await tx.unsafe("update app_users set status = 'deletion_requested', updated_at = now() where id = $1", [c.get('userId')]);
          await tx.unsafe("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [c.get('userId')]);
        } else {
          const contentVersion = typeof operation.payload.contentVersion === 'string' ? operation.payload.contentVersion : 'profile-v1';
          await tx.unsafe(
            "insert into learning_events (user_id, event_type, entity_id, content_version, payload, occurred_at_client) values ($1,$2,$3,$4,$5::jsonb,$6)",
            [c.get('userId'), operation.entityType, operation.entityId, contentVersion, JSON.stringify(operation.payload), operation.occurredAtLocal]
          );
          if (operation.entityType === 'review_event') {
            const review = ReviewStateSchema.parse(operation.payload.reviewState);
            await tx.unsafe(
              "insert into review_states (user_id, item_id, state, algorithm_version, due_at) values ($1,$2,$3::jsonb,$4,$5) " +
              "on conflict (user_id, item_id) do update set state=excluded.state, algorithm_version=excluded.algorithm_version, due_at=excluded.due_at, updated_at=now()",
              [c.get('userId'), review.itemId, JSON.stringify(review), review.version, review.dueAt]
            );
          }
        }
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
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe("select set_config('app.user_id', $1, true)", [c.get('userId')]);
      return tx.unsafe(
        "select id, title, stage, status, content_version, updated_at from content_items " +
        "where status in ('draft','in_review','approved','published') order by updated_at desc limit 200"
      );
    });
    return c.json({ items: rows });
  } catch {
    return c.json({ error: 'content_query_failed' }, 503);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

app.post('/v1/admin/drafts', requireSession, requireRole('owner', 'editor'), async (c) => {
  const parsed = LessonSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || parsed.data.status !== 'draft' ||
      parsed.data.review.reviewerId !== null || parsed.data.review.reviewedAt !== null || parsed.data.review.approvalNote !== null) {
    return c.json({ error: 'invalid_draft_or_premature_approval' }, 400);
  }
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }
  try {
    const result = await sql.begin(async (tx) => {
      await tx.unsafe("select set_config('app.user_id', $1, true)", [c.get('userId')]);
      const lesson = parsed.data;
      const rows = await tx.unsafe(
        "insert into content_items (id,title,stage,status,content_version,source_metadata,content_json,created_by) " +
        "values ($1,$2,$3,'draft',$4,$5::jsonb,$6::jsonb,$7) returning id,title,status,content_version",
        [lesson.id, lesson.title, lesson.stage, lesson.contentVersion, JSON.stringify(lesson.source), JSON.stringify(lesson), c.get('userId')]
      );
      await tx.unsafe(
        "insert into content_versions (content_id,content_version,snapshot,created_by) values ($1,$2,$3::jsonb,$4)",
        [lesson.id, lesson.contentVersion, JSON.stringify(lesson), c.get('userId')]
      );
      await tx.unsafe(
        "insert into audit_events (actor_user_id,action,subject_id,metadata) values ($1,'content.create_draft',$2,'{}'::jsonb)",
        [c.get('userId'), lesson.id]
      );
      return rows[0];
    });
    return c.json({ item: result }, 201);
  } catch {
    return c.json({ error: 'draft_create_conflict_or_unavailable' }, 409);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

app.put('/v1/admin/drafts/:id', requireSession, requireRole('owner', 'editor'), async (c) => {
  const parsed = LessonSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || parsed.data.id !== c.req.param('id') || parsed.data.status !== 'draft' ||
      parsed.data.review.reviewerId !== null || parsed.data.review.reviewedAt !== null || parsed.data.review.approvalNote !== null) {
    return c.json({ error: 'invalid_draft_update' }, 400);
  }
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }
  try {
    const result = await sql.begin(async (tx) => {
      await tx.unsafe("select set_config('app.user_id', $1, true)", [c.get('userId')]);
      const lesson = parsed.data;
      const updated = await tx.unsafe(
        "update content_items set title=$1,stage=$2,content_version=$3,source_metadata=$4::jsonb,content_json=$5::jsonb,updated_at=now() " +
        "where id=$6 and status='draft' and created_by=$7 returning id,title,status,content_version",
        [lesson.title, lesson.stage, lesson.contentVersion, JSON.stringify(lesson.source), JSON.stringify(lesson), lesson.id, c.get('userId')]
      );
      if (!updated.length) return null;
      await tx.unsafe(
        "insert into content_versions (content_id,content_version,snapshot,created_by) values ($1,$2,$3::jsonb,$4)",
        [lesson.id, lesson.contentVersion, JSON.stringify(lesson), c.get('userId')]
      );
      await tx.unsafe(
        "insert into audit_events (actor_user_id,action,subject_id,metadata) values ($1,'content.update_draft',$2,$3::jsonb)",
        [c.get('userId'), lesson.id, JSON.stringify({ contentVersion: lesson.contentVersion })]
      );
      return updated[0];
    });
    if (!result) return c.json({ error: 'draft_not_found_or_not_owned' }, 409);
    return c.json({ item: result });
  } catch {
    return c.json({ error: 'draft_update_conflict_or_unavailable' }, 409);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

app.post('/v1/admin/content/:id/submit', requireSession, requireRole('owner', 'editor'), async (c) => {
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }
  try {
    const result = await sql.begin(async (tx) => {
      await tx.unsafe("select set_config('app.user_id', $1, true)", [c.get('userId')]);
      const updated = await tx.unsafe(
        "update content_items set status='in_review',updated_at=now() where id=$1 and status='draft' and created_by=$2 returning id,status",
        [c.req.param('id'), c.get('userId')]
      );
      if (!updated.length) return null;
      await tx.unsafe(
        "insert into audit_events (actor_user_id,action,subject_id,metadata) values ($1,'content.submit_for_review',$2,'{}'::jsonb)",
        [c.get('userId'), c.req.param('id')]
      );
      return updated[0];
    });
    if (!result) return c.json({ error: 'draft_not_found_or_not_owned' }, 409);
    return c.json({ item: result });
  } catch {
    return c.json({ error: 'content_submit_failed' }, 503);
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
    const result = await sql.begin(async (tx) => {
      await tx.unsafe("select set_config('app.user_id', $1, true)", [c.get('userId')]);
      const updated = await tx.unsafe(
        "update content_items set status=$1,review_note=$2,reviewed_by=$3,reviewed_at=now(),updated_at=now(), " +
        "content_json = content_json || jsonb_build_object('status',$1::text,'review',coalesce(content_json->'review','{}'::jsonb) || jsonb_build_object('reviewerId',$3::text,'reviewedAt',now()::text,'approvalNote',$2::text)) " +
        "where id=$4 and status='in_review' and created_by <> $3 returning id,status,reviewed_by,reviewed_at",
        [body.data.decision, body.data.note, c.get('userId'), c.req.param('id')]
      );
      if (!updated.length) return null;
      await tx.unsafe(
        "insert into audit_events (actor_user_id,action,subject_id,metadata) values ($1,'content.review',$2,$3::jsonb)",
        [c.get('userId'), c.req.param('id'), JSON.stringify({ decision: body.data.decision, note: body.data.note })]
      );
      return updated[0];
    });
    if (!result) return c.json({ error: 'item_not_awaiting_review_or_self_review' }, 409);
    return c.json({ item: result });
  } catch {
    return c.json({ error: 'content_review_failed' }, 503);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

app.post('/v1/admin/content/:id/publish', requireSession, requireRole('owner', 'publisher'), async (c) => {
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }
  try {
    const result = await sql.begin(async (tx) => {
      await tx.unsafe("select set_config('app.user_id', $1, true)", [c.get('userId')]);
      const rows = await tx.unsafe(
        "select id,status,content_version,reviewed_by,created_by from content_items where id=$1 for update",
        [c.req.param('id')]
      );
      const item = rows[0] as { id: string; status: string; content_version: string; reviewed_by: string | null; created_by: string } | undefined;
      if (!item || item.status !== 'approved' || !item.reviewed_by || item.reviewed_by === item.created_by || item.created_by === c.get('userId')) return null;
      const published = await tx.unsafe(
        "update content_items set status='published',published_by=$1,published_at=now(),updated_at=now(), " +
        "content_json = jsonb_set(content_json, '{status}', to_jsonb('published'::text)) " +
        "where id=$2 and status='approved' returning id,status,content_version,published_at",
        [c.get('userId'), item.id]
      );
      await tx.unsafe(
        "insert into audit_events (actor_user_id,action,subject_id,metadata) values ($1,'content.publish',$2,$3::jsonb)",
        [c.get('userId'), item.id, JSON.stringify({ contentVersion: item.content_version })]
      );
      return published[0];
    });
    if (!result) return c.json({ error: 'human_approval_required_or_self_publish' }, 409);
    return c.json({ item: result });
  } catch {
    return c.json({ error: 'content_publish_failed' }, 503);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

app.post('/v1/admin/releases', requireSession, requireRole('owner', 'publisher'), async (c) => {
  if (!c.env.CURRICULUM_BUCKET) return c.json({ error: 'curriculum_storage_not_configured' }, 503);
  const body = z.object({ contentVersion: z.string().regex(/^\d+\.\d+\.\d+$/) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid_content_version' }, 400);
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }
  try {
    const release = await sql.begin(async (tx) => {
      await tx.unsafe("select set_config('app.user_id', $1, true)", [c.get('userId')]);
      const existing = await tx.unsafe("select id from curriculum_releases where package_id='fluently.core' and content_version=$1", [body.data.contentVersion]);
      if (existing.length) return { conflict: true as const };
      const rows = await tx.unsafe(
        "select id,content_json,source_metadata from content_items where status in ('approved','published') order by id"
      );
      const lessons = rows.map((row) => row.content_json);
      if (lessons.length === 0 || !lessons.every(isApprovedLesson)) return { empty: true as const };
      const contentBytes = new TextEncoder().encode(JSON.stringify({
        packageId: 'fluently.core', contentVersion: body.data.contentVersion, lessons
      }, null, 2));
      const digest = await sha256Hex(contentBytes);
      const rights = rows.map((row) => {
        const source = row.source_metadata as { license?: string; note?: string };
        return { asset: String(row.id), license: source.license ?? '', attribution: source.note ?? '' };
      });
      if (rights.some((item) => !item.license || !item.attribution)) return { rightsError: true as const };
      const manifest = {
        packageId: 'fluently.core', contentVersion: body.data.contentVersion, schemaVersion: 1,
        minAppVersion: '0.1.0', maxAppVersion: null, generatedAt: new Date().toISOString(),
        files: [{ path: 'content.json', bytes: contentBytes.byteLength, sha256: digest }],
        rights
      };
      const releaseId = crypto.randomUUID();
      await c.env.CURRICULUM_BUCKET!.put('staged/' + releaseId + '/content.json', contentBytes);
      await c.env.CURRICULUM_BUCKET!.put('staged/' + releaseId + '/manifest.json', JSON.stringify(manifest));
      const inserted = await tx.unsafe(
        "insert into curriculum_releases (id,package_id,content_version,schema_version,manifest,package_sha256,status) values ($1,'fluently.core',$2,1,$3::jsonb,$4,'staged') returning id,content_version,status,package_sha256",
        [releaseId, body.data.contentVersion, JSON.stringify(manifest), digest]
      );
      await tx.unsafe(
        "insert into audit_events (actor_user_id,action,subject_id,metadata) values ($1,'curriculum.stage_release',$2,$3::jsonb)",
        [c.get('userId'), releaseId, JSON.stringify({ contentVersion: body.data.contentVersion, sha256: digest })]
      );
      return { item: inserted[0] };
    });
    if ('conflict' in release) return c.json({ error: 'release_version_exists' }, 409);
    if ('empty' in release) return c.json({ error: 'no_human_approved_content' }, 409);
    if ('rightsError' in release) return c.json({ error: 'missing_content_rights' }, 409);
    return c.json({ release: release.item }, 201);
  } catch {
    return c.json({ error: 'release_build_failed' }, 503);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

app.post('/v1/admin/releases/:id/publish', requireSession, requireRole('owner', 'publisher'), async (c) => {
  const bucket = c.env.CURRICULUM_BUCKET;
  if (!bucket) return c.json({ error: 'curriculum_storage_not_configured' }, 503);
  let sql;
  try { sql = getDatabase(c.env); }
  catch { return c.json({ error: 'database_not_configured' }, 503); }
  try {
    const result = await sql.begin(async (tx) => {
      await tx.unsafe("select set_config('app.user_id', $1, true)", [c.get('userId')]);
      const rows = await tx.unsafe(
        "select id,package_id,content_version,manifest,package_sha256,status from curriculum_releases where id=$1 for update",
        [c.req.param('id')]
      );
      const release = rows[0] as { id: string; package_id: string; content_version: string; manifest: unknown; package_sha256: string; status: string } | undefined;
      if (!release || release.status !== 'staged') return null;
      const stagedContent = await bucket.get('staged/' + release.id + '/content.json');
      const stagedManifest = await bucket.get('staged/' + release.id + '/manifest.json');
      if (!stagedContent || !stagedManifest) throw new Error('staged_release_files_missing');
      await bucket.put('published/' + release.id + '/content.json', stagedContent.body, { httpMetadata: { contentType: 'application/json' } });
      await bucket.put('published/' + release.id + '/manifest.json', stagedManifest.body, { httpMetadata: { contentType: 'application/json' } });
      await tx.unsafe("update curriculum_releases set status='retired' where package_id=$1 and status='published'", [release.package_id]);
      const published = await tx.unsafe(
        "update curriculum_releases set status='published',published_by=$1,published_at=now() where id=$2 and status='staged' returning id,package_id,content_version,package_sha256,published_at",
        [c.get('userId'), release.id]
      );
      await tx.unsafe(
        "insert into audit_events (actor_user_id,action,subject_id,metadata) values ($1,'curriculum.publish_release',$2,$3::jsonb)",
        [c.get('userId'), release.id, JSON.stringify({ contentVersion: release.content_version, packageSha256: release.package_sha256 })]
      );
      return published[0];
    });
    if (!result) return c.json({ error: 'staged_release_not_found' }, 409);
    return c.json({ release: result });
  } catch {
    return c.json({ error: 'release_publish_failed' }, 503);
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
