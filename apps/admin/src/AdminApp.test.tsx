import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminApp from './AdminApp';

describe('admin console localization', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('switches admin navigation, titles, and document direction between Arabic and English', async () => {
    render(<AdminApp />);

    expect(await screen.findByRole('heading', {
      name: 'مساحة إدارة المحتوى'
    })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'التنقل الإداري' })).toBeTruthy();

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('ar');
      expect(document.documentElement.dir).toBe('rtl');
    });

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(await screen.findByRole('heading', {
      name: 'Content administration workspace'
    })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Admin navigation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review and approval' })).toBeTruthy();

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('en');
      expect(document.documentElement.dir).toBe('ltr');
      expect(window.localStorage.getItem('adminInterfaceLocale')).toBe('en');
    });

    expect(screen.getByText('Authentication is disabled')).toBeTruthy();
  });

  it('restores a regional English locale when the admin console opens', async () => {
    window.localStorage.setItem('adminInterfaceLocale', 'en-GB');

    render(<AdminApp />);

    expect(await screen.findByRole('heading', {
      name: 'Content administration workspace'
    })).toBeTruthy();
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('en');
      expect(document.documentElement.dir).toBe('ltr');
    });
  });

  it('shows a localized unauthenticated status after the server rejects the session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.setItem('adminInterfaceLocale', 'en');

    render(<AdminApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Check session' }));

    expect(await screen.findByText('Not signed in')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/session', {
      credentials: 'include'
    });
  });
});
