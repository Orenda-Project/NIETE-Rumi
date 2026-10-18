import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';

vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../services/api';
import { FlnBand } from '../FlnBand';
import { flnStrings } from '../strings';
import { LEVELS, ME_TEACHER, numG2, rhEnG1, rhEnG8, rhUrG1, stubFetch } from './listFixtures';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// vitest runs with css:false (a `?raw` import comes back empty), so read the stylesheet from disk.
const css = readFileSync(resolve(__dirname, '../fln.css'), 'utf8');

/**
 * bd-t7zk3t.11 — the Reading Hour & Numeracy band on the New-lesson page (DESIGN v2 §0, §2 S2, §7).
 * Network boundary only: `fetch` for /api/portal/fln/*, the axios client for /me/grade-subjects.
 */

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const EN = flnStrings('en');
const UR = flnStrings('ur');

function combos(grades: number[]) {
  http.get.mockImplementation(async (url: string) => {
    if (url === '/me/grade-subjects') {
      return { data: { success: true, combos: grades.map((g) => ({ grade: g, gradeCode: `grade_${g}`, subject: 'English', subjectKey: 'english', source: 'class', featureKey: 'English', available: true })) } };
    }
    throw Object.assign(new Error('404'), { response: { status: 404 } });
  });
}

function catalogueFor(url: URL) {
  const grade = Number(url.searchParams.get('grade'));
  const subject = url.searchParams.get('subject');
  if (grade >= 6) return { status: 200, body: { ...rhEnG8(), grade, subject: { key: subject, lang: 'en', dir: 'ltr' } } };
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
    expect(within(rows[0]).getByText(EN.bandRow(LEVELS[1].count, 2))).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(12);
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radios[4]);
    await waitFor(() => expect(screen.getAllByRole('link')[0].getAttribute('href')).toBe('/portal/fln/list/rh-en?grade=5'));
    expect(f.mock.calls.some(([u]) => String(u).includes('grade=5'))).toBe(true);
  });

  it('grade 8 → the sub-line is subSenior on every row (never minutes)', async () => {
    combos([8]);
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': catalogueFor });
    renderBand();
    const rows = await screen.findAllByRole('link');
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(within(r).getByText(EN.band.subSenior)).toBeInTheDocument();
      expect(r.textContent).not.toMatch(/min/);
    }
    expect(rows[0].getAttribute('href')).toBe('/portal/fln/list/rh-en?grade=8');
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
