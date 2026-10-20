import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';

vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../services/api';
import { FlnBand } from '../FlnBand';
import { bandGrade, bandGradeForPairs, defaultGrade } from '../FlnBandBody';
import { flnStrings } from '../strings';
import type { FlnMe } from '../types';
import { LEVELS, ME_TEACHER, numG2, rhEnG1, rhUrG1, stubFetch } from './listFixtures';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// vitest runs with css:false (a `?raw` import comes back empty), so read the stylesheet from disk.
const css = readFileSync(resolve(__dirname, '../fln.css'), 'utf8');

/**
 * The Reading Hour & Numeracy band on the New-lesson page (DESIGN v2 §0, §2 S2, §7).
 * Network boundary only: `fetch` for /api/portal/fln/*, the axios client for /me/grade-subjects.
 */

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const EN = flnStrings('en');
const UR = flnStrings('ur');
const ME_COACH: FlnMe = { lessons: true, share: true, role: 'coach', ui_lang: 'en' };
// A principal with Share off: a leader by ROLE, so the band is theirs whatever the share switch says.
const ME_PRINCIPAL: FlnMe = { lessons: true, share: false, role: 'principal', ui_lang: 'en' };

type Klass = { grade: number | null; source?: 'class' | 'history' };

/** Their classes as GET /me/grade-subjects answers them: a grade (null = early years) and where it came from. */
function classes(rows: Klass[]) {
  http.get.mockImplementation(async (url: string) => {
    if (url === '/me/grade-subjects') {
      return { data: { success: true, combos: rows.map((r) => ({ grade: r.grade, gradeCode: r.grade == null ? 'ecce' : `grade_${r.grade}`, subject: 'English', subjectKey: 'english', source: r.source ?? 'class', featureKey: 'English', available: true })) } };
    }
    throw Object.assign(new Error('404'), { response: { status: 404 } });
  });
}

function combos(grades: number[]) {
  classes(grades.map((grade) => ({ grade })));
}

function catalogueFor(url: URL) {
  const grade = Number(url.searchParams.get('grade'));
  const subject = url.searchParams.get('subject');
  // FLN is Grades 1–5 only (bd-elc1qz): the server answers 400 above grade 5, and the band never asks.
  if (!(grade >= 1 && grade <= 5)) return { status: 400, body: { error: 'bad_request' } };
  const base = subject === 'num' ? numG2() : subject === 'rh-ur' ? rhUrG1() : rhEnG1();
  return { status: 200, body: { ...base, grade, level: grade === 1 ? 1 : grade <= 3 ? 2 : 3 } };
}

function renderBand() {
  return render(<MemoryRouter><FlnBand /></MemoryRouter>);
}

