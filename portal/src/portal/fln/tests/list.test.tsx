import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { FlnProvider } from '../FlnContext';
import { LessonList } from '../LessonList';
import { flnStrings, type FlnSubjectKey } from '../strings';
import { ME_TEACHER, numG2, rhEnG1, rhUrG1, stubFetch } from './listFixtures';
import type { FlnMe } from '../types';

/**
 * S3, the lesson list (DESIGN v2 §2 S3/S5): running number = `pos` (never an index), the guide
 * pinned on top unnumbered, the screener's chip is the answer key (never a sounds count), a "Next" marker on the
 * first unopened numbered row, ✓ when opened, "Other levels", Numeracy strand tabs, Back, scroll restore, and on an
 * Urdu page no «·» and every ASCII run inside <bdi> (or a dir=ltr island).
 */

const EN = flnStrings('en');
const UR = flnStrings('ur');

function Where() {
  const loc = useLocation();
  return <div data-testid="where" data-path={loc.pathname} data-search={loc.search} />;
}
function renderList(subject: FlnSubjectKey, grade: number, level: number | null = null, me: FlnMe = ME_TEACHER) {
  const q = `?grade=${grade}${level ? `&level=${level}` : ''}`;
  return render(
    <MemoryRouter initialEntries={[`/portal/fln/list/${subject}${q}`]}>
      <FlnProvider me={me}>
        <Routes>
          <Route path="/portal/fln/list/:subject" element={<LessonList subject={subject} grade={grade} level={level} />} />
          <Route path="*" element={null} />
        </Routes>
      </FlnProvider>
      <Where />
    </MemoryRouter>,
  );
}
const rowsOf = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-fln-row]')) as HTMLElement[];

