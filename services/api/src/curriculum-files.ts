import { isSafePackagePath } from '@fluently/content-schema';

/**
 * Decodes a path carried in the API URL without allowing encoded separators
 * or traversal to change the R2 object key after route matching.
 */
export function decodeCurriculumFilePath(encodedPath: string): string | null {
  if (!encodedPath) return null;

  const decodedSegments: string[] = [];
  for (const encodedSegment of encodedPath.split('/')) {
    if (!encodedSegment) return null;

    let segment: string;
    try {
      segment = decodeURIComponent(encodedSegment);
    } catch {
      return null;
    }

    if (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\') ||
    ) return null;

    decodedSegments.push(segment);
  }

  const path = decodedSegments.join('/');
  if (!isSafePackagePath(path) || path.toLowerCase() === 'manifest.json') return null;
  return path;
}