beforeEach(async () => {
  vi.clearAllMocks();
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('en'); });
  combos([1]);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('FlnBand', () => {
  it('404 from the FLN API (switch off) → renders nothing at all', async () => {
    const f = stubFetch({});
    const { container } = renderBand();
    await waitFor(() => expect(f).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(container.innerHTML).toBe('');
  });

  it('grade 1 → three rows with the level count from the catalogue, each a link to its list', async () => {
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    renderBand();
    const rows = await screen.findAllByRole('link');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.getAttribute('href'))).toEqual([
      '/portal/fln/list/rh-en?grade=1',
      '/portal/fln/list/rh-ur?grade=1',
      '/portal/fln/list/num?grade=1',
    ]);
    expect(within(rows[0]).getByText(EN.subject['rh-en'])).toBeInTheDocument();
    expect(within(rows[0]).getByText(EN.bandRow(LEVELS[0].count, 1))).toBeInTheDocument();
    expect(screen.getByText(EN.band.title)).toBeInTheDocument();
    expect(screen.getByText(EN.band.sub)).toBeInTheDocument();
  });

  it('defaults to the lowest of several grades, and a grade chip changes the rows', async () => {
    combos([4, 2]);
    const f = stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    renderBand();
    const rows = await screen.findAllByRole('link');
    expect(rows[0].getAttribute('href')).toBe('/portal/fln/list/rh-en?grade=2');
    // grade 2's own rows (66 in this fixture), never level 2's representative count (QT-counts)
    expect(within(rows[0]).getByText(EN.bandRow(66, 2))).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radios[4]);
    await waitFor(() => expect(screen.getAllByRole('link')[0].getAttribute('href')).toBe('/portal/fln/list/rh-en?grade=5'));
    expect(f.mock.calls.some(([u]) => String(u).includes('grade=5'))).toBe(true);
  });

  it('offers Grades 1–5 only; a coach of Grade 7 alone lands on Grade 1 and no grade above 5 is ever asked (bd-elc1qz)', async () => {
    // A TEACHER of Grade 7 alone sees no band at all since bd-4tsjcr (below); a leader still lands on Grade 1.
    combos([7]);
    const f = stubFetch({ '/me': { status: 200, body: ME_COACH }, '/catalogue': catalogueFor });
    renderBand();
    const rows = await screen.findAllByRole('link');
    expect(rows.map((r) => r.getAttribute('href'))).toEqual([
      '/portal/fln/list/rh-en?grade=1',
      '/portal/fln/list/rh-ur?grade=1',
      '/portal/fln/list/num?grade=1',
    ]);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([1, 2, 3, 4, 5].map((g) => EN.grade(g)));
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    expect(within(rows[0]).getByText(EN.bandRow(LEVELS[0].count, 1))).toBeInTheDocument();
    const grades = f.mock.calls.map(([u]) => new URL(String(u), 'http://x').searchParams.get('grade')).filter(Boolean);
    expect(grades.length).toBeGreaterThan(0);
    expect(grades.every((g) => Number(g) >= 1 && Number(g) <= 5)).toBe(true);
  });

  it('the sub-line names Grades 1–5, in both languages (bd-elc1qz)', () => {
    expect(EN.band.sub).toContain('Grades 1–5');
    expect(EN.band.sub).not.toMatch(/every grade/i);
    expect(UR.band.sub).toContain('جماعت ۱ تا ۵');
    expect(UR.band.sub).not.toContain('ہر جماعت');
  });

  it('defaultGrade: only Grades 1–5 count — the lowest of them, else Grade 1', () => {
    expect(defaultGrade([7])).toBe(1);
    expect(defaultGrade([12, 6])).toBe(1);
    expect(defaultGrade([8, 3, 5])).toBe(3);
    expect(defaultGrade([4, 2])).toBe(2);
    expect(defaultGrade([null, undefined, 0, 13])).toBe(1);
  });

  it('503 → one calm line and a retry that fetches again', async () => {
    let fail = true;
    stubFetch({
      '/me': { status: 200, body: ME_TEACHER },
      '/catalogue': (u) => (fail ? { status: 503, body: { error: 'fln_unavailable' } } : catalogueFor(u)),
    });
    renderBand();
    expect(await screen.findByText(EN.band.error)).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: EN.band.retry }));
    expect(await screen.findAllByRole('link')).toHaveLength(3);
  });

  it('three skeleton rows while the catalogue loads', async () => {
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': () => ({ status: 200, body: rhEnG1() }) });
    const slow = vi.fn((input: RequestInfo | URL) => (String(input).includes('/catalogue')
      ? new Promise<Response>(() => {})
      : Promise.resolve(new Response(JSON.stringify(ME_TEACHER), { status: 200 }))));
    vi.stubGlobal('fetch', slow);
    const { container } = renderBand();
    await waitFor(() => expect(container.querySelectorAll('[data-fln-skeleton]')).toHaveLength(3));
  });

  it('grade chips and rows are ≥48 px / ≥56 px (class + the scoped CSS rule)', async () => {
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    renderBand();
    const rows = await screen.findAllByRole('link');
    for (const r of screen.getAllByRole('radio')) expect(r.classList.contains('fln-chip')).toBe(true);
    for (const r of rows) expect(r.classList.contains('fln-row')).toBe(true);
    const flat = css.replace(/\s+/g, ' ');
    expect(flat).toMatch(/\.fln-band \.fln-chip[^{]*\{[^}]*min-height: ?48px/);
    expect(flat).toMatch(/\.fln-band \.fln-row[^{]*\{[^}]*min-height: ?56px/);
  });

  it('grade chips never shrink in the nowrap scroller (R5 CHIPS-390: "Grade 2Grade 3…" at 390 px)', async () => {
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    try {
      renderBand();
      await screen.findAllByRole('link');
      const row = screen.getAllByRole('radio')[0].parentElement as HTMLElement;
      expect(getComputedStyle(row).flexWrap).toBe('nowrap');
      for (const chip of screen.getAllByRole('radio')) expect(getComputedStyle(chip).flexShrink).toBe('0');
    } finally {
      style.remove();
    }
  });

  it('the selected grade chip is scrolled to the middle of its row on load, the row only (red-team 192944: «جماعت ۵» at x = −113)', async () => {
    combos([5]);
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    const rect = (left: number, width: number) => ({ left, width, right: left + width, top: 0, bottom: 48, height: 48, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('fln-chips')) return rect(0, 390);
      if (this.classList.contains('fln-chip')) return rect(this.classList.contains('on') ? 600 : 0, 90);
      return rect(0, 0);
    });
    try {
      renderBand();
      await screen.findAllByRole('link');
      const row = screen.getByRole('radiogroup');
      expect(screen.getByRole('radio', { checked: true }).textContent).toBe(EN.grade(5));
      expect(row.scrollLeft).toBe(450); // (600 + 45) − (0 + 195)
    } finally {
      spy.mockRestore();
    }
  });

  it('Urdu page: Urdu chrome with «—», no «·»', async () => {
    await act(async () => { await i18n.changeLanguage('ur'); });
    stubFetch({ '/me': { status: 200, body: { ...ME_TEACHER, ui_lang: 'ur' } }, '/catalogue': catalogueFor });
    const { container } = renderBand();
    const rows = await screen.findAllByRole('link');
    expect(within(rows[0]).getByText(UR.subject['rh-en'])).toBeInTheDocument();
    expect(container.textContent).not.toContain('·');
    expect(container.querySelector('.fln-band')?.getAttribute('dir')).toBe('rtl');
  });
});