let scrolled: Element[] = [];
beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) { scrolled.push(this); });
  try { window.sessionStorage.clear(); } catch { /* none */ }
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LessonList', () => {
  it('rows in pos order; the number is pos; the guide is first and unnumbered', async () => {
    stubFetch({ '/catalogue': { status: 200, body: rhEnG1() } });
    const { container } = renderList('rh-en', 1);
    await screen.findByText('Synthetic guide');
    const rows = rowsOf(container);
    expect(rows.map((r) => r.dataset.flnRow)).toEqual(['9001', '9002', '9003', '9004', '9005', '9006', '9007']);
    expect(rows[0].querySelector('[data-fln-no]')).toBeNull();
    expect(rows.slice(1).map((r) => r.querySelector('[data-fln-no]')?.textContent)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(rows[2].getAttribute('href')).toBe('/portal/fln/p/9003?grade=1'); // the list's grade rides to the plan (QT-counts)
  });

  it('sub-header from listSub with the strand count; chapter headers in the UI language', async () => {
    stubFetch({ '/catalogue': { status: 200, body: rhEnG1() } });
    renderList('rh-en', 1);
    expect(await screen.findByText(EN.listSub(1, EN.levelGrades[1], 66))).toBeInTheDocument();
    expect(screen.getByText('Letter sounds')).toBeInTheDocument();
  });

  it('the screener row shows the answer-key chip and never a sounds count', async () => {
    stubFetch({ '/catalogue': { status: 200, body: rhEnG1() } });
    const { container } = renderList('rh-en', 1);
    await screen.findByText('Synthetic screener');
    const scr = rowsOf(container)[1];
    expect(scr.textContent).toContain(EN.chip.answerKey);
    expect(scr.textContent).not.toContain(EN.chip.sounds(54));
    expect(scr.textContent).toContain(EN.minutes(53));
    const core = rowsOf(container)[2];
    expect(core.textContent).toContain(EN.chip.sounds(2));
    expect(rowsOf(container)[3].textContent).toContain(EN.chip.soundOne);
    expect(rowsOf(container)[4].textContent).toContain(EN.chip.textbook);
    expect(rowsOf(container)[5].textContent).toContain(EN.chip.video);
    expect(rowsOf(container)[6].textContent).toContain(EN.chip.additional);
  });

  it('✓ on opened rows; the Next marker on the first unopened numbered row, scrolled into view', async () => {
    stubFetch({ '/catalogue': { status: 200, body: rhEnG1() } });
    const { container } = renderList('rh-en', 1);
    await screen.findByText('Synthetic guide');
    const rows = rowsOf(container);
    expect(rows.filter((r) => r.querySelector('[data-fln-opened]')).map((r) => r.dataset.flnRow)).toEqual(['9001', '9002', '9003', '9004']);
    const marked = rows.filter((r) => r.querySelector('[data-fln-next]'));
    expect(marked.map((r) => r.dataset.flnRow)).toEqual(['9005']);
    expect(within(marked[0]).getByText(EN.next)).toBeInTheDocument();
    await waitFor(() => expect(scrolled).toContain(marked[0]));
  });

  it('Other levels → the three levels, each → ?grade=1&level=n', async () => {
    stubFetch({ '/catalogue': { status: 200, body: rhEnG1() } });
    renderList('rh-en', 1);
    const btn = await screen.findByRole('button', { name: new RegExp(EN.otherLevels) });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const opts = screen.getAllByRole('link', { name: new RegExp(`^${EN.level(1)}|^${EN.level(2)}|^${EN.level(3)}`) });
    expect(opts.map((o) => o.getAttribute('href'))).toEqual([
      '/portal/fln/list/rh-en?grade=1&level=1',
      '/portal/fln/list/rh-en?grade=1&level=2',
      '/portal/fln/list/rh-en?grade=1&level=3',
    ]);
  });

  it('another level than the grade’s own asks the catalogue for that level’s grade', async () => {
    const f = stubFetch({ '/catalogue': { status: 200, body: rhEnG1() } });
    renderList('rh-en', 1, 3);
    await screen.findByText('Synthetic guide');
    const url = new URL(String(f.mock.calls[0][0]), 'http://x');
    expect(url.searchParams.get('grade')).toBe('5');
    expect(url.searchParams.get('level')).toBe('3');
  });

  it('Numeracy with an extended strand: two tabs, Daily first; the tab switches the rows', async () => {
    stubFetch({ '/catalogue': { status: 200, body: numG2() } });
    renderList('num', 2);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([EN.strand.daily, EN.strand.extended]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Daily one')).toBeInTheDocument();
    expect(screen.queryByText('Extended one')).toBeNull();
    expect(screen.getByText(EN.listSub(2, EN.levelGrades[2], 40))).toBeInTheDocument();
    fireEvent.click(tabs[1]);
    expect(await screen.findByText('Extended one')).toBeInTheDocument();
    expect(screen.queryByText('Daily one')).toBeNull();
    expect(screen.getByText(EN.listSub(2, EN.levelGrades[2], 20))).toBeInTheDocument();
  });

  it('no tabs when there is only the daily strand', async () => {
    stubFetch({ '/catalogue': { status: 200, body: rhEnG1() } });
    renderList('rh-en', 1);
    await screen.findByText('Synthetic guide');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('Back: G1–5 → the New-lesson page; G6–12 → the chooser', async () => {
    stubFetch({ '/catalogue': { status: 200, body: rhEnG1() } });
    renderList('rh-en', 1);
    await screen.findByText('Synthetic guide');
    expect(screen.getByRole('link', { name: EN.back }).getAttribute('href')).toBe('/portal/teacher/lessons/new');
    cleanup();
    renderList('rh-en', 8, 1);
    await screen.findByText('Synthetic guide');
    expect(screen.getByRole('link', { name: EN.back }).getAttribute('href')).toBe('/portal/fln/list/rh-en?grade=8');
  });

  it('saves the scroll position when a plan is opened and restores it on return (no Next scroll then)', async () => {
    stubFetch({ '/catalogue': { status: 200, body: rhEnG1() } });
    const { container } = renderList('rh-en', 1);
    await screen.findByText('Synthetic guide');
    Object.defineProperty(window, 'scrollY', { value: 420, configurable: true });
    fireEvent.click(rowsOf(container)[3]);
    cleanup();
    scrolled = [];
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    renderList('rh-en', 1);
    await screen.findByText('Synthetic guide');
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 420));
    expect(scrolled).toHaveLength(0);
  });

  it('Urdu page: no «·» anywhere, every ASCII letter/digit run in rtl chrome is inside <bdi> or a dir=ltr island', async () => {
    stubFetch({ '/catalogue': { status: 200, body: rhUrG1() } });
    const { container } = renderList('rh-ur', 1, null, { ...ME_TEACHER, ui_lang: 'ur' });
    await screen.findByText('منصوبہ بندی کا تعارف');
    expect(container.textContent).not.toContain('·');
    expect(screen.getByText(UR.listSub(1, UR.levelGrades[1], 66))).toBeInTheDocument();
    const bad: string[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!/[A-Za-z0-9]/.test(n.nodeValue || '')) continue;
      let el = n.parentElement;
      let ok = false;
      // the page is Urdu (rtl) unless a nearer ancestor says otherwise
      while (el && el !== container.parentElement) {
        if (el.tagName === 'BDI' || el.getAttribute('dir') === 'ltr') { ok = true; break; }
        if (el.getAttribute('dir') === 'rtl') break;
        el = el.parentElement;
      }
      if (!ok) bad.push(n.nodeValue || '');
    }
    expect(bad).toEqual([]);
    // the English plan title on the Urdu page is its own ltr island with lang=en (the CSS gives it the Latin font)
    const en = screen.getByText('Synthetic English title');
    expect(en.closest('[lang="en"]')?.getAttribute('dir')).toBe('ltr');
    // the Urdu title with a Latin token keeps the token in <bdi>
    expect(container.innerHTML).toContain('<bdi>SLO</bdi>');
  });
});
