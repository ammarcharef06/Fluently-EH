import { zipSync, strToU8 } from 'fflate';
import {
  LessonSchema,
  MAX_PACKAGE_BYTES,
  validateCurriculumManifest,
  verifyPackageFiles,
  type CurriculumManifest,
  type Lesson
} from '@fluently/content-schema';

const PACKAGE_ID = 'fluently.core';
const MAX_ARCHIVE_BYTES = MAX_PACKAGE_BYTES + 2 * 1024 * 1024;

export type BuiltCurriculumArchive = {
  manifest: CurriculumManifest;
  files: Map<string, Uint8Array>;
  archive: Uint8Array;
  contentSha256: string;
  archiveSha256: string;
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function approvedLesson(input: unknown): Lesson {
  const parsed = LessonSchema.safeParse(input);
  if (!parsed.success) throw new Error('A curriculum release contains an invalid lesson schema.');
  const lesson = parsed.data;
  if (
    (lesson.status !== 'approved' && lesson.status !== 'published') ||
    !lesson.review.reviewerId ||
    !lesson.review.reviewedAt ||
    !lesson.review.approvalNote?.trim() ||
    !lesson.source.note.trim() ||
    !lesson.source.license.trim() ||
    lesson.source.license.toLowerCase().includes('pending')
  ) {
    throw new Error('A curriculum release contains a lesson without complete human approval and rights metadata.');
  }
  return lesson;
}

/**
 * Builds a ZIP32 curriculum archive from already-selected release lessons.
 * Every content file is separately listed and hashed in the trusted manifest.
 * No draft content is promoted by this function.
 */
export async function buildCurriculumArchive(
  lessonInputs: readonly unknown[],
  contentVersion: string,
  generatedAt = new Date().toISOString()
): Promise<BuiltCurriculumArchive> {
  if (!/^\d+\.\d+\.\d+$/.test(contentVersion)) {
    throw new Error('The curriculum content version must use MAJOR.MINOR.PATCH.');
  }
  if (lessonInputs.length === 0) throw new Error('A curriculum release requires human-approved lessons.');

  const lessons = lessonInputs.map(approvedLesson).sort((left, right) => left.id.localeCompare(right.id));
  const ids = new Set<string>();
  for (const lesson of lessons) {
    if (ids.has(lesson.id)) throw new Error('A curriculum release contains duplicate lesson IDs.');
    ids.add(lesson.id);
  }

  const files = new Map<string, Uint8Array>();
  files.set('content.json', new TextEncoder().encode(JSON.stringify({
    packageId: PACKAGE_ID,
    contentVersion,
    lessons
  }, null, 2)));

  for (const lesson of lessons) {
    files.set('lessons/' + lesson.id + '.json', new TextEncoder().encode(JSON.stringify(lesson, null, 2)));
  }

  const manifestFiles = await Promise.all([...files.entries()].map(async ([path, bytes]) => ({
    path,
    bytes: bytes.byteLength,
    sha256: await sha256Hex(bytes)
  })));

  const manifestInput = {
    packageId: PACKAGE_ID,
    contentVersion,
    schemaVersion: 1,
    minAppVersion: '0.1.0',
    maxAppVersion: null,
    generatedAt,
    files: manifestFiles,
    rights: lessons.map((lesson) => ({
      asset: lesson.id,
      license: lesson.source.license,
      attribution: lesson.source.note
    }))
  };

  const manifestValidation = validateCurriculumManifest(manifestInput);
  if (!manifestValidation.ok) {
    throw new Error('The generated curriculum manifest is invalid: ' + manifestValidation.errors.join('; '));
  }
  const verified = await verifyPackageFiles(manifestValidation.manifest, files);
  if (!verified.ok) {
    throw new Error('The generated curriculum files failed integrity verification: ' + verified.errors.join('; '));
  }

  const zipEntries: Record<string, Uint8Array> = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifestValidation.manifest)),
    ...Object.fromEntries(files)
  };
  const archive = zipSync(zipEntries, { level: 6 });
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('The generated curriculum ZIP exceeds the configured archive size limit.');
  }

  const contentEntry = manifestValidation.manifest.files.find((entry) => entry.path === 'content.json');
  if (!contentEntry) throw new Error('The generated curriculum manifest is missing content.json.');

  return {
    manifest: manifestValidation.manifest,
    files,
    archive,
    contentSha256: contentEntry.sha256,
    archiveSha256: await sha256Hex(archive)
  };
}
