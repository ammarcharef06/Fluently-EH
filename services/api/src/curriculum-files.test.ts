import { describe, expect, it } from 'vitest';
import { decodeCurriculumFilePath } from './curriculum-files';

describe('curriculum file route paths', () => {
  it('decodes nested manifest paths', () => {
    expect(decodeCurriculumFilePath('lessons/unit%201/lesson.md')).toBe('lessons/unit 1/lesson.md');
  });

  it('rejects traversal, absolute paths, and empty segments', () => {
    expect(decodeCurriculumFilePath('../secret.txt')).toBeNull();
    expect(decodeCurriculumFilePath('%2e%2e/secret.txt')).toBeNull();
    expect(decodeCurriculumFilePath('/etc/passwd')).toBeNull();
    expect(decodeCurriculumFilePath('lessons//lesson.md')).toBeNull();
  });

  it('rejects encoded separators, backslashes, and control characters', () => {
    expect(decodeCurriculumFilePath('lessons%2fsecret.txt')).toBeNull();
    expect(decodeCurriculumFilePath('lessons%5csecret.txt')).toBeNull();
    expect(decodeCurriculumFilePath('lessons/%00secret.txt')).toBeNull();
  });

  it('rejects malformed encoding and the reserved root manifest', () => {
    expect(decodeCurriculumFilePath('lessons/%E0%A4%A')).toBeNull();
    expect(decodeCurriculumFilePath('manifest.json')).toBeNull();
    expect(decodeCurriculumFilePath('MANIFEST.JSON')).toBeNull();
  });
});
