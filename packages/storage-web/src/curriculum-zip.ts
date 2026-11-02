import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import {
  isSafePackagePath,
  MAX_FILE_COUNT,
  MAX_PACKAGE_BYTES,
  MAX_SINGLE_FILE_BYTES,
  validateCurriculumManifest,
  type CurriculumManifest
} from '@fluently/content-schema';
import { activateCurriculumPackage } from './curriculum';

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const UNICODE_PATH_EXTRA_FIELD = 0x7075;
const UTF8_FILENAME_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP64_UNSUPPORTED_SENTINEL_16 = 0xffff;
const ZIP64_UNSUPPORTED_SENTINEL_32 = 0xffffffff;
const MAX_ZIP_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_ARCHIVE_BYTES = MAX_PACKAGE_BYTES + MAX_ZIP_MANIFEST_BYTES;
const ZIP_INPUT_CHUNK_BYTES = 64 * 1024;
const ROOT_MANIFEST_PATH = 'manifest.json';
const ALLOWED_GENERAL_PURPOSE_FLAGS = UTF8_FILENAME_FLAG | DATA_DESCRIPTOR_FLAG | 0x0006;

type ZipFailureReason =
  | 'archive_too_large'
  | 'invalid_archive'
  | 'unsupported_archive'
  | 'invalid_manifest'
  | 'manifest_mismatch'
  | 'integrity_failed'
  | 'storage_failed';

type ZipImportResult =
  | { ok: true; manifest: CurriculumManifest }
  | { ok: false; reason: ZipFailureReason; errors: string[] };

type ZipEntry = {
  path: string;
  filenameBytes: Uint8Array;
  flags: number;
  compression: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dataStart: number;
  recordEnd: number;
};

class ZipImportFailure extends Error {
  constructor(
    readonly reason: ZipFailureReason,
    message: string
  ) {
    super(message);
    this.name = 'ZipImportFailure';
  }
}

function fail(reason: ZipFailureReason, message: string): never {
  throw new ZipImportFailure(reason, message);
}

function hasRange(view: DataView, offset: number, length: number): boolean {
  return Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset <= view.byteLength - length;
}

