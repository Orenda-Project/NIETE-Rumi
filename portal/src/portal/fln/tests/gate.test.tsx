import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { FlnGate } from '../FlnGate';
import { useFln } from '../FlnContext';
import { flnStrings } from '../strings';
import FlnRoutes from '../FlnRoutes';
import { ME_TEACHER, rhEnG1, rhEnG8, stubFetch } from './listFixtures';

/**
 * bd-t7zk3t.11 — FlnGate: GET /fln/me on EVERY mount (no cache), 401 → sign-in with next=, 404 or lessons:false →
 * "This lesson isn't available" with the link to the lessons home, else `.fln-root` with lang/dir + the context.
 */

function Where() {
  const loc = useLocation();
  return <div data-testid="where" data-path={loc.pathname} data-search={loc.search} />;
}
function Child() {
  const { me, lang, dir, s } = useFln();
  return <p data-testid="child" data-lang={lang} data-dir={dir} data-role={me.role ?? ''}>{s.back}</p>;
}
function renderAt(path: string) {
  const [pathname, search] = path.split('?');
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : '' }]}>
      <Routes>
        <Route path="/portal/fln/*" element={<FlnGate><Child /></FlnGate>} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('FlnGate', () => {
  it('401 → navigates to the sign-in page with next = path + search (replace)', async () => {
    stubFetch({ '/me': { status: 401, body: { error: 'unauthenticated' } } });
    renderAt('/portal/fln/p/11156?src=wa');
    await waitFor(() => expect(screen.getByTestId('where').dataset.path).toBe('/portal/login'));
    const next = new URLSearchParams(screen.getByTestId('where').dataset.search).get('next');
    expect(next).toBe('/portal/fln/p/11156?src=wa');
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('404 (feature off) → the not-available page with a link to the lessons home', async () => {
    stubFetch({ '/me': { status: 404 } });
    renderAt('/portal/fln/list/rh-en?grade=1');
    const msg = await screen.findByText(flnStrings('en').errors.notAvailable);
    expect(msg).toBeInTheDocument();
    const link = screen.getByRole('link', { name: flnStrings('en').errors.toList });
    expect(link.getAttribute('href')).toBe('/portal/teacher/lessons');
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('lessons:false → the not-available page too', async () => {
    stubFetch({ '/me': { status: 200, body: { ...ME_TEACHER, lessons: false } } });
    renderAt('/portal/fln/list/rh-en?grade=1');
    expect(await screen.findByText(flnStrings('en').errors.notAvailable)).toBeInTheDocument();
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('lessons:false with ui_lang ur → the not-available page in Urdu, rtl (qa r1 D11)', async () => {
    stubFetch({ '/me': { status: 200, body: { ...ME_TEACHER, lessons: false, ui_lang: 'ur' } } });
    renderAt('/portal/fln/p/11156');
    expect(await screen.findByText(flnStrings('ur').errors.notAvailable)).toBeInTheDocument();
    expect(screen.getByText(flnStrings('ur').errors.toList)).toBeInTheDocument();
    expect(document.querySelector('.fln-root')!.getAttribute('dir')).toBe('rtl');
  });

  it('lessons:true → children inside .fln-root with lang/dir from ui_lang and the context', async () => {
    stubFetch({ '/me': { status: 200, body: { ...ME_TEACHER, ui_lang: 'ur' } } });
    const { container } = renderAt('/portal/fln/list/rh-en?grade=1');
    const child = await screen.findByTestId('child');
    expect(child.dataset.lang).toBe('ur');
    expect(child.dataset.dir).toBe('rtl');
    expect(child.textContent).toBe(flnStrings('ur').back);
    const root = container.querySelector('.fln-root') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute('lang')).toBe('ur');
    expect(root.getAttribute('dir')).toBe('rtl');
  });

  it('shows a reserved-height skeleton while /me loads', async () => {
    let release: (v: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { release = r; })));
    const { container } = renderAt('/portal/fln/p/1');
    expect(container.querySelector('[data-fln-skeleton]')).not.toBeNull();
    release(new Response(JSON.stringify(ME_TEACHER), { status: 200 }));
    await screen.findByTestId('child');
  });

  it('calls /me on EVERY mount (no cache) with cache: no-store', async () => {
    const f = stubFetch({ '/me': { status: 200, body: ME_TEACHER } });
    renderAt('/portal/fln/p/1');
    await screen.findByTestId('child');
    cleanup();
    renderAt('/portal/fln/p/1');
    await screen.findByTestId('child');
    const meCalls = f.mock.calls.filter(([u]) => String(u).endsWith('/api/portal/fln/me'));
    expect(meCalls).toHaveLength(2);
    expect((meCalls[0][1] as RequestInit).cache).toBe('no-store');
  });

  it('503 → the calm line with a retry that asks again', async () => {
    let n = 0;
    stubFetch({ '/me': () => (n++ === 0 ? { status: 503, body: { error: 'fln_unavailable' } } : { status: 200, body: ME_TEACHER }) });
    renderAt('/portal/fln/p/1');
    const retry = await screen.findByRole('button', { name: flnStrings('en').errors.retry });
    expect(screen.getByText(flnStrings('en').errors.unavailable)).toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByTestId('child')).toBeInTheDocument();
  });
});

describe('FlnRoutes (behind the gate)', () => {
  function renderRoutes(path: string) {
    const [pathname, search] = path.split('?');
    return render(
      <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : '' }]}>
        <Routes>
          <Route path="/portal/fln/*" element={<FlnRoutes />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('list/<subject>?grade=8 (no level) → the level chooser', async () => {
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': { status: 200, body: rhEnG8() } });
    renderRoutes('/portal/fln/list/rh-en?grade=8');
    expect(await screen.findByRole('heading', { name: flnStrings('en').chooser.title })).toBeInTheDocument();
  });

  it('list/<subject>?grade=1 → the lesson list', async () => {
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': { status: 200, body: rhEnG1() } });
    renderRoutes('/portal/fln/list/rh-en?grade=1');
    expect(await screen.findByText('Synthetic guide')).toBeInTheDocument();
  });

  it('a bad subject, a bad grade, or an unknown path → not available', async () => {
    for (const p of ['/portal/fln/list/maths?grade=1', '/portal/fln/list/rh-en?grade=13', '/portal/fln/nope']) {
      stubFetch({ '/me': { status: 200, body: ME_TEACHER } });
      renderRoutes(p);
      expect(await screen.findByText(flnStrings('en').errors.notAvailable)).toBeInTheDocument();
      cleanup();
    }
  });
});
