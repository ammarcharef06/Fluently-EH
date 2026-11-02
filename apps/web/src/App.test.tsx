import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as storage from '@fluently/storage-web';
import App from './App';

vi.mock('@fluently/storage-web', () => ({
  enqueueOperation: vi.fn().mockResolvedValue(undefined),
  listLessonProgress: vi.fn().mockResolvedValue([]),
  listReviewStates: vi.fn().mockResolvedValue([]),
  readLessonProgress: vi.fn().mockResolvedValue(undefined),
  requestPersistentStorage: vi.fn().mockResolvedValue(true),
  saveLessonProgress: vi.fn().mockResolvedValue(undefined),
  saveReviewState: vi.fn().mockResolvedValue(undefined),
  clearLocalLearningData: vi.fn().mockResolvedValue(undefined),
  readSetting: vi.fn().mockResolvedValue(undefined),
  saveSetting: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@fluently/storage-web/curriculum', () => ({
  downloadAndActivateCurriculum: vi.fn().mockResolvedValue({ ok: false }),
  readActiveCurriculumPackage: vi.fn().mockResolvedValue(null)
}));

vi.mock('@fluently/storage-web/sync', () => ({
  syncPendingOperations: vi.fn().mockResolvedValue({ status: 'empty', acknowledged: 0 })
}));

describe('learner web localization', () => {
  beforeEach(() => {
    vi.mocked(storage.readSetting).mockResolvedValue(undefined);
    vi.mocked(storage.saveSetting).mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  });

  afterEach(() => {
    cleanup();
  });

  it('switches the shared interface translations and document direction', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', {
      name: 'ابدأ من الصفر، وتقدّم بثبات.'
    })).toBeTruthy();
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(await screen.findByRole('heading', {
      name: 'Start from zero. Progress with confidence.'
    })).toBeTruthy();
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('en');
      expect(document.documentElement.dir).toBe('ltr');
      expect(storage.saveSetting).toHaveBeenCalledWith('interfaceLocale', 'en');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Arabic' }));

    expect(await screen.findByRole('heading', {
      name: 'ابدأ من الصفر، وتقدّم بثبات.'
    })).toBeTruthy();
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('ar');
      expect(document.documentElement.dir).toBe('rtl');
      expect(storage.saveSetting).toHaveBeenCalledWith('interfaceLocale', 'ar');
    });
  });

  it('restores a stored regional English locale on startup', async () => {
    vi.mocked(storage.readSetting).mockResolvedValue('en-GB');

    render(<App />);

    expect(await screen.findByRole('heading', {
      name: 'Start from zero. Progress with confidence.'
    })).toBeTruthy();
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('en');
      expect(document.documentElement.dir).toBe('ltr');
    });
  });
});
