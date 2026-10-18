import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import SendPage from './SendPage';
import { stubFetch, callsTo, ME_LEADER, ME_LEADER_UR, ME_TEACHER } from '../share/testFetch';

/**
 * bd-t7zk3t.12 — the "Send a lesson plan" builder at /portal/fln/send (DESIGN v2 §4 L3): grade → subject → level
 * (pre-selected for 1–5, NONE for 6–12 with the screener on top) → search + filters → rows with Send to teacher and
 * Share link. State lives in the URL so Back works. 404 → "not available"; no rows → the §7 empty line.
 */
const ROW = (id: number, extra: Record<string, unknown> = {}) => ({
  id, title: `Plan ${id}`, lang: 'en', dir: 'ltr', minutes: 30, chips: {}, opened: false,
  url: `https://portal.example.test/portal/fln/p/${id}`, level: 1, grades: [1], chapter_title_en: 'Unit 1', chapter_title_ur: null,
  pos: 1, count: 3, ...extra,
});

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/fln/send" element={<><SendPage /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SendPage — access', () => {
  it('share:false → the "not available" page, and /links is never asked', async () => {
    const f = stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_TEACHER } });
    mount('/portal/fln/send?grade=1&subject=rh-en');
    expect(await screen.findByText("Sending lesson plans isn't available")).toBeTruthy();
    expect(callsTo(f, '/fln/links')).toHaveLength(0);
  });
  it('/links 404 → the "not available" page', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER }, '/api/portal/fln/links': { status: 404, body: { error: 'not_found' } } });
    mount('/portal/fln/send?grade=1&subject=rh-en');
    expect(await screen.findByText("Sending lesson plans isn't available")).toBeTruthy();
  });
  it('/links 503 → the calm line with Try again', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER }, '/api/portal/fln/links': { status: 503, body: { error: 'fln_unavailable' } } });
    mount('/portal/fln/send?grade=1&subject=rh-en');
    expect(await screen.findByText("Reading Hour plans aren't available right now")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('SendPage — the builder', () => {
  it('title, 12 grade chips, every chip ≥48 px', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER } });
    mount('/portal/fln/send');
    expect(await screen.findByRole('heading', { name: 'Send a lesson plan' })).toBeTruthy();
    const grades = within(screen.getByRole('group', { name: 'Grade' })).getAllByRole('button');
    expect(grades.map((b) => b.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    for (const b of grades) expect(b.className).toContain('min-h-[48px]');
  });

  it('grade 2 pre-selects level 2 and asks /links with it (no-store, sort=used)', async () => {
    const f = stubFetch({
      '/api/portal/fln/me': { status: 200, body: ME_LEADER },
      '/api/portal/fln/links': { status: 200, body: { rows: [ROW(201, { level: 2 })] } },
    });
    mount('/portal/fln/send');
    fireEvent.click(within(await screen.findByRole('group', { name: 'Grade' })).getByRole('button', { name: '2' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Subject' })).getByRole('button', { name: 'Reading Hour · English' }));
    const level2 = within(screen.getByRole('group', { name: 'Level' })).getByRole('button', { name: 'Level 2' });
    expect(level2.getAttribute('aria-pressed')).toBe('true');
    await screen.findByText('Plan 201');
    const [url, init] = callsTo(f, '/fln/links').at(-1)!;
    const q = new URL(String(url), 'https://x').searchParams;
    expect([q.get('grade'), q.get('subject'), q.get('level'), q.get('sort')]).toEqual(['2', 'rh-en', '2', 'used']);
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
    expect(screen.getByTestId('where').textContent).toBe('/portal/fln/send?grade=2&subject=rh-en&level=2');
  });

  it('grade 8: NO level pre-selected, /links without level, the screener row on top', async () => {
    const f = stubFetch({
      '/api/portal/fln/me': { status: 200, body: ME_LEADER },
      '/api/portal/fln/links': { status: 200, body: { rows: [ROW(900, { chips: { screener: true, sounds: 4 } }), ROW(101, { pos: 2 })] } },
    });
    mount('/portal/fln/send?grade=8&subject=rh-en');
    await screen.findByText('Plan 900');
    const levels = within(screen.getByRole('group', { name: 'Level' })).getAllByRole('button');
    expect(levels.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
    // qa-render (c/d/e): a chip is a flex box, so its label must be ONE inline box, or the space before the <bdi>
    // number collapses ("Level1", «سطح۱»).
    for (const b of levels) {
      expect(b.childNodes).toHaveLength(1);
      expect((b.firstChild as HTMLElement).tagName).toBe('SPAN');
    }
    expect(levels.map((b) => b.textContent)).toEqual(['Level 1', 'Level 2', 'Level 3']);
    const q = new URL(String(callsTo(f, '/fln/links').at(-1)![0]), 'https://x').searchParams;
    expect(q.has('level')).toBe(false);
    const rows = screen.getAllByTestId(/^fln-send-row-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['fln-send-row-900', 'fln-send-row-101']);
    expect(rows[0].textContent).toContain('Answer key audio · teacher only');
  });

  it('a row: n/N, the title in its own direction, chips, minutes; Share link offers Copy + WhatsApp with the row\'s link', async () => {
    stubFetch({
      '/api/portal/fln/me': { status: 200, body: ME_LEADER },
      '/api/portal/fln/links': { status: 200, body: { rows: [ROW(101, { pos: 2, count: 48, chips: { sounds: 7 }, minutes: 36, title: 'حروف', lang: 'ur', dir: 'rtl' })] } },
    });
    mount('/portal/fln/send?grade=1&subject=rh-ur&level=1');
    const row = await screen.findByTestId('fln-send-row-101');
    expect(row.textContent).toContain('2/48');
    expect(row.textContent).toContain('7 sounds');
    expect(row.textContent).toContain('36 min');
    expect(within(row).getByText('حروف').getAttribute('dir')).toBe('rtl');
    const wa = within(row).getByRole('link', { name: 'WhatsApp' }) as HTMLAnchorElement;
    const text = decodeURIComponent(wa.href.slice('https://wa.me/?text='.length));
    expect(text.split('\n')).toEqual(['📘 Reading Hour · Urdu · Level 1', 'حروف', 'https://portal.example.test/portal/fln/p/101?src=wa']);
    for (const b of within(row).getAllByRole('button')) expect(b.className).toContain('min-h-[48px]');
  });

  it('typing a search and toggling a filter go into the URL and the /links query', async () => {
    const f = stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER }, '/api/portal/fln/links': { status: 200, body: { rows: [ROW(1)] } } });
    mount('/portal/fln/send?grade=1&subject=rh-en&level=1');
    await screen.findByText('Plan 1');
    fireEvent.click(within(screen.getByRole('group', { name: 'Filters' })).getByRole('button', { name: 'Has sounds' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search lessons' }), { target: { value: 'cat' } });
    await waitFor(() => {
      const q = new URL(String(callsTo(f, '/fln/links').at(-1)![0]), 'https://x').searchParams;
      expect([q.get('q'), q.get('has')]).toEqual(['cat', 'sounds']);
    });
    expect(screen.getByTestId('where').textContent).toContain('has=sounds');
    expect(screen.getByTestId('where').textContent).toContain('q=cat');
  });

  it('no rows → "No lessons match. Clear the filters." and the button clears them', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER }, '/api/portal/fln/links': { status: 200, body: { rows: [] } } });
    mount('/portal/fln/send?grade=1&subject=rh-en&level=1&has=sounds&q=zz');
    expect(await screen.findByText('No lessons match. Clear the filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear the filters' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/portal/fln/send?grade=1&subject=rh-en&level=1'));
  });

  it('Send to teacher on a row opens the teacher sheet for that plan', async () => {
    stubFetch({
      '/api/portal/fln/me': { status: 200, body: ME_LEADER },
      '/api/portal/fln/links': { status: 200, body: { rows: [ROW(101)] } },
      '/api/portal/fln/teachers': { status: 404 },
    });
    mount('/portal/fln/send?grade=1&subject=rh-en&level=1');
    const row = await screen.findByTestId('fln-send-row-101');
    fireEvent.click(within(row).getByRole('button', { name: 'Send to teacher' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send to teacher' });
    expect(within(dialog).getByText('Plan 101')).toBeTruthy();
  });

  it('Urdu chrome: Urdu subject chips with «—», Urdu digits on the grade chips, rtl', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER_UR } });
    mount('/portal/fln/send?grade=1');
    await screen.findByRole('heading', { name: 'سبق کا منصوبہ بھیجیں' });
    const page = await screen.findByTestId('fln-send-page');
    expect(page.getAttribute('dir')).toBe('rtl');
    const grades = within(screen.getByRole('group', { name: 'جماعت' })).getAllByRole('button');
    expect(grades[11].textContent).toBe('۱۲');
    expect(page.textContent).toContain('ریڈنگ آور — انگریزی');
    expect(page.textContent).not.toContain('·');
  });
});
