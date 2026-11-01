import { jwtVerify } from 'jose';
import { createMiddleware } from 'hono/factory';
import type { AdminRole, Env, Variables } from './types';

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
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

  try {
    const key = new TextEncoder().encode(secret);
    const result = await jwtVerify(token, key, {
      issuer, audience, algorithms: ['HS256'], clockTolerance: 5
    });
    if (typeof result.payload.sub !== 'string' || result.payload.sub.length < 1) {
      return c.json({ error: 'invalid_session_subject' }, 401);
    }
    const roles = Array.isArray(result.payload.roles)
      ? result.payload.roles.filter((role): role is AdminRole => ['owner', 'editor', 'reviewer', 'publisher'].includes(String(role)))
      : [];
    c.set('userId', result.payload.sub);
    c.set('roles', roles);
    c.set('emailVerified', result.payload.email_verified === true);
    await next();
  } catch {
    return c.json({ error: 'invalid_or_expired_session' }, 401);
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
