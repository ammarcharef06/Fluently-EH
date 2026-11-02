import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as storage from '@fluently/storage-web';
vi.mock('@fluently/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@fluently/domain')>();
  return {
    ...actual,
    createSyncOperation: vi.fn((input: Record<string, unknown>) => ({
      ...input,
      operationId: 'test-operation-id',
      schemaVersion: 1,
      status: 'pending'
    }))
  };
});

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

  it('grades the existing pronoun draft through the assessment engine and gates lesson progress', async () => {
    render(<App />);

    const lessonTitle = await screen.findByText('ضمائر الفاعل الأساسية');
    const lessonCard = lessonTitle.closest('article');
    expect(lessonCard).not.toBeNull();
    fireEvent.click(within(lessonCard as HTMLElement).getByRole('button', { name: 'التالي' }));

    for (const heading of [
      'ما ضمير الفاعل؟',
      'I = أنا',
      'You = أنتَ أو أنتِ أو أنتم',
      'He = هو / She = هي',
      'We = نحن / They = هم'
    ]) {
      if (heading === 'ما ضمير الفاعل؟') {
        expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
      } else {
        expect(await screen.findByText(heading)).toBeTruthy();
      }
      fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    }

    expect(await screen.findByRole('heading', { name: 'أي ضمير يعني «هي»؟' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'He' }));
    fireEvent.click(screen.getByRole('button', { name: 'تحقق من الإجابة' }));

    expect(await screen.findByText('هذه ليست الإجابة المطلوبة. She تعني هي عند الحديث عن مؤنث مفرد.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'التالي' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'She' }));
    fireEvent.click(screen.getByRole('button', { name: 'تحقق من الإجابة' }));

    expect(await screen.findByText('She تعني هي عند الحديث عن مؤنث مفرد.')).toBeTruthy();
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'التالي' }) as HTMLButtonElement).disabled).toBe(false);
      expect(storage.saveLessonProgress).toHaveBeenCalled();
      expect(storage.enqueueOperation).toHaveBeenCalled();
    });
  });
});
