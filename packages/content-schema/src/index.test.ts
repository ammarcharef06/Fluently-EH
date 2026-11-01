import { describe, expect, it } from 'vitest';
import { isSafePackagePath, verifyPackageFiles } from './index';
describe('package paths', () => {
  it('blocks traversal', () => {
    expect(isSafePackagePath('../secret')).toBe(false);
    expect(isSafePackagePath('/etc/passwd')).toBe(false);
    expect(isSafePackagePath('lesson/content.json')).toBe(true);
  });
});
describe('package integrity', () => {
  it('rejects altered content against original manifest hash', async () => {
    const good = new TextEncoder().encode('fluently content');
    const digest = await crypto.subtle.digest('SHA-256', good);
    const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const manifest = { packageId: 'fluently.literacy', contentVersion: '0.1.0', schemaVersion: 1, minAppVersion: '0.1.0', maxAppVersion: null, generatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(), files: [{ path: 'content.json', bytes: good.byteLength, sha256 }], rights: [] };
    const altered = new TextEncoder().encode('Fluently content');
    const result = await verifyPackageFiles(manifest, new Map([['content.json', altered]]));
    expect(result.ok).toBe(false);
  });
});
