import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const source = resolve('packages/curriculum/src/approved');
const output = resolve('artifacts/curriculum');
let lessonFiles = [];
try { lessonFiles = (await readdir(source)).filter((name) => name.endsWith('.json')); } catch { lessonFiles = []; }
if (lessonFiles.length === 0) {
  console.error('Refusing to create a publishable curriculum bundle: there are no human-approved lessons.');
  process.exit(2);
}
const lessons = [];
for (const file of lessonFiles) {
  const lesson = JSON.parse(await readFile(join(source, file), 'utf8'));
  if (lesson.status !== 'approved' || !lesson.review?.reviewerId || !lesson.review?.reviewedAt || !lesson.review?.approvalNote) {
    throw new Error('Lesson lacks a complete human approval record: ' + file);
  }
  lessons.push(lesson);
}
const payload = Buffer.from(JSON.stringify({ packageId: 'fluently.core', contentVersion: '1.0.0', lessons }, null, 2));
const digest = createHash('sha256').update(payload).digest('hex');
const manifest = {
  packageId: 'fluently.core', contentVersion: '1.0.0', schemaVersion: 1,
  minAppVersion: '0.1.0', maxAppVersion: null, generatedAt: new Date().toISOString(),
  files: [{ path: 'content.json', bytes: payload.byteLength, sha256: digest }],
  rights: lessons.map((lesson) => ({ asset: lesson.id, license: lesson.source.license, attribution: lesson.source.note }))
};
await mkdir(output, { recursive: true });
await writeFile(join(output, 'content.json'), payload);
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Created reviewed curriculum bundle with ' + lessons.length + ' lesson(s), sha256=' + digest);
