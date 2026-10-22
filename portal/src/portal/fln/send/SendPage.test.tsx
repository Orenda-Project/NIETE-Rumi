import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { WHATSAPP_URL_PICKER } from '@/lib/whatsapp';
import SendPage from './SendPage';
import { stubFetch, callsTo, ME_LEADER, ME_LEADER_UR, ME_TEACHER } from '../share/testFetch';

/**
 * The "Send a lesson plan" builder at /portal/fln/send (DESIGN v2 §4 L3): grade (1–5 only, bd-elc1qz) → subject →
 * search + filters → rows with Send to teacher and Share link. No level chips: the grade decides the rows. State lives in the URL so Back works. 404 → "not available"; no rows → the §7 empty line.
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
  it('title, grade chips 1–5 only (bd-elc1qz), every chip ≥48 px', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER } });
    mount('/portal/fln/send');
    expect(await screen.findByRole('heading', { name: 'Send a lesson plan' })).toBeTruthy();
    const grades = within(screen.getByRole('group', { name: 'Grade' })).getAllByRole('button');
    expect(grades.map((b) => b.textContent)).toEqual(['1', '2', '3', '4', '5']);
    for (const b of grades) expect(b.className).toContain('min-h-[48px]');
  });

  it('grade 2 asks /links with grade and subject only: no Level chips, no level in the request or the URL (no-store, sort=used)', async () => {
    const f = stubFetch({
      '/api/portal/fln/me': { status: 200, body: ME_LEADER },
      '/api/portal/fln/links': { status: 200, body: { rows: [ROW(201, { level: 2 })] } },
    });
    mount('/portal/fln/send');
    fireEvent.click(within(await screen.findByRole('group', { name: 'Grade' })).getByRole('button', { name: '2' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Subject' })).getByRole('button', { name: 'Reading Hour · English' }));
    await screen.findByText('Plan 201');
    expect(screen.queryByRole('group', { name: 'Level' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Level \d$/ })).toBeNull();
    const [url, init] = callsTo(f, '/fln/links').at(-1)!;
    const q = new URL(String(url), 'https://x').searchParams;
    expect([q.get('grade'), q.get('subject'), q.get('sort')]).toEqual(['2', 'rh-en', 'used']);
    expect(q.has('level')).toBe(false);
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
    expect(screen.getByTestId('where').textContent).toBe('/portal/fln/send?grade=2&subject=rh-en');
  });

  it('an old ?grade=8 link (6–12 retired, bd-elc1qz) is no grade: no chip on, "pick a grade", /links never asked', async () => {
    const f = stubFetch({
      '/api/portal/fln/me': { status: 200, body: ME_LEADER },
      '/api/portal/fln/links': { status: 200, body: { rows: [ROW(900, { chips: { screener: true, sounds: 4 } })] } },
    });
    mount('/portal/fln/send?grade=8&subject=rh-en');
    const grades = within(await screen.findByRole('group', { name: 'Grade' })).getAllByRole('button');
    expect(grades.map((b) => b.textContent)).toEqual(['1', '2', '3', '4', '5']);
    expect(grades.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'false', 'false']);
    expect(screen.getByText('Choose a grade')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Level' })).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(callsTo(f, '/fln/links')).toHaveLength(0);
    expect(screen.queryByText('Plan 900')).toBeNull();
  });

  it('an old link with &level=1 on Grade 4 draws no Level chips and asks /links without level: the grade decides', async () => {
    const f = stubFetch({
      '/api/portal/fln/me': { status: 200, body: ME_LEADER },
      '/api/portal/fln/links': { status: 200, body: { rows: [ROW(401, { level: 3, grades: [4, 5] })] } },
    });
    mount('/portal/fln/send?grade=4&subject=rh-en&level=1');
    await screen.findByText('Plan 401');
    expect(screen.queryByRole('group', { name: 'Level' })).toBeNull();
    const q = new URL(String(callsTo(f, '/fln/links').at(-1)![0]), 'https://x').searchParams;
    expect([q.get('grade'), q.get('subject'), q.has('level')]).toEqual(['4', 'rh-en', false]);
  });

  it('filter chips are exactly Screener / Has sounds / Story audio; an old has=additional is dropped (bd-e5ieg0)', async () => {
    const f = stubFetch({
      '/api/portal/fln/me': { status: 200, body: ME_LEADER },
      '/api/portal/fln/links': { status: 200, body: { rows: [ROW(101)] } },
    });
    mount('/portal/fln/send?grade=1&subject=rh-en&level=1&has=additional');
    await screen.findByText('Plan 101');
    const chips = within(screen.getByRole('group', { name: 'Filters' })).getAllByRole('button');
    expect(chips.map((b) => b.textContent)).toEqual(['Screener', 'Has sounds', 'Story audio']);
    expect(screen.queryByRole('button', { name: 'Additional practice' })).toBeNull();
    const q = new URL(String(callsTo(f, '/fln/links').at(-1)![0]), 'https://x').searchParams;
    expect(q.has('has')).toBe(false);
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
    const text = decodeURIComponent(wa.href.slice(`${WHATSAPP_URL_PICKER}?text=`.length));
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
    // An old link's &level=1 is dropped the first time the builder writes the URL (the grade decides the rows).
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/portal/fln/send?grade=1&subject=rh-en'));
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

  // bd-4joiqz — the leader can READ a plan before sending it: View opens that plan's FLN page, at the row's grade.
  it('View on a row opens that plan\'s page (/portal/fln/p/<id>?grade=<g>), with Send and Share as they were', async () => {
    stubFetch({
      '/api/portal/fln/me': { status: 200, body: ME_LEADER },
      '/api/portal/fln/links': { status: 200, body: { rows: [ROW(101), ROW(102)] } },
    });
    render(
      <MemoryRouter initialEntries={['/portal/fln/send?grade=3&subject=num']}>
        <Routes>
          <Route path="/portal/fln/send" element={<><SendPage /><Where /></>} />
          <Route path="/portal/fln/p/:id" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    const row = await screen.findByTestId('fln-send-row-102');
    const view = within(row).getByRole('link', { name: 'View' });
    expect(view.getAttribute('href')).toBe('/portal/fln/p/102?grade=3');
    expect(view.className).toContain('min-h-[48px]');
    expect(within(row).getByRole('button', { name: 'Send to teacher' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Copy link' })).toBeTruthy();
    fireEvent.click(view);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/portal/fln/p/102?grade=3'));
  });

  it('View in Urdu chrome', async () => {
    stubFetch({
      '/api/portal/fln/me': { status: 200, body: ME_LEADER_UR },
      '/api/portal/fln/links': { status: 200, body: { rows: [ROW(101)] } },
    });
    mount('/portal/fln/send?grade=1&subject=rh-en');
    const row = await screen.findByTestId('fln-send-row-101');
    expect(within(row).getByRole('link', { name: 'دیکھیں' }).getAttribute('href')).toBe('/portal/fln/p/101?grade=1');
  });

  it('Urdu chrome: Urdu subject chips with «—», Urdu digits on the grade chips, rtl', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER_UR } });
    mount('/portal/fln/send?grade=1');
    await screen.findByRole('heading', { name: 'سبق کا منصوبہ بھیجیں' });
    const page = await screen.findByTestId('fln-send-page');
    expect(page.getAttribute('dir')).toBe('rtl');
    const grades = within(screen.getByRole('group', { name: 'جماعت' })).getAllByRole('button');
    expect(grades.map((g) => g.textContent)).toEqual(['۱', '۲', '۳', '۴', '۵']);
    expect(page.textContent).toContain('ریڈنگ آور — انگریزی');
    expect(page.textContent).not.toContain('·');
  });
});