function u16(view: DataView, offset: number): number {
  if (!hasRange(view, offset, 2)) fail('invalid_archive', 'Truncated ZIP 16-bit field.');
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  if (!hasRange(view, offset, 4)) fail('invalid_archive', 'Truncated ZIP 32-bit field.');
  return view.getUint32(offset, true);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let i = 0; i < left.byteLength; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function decodeFilename(bytes: Uint8Array, flags: number): string {
  if (!(flags & UTF8_FILENAME_FLAG) && bytes.some((byte) => byte > 0x7f)) {
    fail('unsupported_archive', 'ZIP filenames without the UTF-8 flag must be ASCII.');
  }

  let name: string;
  try {
    name = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('invalid_archive', 'A ZIP filename is not valid UTF-8.');
  }
  if (name.normalize('NFC') !== name) {
    fail('unsupported_archive', 'ZIP filenames must use Unicode NFC normalization.');
  }
  return name;
}

function validateExtraFields(view: DataView, offset: number, length: number): void {
  if (!hasRange(view, offset, length)) fail('invalid_archive', 'Truncated ZIP extra field data.');
  const end = offset + length;
  let cursor = offset;

  while (cursor < end) {
    if (!hasRange(view, cursor, 4) || cursor + 4 > end) {
      fail('invalid_archive', 'Malformed ZIP extra field header.');
    }

    const identifier = u16(view, cursor);
    const fieldLength = u16(view, cursor + 2);
    cursor += 4;
    if (cursor + fieldLength > end) fail('invalid_archive', 'Malformed ZIP extra field length.');

    if (identifier === ZIP64_EXTRA_FIELD || identifier === UNICODE_PATH_EXTRA_FIELD) {
      fail('unsupported_archive', 'ZIP64 and alternate Unicode path fields are not supported.');
    }
    if (identifier !== 0x5455 && identifier !== 0x000a) {
      fail('unsupported_archive', 'The ZIP contains an unsupported extra field.');
    }

    cursor += fieldLength;
  }
}

function hasExecutableExtension(path: string): boolean {
  const filename = path.split('/').at(-1) ?? '';
  const extension = filename.includes('.') ? filename.split('.').at(-1)?.toLowerCase() : '';
  return new Set([
    'apk', 'app', 'bat', 'bin', 'class', 'cmd', 'com', 'cjs', 'deb',
    'desktop', 'dll', 'dmg', 'dylib', 'exe', 'hta', 'htm', 'html',
    'jar', 'js', 'lnk', 'mht', 'mhtml', 'mjs', 'msi', 'php', 'pl',
    'ps1', 'psd1', 'psm1', 'py', 'rb', 'reg', 'rpm', 'scr', 'sh',
    'so', 'svg', 'swf', 'url', 'vbe', 'vbs', 'wasm', 'webloc', 'wsf',
    'wsh', 'xht', 'xhtml', 'xsl', 'xslt'
  ]).has(extension ?? '');
}

function validateEntryAttributes(
  path: string,
  madeBy: number,
  externalAttributes: number
): void {
  if (path.endsWith('/')) fail('unsupported_archive', 'Directory entries are not allowed in curriculum ZIP files.');
  if (hasExecutableExtension(path)) fail('unsupported_archive', 'Executable or active-content file types are not allowed.');

  const creatorOperatingSystem = madeBy >>> 8;
  const unixMode = externalAttributes >>> 16;
  const dosAttributes = externalAttributes & 0xffff;
  if (dosAttributes & (0x08 | 0x10 | 0x0400)) {
    fail('unsupported_archive', 'Volume labels, directory entries, and reparse points are not allowed in curriculum ZIP files.');
  }

  if ((creatorOperatingSystem === 3 || creatorOperatingSystem === 19) && unixMode !== 0) {
    const fileType = unixMode & 0xf000;
    if (fileType !== 0 && fileType !== 0x8000) {
      fail('unsupported_archive', 'Unix symlinks and special files are not allowed in curriculum ZIP files.');
    }
    if (unixMode & 0o111) {
      fail('unsupported_archive', 'Executable file permissions are not allowed in curriculum ZIP files.');
    }
  }
}

function parseDataDescriptor(
  view: DataView,
  offset: number,
  limit: number,
  entry: Pick<ZipEntry, 'crc32' | 'compressedSize' | 'uncompressedSize'>
): number {
  const matches = (candidate: number): boolean =>
    hasRange(view, candidate, 12) &&
    u32(view, candidate) === entry.crc32 &&
    u32(view, candidate + 4) === entry.compressedSize &&
    u32(view, candidate + 8) === entry.uncompressedSize;

  if (
    offset + 16 <= limit &&
    hasRange(view, offset, 16) &&
    u32(view, offset) === ZIP_DATA_DESCRIPTOR_SIGNATURE &&
    matches(offset + 4)
  ) {
    return offset + 16;
  }

  if (offset + 12 <= limit && matches(offset)) return offset + 12;
  if (offset + 12 > limit) fail('invalid_archive', 'Truncated ZIP data descriptor.');
  fail('invalid_archive', 'ZIP data descriptor does not match the central directory.');
}

function parseZipEntries(archive: Uint8Array): ZipEntry[] {
  if (archive.byteLength > MAX_ZIP_ARCHIVE_BYTES) {
    fail('archive_too_large', 'The ZIP archive exceeds the configured size limit.');
  }
  if (archive.byteLength < 22) fail('invalid_archive', 'The ZIP archive is too small.');

  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const minEocdOffset = Math.max(0, archive.byteLength - 22 - 0xffff);
  let eocdOffset = -1;

  for (let offset = archive.byteLength - 22; offset >= minEocdOffset; offset -= 1) {
    if (!hasRange(view, offset, 22)) continue;
    if (u32(view, offset) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = u16(view, offset + 20);
    if (offset + 22 + commentLength === archive.byteLength) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) fail('invalid_archive', 'A complete ZIP end-of-central-directory record was not found.');

  const diskNumber = u16(view, eocdOffset + 4);
  const centralDisk = u16(view, eocdOffset + 6);
  const entriesOnDisk = u16(view, eocdOffset + 8);
  const entryCount = u16(view, eocdOffset + 10);
  const centralSize = u32(view, eocdOffset + 12);
  const centralOffset = u32(view, eocdOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === ZIP64_UNSUPPORTED_SENTINEL_16 ||
    centralSize === ZIP64_UNSUPPORTED_SENTINEL_32 ||
    centralOffset === ZIP64_UNSUPPORTED_SENTINEL_32
  ) {
    fail('unsupported_archive', 'Multi-disk ZIP and ZIP64 archives are not supported.');
  }
  if (entryCount === 0 || entryCount > MAX_FILE_COUNT + 1) {
    fail('invalid_archive', 'The ZIP entry count is empty or exceeds the configured limit.');
  }
  if (centralOffset + centralSize !== eocdOffset) {
    fail('invalid_archive', 'The ZIP central directory is not contiguous with the end record.');
  }

  const entries: ZipEntry[] = [];
  const seenPaths = new Set<string>();
  let cursor = centralOffset;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (!hasRange(view, cursor, 46) || u32(view, cursor) !== ZIP_CENTRAL_SIGNATURE) {
      fail('invalid_archive', 'Malformed ZIP central directory entry.');
    }

    const madeBy = u16(view, cursor + 4);
    const versionNeeded = u16(view, cursor + 6);
    const flags = u16(view, cursor + 8);
    const compression = u16(view, cursor + 10);
    const crc32 = u32(view, cursor + 16);
    const compressedSize = u32(view, cursor + 20);
    const uncompressedSize = u32(view, cursor + 24);
    const filenameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const diskStart = u16(view, cursor + 34);
    const externalAttributes = u32(view, cursor + 38);
    const localHeaderOffset = u32(view, cursor + 42);
    const recordLength = 46 + filenameLength + extraLength + commentLength;

    if (!hasRange(view, cursor, recordLength) || cursor + recordLength > eocdOffset) {
      fail('invalid_archive', 'A ZIP central directory entry is truncated.');
    }
    if (
      versionNeeded > 20 ||
      diskStart !== 0 ||
      compressedSize === ZIP64_UNSUPPORTED_SENTINEL_32 ||
      uncompressedSize === ZIP64_UNSUPPORTED_SENTINEL_32 ||
      localHeaderOffset === ZIP64_UNSUPPORTED_SENTINEL_32
    ) {
      fail('unsupported_archive', 'The ZIP entry requires unsupported ZIP features.');
    }
    if (flags & ~ALLOWED_GENERAL_PURPOSE_FLAGS) {
      fail('unsupported_archive', 'The ZIP entry uses unsupported flags or encryption.');
    }
    if (compression !== 0 && compression !== 8) {
      fail('unsupported_archive', 'Only stored and DEFLATE ZIP entries are supported.');
    }
    if (compression === 0 && (flags & 0x0006)) {
      fail('unsupported_archive', 'Deflate option flags are invalid for stored ZIP entries.');
    }

    const filenameStart = cursor + 46;
    const filenameBytes = archive.slice(filenameStart, filenameStart + filenameLength);
    const path = decodeFilename(filenameBytes, flags);
    if (!isSafePackagePath(path)) fail('invalid_archive', 'The ZIP contains an unsafe relative path.');
    if (path.toLowerCase() === ROOT_MANIFEST_PATH.toLowerCase() && path !== ROOT_MANIFEST_PATH) {
      fail('invalid_archive', 'The root manifest must use the exact name manifest.json.');
    }
    if (path.toLowerCase() !== ROOT_MANIFEST_PATH.toLowerCase() && hasExecutableExtension(path)) {
      fail('unsupported_archive', 'Executable file types are not allowed.');
    }

    const normalizedPath = path.normalize('NFC').toLowerCase();
    if (seenPaths.has(normalizedPath)) fail('invalid_archive', 'The ZIP contains duplicate or case-colliding paths.');
    seenPaths.add(normalizedPath);
    validateEntryAttributes(path, madeBy, externalAttributes);

    validateExtraFields(view, filenameStart + filenameLength, extraLength);
    cursor += recordLength;

    totalUncompressedBytes += uncompressedSize;
    if (path === ROOT_MANIFEST_PATH) {
      if (uncompressedSize > MAX_ZIP_MANIFEST_BYTES) {
        fail('invalid_archive', 'The ZIP manifest exceeds the configured size limit.');
      }
    } else if (uncompressedSize > MAX_SINGLE_FILE_BYTES) {
      fail('invalid_archive', 'A ZIP file exceeds the per-file size limit.');
    }

    if (totalUncompressedBytes > MAX_PACKAGE_BYTES + MAX_ZIP_MANIFEST_BYTES) {
      fail('archive_too_large', 'The ZIP uncompressed content exceeds the configured size limit.');
    }

    entries.push({
      path,
      filenameBytes,
      flags,
      compression,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataStart: 0,
      recordEnd: 0
    });
  }

  if (cursor !== centralOffset + centralSize) {
    fail('invalid_archive', 'The ZIP central directory contains undeclared trailing data.');
  }

  if (entries.filter((entry) => entry.path === ROOT_MANIFEST_PATH).length !== 1) {
    fail('invalid_archive', 'The ZIP must contain exactly one root manifest.json file.');
  }

  const sorted = [...entries].sort((left, right) => left.path.localeCompare(right.path));
  for (let index = 0; index < sorted.length - 1; index += 1) {
    if (sorted[index + 1]!.path.startsWith(sorted[index]!.path + '/')) {
      fail('invalid_archive', 'A ZIP file path conflicts with a nested file path.');
    }
  }

  for (const entry of entries) {
    const localOffset = entry.localHeaderOffset;
    if (localOffset >= centralOffset || !hasRange(view, localOffset, 30)) {
      fail('invalid_archive', 'A ZIP local file header has an invalid offset.');
    }
    if (u32(view, localOffset) !== ZIP_LOCAL_SIGNATURE) {
      fail('invalid_archive', 'A ZIP local file header signature is invalid.');
    }

    const localFlags = u16(view, localOffset + 6);
    const localCompression = u16(view, localOffset + 8);
    const localCrc32 = u32(view, localOffset + 14);
    const localCompressedSize = u32(view, localOffset + 18);
    const localUncompressedSize = u32(view, localOffset + 22);
    const localFilenameLength = u16(view, localOffset + 26);
    const localExtraLength = u16(view, localOffset + 28);
    const localNameStart = localOffset + 30;
    const localDataStart = localNameStart + localFilenameLength + localExtraLength;

    if (!hasRange(view, localOffset, 30 + localFilenameLength + localExtraLength) ||
        localDataStart > centralOffset) {
      fail('invalid_archive', 'A ZIP local file header is truncated.');
    }
    if (
      localFlags !== entry.flags ||
      localCompression !== entry.compression ||
      localFilenameLength !== entry.filenameBytes.byteLength ||
      !bytesEqual(archive.subarray(localNameStart, localNameStart + localFilenameLength), entry.filenameBytes)
    ) {
      fail('invalid_archive', 'ZIP local and central file headers do not match.');
    }

    validateExtraFields(view, localNameStart + localFilenameLength, localExtraLength);

    const hasDescriptor = Boolean(entry.flags & DATA_DESCRIPTOR_FLAG);
    if (!hasDescriptor) {
      if (
        localCrc32 !== entry.crc32 ||
        localCompressedSize !== entry.compressedSize ||
        localUncompressedSize !== entry.uncompressedSize
      ) {
        fail('invalid_archive', 'ZIP local file sizes or CRC do not match the central directory.');
      }
    } else if (
      (localCrc32 !== 0 && localCrc32 !== entry.crc32) ||
      (localCompressedSize !== 0 && localCompressedSize !== entry.compressedSize) ||
      (localUncompressedSize !== 0 && localUncompressedSize !== entry.uncompressedSize)
    ) {
      fail('invalid_archive', 'ZIP data-descriptor local fields conflict with the central directory.');
    }

    const compressedEnd = localDataStart + entry.compressedSize;
    if (!Number.isSafeInteger(compressedEnd) || compressedEnd > centralOffset) {
      fail('invalid_archive', 'A ZIP compressed data region is out of bounds.');
    }

    const recordEnd = hasDescriptor
      ? parseDataDescriptor(view, compressedEnd, centralOffset, entry)
      : compressedEnd;

    entry.dataStart = localDataStart;
    entry.recordEnd = recordEnd;
  }

  const localRecords = [...entries].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  if (localRecords[0]?.localHeaderOffset !== 0) {
    fail('unsupported_archive', 'Self-extracting ZIP prefixes are not supported.');
  }

  let expectedLocalOffset = 0;
  for (const entry of localRecords) {
    if (entry.localHeaderOffset !== expectedLocalOffset) {
      fail('invalid_archive', 'ZIP local records contain overlapping or unparsed gaps.');
    }
    expectedLocalOffset = entry.recordEnd;
  }
  if (expectedLocalOffset !== centralOffset) {
    fail('invalid_archive', 'Unparsed bytes are present between ZIP local records and the central directory.');
  }

  return entries;
}

function sameManifest(left: CurriculumManifest, right: CurriculumManifest): boolean {
  if (
    left.packageId !== right.packageId ||
    left.contentVersion !== right.contentVersion ||
    left.schemaVersion !== right.schemaVersion ||
    left.minAppVersion !== right.minAppVersion ||
    left.maxAppVersion !== right.maxAppVersion ||
    left.generatedAt !== right.generatedAt ||
    left.files.length !== right.files.length ||
    left.rights.length !== right.rights.length
  ) return false;

  for (let index = 0; index < left.files.length; index += 1) {
    const leftFile = left.files[index]!;
    const rightFile = right.files[index]!;
    if (
      leftFile.path !== rightFile.path ||
      leftFile.bytes !== rightFile.bytes ||
      leftFile.sha256 !== rightFile.sha256
    ) return false;
  }

  for (let index = 0; index < left.rights.length; index += 1) {
    const leftRight = left.rights[index]!;
    const rightRight = right.rights[index]!;
    if (
      leftRight.asset !== rightRight.asset ||
      leftRight.license !== rightRight.license ||
      (leftRight.attribution ?? null) !== (rightRight.attribution ?? null)
    ) return false;
  }

  return true;
}

function inflateZipEntries(archive: Uint8Array, entries: readonly ZipEntry[]): Map<string, Uint8Array> {
  const expectedEntries = new Map(entries.map((entry) => [entry.path, entry]));
  const seenEntries = new Set<string>();
  const extracted = new Map<string, Uint8Array>();
  let failure: ZipImportFailure | undefined;

  const unzip = new Unzip((file) => {
    if (failure) return;

    const entry = expectedEntries.get(file.name);
    if (!entry || seenEntries.has(file.name)) {
      failure = new ZipImportFailure('invalid_archive', 'The ZIP decompressor emitted an undeclared or duplicate file.');
      file.terminate?.();
      return;
    }
    seenEntries.add(file.name);

    if (
      file.compression !== entry.compression ||
      (file.size !== undefined && file.size !== entry.compressedSize) ||
      (file.originalSize !== undefined && file.originalSize !== entry.uncompressedSize)
    ) {
      failure = new ZipImportFailure('invalid_archive', 'The decompressor metadata does not match the ZIP directory.');
      file.terminate?.();
      return;
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    file.ondata = (error, chunk, final) => {
      if (failure) return;
      if (error) {
        failure = new ZipImportFailure('invalid_archive', 'A ZIP entry could not be decompressed.');
        return;
      }

      totalBytes += chunk.byteLength;
      if (
        totalBytes > entry.uncompressedSize ||
        totalBytes > MAX_SINGLE_FILE_BYTES + (entry.path === ROOT_MANIFEST_PATH ? MAX_ZIP_MANIFEST_BYTES : 0)
      ) {
        failure = new ZipImportFailure('archive_too_large', 'A ZIP entry expanded beyond its declared size.');
        file.terminate?.();
        return;
      }

      chunks.push(chunk.slice());
      if (!final) return;

      if (totalBytes !== entry.uncompressedSize) {
        failure = new ZipImportFailure('invalid_archive', 'A ZIP entry expanded to an unexpected size.');
        return;
      }

      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const part of chunks) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      extracted.set(file.name, bytes);
    };

    try {
      file.start();
    } catch {
      failure = new ZipImportFailure('unsupported_archive', 'A ZIP entry uses an unavailable decompression method.');
      file.terminate?.();
    }
  });

  unzip.register(UnzipPassThrough);
  unzip.register(UnzipInflate);
  try {
    for (let offset = 0; offset < archive.byteLength; offset += ZIP_INPUT_CHUNK_BYTES) {
      const end = Math.min(offset + ZIP_INPUT_CHUNK_BYTES, archive.byteLength);
      unzip.push(archive.subarray(offset, end), end === archive.byteLength);
      if (failure) break;
    }
  } catch {
    fail('invalid_archive', 'The ZIP stream is malformed or truncated.');
  }

  if (failure) throw failure;
  if (seenEntries.size !== entries.length || extracted.size !== entries.length) {
    fail('invalid_archive', 'The ZIP stream does not contain every declared archive entry.');
  }
  return extracted;
}

function manifestBytesToObject(bytes: Uint8Array): unknown {
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(json) as unknown;
  } catch {
    fail('invalid_manifest', 'The ZIP root manifest is not valid UTF-8 JSON.');
  }
}

