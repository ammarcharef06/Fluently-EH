import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { readActiveCurriculumPackage } from './curriculum';
import { importCurriculumZip } from './curriculum-zip';

type PackageFiles = Record<string, Uint8Array>;

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function createManifest(packageId: string, files: PackageFiles) {
  const entries = await Promise.all(
    Object.entries(files).map(async ([path, bytes]) => ({
      path,
      bytes: bytes.byteLength,
      sha256: await sha256(bytes)
    }))
  );

  return {
    packageId,
    contentVersion: '1.0.0',
    schemaVersion: 1,
    minAppVersion: '0.1.0',
    maxAppVersion: null,
    generatedAt: '2026-11-01T00:00:00.000Z',
    files: entries,
    rights: []
  };
}

function createZip(embeddedManifest: unknown, files: PackageFiles): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(embeddedManifest))
  };
  for (const [path, bytes] of Object.entries(files)) entries[path] = bytes;
  return zipSync(entries, { level: 6 });
}

function directoryEntryOffsets(archive: Uint8Array): Array<{
  name: string;
  localHeaderOffset: number;
  centralHeaderOffset: number;
}> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let eocdOffset = -1;
  for (let offset = archive.byteLength - 22; offset >= Math.max(0, archive.byteLength - 22 - 0xffff); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50 &&
        offset + 22 + view.getUint16(offset + 20, true) === archive.byteLength) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('test ZIP has no EOCD');
  const count = view.getUint16(eocdOffset + 10, true);
  let cursor = view.getUint32(eocdOffset + 16, true);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('test ZIP central directory is malformed');
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const name = new TextDecoder().decode(archive.subarray(cursor + 46, cursor + 46 + nameLength));
    entries.push({
      name,
      localHeaderOffset: view.getUint32(cursor + 42, true),
      centralHeaderOffset: cursor
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function mutateArchive(archive: Uint8Array, mutate: (copy: Uint8Array, view: DataView) => void): Uint8Array {
  const copy = archive.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  mutate(copy, view);
  return copy;
}

function setEntryEncrypted(archive: Uint8Array, name: string): Uint8Array {
  return mutateArchive(archive, (_copy, view) => {
    const entry = directoryEntryOffsets(archive).find((candidate) => candidate.name === name);
    if (!entry) throw new Error('test ZIP entry not found: ' + name);
    view.setUint16(entry.localHeaderOffset + 6, view.getUint16(entry.localHeaderOffset + 6, true) | 1, true);
    view.setUint16(entry.centralHeaderOffset + 8, view.getUint16(entry.centralHeaderOffset + 8, true) | 1, true);
  });
}

function setEntryUnixSymlink(archive: Uint8Array, name: string): Uint8Array {
  return mutateArchive(archive, (_copy, view) => {
    const entry = directoryEntryOffsets(archive).find((candidate) => candidate.name === name);
    if (!entry) throw new Error('test ZIP entry not found: ' + name);
    view.setUint16(entry.centralHeaderOffset + 4, (3 << 8) | 20, true);
    view.setUint32(entry.centralHeaderOffset + 38, ((0xa000 | 0o777) << 16) >>> 0, true);
  });
}

function setEntryDosReparsePoint(archive: Uint8Array, name: string): Uint8Array {
  return mutateArchive(archive, (_copy, view) => {
    const entry = directoryEntryOffsets(archive).find((candidate) => candidate.name === name);
    if (!entry) throw new Error('test ZIP entry not found: ' + name);
    view.setUint32(
      entry.centralHeaderOffset + 38,
      view.getUint32(entry.centralHeaderOffset + 38, true) | 0x0400,
      true
    );
  });
}

function insertGapBeforeCentralDirectory(archive: Uint8Array): Uint8Array {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let eocdOffset = -1;
  for (let offset = archive.byteLength - 22; offset >= Math.max(0, archive.byteLength - 22 - 0xffff); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50 &&
        offset + 22 + view.getUint16(offset + 20, true) === archive.byteLength) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('test ZIP has no EOCD');
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  const copy = new Uint8Array(archive.byteLength + 1);
  copy.set(archive.subarray(0, centralOffset), 0);
  copy[centralOffset] = 0x7f;
  copy.set(archive.subarray(centralOffset), centralOffset + 1);
  const nextView = new DataView(copy.buffer);
  nextView.setUint32(eocdOffset + 1 + 16, centralOffset + 1, true);
  return copy;
}

function setLocalFilenameMismatch(archive: Uint8Array, name: string): Uint8Array {
  return mutateArchive(archive, (copy, view) => {
    const entry = directoryEntryOffsets(archive).find((candidate) => candidate.name === name);
    if (!entry) throw new Error('test ZIP entry not found: ' + name);
    const filenameLength = view.getUint16(entry.localHeaderOffset + 26, true);
    if (filenameLength === 0) throw new Error('test ZIP filename is empty');
    copy[entry.localHeaderOffset + 30] = copy[entry.localHeaderOffset + 30]! ^ 1;
  });
}

function setZip64Sentinel(archive: Uint8Array): Uint8Array {
  return mutateArchive(archive, (_copy, view) => {
    let eocdOffset = -1;
    for (let offset = archive.byteLength - 22; offset >= Math.max(0, archive.byteLength - 22 - 0xffff); offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50 &&
          offset + 22 + view.getUint16(offset + 20, true) === archive.byteLength) {
        eocdOffset = offset;
        break;
      }
    }
    if (eocdOffset < 0) throw new Error('test ZIP has no EOCD');
    view.setUint16(eocdOffset + 8, 0xffff, true);
    view.setUint16(eocdOffset + 10, 0xffff, true);
  });
}

describe('curriculum ZIP import', () => {
  it('imports a multi-file ZIP only when its embedded manifest matches the trusted manifest', async () => {
    const packageId = 'fluently.test.zip.' + crypto.randomUUID();
    const files: PackageFiles = {
      'content.json': strToU8('{"lessons":[]}'),
      'lessons/unit-1/lesson.md': strToU8('# A reviewed lesson'),
      'media/example.txt': strToU8('Example asset with documented rights')
    };
    const manifest = await createManifest(packageId, files);
    const archive = createZip(manifest, files);

    const result = await importCurriculumZip(archive, manifest);

    expect(result).toEqual({ ok: true, manifest });
    const stored = await readActiveCurriculumPackage(packageId);
    expect(stored?.package.contentVersion).toBe('1.0.0');
    expect(new TextDecoder().decode(stored?.files.get('content.json'))).toBe('{"lessons":[]}');
    expect(new TextDecoder().decode(stored?.files.get('lessons/unit-1/lesson.md'))).toBe('# A reviewed lesson');
    expect(new TextDecoder().decode(stored?.files.get('media/example.txt'))).toBe('Example asset with documented rights');
    expect(stored?.files.has('manifest.json')).toBe(false);
  });

  it('rejects an embedded manifest that differs from the trusted manifest without activation', async () => {
    const packageId = 'fluently.test.zip.manifest.' + crypto.randomUUID();
    const files: PackageFiles = { 'content.json': strToU8('{"lessons":[]}') };
    const trusted = await createManifest(packageId, files);
    const changed = { ...trusted, contentVersion: '2.0.0' };
    const archive = createZip(changed, files);

    const result = await importCurriculumZip(archive, trusted);

    expect(result).toMatchObject({ ok: false, reason: 'manifest_mismatch' });
    expect(await readActiveCurriculumPackage(packageId)).toBeNull();
  });

  it('rejects changed file bytes when the embedded and trusted manifests retain the original hash', async () => {
    const packageId = 'fluently.test.zip.hash.' + crypto.randomUUID();
    const originalFiles: PackageFiles = { 'content.json': strToU8('{"lessons":[]}') };
    const manifest = await createManifest(packageId, originalFiles);
    const changedFiles: PackageFiles = { 'content.json': strToU8('{"lessons":[1]}') };
    const archive = createZip(manifest, changedFiles);

    const result = await importCurriculumZip(archive, manifest);

    expect(result).toMatchObject({ ok: false, reason: 'integrity_failed' });
    expect(await readActiveCurriculumPackage(packageId)).toBeNull();
  });

  it('rejects extra undeclared files and path-prefix conflicts', async () => {
    const packageId = 'fluently.test.zip.extra.' + crypto.randomUUID();
    const files: PackageFiles = { 'content.json': strToU8('{"lessons":[]}') };
    const manifest = await createManifest(packageId, files);
    const extraArchive = createZip(manifest, {
      ...files,
      'unexpected.txt': strToU8('not declared')
    });

    expect(await importCurriculumZip(extraArchive, manifest)).toMatchObject({
      ok: false,
      reason: 'invalid_archive'
    });

    const conflictingFiles: PackageFiles = {
      'content.json': strToU8('{"lessons":[]}'),
      'lessons': strToU8('file path'),
      'lessons/one.md': strToU8('nested path')
    };
    const conflictingManifest = await createManifest(
      'fluently.test.zip.conflict.' + crypto.randomUUID(),
      conflictingFiles
    );
    const conflictingArchive = createZip(conflictingManifest, conflictingFiles);
    expect(await importCurriculumZip(conflictingArchive, conflictingManifest)).toMatchObject({
      ok: false,
      reason: 'invalid_archive'
    });
  });

  it('rejects traversal paths and executable file types', async () => {
    const packageId = 'fluently.test.zip.path.' + crypto.randomUUID();
    const files: PackageFiles = { 'content.json': strToU8('{"lessons":[]}') };
    const manifest = await createManifest(packageId, files);
    const traversalArchive = createZip(manifest, {
      ...files,
      '../escape.txt': strToU8('outside')
    });
    expect(await importCurriculumZip(traversalArchive, manifest)).toMatchObject({
      ok: false,
      reason: 'invalid_archive'
    });

    const executableFiles: PackageFiles = {
      'content.json': strToU8('{"lessons":[]}'),
      'launch.exe': strToU8('MZ')
    };
    const executableManifest = await createManifest(
      'fluently.test.zip.exe.' + crypto.randomUUID(),
      executableFiles
    );
    const executableArchive = createZip(executableManifest, executableFiles);
    expect(await importCurriculumZip(executableArchive, executableManifest)).toMatchObject({
      ok: false,
      reason: 'unsupported_archive'
    });
  });

  it('rejects encrypted, Unix symlink, Windows reparse, active-content, and mismatched header entries', async () => {
    const packageId = 'fluently.test.zip.headers.' + crypto.randomUUID();
    const files: PackageFiles = {
      'content.json': strToU8('{"lessons":[]}'),
      'lesson.md': strToU8('# Lesson')
    };
    const manifest = await createManifest(packageId, files);
    const original = createZip(manifest, files);

    expect(await importCurriculumZip(setEntryEncrypted(original, 'lesson.md'), manifest)).toMatchObject({
      ok: false,
      reason: 'unsupported_archive'
    });
    expect(await importCurriculumZip(setEntryUnixSymlink(original, 'lesson.md'), manifest)).toMatchObject({
      ok: false,
      reason: 'unsupported_archive'
    });
    expect(await importCurriculumZip(setEntryDosReparsePoint(original, 'lesson.md'), manifest)).toMatchObject({
      ok: false,
      reason: 'unsupported_archive'
    });
    expect(await importCurriculumZip(setLocalFilenameMismatch(original, 'lesson.md'), manifest)).toMatchObject({
      ok: false,
      reason: 'invalid_archive'
    });

    const activeFiles: PackageFiles = {
      'content.json': strToU8('{"lessons":[]}'),
      'media/icon.svg': strToU8('<svg/>')
    };
    const activeManifest = await createManifest(
      'fluently.test.zip.svg.' + crypto.randomUUID(),
      activeFiles
    );
    expect(await importCurriculumZip(createZip(activeManifest, activeFiles), activeManifest)).toMatchObject({
      ok: false,
      reason: 'unsupported_archive'
    });
  });

  it('rejects ZIP64 sentinels and truncated archives', async () => {
    const packageId = 'fluently.test.zip.features.' + crypto.randomUUID();
    const files: PackageFiles = { 'content.json': strToU8('{"lessons":[]}') };
    const manifest = await createManifest(packageId, files);
    const archive = createZip(manifest, files);

    expect(await importCurriculumZip(setZip64Sentinel(archive), manifest)).toMatchObject({
      ok: false,
      reason: 'unsupported_archive'
    });
    expect(await importCurriculumZip(insertGapBeforeCentralDirectory(archive), manifest)).toMatchObject({
      ok: false,
      reason: 'invalid_archive'
    });
    expect(await importCurriculumZip(archive.slice(0, -8), manifest)).toMatchObject({
      ok: false,
      reason: 'invalid_archive'
    });
  });

  it('keeps the active package when a candidate ZIP fails before activation', async () => {
    const packageId = 'fluently.test.zip.rollback.' + crypto.randomUUID();
    const activeFiles: PackageFiles = { 'content.json': strToU8('active-v1') };
    const activeManifest = await createManifest(packageId, activeFiles);
    const activeArchive = createZip(activeManifest, activeFiles);
    expect((await importCurriculumZip(activeArchive, activeManifest)).ok).toBe(true);

    const changedFiles: PackageFiles = { 'content.json': strToU8('candidate-v2') };
    const candidateManifest = await createManifest(packageId, changedFiles);
    const untrustedCandidate = {
      ...candidateManifest,
      files: candidateManifest.files.map((file) => ({ ...file, sha256: '0'.repeat(64) }))
    };
    const candidateArchive = createZip(untrustedCandidate, changedFiles);
    const failed = await importCurriculumZip(candidateArchive, candidateManifest);

    expect(failed).toMatchObject({ ok: false, reason: 'integrity_failed' });
    const stored = await readActiveCurriculumPackage(packageId);
    expect(stored?.package.contentVersion).toBe('1.0.0');
    expect(new TextDecoder().decode(stored?.files.get('content.json'))).toBe('active-v1');
  });

  it('rejects malformed ZIP bytes and an invalid trusted manifest', async () => {
    expect(await importCurriculumZip(new Uint8Array([1, 2, 3]), {})).toMatchObject({
      ok: false,
      reason: 'invalid_manifest'
    });

    const result = await importCurriculumZip(new Uint8Array([1, 2, 3]), {
      packageId: 'bad',
      contentVersion: '1.0.0',
      schemaVersion: 1,
      minAppVersion: '0.1.0',
      maxAppVersion: null,
      generatedAt: '2026-11-01T00:00:00.000Z',
      files: [{ path: 'content.json', bytes: 1, sha256: '0'.repeat(64) }],
      rights: []
    });
    expect(result).toMatchObject({ ok: false, reason: 'invalid_archive' });
  });
});
