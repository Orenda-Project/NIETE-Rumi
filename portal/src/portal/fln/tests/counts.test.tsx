import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';

vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../services/api';
import { FlnBand } from '../FlnBand';
import { FlnProvider } from '../FlnContext';
import { LessonList } from '../LessonList';
import { PlanScreen } from '../PlanPage';
import { flnStrings } from '../strings';
import { LEVELS, ME_TEACHER, numG2, rhEnG1, rhUrG1, stubFetch } from './listFixtures';
import { numEn } from './fixtures/plans';
import type { FlnCatalogue, FlnMe, FlnPlanResponse } from '../types';

/**
 * QT-counts (FLN R5 Q1): a level spans two grades whose placements differ. The band, the list and the plan kicker
 * must all read the placement of the grade the teacher is looking at — never the level's representative count and
 * never `placement[0]` when the plan was opened from another grade's list. `fetch` is the only thing stubbed.
 */

const EN = flnStrings('en');
const UR = flnStrings('ur');
const http = api as unknown as { get: ReturnType<typeof vi.fn> };

function combos(grades: number[]) {
  http.get.mockImplementation(async (url: string) => {
    if (url === '/me/grade-subjects') {
      return { data: { success: true, combos: grades.map((g) => ({ grade: g, gradeCode: `grade_${g}`, subject: 'English', subjectKey: 'english', source: 'class', featureKey: 'English', available: true })) } };
    }
    throw Object.assign(new Error('404'), { response: { status: 404 } });
  });
}

/** Level 2's representative count is G3's (72 EN, 63 UR); grade 2's own rows say 70 / 59. */
const L2_LEVELS = LEVELS.map((l) => (l.level === 2 ? { ...l, count: 72 } : l));
function withRowCount(cat: FlnCatalogue, count: number, levels = L2_LEVELS): FlnCatalogue {
  return {
    ...cat,
    levels,
    strands: cat.strands.map((b) => ({ ...b, chapters: b.chapters.map((c) => ({ ...c, plans: c.plans.map((r) => ({ ...r, count })) })) })),
  };
}
function g2Catalogue(url: URL) {
  const subject = url.searchParams.get('subject');
  const grade = Number(url.searchParams.get('grade'));
  if (subject === 'rh-ur') return { status: 200, body: { ...withRowCount(rhUrG1(), 59, LEVELS.map((l) => (l.level === 2 ? { ...l, count: 63 } : l))), grade, level: 2 } };
  if (subject === 'num') return { status: 200, body: { ...withRowCount(numG2(), 34), grade, level: 2 } };
  return { status: 200, body: { ...withRowCount(rhEnG1(), 70), grade, level: 2 } };
}

