import { jwtVerify } from 'jose';
import { getDatabase } from './db';
import type { AdminRole, AuthResult, Env } from './types';

const allowedRoles = new Set<AdminRole>(['owner', 'editor', 'reviewer', 'publisher']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    const key = item.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isAllowedCookieMutation(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  const allowed = (env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  const contentType = request.headers.get('Content-Type') ?? '';
  return Boolean(
    origin &&
    allowed.includes(origin) &&
    fetchSite !== 'cross-site' &&
    contentType.toLowerCase().startsWith('application/json')
  );
}

export async function authenticateRequest(request: Request, env: Env): Promise<AuthResult> {
  const secret = env.AUTH_SESSION_SECRET;
  const issuer = env.AUTH_ISSUER;
  const audience = env.AUTH_AUDIENCE;
  if (!secret || secret.length < 32 || !issuer || !audience) {
    return { ok: false, status: 503, error: 'identity_provider_not_configured' };
  }

  const authorization = request.headers.get('Authorization');
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
  const cookieToken = parseCookie(request.headers.get('Cookie'), 'fluently_session');
  const token = bearer || cookieToken;
  if (!token) return { ok: false, status: 401, error: 'authentication_required' };
  if (token.length > 8192) return { ok: false, status: 401, error: 'invalid_session_token' };

  if (!bearer && cookieToken && !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase()) &&
      !isAllowedCookieMutation(request, env)) {
    return { ok: false, status: 403, error: 'csrf_validation_failed' };
  }

  let subject: string;
  try {
    const verified = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer,
      audience,
      algorithms: ['HS256'],
      clockTolerance: 5
    });
    if (typeof verified.payload.sub !== 'string' || !uuidPattern.test(verified.payload.sub)) {
      return { ok: false, status: 401, error: 'invalid_session_subject' };
    }
    subject = verified.payload.sub;
  } catch {
    return { ok: false, status: 401, error: 'invalid_or_expired_session' };
  }

  let sql;
  try {
    sql = getDatabase(env);
  } catch {
    return { ok: false, status: 503, error: 'database_not_configured' };
  }

  try {
    const tokenHash = await sha256Hex(token);
    const result = await sql.begin(async (tx) => {
      await tx.unsafe("select set_config('app.user_id', $1, true)", [subject]);
      const users = await tx.unsafe('select status, email_verified_at from app_users where id = $1', [subject]);
      const account = users[0] as { status: string; email_verified_at: string | null } | undefined;
      if (!account) return { state: 'invalid' as const };
      if (account.status === 'deletion_requested' || account.status === 'deleted') {
        return { state: 'deletion' as const };
      }
      if (account.status !== 'active') return { state: 'invalid' as const };

      const sessions = await tx.unsafe(
        'select s.user_id::text as user_id from user_sessions s ' +
        'where s.user_id = $1 and s.token_hash = $2 and s.revoked_at is null and s.expires_at > now() limit 1',
        [subject, tokenHash]
      );
      if (!sessions.length) return { state: 'invalid' as const };

      const roleRows = await tx.unsafe(
        "select role::text as role from employee_memberships where user_id = $1 and revoked_at is null",
        [subject]
      );
      const roles = roleRows
        .map((row) => String(row.role))
        .filter((role): role is AdminRole => allowedRoles.has(role as AdminRole));
      return {
        state: 'valid' as const,
        userId: subject,
        emailVerified: Boolean(account.email_verified_at),
        roles
      };
    });

    if (result.state === 'deletion') return { ok: false, status: 410, error: 'account_deletion_pending' };
    if (result.state === 'invalid') return { ok: false, status: 401, error: 'invalid_or_revoked_session' };
    return {
      ok: true,
      user: { userId: result.userId, emailVerified: result.emailVerified, roles: result.roles }
    };
  } catch {
    return { ok: false, status: 503, error: 'session_validation_unavailable' };
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export function hasRole(userRoles: readonly AdminRole[], ...required: AdminRole[]): boolean {
  return userRoles.includes('owner') || required.some((role) => userRoles.includes(role));
}
