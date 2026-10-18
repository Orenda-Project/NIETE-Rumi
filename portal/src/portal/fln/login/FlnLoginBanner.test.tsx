import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FlnLoginBanner from './FlnLoginBanner';
import { stubFetch, callsTo } from '../share/testFetch';

/**
 * bd-t7zk3t.12 — the sign-in page's banner for a shared plan link (DESIGN v2 §4 L4): bilingual by construction — the
 * plan title in ITS language (from /api/portal/fln/title/:id, hidden on error) + "Sign in to open" + «کھولنے کے لیے
 * سائن اِن کریں», both always shown, whatever the page language. Nothing at all for any other `next=`.
 */
function mount(search: string) {
  return render(<MemoryRouter initialEntries={[`/portal/login${search}`]}><FlnLoginBanner /></MemoryRouter>);
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('FlnLoginBanner', () => {
  it('next=/portal/fln/p/<id>: the title in its own language and direction, then both sign-in lines', async () => {
    const f = stubFetch({ '/api/portal/fln/title/11133': { status: 200, body: { title: 'حروف کی آوازیں', lang: 'ur', dir: 'rtl' } } });
    mount(`?next=${encodeURIComponent('/portal/fln/p/11133?src=wa')}`);
    const t = await screen.findByText('حروف کی آوازیں');
    expect(t.getAttribute('lang')).toBe('ur');
    expect(t.getAttribute('dir')).toBe('rtl');
    const en = screen.getByText('Sign in to open');
    expect([en.getAttribute('lang'), en.getAttribute('dir')]).toEqual(['en', 'ltr']);
    const ur = screen.getByText('کھولنے کے لیے سائن اِن کریں');
    expect([ur.getAttribute('lang'), ur.getAttribute('dir')]).toEqual(['ur', 'rtl']);
    expect(callsTo(f, '/fln/title/11133')[0][1]).toMatchObject({ cache: 'no-store' });
    expect(screen.getByTestId('fln-login-banner').closest('.fln-root')).not.toBeNull();
  });

  it.each([404, 503])('title %i → no title, both lines still shown', async (status) => {
    stubFetch({ '/api/portal/fln/title/': { status, body: { error: 'x' } } });
    mount('?next=/portal/fln/p/777');
    expect(await screen.findByText('Sign in to open')).toBeTruthy();
    expect(screen.getByText('کھولنے کے لیے سائن اِن کریں')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('fln-login-banner-title')).toBeNull());
  });

  it.each(['', '?next=/portal/dashboard', '?next=//evil.example/portal/fln/p/1', '?next=/portal/fln/list/rh-en', '?next=/portal/fln/p/abc'])(
    '%j → renders nothing and asks nothing',
    async (search) => {
      const f = stubFetch({});
      const { container } = mount(search);
      await new Promise((r) => setTimeout(r, 0));
      expect(container.innerHTML).toBe('');
      expect(f).not.toHaveBeenCalled();
    },
  );
});
