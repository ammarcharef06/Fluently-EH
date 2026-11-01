import { z } from 'zod';

export const LessonStepSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), type: z.literal('explanation'), heading: z.string().min(1), body: z.string().min(1) }),
  z.object({ id: z.string().min(1), type: z.literal('example'), english: z.string().min(1), arabic: z.string().min(1), note: z.string().optional() }),
  z.object({ id: z.string().min(1), type: z.literal('choice'), questionId: z.string().min(1), prompt: z.string().min(1), options: z.array(z.object({ id: z.string(), text: z.string() })).min(2), answerId: z.string(), explanation: z.string().min(1) })
]);
export const LessonSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
  type: z.literal('lesson'),
  title: z.string().min(1),
  description: z.string().min(1),
  stage: z.enum(['literacy', 'pre-a1', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2']),
  skills: z.array(z.enum(['literacy', 'reading', 'writing', 'listening', 'speaking-practice', 'grammar', 'vocabulary'])).min(1),
  objectives: z.array(z.object({ id: z.string().min(1), description: z.string().min(1) })).min(1),
  prerequisites: z.array(z.string()),
  estimatedMinutes: z.number().int().min(1).max(60),
  steps: z.array(LessonStepSchema).min(1),
  status: z.enum(['draft', 'in_review', 'approved', 'published', 'retired']),
  contentVersion: z.string().min(1),
  source: z.object({ kind: z.enum(['original', 'external']), note: z.string().min(1), license: z.string().min(1) }),
  review: z.object({ reviewerId: z.string().nullable(), reviewedAt: z.string().nullable(), approvalNote: z.string().nullable() })
});
export const CurriculumManifestSchema = z.object({
  packageId: z.string().min(1),
  contentVersion: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  minAppVersion: z.string().min(1),
  maxAppVersion: z.string().nullable(),
  generatedAt: z.string().datetime(),
  files: z.array(z.object({ path: z.string().min(1), bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })),
  rights: z.array(z.object({ asset: z.string(), license: z.string(), attribution: z.string().optional() }))
});
export type Lesson = z.infer<typeof LessonSchema>;
export type CurriculumManifest = z.infer<typeof CurriculumManifestSchema>;
export const CURRENT_SCHEMA_VERSION = 1;
export const MAX_PACKAGE_BYTES = 250 * 1024 * 1024;
export const MAX_FILE_COUNT = 5000;
export const MAX_SINGLE_FILE_BYTES = 100 * 1024 * 1024;

export function isSafePackagePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.startsWith('\\') || path.includes('\\')) return false;
  return path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !/^[A-Za-z]:/.test(segment));
}

export async function verifyPackageFiles(manifestInput: unknown, files: ReadonlyMap<string, Uint8Array>, supportedSchemaVersion = CURRENT_SCHEMA_VERSION): Promise<{ ok: true; manifest: CurriculumManifest } | { ok: false; errors: string[] }> {
  const parsed = CurriculumManifestSchema.safeParse(manifestInput);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  const manifest = parsed.data;
  const errors: string[] = [];
  if (manifest.schemaVersion !== supportedSchemaVersion) errors.push('Unsupported schema version.');
  if (manifest.files.length > MAX_FILE_COUNT) errors.push('Too many files in package.');
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const entry of manifest.files) {
    if (!isSafePackagePath(entry.path)) errors.push('Unsafe package path: ' + entry.path);
    if (seen.has(entry.path)) errors.push('Duplicate package path: ' + entry.path);
    seen.add(entry.path);
    const data = files.get(entry.path);
    if (!data) { errors.push('Missing file: ' + entry.path); continue; }
    if (data.byteLength !== entry.bytes) errors.push('Size mismatch: ' + entry.path);
    if (data.byteLength > MAX_SINGLE_FILE_BYTES) errors.push('File exceeds size limit: ' + entry.path);
    totalBytes += data.byteLength;
    const digest = await crypto.subtle.digest('SHA-256', data);
    const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== entry.sha256) errors.push('SHA-256 mismatch: ' + entry.path);
  }
  if (totalBytes > MAX_PACKAGE_BYTES) errors.push('Package exceeds total size limit.');
  if (files.size !== manifest.files.length) errors.push('Unexpected files are present in package.');
  return errors.length ? { ok: false, errors } : { ok: true, manifest };
}
