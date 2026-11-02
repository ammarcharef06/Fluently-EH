import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { zipSync } from 'fflate';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function buildPublishedFixture() {
  const lesson = {
    id: 'pre-a1.browser.acceptance',
    type: 'lesson',
    title: 'Browser Acceptance Lesson',
    description: 'A synthetic lesson used only to verify the first-run browser flow.',
    stage: 'pre-a1',
    skills: ['vocabulary'],
    objectives: [{
      id: 'pre-a1.browser.acceptance.objective',
      description: 'Recognize one familiar word.'
    }],
    prerequisites: [],
    estimatedMinutes: 5,
    steps: [{
      id: 'pre-a1.browser.acceptance.step',
      type: 'explanation',
      heading: 'A familiar word',
      body: 'This is a synthetic browser acceptance fixture.'
    }],
    status: 'published',
    contentVersion: '1.0.0',
    source: {
      kind: 'original',
      note: 'Synthetic test fixture; not educational release content.',
      license: 'CC0-1.0'
    },
    review: {
      reviewerId: 'browser-test-reviewer',
      reviewedAt: '2026-11-02T10:00:00.000Z',
      approvalNote: 'Synthetic fixture approved for automated browser testing only.'
    }
  };
  const content = Buffer.from(JSON.stringify({
    packageId: 'fluently.core',
    contentVersion: '1.0.0',
    lessons: [lesson]
  }));
  const manifest = {
    packageId: 'fluently.core',
    contentVersion: '1.0.0',
    schemaVersion: 1,
    minAppVersion: '0.1.0',
    maxAppVersion: null,
    generatedAt: '2026-11-02T10:00:00.000Z',
    files: [{
      path: 'content.json',
      bytes: content.byteLength,
      sha256: sha256(content)
    }],
    rights: [{
      asset: lesson.id,
      license: 'CC0-1.0',
      attribution: 'Synthetic test fixture; not educational release content.'
    }]
  };
  const archive = zipSync({
    'manifest.json': Buffer.from(JSON.stringify(manifest)),
    'content.json': content
  }, { level: 6 });
  return { lesson, manifest, archive };
}

test('downloads a trusted curriculum ZIP and keeps the lesson available after going offline', async ({ page, context }) => {
  const fixture = buildPublishedFixture();

  await page.route('**/api/v1/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}'
  }));
  await page.route('**/api/v1/curriculum/manifest', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(fixture.manifest)
  }));
  await page.route('**/api/v1/curriculum/package.zip', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(fixture.archive.byteLength)
      },
      body: Buffer.from(fixture.archive)
    });
  });

  await page.goto('/');
  await expect(page.locator('.curriculum-download-progress')).toBeVisible();
  await expect(page.getByText(fixture.lesson.title, { exact: true })).toBeVisible({ timeout: 10_000 });

  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) await navigator.serviceWorker.ready;
  });

  await page.route('**/api/**', (route) => route.abort());
  await context.setOffline(true);
  await page.reload();

  await expect(page.getByText(fixture.lesson.title, { exact: true })).toBeVisible({ timeout: 10_000 });
});
