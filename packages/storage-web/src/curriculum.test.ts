import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { activateCurriculumPackage, readActiveCurriculumPackage } from './curriculum';

describe('atomic curriculum activation', () => {
  it('does not replace the active package when the downloaded bytes fail the manifest hash', async () => {
    const original = new TextEncoder().encode('first reviewed package');
    const digest = await crypto.subtle.digest('SHA-256', original);
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const manifest = {
      packageId: 'fluently.test.' + crypto.randomUUID(),
      contentVersion: '1.0.0', schemaVersion: 1,
      minAppVersion: '0.1.0', maxAppVersion: null,
      generatedAt: new Date('2026-11-01T00:00:00.000Z').toISOString(),
      files: [{ path: 'content.json', bytes: original.byteLength, sha256 }],
      rights: [{ asset: 'test.lesson', license: 'CC BY-NC-SA 4.0', attribution: 'Original draft for testing' }]
    };
    const first = await activateCurriculumPackage(manifest, new Map([['content.json', original]]));
    expect(first.ok).toBe(true);

    const altered = new TextEncoder().encode('altered package');
    const failed = await activateCurriculumPackage(manifest, new Map([['content.json', altered]]));
    expect(failed.ok).toBe(false);

    const stored = await readActiveCurriculumPackage(manifest.packageId);
    expect(new TextDecoder().decode(stored?.files.get('content.json'))).toBe('first reviewed package');
  });
});
