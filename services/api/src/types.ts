export type AdminRole = 'owner' | 'editor' | 'reviewer' | 'publisher';

export interface ObjectBucket {
  get(key: string): Promise<{ body: ReadableStream; httpEtag: string } | null>;
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
}

export interface Env {
  APP_ENV: 'development' | 'production';
  AUTH_ISSUER?: string;
  AUTH_AUDIENCE?: string;
  AUTH_SESSION_SECRET?: string;
  HYPERDRIVE?: { connectionString: string };
  CURRICULUM_BUCKET?: ObjectBucket;
  CORS_ALLOWED_ORIGINS?: string;
}

export type AuthenticatedUser = {
  userId: string;
  roles: AdminRole[];
  emailVerified: boolean;
};

export type AuthResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; status: 401 | 403 | 410 | 503; error: string };
