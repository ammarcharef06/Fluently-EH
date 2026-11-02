import { z } from 'zod';
import { LessonSchema, MAX_PACKAGE_BYTES, validateCurriculumManifest } from '@fluently/content-schema';
import { buildCurriculumArchive } from './curriculum-package';
import { decodeCurriculumFilePath } from './curriculum-files';
import { authenticateRequest, hasRole } from './auth';
import { getDatabase } from './db';
import type { AdminRole, AuthenticatedUser, Env } from './types';

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
  payload: z.record(z.string(), z.unknown())
}).superRefine((operation, context) => {
  if ((operation.entityType === 'lesson_attempt' || operation.entityType === 'review_event') &&
      typeof operation.payload.contentVersion !== 'string') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['payload', 'contentVersion'],
      message: 'contentVersion is required for learning events'
    });
  }
  if (operation.entityType === 'review_event' && !ReviewStateSchema.safeParse(operation.payload.reviewState).success) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['payload', 'reviewState'],
      message: 'Invalid versioned review state'
    });
  }
});

const SyncInput = z.object({ operations: z.array(SyncOperationSchema).min(1).max(100) });
const ReleaseInput = z.object({ contentVersion: z.string().regex(/^\d+\.\d+\.\d+$/) });
const ReviewInput = z.object({
  decision: z.enum(['approved', 'changes_requested']),
  note: z.string().min(10).max(2000)
});

type SyncOperation = z.infer<typeof SyncOperationSchema>;
type QueryResult<T> = { data?: T; error?: string };

const encoder = new TextEncoder();

function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'same-origin');
  return new Response(JSON.stringify(data), { status, headers });
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  headers.append('Vary', 'Origin');
  const origin = request.headers.get('Origin');
  const allowed = (env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,DELETE,OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    headers.set('Access-Control-Max-Age', '600');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function readJson(request: Request, maxBytes: number): Promise<QueryResult<unknown>> {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return { error: 'content_type_must_be_application_json' };
  }
  const declaredLength = Number(request.headers.get('Content-Length') ?? '0');
  if (declaredLength > maxBytes) return { error: 'request_body_too_large' };
  if (!request.body) return { error: 'request_body_required' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { error: 'request_body_too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { error: 'request_body_read_failed' };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { data: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return { error: 'invalid_json' };
  }
}

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
    Boolean(parsed.data.source.license && !parsed.data.source.license.toLowerCase().includes('pending') && parsed.data.source.note);
}

function requireRole(user: AuthenticatedUser, ...roles: AdminRole[]): boolean {
  return hasRole(user.roles, ...roles);
}

async function authenticated(request: Request, env: Env): Promise<
  { ok: true; user: AuthenticatedUser } | { ok: false; response: Response }
> {
  const result = await authenticateRequest(request, env);
  if (!result.ok) return { ok: false, response: json({ error: result.error }, result.status) };
  return { ok: true, user: result.user };
}