beforeEach(async () => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  try { window.sessionStorage.clear(); } catch { /* none */ }
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('en'); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('band: the count is the grade’s own rows, as the list shows it', () => {
  it('Grade 2, level 2 (rows 70, level count 72) → "70 lessons · Level 2"', async () => {
    combos([2]);
    stubFetch({ '/me': { status: 200, body: ME_TEACHER }, '/catalogue': g2Catalogue });
    render(<MemoryRouter><FlnBand /></MemoryRouter>);
    const rows = await screen.findAllByRole('link');
    expect(rows[0].getAttribute('href')).toBe('/portal/fln/list/rh-en?grade=2');
    expect(within(rows[0]).getByText(EN.bandRow(70, 2))).toBeInTheDocument();
    expect(within(rows[0]).queryByText(EN.bandRow(72, 2))).toBeNull();
    expect(within(rows[2]).getByText(EN.bandRow(34, 2))).toBeInTheDocument();
  });

  it('Urdu page, Grade 2 → Urdu row shows ۵۹ (its rows), never ۶۳', async () => {
    combos([2]);
    await act(async () => { await i18n.changeLanguage('ur'); });
    stubFetch({ '/me': { status: 200, body: { ...ME_TEACHER, ui_lang: 'ur' } }, '/catalogue': g2Catalogue });
    render(<MemoryRouter><FlnBand /></MemoryRouter>);
    const rows = await screen.findAllByRole('link');
    expect(within(rows[1]).getByText(UR.bandRow(59, 2))).toBeInTheDocument();
    expect(UR.bandRow(59, 2)).toContain('۵۹');
    expect(rows[1].textContent).not.toContain('۶۳');
  });
});

/** Plan 10552 sits at pos 25 in grade 2's numeracy list and pos 24 in grade 3's. */
const planTwoGrades: FlnPlanResponse = {
  plan: { ...numEn.plan, id: 10552 },
  placement: [
    { ...numEn.placement[0], grade: 2, pos: 25, count: 35 },
    { ...numEn.placement[0], grade: 3, pos: 24, count: 35 },
  ],
};
function numG3(): FlnCatalogue {
  return {
    subject: { key: 'num', lang: 'en', dir: 'ltr' },
    grade: 3,
    level: 2,
    levels: LEVELS,
    strands: [{ strand: 'daily', chapters: [{ chapter_no: 1, title_en: 'Numbers', title_ur: 'اعداد', plans: [
      { id: 10552, title: 'Synthetic lesson 10552', lang: 'en', dir: 'ltr', minutes: 45, chips: {}, opened: false, pos: 24, count: 35, label: null },
    ] }] }],
  };
}

function renderApp(entry: string, me: FlnMe = ME_TEACHER) {
  stubFetch({
    '/catalogue': { status: 200, body: numG3() },
    '/plan/': { status: 200, body: planTwoGrades },
    '/events': { status: 204 },
  });
  combos([]);
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <FlnProvider me={me}>
        <Routes>
          <Route path="/portal/fln/list/:subject" element={<LessonList subject="num" grade={3} level={null} />} />
          <Route path="/portal/fln/p/:id" element={<PlanScreen me={me} lang="en" />} />
        </Routes>
      </FlnProvider>
    </MemoryRouter>,
  );
}
const kicker = () => [...document.querySelectorAll('.fln-kicker')].map((e) => e.textContent);

describe('plan kicker: the placement of the grade the plan was opened from', () => {
  it('opened from /portal/fln/list/num?grade=3, row 24 → "Lesson 24/35", not grade 2’s 25/35', async () => {
    const { container } = renderApp('/portal/fln/list/num?grade=3');
    await screen.findByText('Synthetic lesson 10552');
    const row = container.querySelector('[data-fln-row="10552"]') as HTMLAnchorElement;
    expect(row.getAttribute('href')).toBe('/portal/fln/p/10552?grade=3');
    fireEvent.click(row);
    await screen.findByText(numEn.plan.title);
    expect(kicker()).toEqual(['Numeracy', 'Level 2 · Lesson 24/35']);
  });

  it('without ?grade= → unchanged: placement[0]', async () => {
    renderApp('/portal/fln/p/10552');
    await screen.findByText(numEn.plan.title);
    expect(kicker()).toEqual(['Numeracy', 'Level 2 · Lesson 25/35']);
  });

  it('a ?grade= no placement row matches → placement[0]', async () => {
    renderApp('/portal/fln/p/10552?grade=7');
    await screen.findByText(numEn.plan.title);
    expect(kicker()).toEqual(['Numeracy', 'Level 2 · Lesson 25/35']);
  });

  it('the share sheet on that page shows the same lesson number as the kicker', async () => {
    const coach: FlnMe = { ...ME_TEACHER, share: true, role: 'coach' };
    renderApp('/portal/fln/p/10552?grade=3', coach);
    await screen.findByText(numEn.plan.title);
    fireEvent.click(within(screen.getByTestId('fln-share-bar')).getAllByRole('button')[1]);
    const text = document.body.textContent || '';
    expect(text).toContain('24/35');
    expect(text).not.toContain('25/35');
  });
});