export async function importCurriculumZip(
  archive: Uint8Array,
  trustedManifestInput: unknown
): Promise<ZipImportResult> {
  try {
    const expectedValidation = validateCurriculumManifest(trustedManifestInput);
    if (!expectedValidation.ok) {
      return { ok: false, reason: 'invalid_manifest', errors: expectedValidation.errors };
    }
    const expectedManifest = expectedValidation.manifest;

    const entries = parseZipEntries(archive);
    if (entries.length !== expectedManifest.files.length + 1) {
      fail('invalid_archive', 'The ZIP must contain manifest.json and exactly the files declared by the trusted manifest.');
    }

    const expectedFiles = new Map(expectedManifest.files.map((file) => [file.path, file]));
    for (const entry of entries) {
      if (entry.path === ROOT_MANIFEST_PATH) continue;
      const expected = expectedFiles.get(entry.path);
      if (!expected) fail('invalid_archive', 'The ZIP contains a file not declared by the trusted manifest.');
      if (entry.uncompressedSize !== expected.bytes) {
        fail('invalid_archive', 'A ZIP entry size does not match the trusted manifest.');
      }
    }

    const extracted = inflateZipEntries(archive, entries);
    const embeddedManifestBytes = extracted.get(ROOT_MANIFEST_PATH);
    if (!embeddedManifestBytes) fail('invalid_manifest', 'The ZIP root manifest is missing.');

    const embeddedValidation = validateCurriculumManifest(manifestBytesToObject(embeddedManifestBytes));
    if (!embeddedValidation.ok) {
      return { ok: false, reason: 'invalid_manifest', errors: embeddedValidation.errors };
    }
    if (!sameManifest(embeddedValidation.manifest, expectedManifest)) {
      fail('manifest_mismatch', 'The ZIP manifest does not match the trusted manifest.');
    }

    const files = new Map(extracted);
    files.delete(ROOT_MANIFEST_PATH);
    let activation: Awaited<ReturnType<typeof activateCurriculumPackage>>;
    try {
      activation = await activateCurriculumPackage(expectedManifest, files);
    } catch {
      fail('storage_failed', 'The verified ZIP could not be committed to local storage.');
    }
    if (!activation.ok) {
      return { ok: false, reason: 'integrity_failed', errors: activation.errors };
    }

    return { ok: true, manifest: activation.manifest };
  } catch (error) {
    if (error instanceof ZipImportFailure) {
      return { ok: false, reason: error.reason, errors: [error.message] };
    }
    return {
      ok: false,
      reason: 'invalid_archive',
      errors: ['The ZIP archive could not be parsed safely.']
    };
  }
}