async function getReleaseObject(env: Env, request: Request, key: 'manifest.json' | 'content.json'): Promise<Response> {
  if (!env.CURRICULUM_BUCKET) return json({ error: 'curriculum_storage_not_configured' }, 503);
  let sql;
  try {
    sql = getDatabase(env);
  } catch {
    return json({ error: 'database_not_configured' }, 503);
  }
  try {
    const releases = await sql.unsafe(
      "select id from curriculum_releases where package_id='fluently.core' and status='published' order by published_at desc limit 1"
    );
    const release = releases[0] as { id: string } | undefined;
    if (!release) return json({ error: 'no_published_curriculum' }, 404);
    const object = await env.CURRICULUM_BUCKET.get('published/' + release.id + '/' + key);
    if (!object) return json({ error: 'published_curriculum_object_missing' }, 503);
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
        ETag: object.httpEtag,
        Vary: 'Cookie, Authorization'
      }
    });
  } catch {
    return json({ error: 'curriculum_query_failed' }, 503);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function getReleaseArchive(env: Env): Promise<Response> {
  if (!env.CURRICULUM_BUCKET) return json({ error: 'curriculum_storage_not_configured' }, 503);
  let sql;
  try {
    sql = getDatabase(env);
  } catch {
    return json({ error: 'database_not_configured' }, 503);
  }

  try {
    const releases = await sql.unsafe(
      "select id from curriculum_releases where package_id='fluently.core' and status='published' order by published_at desc limit 1"
    );
    const release = releases[0] as { id: string } | undefined;
    if (!release) return json({ error: 'no_published_curriculum' }, 404);
    const object = await env.CURRICULUM_BUCKET.get('published/' + release.id + '/curriculum.zip');
    if (!object) return json({ error: 'published_curriculum_archive_missing' }, 503);
    if (object.size > MAX_PACKAGE_BYTES + 2 * 1024 * 1024) {
      return json({ error: 'published_curriculum_archive_too_large' }, 503);
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(object.size),
        'Content-Disposition': 'attachment; filename="curriculum.zip"',
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
        ETag: object.httpEtag,
        Vary: 'Cookie, Authorization'
      }
    });
  } catch {
    return json({ error: 'curriculum_archive_query_failed' }, 503);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function getReleaseFile(env: Env, filePath: string): Promise<Response> {
  if (!env.CURRICULUM_BUCKET) return json({ error: 'curriculum_storage_not_configured' }, 503);

  let sql;
  try {
    sql = getDatabase(env);
  } catch {
    return json({ error: 'database_not_configured' }, 503);
  }

  try {
    const releases = await sql.unsafe(
      "select id from curriculum_releases where package_id='fluently.core' and status='published' order by published_at desc limit 1"
    );
    const release = releases[0] as { id: string } | undefined;
    if (!release) return json({ error: 'no_published_curriculum' }, 404);

    const manifestObject = await env.CURRICULUM_BUCKET.get('published/' + release.id + '/manifest.json');
    if (!manifestObject) return json({ error: 'published_curriculum_manifest_missing' }, 503);

    let manifestInput: unknown;
    try {
      manifestInput = JSON.parse(await new Response(manifestObject.body).text()) as unknown;
    } catch {
      return json({ error: 'published_curriculum_manifest_invalid' }, 503);
    }

    const validation = validateCurriculumManifest(manifestInput);
    if (!validation.ok) return json({ error: 'published_curriculum_manifest_invalid' }, 503);

    const entry = validation.manifest.files.find((file) => file.path === filePath);
    if (!entry) return json({ error: 'curriculum_file_not_declared' }, 404);

    const object = await env.CURRICULUM_BUCKET.get('published/' + release.id + '/' + filePath);
    if (!object) return json({ error: 'published_curriculum_object_missing' }, 503);
    if (object.size !== entry.bytes) return json({ error: 'published_curriculum_file_size_mismatch' }, 503);

    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
        ETag: object.httpEtag,
        Vary: 'Cookie, Authorization'
      }
    });
  } catch {
    return json({ error: 'curriculum_file_query_failed' }, 503);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    const origin = request.headers.get('Origin');
    const allowed = (env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    if (!origin || !allowed.includes(origin)) return json({ error: 'origin_not_allowed' }, 403);
    return new Response(null, { status: 204 });
  }

  if (path === '/v1/health' && method === 'GET') {
    return json({
      service: 'fluently-api',
      status: 'ok',
      environment: env.APP_ENV,
      integrations: {
        identity: Boolean(env.AUTH_SESSION_SECRET && env.AUTH_ISSUER && env.AUTH_AUDIENCE),
        database: Boolean(env.HYPERDRIVE),
        curriculumStorage: Boolean(env.CURRICULUM_BUCKET)
      }
    });
  }

  if (path.startsWith('/v1/auth/')) {
    return json({
      error: 'identity_provider_not_configured',
      message: 'Sign-in endpoints remain disabled until an identity and email provider passes the no-card/no-billing review.'
    }, 503);
  }

  const meMatch = path === '/v1/me';
  const exportMatch = path === '/v1/me/export';
  const curriculumManifest = path === '/v1/curriculum/manifest';
  const curriculumContent = path === '/v1/curriculum/content.json';
  const curriculumZip = path === '/v1/curriculum/package.zip';
  const curriculumFilesPrefix = '/v1/curriculum/files/';
  const curriculumFileRequest = path.startsWith(curriculumFilesPrefix);
  const syncPush = path === '/v1/sync/push';
  const adminSession = path === '/v1/admin/session';
  const adminDrafts = path === '/v1/admin/drafts';
  const adminRelease = path === '/v1/admin/releases';
  const adminReleasePublish = /^\/v1\/admin\/releases\/[0-9a-f-]+\/publish$/i.test(path);
  const adminDraftSubmit = /^\/v1\/admin\/content\/[a-z0-9._-]+\/submit$/i.test(path);
  const adminContentReview = /^\/v1\/admin\/content\/[a-z0-9._-]+\/review$/i.test(path);
  const adminContentPublish = /^\/v1\/admin\/content\/[a-z0-9._-]+\/publish$/i.test(path);
  const adminDraftUpdate = /^\/v1\/admin\/drafts\/[a-z0-9._-]+$/i.test(path);

  const auth = await authenticated(request, env);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  if (meMatch && method === 'GET') {
    return json({ userId: user.userId, emailVerified: user.emailVerified });
  }

  if (exportMatch && method === 'GET') {
    let sql;
    try { sql = getDatabase(env); } catch { return json({ error: 'database_not_configured' }, 503); }
    try {
      const exported = await sql.begin(async (tx) => {
        await tx.unsafe("select set_config('app.user_id', $1, true)", [user.userId]);
        const profiles = await tx.unsafe(
          'select nickname,locale,active_track,daily_goal_minutes,created_at,updated_at from learning_profiles where user_id=$1',
          [user.userId]
        );
        const events = await tx.unsafe(
          'select event_type,entity_id,content_version,payload,occurred_at_client,received_at_server from learning_events where user_id=$1 order by received_at_server',
          [user.userId]
        );
        const reviews = await tx.unsafe(
          'select item_id,state,algorithm_version,due_at,updated_at from review_states where user_id=$1 order by item_id',
          [user.userId]
        );
        return { profile: profiles[0] ?? null, learningEvents: events, reviewStates: reviews };
      });
      return json({ exportedAt: new Date().toISOString(), userId: user.userId, ...exported });
    } catch {
      return json({ error: 'data_export_unavailable' }, 503);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }

  if (meMatch && method === 'DELETE') {
    let sql;
    try { sql = getDatabase(env); } catch { return json({ error: 'database_not_configured' }, 503); }
    try {
      const deletion = await sql.begin(async (tx) => {
        await tx.unsafe("select set_config('app.user_id', $1, true)", [user.userId]);
        const requests = await tx.unsafe(
          'insert into account_deletion_requests (user_id) values ($1) returning id,requested_at',
          [user.userId]
        );
        await tx.unsafe("update app_users set status='deletion_requested',updated_at=now() where id=$1", [user.userId]);
        await tx.unsafe("update user_sessions set revoked_at=now() where user_id=$1 and revoked_at is null", [user.userId]);
        return requests[0] as { id: string; requested_at: string } | undefined;
      });
      if (!deletion) return json({ error: 'deletion_request_unavailable' }, 503);
      return json({ status: 'deletion_requested', requestId: deletion.id, requestedAt: deletion.requested_at }, 202);
    } catch {
      return json({ error: 'deletion_request_unavailable' }, 503);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }

  if (syncPush && method === 'POST') {
    if (!user.emailVerified) return json({ error: 'email_verification_required_for_sync' }, 403);
    const body = await readJson(request, 512 * 1024);
    if (body.error) return json({ error: body.error }, body.error === 'request_body_too_large' ? 413 : 400);
    const parsed = SyncInput.safeParse(body.data);
    if (!parsed.success) return json({ error: 'invalid_sync_payload', details: parsed.error.issues }, 400);
    const operations: SyncOperation[] = parsed.data.operations;
    const containsDeletion = operations.some((operation) => operation.entityType === 'account_delete');
    if (containsDeletion && parsed.data.operations.length !== 1) {
      return json({ error: 'account_deletion_must_be_a_standalone_operation' }, 400);
    }

    let sql;
    try { sql = getDatabase(env); } catch { return json({ error: 'database_not_configured' }, 503); }
    const accepted: string[] = [];
    const duplicates: string[] = [];
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("select set_config('app.user_id', $1, true)", [user.userId]);
        for (const operation of operations) {
          const inserted = await tx.unsafe(
            'insert into sync_operations (user_id,operation_id,entity_id,entity_type,schema_version,occurred_at_local,payload) ' +
            'values ($1,$2,$3,$4,$5,$6,$7::jsonb) on conflict (user_id,operation_id) do nothing returning operation_id',
            [user.userId, operation.operationId, operation.entityId, operation.entityType, operation.schemaVersion, operation.occurredAtLocal, JSON.stringify(operation.payload)]
          );
          if (!inserted.length) {
            duplicates.push(operation.operationId);
            continue;
          }
          accepted.push(operation.operationId);

          if (operation.entityType === 'account_delete') {
            await tx.unsafe('insert into account_deletion_requests (user_id) values ($1)', [user.userId]);
            await tx.unsafe("update app_users set status='deletion_requested',updated_at=now() where id=$1", [user.userId]);
            await tx.unsafe("update user_sessions set revoked_at=now() where user_id=$1 and revoked_at is null", [user.userId]);
            continue;
          }

          const contentVersion = typeof operation.payload.contentVersion === 'string'
            ? operation.payload.contentVersion : 'profile-v1';
          await tx.unsafe(
            'insert into learning_events (user_id,event_type,entity_id,content_version,payload,occurred_at_client) values ($1,$2,$3,$4,$5::jsonb,$6)',
            [user.userId, operation.entityType, operation.entityId, contentVersion, JSON.stringify(operation.payload), operation.occurredAtLocal]
          );
          if (operation.entityType === 'review_event') {
            const review = ReviewStateSchema.parse(operation.payload.reviewState);
            await tx.unsafe(
              'insert into review_states (user_id,item_id,state,algorithm_version,due_at) values ($1,$2,$3::jsonb,$4,$5) ' +
              'on conflict (user_id,item_id) do update set state=excluded.state,algorithm_version=excluded.algorithm_version,due_at=excluded.due_at,updated_at=now()',
              [user.userId, review.itemId, JSON.stringify(review), review.version, review.dueAt]
            );
          }
        }
      });
      return json({ accepted, duplicates });
    } catch {
      return json({ error: 'sync_write_failed' }, 503);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }

  if (curriculumManifest && method === 'GET') return getReleaseObject(env, request, 'manifest.json');
  if (curriculumZip && method === 'GET') return getReleaseArchive(env);
  if (curriculumContent && method === 'GET') return getReleaseFile(env, 'content.json');
  if (curriculumFileRequest && method === 'GET') {
    const filePath = decodeCurriculumFilePath(path.slice(curriculumFilesPrefix.length));
    if (!filePath) return json({ error: 'invalid_curriculum_file_path' }, 400);
    return getReleaseFile(env, filePath);
  }

  if (adminSession && method === 'GET') {
    if (!requireRole(user, 'owner', 'editor', 'reviewer', 'publisher')) return json({ error: 'forbidden' }, 403);
    return json({ userId: user.userId, roles: user.roles });
  }

  if (adminDrafts && method === 'GET') {
    if (!requireRole(user, 'owner', 'editor', 'reviewer', 'publisher')) return json({ error: 'forbidden' }, 403);
    let sql;
    try { sql = getDatabase(env); } catch { return json({ error: 'database_not_configured' }, 503); }
    try {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe("select set_config('app.user_id', $1, true)", [user.userId]);
        return tx.unsafe(
          "select id,title,stage,status,content_version,updated_at from content_items " +
          "where status in ('draft','in_review','approved','published','changes_requested') order by updated_at desc limit 200"
        );
      });
      return json({ items: rows });
    } catch {
      return json({ error: 'content_query_failed' }, 503);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }

  if (adminDrafts && method === 'POST') {
    if (!requireRole(user, 'owner', 'editor')) return json({ error: 'forbidden' }, 403);
    const body = await readJson(request, 1024 * 1024);
    if (body.error) return json({ error: body.error }, body.error === 'request_body_too_large' ? 413 : 400);
    const parsed = LessonSchema.safeParse(body.data);
    if (!parsed.success || parsed.data.status !== 'draft' ||
        parsed.data.review.reviewerId !== null || parsed.data.review.reviewedAt !== null || parsed.data.review.approvalNote !== null) {
      return json({ error: 'invalid_draft_or_premature_approval' }, 400);
    }
    let sql;
    try { sql = getDatabase(env); } catch { return json({ error: 'database_not_configured' }, 503); }
    try {
      const created = await sql.begin(async (tx) => {
        await tx.unsafe("select set_config('app.user_id', $1, true)", [user.userId]);
        const lesson = parsed.data;
        const rows = await tx.unsafe(
          "insert into content_items (id,title,stage,status,content_version,source_metadata,content_json,created_by) " +
          "values ($1,$2,$3,'draft',$4,$5::jsonb,$6::jsonb,$7) returning id,title,status,content_version",
          [lesson.id, lesson.title, lesson.stage, lesson.contentVersion, JSON.stringify(lesson.source), JSON.stringify(lesson), user.userId]
        );
        await tx.unsafe(
          'insert into content_versions (content_id,content_version,snapshot,created_by) values ($1,$2,$3::jsonb,$4)',
          [lesson.id, lesson.contentVersion, JSON.stringify(lesson), user.userId]
        );
        await tx.unsafe(
          "insert into audit_events (actor_user_id,action,subject_id,metadata) values ($1,'content.create_draft',$2,'{}'::jsonb)",
          [user.userId, lesson.id]
        );
        return rows[0];
      });
      return json({ item: created }, 201);
    } catch {
      return json({ error: 'draft_create_conflict_or_unavailable' }, 409);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }

  if (adminDraftUpdate && method === 'PUT') {
    if (!requireRole(user, 'owner', 'editor')) return json({ error: 'forbidden' }, 403);
    const body = await readJson(request, 1024 * 1024);
    if (body.error) return json({ error: body.error }, body.error === 'request_body_too_large' ? 413 : 400);
    const parsed = LessonSchema.safeParse(body.data);
    const draftId = path.split('/').at(-1) ?? '';
    if (!parsed.success || parsed.data.id !== draftId || parsed.data.status !== 'draft' ||
        parsed.data.review.reviewerId !== null || parsed.data.review.reviewedAt !== null || parsed.data.review.approvalNote !== null) {
      return json({ error: 'invalid_draft_update' }, 400);
    }
    let sql;
    try { sql = getDatabase(env); } catch { return json({ error: 'database_not_configured' }, 503); }
    try {
      const updated = await sql.begin(async (tx) => {
        await tx.unsafe("select set_config('app.user_id', $1, true)", [user.userId]);
        const lesson = parsed.data;
        const rows = await tx.unsafe(
          "update content_items set title=$1,stage=$2,content_version=$3,source_metadata=$4::jsonb,content_json=$5::jsonb,updated_at=now() " +
          "where id=$6 and status in ('draft','changes_requested') and created_by=$7 returning id,title,status,content_version",
          [lesson.title, lesson.stage, lesson.contentVersion, JSON.stringify(lesson.source), JSON.stringify(lesson), lesson.id, user.userId]
        );
        if (!rows.length) return null;
        await tx.unsafe(
          'insert into content_versions (content_id,content_version,snapshot,created_by) values ($1,$2,$3::jsonb,$4)',
          [lesson.id, lesson.contentVersion, JSON.stringify(lesson), user.userId]
        );
        await tx.unsafe(
          "insert into audit_events (actor_user_id,action,subject_id,metadata) values ($1,'content.update_draft',$2,$3::jsonb)",
          [user.userId, lesson.id, JSON.stringify({ contentVersion: lesson.contentVersion })]
        );
        return rows[0];
      });
      if (!updated) return json({ error: 'draft_not_found_or_not_owned' }, 409);
      return json({ item: updated });
    } catch {
      return json({ error: 'draft_update_conflict_or_unavailable' }, 409);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }

  if (adminDraftSubmit && method === 'POST') {
    if (!requireRole(user, 'owner', 'editor')) return json({ error: 'forbidden' }, 403);
    const id = path.split('/').at(-2) ?? '';
    let sql;
    try { sql = getDatabase(env); } catch { return json({ error: 'database_not_configured' }, 503); }
    try {
      const result = await sql.begin(async (tx) => {
        await tx.unsafe("select set_config('app.user_id', $1, true)", [user.userId]);
        const rows = await tx.unsafe(
          "update content_items set status='in_review',updated_at=now() where id=$1 and status in ('draft','changes_requested') and created_by=$2 returning id,status",
          [id, user.userId]
        );
        if (!rows.length) return null;
        await tx.unsafe(
          "insert into audit_events (actor_user_id,action,subject_id,metadata) values ($1,'content.submit_for_review',$2,'{}'::jsonb)",
          [user.userId, id]
        );
        return rows[0];
      });
      if (!result) return json({ error: 'draft_not_found_or_not_owned' }, 409);
      return json({ item: result });
    } catch {
      return json({ error: 'content_submit_failed' }, 503);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }

  if (adminContentReview && method === 'POST') {
    if (!requireRole(user, 'owner', 'reviewer')) return json({ error: 'forbidden' }, 403);
    const body = await readJson(request, 64 * 1024);
    if (body.error) return json({ error: body.error }, 400);
    const parsed = ReviewInput.safeParse(body.data);
    if (!parsed.success) return json({ error: 'invalid_review', details: parsed.error.issues }, 400);
    const id = path.split('/').at(-2) ?? '';
    let sql;
    try { sql = getDatabase(env); } catch { return json({ error: 'database_not_configured' }, 503); }
    try {
      const result = await sql.begin(async (tx) => {
        await tx.unsafe("select set_config('app.user_id', $1, true)", [user.userId]);
        const rows = await tx.unsafe(
          "update content_items set status=$1,review_note=$2,reviewed_by=$3,reviewed_at=now(),updated_at=now(), " +
          "content_json = content_json || jsonb_build_object('status',$1::text,'review',coalesce(content_json->'review','{}'::jsonb) || jsonb_build_object('reviewerId',$3::text,'reviewedAt',now()::text,'approvalNote',$2::text)) " +
          "where id=$4 and status='in_review' and created_by <> $3 " +
          "and ($1 <> 'approved' or (trim(coalesce(source_metadata->>'license','')) <> '' and lower(source_metadata->>'license') not like '%pending%' and trim(coalesce(source_metadata->>'note','')) <> '')) " +
          "returning id,status,reviewed_by,reviewed_at",
          [parsed.data.decision, parsed.data.note, user.userId, id]
        );
        if (!rows.length) return null;
        await tx.unsafe(
          "insert into audit_events (actor_user_id,action,subject_id,metadata) values ($1,'content.review',$2,$3::jsonb)",
          [user.userId, id, JSON.stringify({ decision: parsed.data.decision, note: parsed.data.note })]
        );
        return rows[0];
      });
      if (!result) return json({ error: 'item_not_awaiting_review_or_missing_rights_or_self_review' }, 409);
      return json({ item: result });
    } catch {
      return json({ error: 'content_review_failed' }, 503);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }

  if (adminContentPublish && method === 'POST') {
    if (!requireRole(user, 'owner', 'publisher')) return json({ error: 'forbidden' }, 403);
    const id = path.split('/').at(-2) ?? '';
    let sql;
    try { sql = getDatabase(env); } catch { return json({ error: 'database_not_configured' }, 503); }
    try {
      const result = await sql.begin(async (tx) => {
        await tx.unsafe("select set_config('app.user_id', $1, true)", [user.userId]);
        const rows = await tx.unsafe(
          'select id,status,content_version,reviewed_by,created_by from content_items where id=$1 for update',
          [id]
        );
        const item = rows[0] as { id: string; status: string; content_version: string; reviewed_by: string | null; created_by: string } | undefined;
        if (!item || item.status !== 'approved' || !item.reviewed_by || item.reviewed_by === item.created_by ||
            item.created_by === user.userId || item.reviewed_by === user.userId) return null;
        const published = await tx.unsafe(
          "update content_items set status='published',published_by=$1,published_at=now(),updated_at=now(),content_json=jsonb_set(content_json,'{status}',to_jsonb('published'::text)) " +
          "where id=$2 and status='approved' returning id,status,content_version,published_at",
          [user.userId, item.id]
        );
        await tx.unsafe(
          "insert into audit_events (actor_user_id,action,subject_id,metadata) values ($1,'content.publish',$2,$3::jsonb)",
          [user.userId, item.id, JSON.stringify({ contentVersion: item.content_version })]
        );
        return published[0] ?? null;
      });
      if (!result) return json({ error: 'human_approval_required_or_self_publish' }, 409);
      return json({ item: result });
    } catch {
      return json({ error: 'content_publish_failed' }, 503);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }

  if (adminRelease && method === 'POST') {
    if (!requireRole(user, 'owner', 'publisher')) return json({ error: 'forbidden' }, 403);
    if (!env.CURRICULUM_BUCKET) return json({ error: 'curriculum_storage_not_configured' }, 503);
    const body = await readJson(request, 32 * 1024);
    if (body.error) return json({ error: body.error }, 400);
    const parsed = ReleaseInput.safeParse(body.data);
    if (!parsed.success) return json({ error: 'invalid_content_version' }, 400);
    let sql;
    try { sql = getDatabase(env); } catch { return json({ error: 'database_not_configured' }, 503); }
    try {
      const snapshot = await sql.begin(async (tx) => {
        await tx.unsafe("select set_config('app.user_id', $1, true)", [user.userId]);
        const existing = await tx.unsafe(
          "select id from curriculum_releases where package_id='fluently.core' and content_version=$1",
          [parsed.data.contentVersion]
        );
        const rows = await tx.unsafe(
          "select id,content_json,source_metadata,created_by::text as created_by,reviewed_by::text as reviewed_by " +
          "from content_items where status in ('approved','published') order by id"
        );
        return { releaseExists: existing.length > 0, rows };
      });
      if (snapshot.releaseExists) return json({ error: 'release_version_exists' }, 409);
      const rows = snapshot.rows;
      const lessons = rows.map((row) => row.content_json);
      if (!lessons.length || !lessons.every(isApprovedLesson)) return json({ error: 'no_human_approved_content' }, 409);
      if (rows.some((row) => !row.reviewed_by || row.reviewed_by === row.created_by || row.reviewed_by === user.userId)) {
        return json({ error: 'reviewer_and_publisher_must_be_separate' }, 409);
      }
      const rights = rows.map((row) => {
        const source = row.source_metadata as { license?: string; note?: string };
        return { asset: String(row.id), license: source.license ?? '', attribution: source.note ?? '' };
      });
      if (rights.some((item) => !item.license || item.license.toLowerCase().includes('pending') || !item.attribution)) {
        return json({ error: 'missing_content_rights' }, 409);
      }

      const bundle = await buildCurriculumArchive(lessons, parsed.data.contentVersion);
      const releaseId = crypto.randomUUID();
      for (const [filePath, bytes] of bundle.files) {
        const contentType = filePath.endsWith('.json')
          ? 'application/json; charset=utf-8'
          : filePath.endsWith('.md')
            ? 'text/markdown; charset=utf-8'
            : 'application/octet-stream';
        await env.CURRICULUM_BUCKET.put('staged/' + releaseId + '/' + filePath, bytes, {
          httpMetadata: { contentType }
        });
      }
      const manifestText = JSON.stringify(bundle.manifest);
      await env.CURRICULUM_BUCKET.put('staged/' + releaseId + '/manifest.json', manifestText, {
        httpMetadata: { contentType: 'application/json; charset=utf-8' }
      });
      await env.CURRICULUM_BUCKET.put('staged/' + releaseId + '/curriculum.zip', bundle.archive, {
        httpMetadata: { contentType: 'application/zip' }
      });
      await env.CURRICULUM_BUCKET.put('staged/' + releaseId + '/curriculum.zip.sha256', bundle.archiveSha256, {
        httpMetadata: { contentType: 'text/plain; charset=utf-8' }
      });
      const created = await sql.begin(async (tx) => {
        await tx.unsafe("select set_config('app.user_id', $1, true)", [user.userId]);
        const inserted = await tx.unsafe(
          "insert into curriculum_releases (id,package_id,content_version,schema_version,manifest,package_sha256,status) " +
          "values ($1,'fluently.core',$2,1,$3::jsonb,$4,'staged') returning id,content_version,status,package_sha256",
          [releaseId, parsed.data.contentVersion, JSON.stringify(bundle.manifest), bundle.contentSha256]
        );
        await tx.unsafe(
          "insert into audit_events (actor_user_id,action,subject_id,metadata) values ($1,'curriculum.stage_release',$2,$3::jsonb)",
          [user.userId, releaseId, JSON.stringify({
            contentVersion: parsed.data.contentVersion,
            contentSha256: bundle.contentSha256,
            archiveSha256: bundle.archiveSha256,
            fileCount: bundle.manifest.files.length
          })]
        );
        return inserted[0];
      });
      return json({ release: created }, 201);
    } catch {
      return json({ error: 'release_build_failed' }, 503);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }

  if (adminReleasePublish && method === 'POST') {
    if (!requireRole(user, 'owner', 'publisher')) return json({ error: 'forbidden' }, 403);
    if (!env.CURRICULUM_BUCKET) return json({ error: 'curriculum_storage_not_configured' }, 503);
    const id = path.split('/').at(-2) ?? '';
    let sql;
    try { sql = getDatabase(env); } catch { return json({ error: 'database_not_configured' }, 503); }
    try {
      const result = await sql.begin(async (tx) => {
        await tx.unsafe("select set_config('app.user_id', $1, true)", [user.userId]);
        const rows = await tx.unsafe(
          "select id,package_id,content_version,package_sha256,status from curriculum_releases where id=$1 for update",
          [id]
        );
        const release = rows[0] as { id: string; package_id: string; content_version: string; package_sha256: string; status: string } | undefined;
        if (!release || release.status !== 'staged') return null;
        const contentObject = await env.CURRICULUM_BUCKET!.get('staged/' + release.id + '/content.json');
        const manifestObject = await env.CURRICULUM_BUCKET!.get('staged/' + release.id + '/manifest.json');
        if (!contentObject || !manifestObject) throw new Error('staged_release_files_missing');
        const bytes = new Uint8Array(await new Response(contentObject.body).arrayBuffer());
        if (await sha256Hex(bytes) !== release.package_sha256) throw new Error('staged_release_hash_mismatch');
        const manifestText = await new Response(manifestObject.body).text();
        const manifest = JSON.parse(manifestText) as { files?: Array<{ sha256?: string }> };
        if (manifest.files?.[0]?.sha256 !== release.package_sha256) throw new Error('staged_manifest_hash_mismatch');
        await env.CURRICULUM_BUCKET!.put('published/' + release.id + '/content.json', bytes, {
          httpMetadata: { contentType: 'application/json' }
        });
        await env.CURRICULUM_BUCKET!.put('published/' + release.id + '/manifest.json', manifestText, {
          httpMetadata: { contentType: 'application/json' }
        });
        await tx.unsafe(
          "update curriculum_releases set status='retired' where package_id=$1 and status='published'",
          [release.package_id]
        );
        const published = await tx.unsafe(
          "update curriculum_releases set status='published',published_by=$1,published_at=now() where id=$2 and status='staged' returning id,package_id,content_version,package_sha256,published_at",
          [user.userId, release.id]
        );
        await tx.unsafe(
          "insert into audit_events (actor_user_id,action,subject_id,metadata) values ($1,'curriculum.publish_release',$2,$3::jsonb)",
          [user.userId, release.id, JSON.stringify({ contentVersion: release.content_version, packageSha256: release.package_sha256 })]
        );
        return published[0] ?? null;
      });
      if (!result) return json({ error: 'staged_release_not_found' }, 409);
      return json({ release: result });
    } catch {
      return json({ error: 'release_publish_failed' }, 503);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }

  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      response = await handleRequest(request, env);
    } catch (error) {
      console.error('API request failed', { name: error instanceof Error ? error.name : 'unknown' });
      response = json({ error: 'internal_error' }, 500);
    }
    return withCors(response, request, env);
  }
};
