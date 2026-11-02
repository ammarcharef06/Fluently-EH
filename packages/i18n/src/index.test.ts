import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getDirection,
  messages,
  resolveLocale,
  t,
  type TranslationKey
} from './index';

describe('locale metadata', () => {
  it('supports Arabic and English only', () => {
    expect(SUPPORTED_LOCALES).toEqual(['ar', 'en']);
    expect(DEFAULT_LOCALE).toBe('ar');
  });

  it('maps Arabic to RTL and English to LTR', () => {
    expect(getDirection('ar')).toBe('rtl');
    expect(getDirection('en')).toBe('ltr');
  });

  it('resolves regional language tags and normalizes separators', () => {
    expect(resolveLocale('ar-DZ')).toBe('ar');
    expect(resolveLocale('EN_us')).toBe('en');
    expect(resolveLocale(' en-GB ')).toBe('en');
  });

  it('uses the configured fallback for unsupported locales', () => {
    expect(resolveLocale('fr-FR')).toBe('ar');
    expect(resolveLocale('fr-FR', 'en')).toBe('en');
    expect(resolveLocale(null)).toBe('ar');
  });
});

describe('translation catalog', () => {
  it('contains the same typed keys for both supported locales', () => {
    const keys = Object.keys(messages.ar).sort();
    expect(Object.keys(messages.en).sort()).toEqual(keys);
    const typedKeys: TranslationKey[] = keys as TranslationKey[];
    expect(typedKeys).toContain('home');
  });

  it('returns Arabic and English messages', () => {
    expect(t('home', 'ar')).toBe('الرئيسية');
    expect(t('home', 'en')).toBe('Home');
  });

  it('uses Arabic when no locale is supplied', () => {
    expect(t('home')).toBe('الرئيسية');
  });

  it('interpolates string and numeric parameters', () => {
    expect(t('stepProgress', 'ar', { current: 2, total: 5 })).toBe('الخطوة 2 من 5');
    expect(t('stepProgress', 'en', { current: '2', total: 5 })).toBe('Step 2 of 5');
  });

  it('keeps missing interpolation placeholders visible', () => {
    expect(t('stepProgress', 'en', { current: 2 })).toBe('Step 2 of {total}');
  });

  it('interpolates learner review labels in both locales', () => {
    expect(t('dueReviewsAvailable', 'ar', { count: 2 })).toBe('لديك مراجعات مستحقة: 2.');
    expect(t('spacedReviewInterval', 'en', { days: 3 })).toBe('Spaced review · 3 days');
  });
});
