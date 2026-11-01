import { jwtVerify } from 'jose';
import { createMiddleware } from 'hono/factory';
import { getDatabase } from './db';
import type { AdminRole, Env, Variables } from './types';

const validRoles = new Set<AdminRole>(['owner', 'editor', 'reviewer', 'publisher']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const requireSession = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const secret = c.env.AUTH_SESSION_SECRET;
  const issuer = c.env.AUTH_ISSUER;
  const audience = c.env.AUTH_AUDIENCE;
  if (!secret || secret.length < 32 || !issuer || !audience) {
    return c.json({ error: 'identity_provider_not_configured' }, 503);
  }

  const authorization = c.req.header('Authorization');
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  const token = bearer ?? readCookie(c.req.header('Cookie'), 'fluently_session');
  if (!token) return c.json({ error: 'authentication_required' }, 401);

  let subject: string;
  try {
    const key = new TextEncoder().encode(secret);
    const result = await jwtVerify(token, key, {
      issuer, audience, algorithms: ['HS256'], clockTolerance: 5
    });
    if (typeof result.payload.sub !== 'string' || !uuidPattern.test(result.payload.sub)) {
      return c.json({ error: 'invalid_session_subject' }, 401);
    }
    subject = result.payload.sub;
  } catch {
    return c.json({ error: 'invalid_or_expired_session' }, 401);
  }

  let sql;
  try {
    sql = getDatabase(c.env);
  } catch {
    return c.json({ error: 'database_not_configured' }, 503);
  }

  try {
    const tokenHash = await sha256Hex(token);
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe("select set_config('app.user_id', $1, true)", [subject]);
      return tx.unsafe(
        "select u.id::text as user_id, (u.email_verified_at is not null) as email_verified, " +
        "coalesce(array_agg(m.role::text) filter (where m.role is not null and m.revoked_at is null), array[]::text[]) as roles " +
        "from app_users u join user_sessions s on s.user_id = u.id " +
        "left join employee_memberships m on m.user_id = u.id " +
        "where u.id = $1 and u.status = 'active' and s.token_hash = $2 " +
        "and s.revoked_at is null and s.expires_at > now() " +
        "group by u.id, u.email_verified_at",
        [subject, tokenHash]
      );
    });

    const session = rows[0] as { user_id: string; email_verified: boolean; roles: string[] } | undefined;
    if (!session) return c.json({ error: 'invalid_or_revoked_session' }, 401);

    const roles = Array.isArray(session.roles)
      ? session.roles.filter((role): role is AdminRole => validRoles.has(role as AdminRole))
      : [];
    c.set('userId', session.user_id);
    c.set('roles', roles);
    c.set('emailVerified', session.email_verified === true);
    await next();
  } catch {
    return c.json({ error: 'session_validation_unavailable' }, 503);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

export function requireRole(...required: AdminRole[]) {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const roles = c.get('roles');
    if (!required.some((role) => roles.includes(role)) && !roles.includes('owner')) {
      return c.json({ error: 'forbidden' }, 403);
    }
    await next();
  });
}