/**
 * bd-4tsjcr (operator, 20 Oct 2026). Asked whether a teacher whose classes are all Grades 6–12 should see the band
 * at Grade 1 or not at all: "not at all". The band is hidden for a TEACHER only when their classes read SUCCEEDED,
 * at least one class has a KNOWN grade, and every known grade is above 5. No classes, only unknown (early-years /
 * null) grades, or a failed read → Grade 1, as before: we cannot tell what they teach, so nothing that might be
 * theirs is hidden. Lesson-plan history (sent only when they have no class pair) never hides it. Leaders (the
 * school-leader family, by role) always see it.
 */
describe('FlnBand: who sees it (bd-4tsjcr)', () => {
  /** Every pending answer landed: /fln/me, the lazy body, the classes read, any catalogue. */
  async function settle() {
    for (let i = 0; i < 10; i += 1) {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
  }

  /** The band's body mounted and asked for their classes, and everything it asked has answered. */
  async function classesAsked() {
    await waitFor(() => expect(http.get).toHaveBeenCalledWith('/me/grade-subjects', { params: { feature: 'lessons' } }));
    await settle();
  }

  const catalogueAsks = (f: ReturnType<typeof stubFetch>) => f.mock.calls.filter(([u]) => String(u).includes('/catalogue'));

  async function landsOn(grade: number) {
    const rows = await screen.findAllByRole('link');
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(
      ['rh-en', 'rh-ur', 'num'].map((s) => `/portal/fln/list/${s}?grade=${grade}`),
    );
    expect(screen.getByRole('radio', { checked: true }).textContent).toBe(EN.grade(grade));
    expect(screen.getByText(EN.band.title)).toBeInTheDocument();
  }

  /** Nothing at all: no section, no heading, no chips, no skeleton — and no catalogue was asked for. */
  function nothingShown(container: HTMLElement, f: ReturnType<typeof stubFetch>) {
    expect(container.innerHTML).toBe('');
    expect(container.querySelector('.fln-band')).toBeNull();
    expect(screen.queryByText(EN.band.title)).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(container.querySelector('[data-fln-skeleton]')).toBeNull();
    expect(catalogueAsks(f)).toHaveLength(0);
  }

  it('a teacher of Grade 9 alone → no band at all', async () => {
    combos([9]);
    const f = stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    const { container } = renderBand();
    await classesAsked();
    nothingShown(container, f);
  });

  it('a teacher of Grades 9 and 7 → no band at all', async () => {
    combos([9, 7]);
    const f = stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    const { container } = renderBand();
    await classesAsked();
    nothingShown(container, f);
  });

  it('a teacher of Grades 9, 7 and an early-years class (unknown grade) → still no band', async () => {
    classes([{ grade: 9 }, { grade: null }, { grade: 7 }]);
    const f = stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    const { container } = renderBand();
    await classesAsked();
    nothingShown(container, f);
  });

  it('a teacher of Grades 7 and 3 → the band, on Grade 3', async () => {
    combos([7, 3]);
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    renderBand();
    await landsOn(3);
  });

  // GET /me/grade-subjects answers from lesson-plan HISTORY only when the teacher has no class pair at all
  // (dashboard grade-subjects.service: `if (fromClasses.length) return { combos: fromClasses }`), so a history row is
  // never next to a class row. History says what they have opened, not what they teach: it never hides the band.
  it('a Grade 8 class (source class) → still no band', async () => {
    classes([{ grade: 8, source: 'class' }]);
    const f = stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    const { container } = renderBand();
    await classesAsked();
    nothingShown(container, f);
  });

  it('no classes, lesson-plan history of Grade 7 only → the band, on Grade 1 (history never hides it)', async () => {
    classes([{ grade: 7, source: 'history' }]);
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    renderBand();
    await landsOn(1);
  });

  it('no classes, lesson-plan history of Grades 9 and 7 → the band, on Grade 1', async () => {
    classes([{ grade: 9, source: 'history' }, { grade: 7, source: 'history' }]);
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    renderBand();
    await landsOn(1);
  });

  it('no classes, lesson-plan history of Grades 3 and 8 → the band, on Grade 3', async () => {
    classes([{ grade: 3, source: 'history' }, { grade: 8, source: 'history' }]);
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    renderBand();
    await landsOn(3);
  });

  it('a teacher with no classes → the band, on Grade 1', async () => {
    combos([]);
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    renderBand();
    await landsOn(1);
  });

  it('a teacher with only unknown grades (early years, null) → the band, on Grade 1', async () => {
    classes([{ grade: null }, { grade: null }]);
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    renderBand();
    await landsOn(1);
  });

  it('the classes read is rejected (502) → the band, on Grade 1', async () => {
    http.get.mockImplementation(async () => { throw Object.assign(new Error('502'), { response: { status: 502 } }); });
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    renderBand();
    await landsOn(1);
  });

  it('the classes read fails (an answer that is not a success) → the band, on Grade 1', async () => {
    http.get.mockImplementation(async (url: string) => (url === '/me/grade-subjects' ? { data: { success: false } } : { data: {} }));
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    renderBand();
    await landsOn(1);
  });

  it('a teacher sees nothing while their classes are still being read (no heading that then disappears)', async () => {
    http.get.mockImplementation(() => new Promise(() => {}));
    const f = stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    const { container } = renderBand();
    await classesAsked();
    nothingShown(container, f);
  });

  it('a coach of Grade 9 alone → the band, on Grade 1', async () => {
    combos([9]);
    stubFetch({ '/me': { status: 200, body: ME_COACH }, '/catalogue': catalogueFor });
    renderBand();
    await landsOn(1);
  });

  it('a principal of Grades 9 and 7 (Share off) → the band, on Grade 1', async () => {
    combos([9, 7]);
    stubFetch({ '/me': { status: 200, body: ME_PRINCIPAL }, '/catalogue': catalogueFor });
    renderBand();
    await landsOn(1);
  });

  it('bandGrade: hidden only for a teacher whose classes read succeeded with every known grade above 5', () => {
    // teacher
    expect(bandGrade([9], false)).toBeNull();
    expect(bandGrade([9, 7], false)).toBeNull();
    expect(bandGrade([12, null, 6], false)).toBeNull();
    expect(bandGrade([7, 3], false)).toBe(3);
    expect(bandGrade([8, 5, 2], false)).toBe(2);
    expect(bandGrade([], false)).toBe(1);
    expect(bandGrade([null, undefined], false)).toBe(1);
    expect(bandGrade([0, 13], false)).toBe(1); // not grades we know
    expect(bandGrade(null, false)).toBe(1); // a failed read
    // leader: unchanged
    expect(bandGrade([9], true)).toBe(1);
    expect(bandGrade([9, 4], true)).toBe(4);
    expect(bandGrade(null, true)).toBe(1);
  });

  it('bandGradeForPairs: class pairs decide; history alone never hides; a failed read → Grade 1', () => {
    const c = (grade: number | null) => ({ grade, source: 'class' as const });
    const h = (grade: number | null) => ({ grade, source: 'history' as const });
    expect(bandGradeForPairs([c(8)], false)).toBeNull();
    expect(bandGradeForPairs([c(9), c(null), c(7)], false)).toBeNull();
    expect(bandGradeForPairs([c(7), c(3)], false)).toBe(3);
    expect(bandGradeForPairs([], false)).toBe(1);
    expect(bandGradeForPairs([h(7)], false)).toBe(1);
    expect(bandGradeForPairs([h(9), h(7)], false)).toBe(1);
    expect(bandGradeForPairs([h(3), h(8)], false)).toBe(3);
    expect(bandGradeForPairs([h(null)], false)).toBe(1);
    expect(bandGradeForPairs(null, false)).toBe(1);
    expect(defaultGrade([9, 7, 12])).toBe(1); // an all-6–12 history opens on Grade 1, never null
    // leader: unchanged
    expect(bandGradeForPairs([c(8)], true)).toBe(1);
    expect(bandGradeForPairs([h(4), h(9)], true)).toBe(4);
    expect(bandGradeForPairs(null, true)).toBe(1);
  });

  it('a coach still sees the band heading while their classes are read (unchanged)', async () => {
    http.get.mockImplementation(() => new Promise(() => {}));
    stubFetch({ '/me': { status: 200, body: ME_COACH }, '/catalogue': catalogueFor });
    renderBand();
    expect(await screen.findByText(EN.band.title)).toBeInTheDocument();
  });
});

/**
 * bd-4tsjcr red team S1: nothing times the classes read out (not the axios client, not useLoad, not the server's
 * pool), so a read that hangs would keep a teacher's band hidden for the whole visit. After 8 s the read counts as
 * FAILED — Grade 1 — and that is latched: an answer arriving later is ignored, so a band once shown never goes.
 */
describe('FlnBand: a classes read that never answers (bd-4tsjcr S1)', () => {
  const pair = (grade: number) => ({ grade, gradeCode: `grade_${grade}`, subject: 'English', subjectKey: 'english', source: 'class', featureKey: 'English', available: true });

  /** The classes read hangs until the test lands it (or never). */
  function hangingClasses() {
    const pending: { land: (v: unknown) => void } = { land: () => {} };
    http.get.mockImplementation((url: string) => (url === '/me/grade-subjects'
      ? new Promise((r) => { pending.land = r; })
      : Promise.reject(Object.assign(new Error('404'), { response: { status: 404 } }))));
    return pending;
  }

  // `shouldAdvanceTime` (so the lazy body and waitFor still run) lets real time leak into the fake clock: under a
  // loaded run a few hundred ms pass before the first advance, so the checks keep ≥4 s away from the deadline.
  async function advance(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  }

  afterEach(() => { vi.useRealTimers(); });

  it('after 8 s the band opens on Grade 1, and a late answer of Grade 9 does not take it away', async () => {
    const read = hangingClasses();
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = renderBand();
    await waitFor(() => expect(http.get).toHaveBeenCalledWith('/me/grade-subjects', { params: { feature: 'lessons' } }));
    expect(container.innerHTML).toBe('');
    await advance(4_000);
    expect(container.innerHTML).toBe('');
    await advance(4_100);
    const rows = await screen.findAllByRole('link');
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(['rh-en', 'rh-ur', 'num'].map((s) => `/portal/fln/list/${s}?grade=1`));
    expect(screen.getByRole('radio', { checked: true }).textContent).toBe(EN.grade(1));
    await act(async () => { read.land({ data: { success: true, combos: [pair(9)] } }); });
    await advance(100);
    expect(screen.getByText(EN.band.title)).toBeInTheDocument();
    expect(screen.getAllByRole('link').map((r) => r.getAttribute('href'))[0]).toBe('/portal/fln/list/rh-en?grade=1');
  });

  it('an answer inside the 8 s still decides: Grade 9 at 4 s → no band, and none after the deadline either', async () => {
    const read = hangingClasses();
    const f = stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = renderBand();
    await waitFor(() => expect(http.get).toHaveBeenCalledWith('/me/grade-subjects', { params: { feature: 'lessons' } }));
    await advance(4_000);
    await act(async () => { read.land({ data: { success: true, combos: [pair(9)] } }); });
    await advance(8_000);
    expect(container.innerHTML).toBe('');
    expect(f.mock.calls.filter(([u]) => String(u).includes('/catalogue'))).toHaveLength(0);
  });

  it('leaving the page before the deadline leaves no timer behind', async () => {
    hangingClasses();
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = renderBand();
    await waitFor(() => expect(http.get).toHaveBeenCalledWith('/me/grade-subjects', { params: { feature: 'lessons' } }));
    await advance(100);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
