import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * bd-snkn32.59.1 (queue #165) — Make my own → A whole unit, the screens (mockups 2, 4–8).
 *
 *   Unit switch on       Make my own's first screen has a third card, "A whole unit", which picks her class first
 *   Unit switch off      no card, and the unit pages send her back (today's screens unchanged)
 *   Chapters + pace      tap first and last chapter; her period; the paces with the server's day counts; See the days
 *                        saves the unit and opens it
 *   Her days             ⋯ → join with next day; Undo; Save unit sends the changed days
 *   Opening a day        a review day opens the book's own day (no make); a lesson day needs her class, then is made
 */

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../lib/recordingSession', () => ({ useRecordingSession: () => null }));
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
const flag = vi.hoisted(() => ({ goal: false, unit: true }));
vi.mock('./flag', () => ({ useLpMakeOwn: () => true }));
vi.mock('../audience', () => ({ useLessonsLeader: () => false }));
vi.mock('./goalApi', async (orig) => ({ ...(await orig<object>()), useLpOwnGoalStart: () => flag.goal }));
vi.mock('./unitApi', async (orig) => ({ ...(await orig<object>()), useLpOwnUnit: () => flag.unit }));

import api from '../../../services/api';
import { resetLessonPlans } from '../../../newui/lessons/lessonPlansApi';
import { NewLessonPage } from '../NewLessonPage';
import { LESSONS_V2_COPY as L } from '../copy';
import { OWN_START } from './state';
import { UNIT_COPY as U } from './unitCopy';
import { LESSONS_UNIT, LESSONS_UNIT_NEW, OWN_UNIT, unitNewUrl, unitUrl } from './unitPaths';
import { UnitNewPage } from './UnitNewPage';
import { UnitPage } from './UnitPage';

const http = api as unknown as Record<'get' | 'post' | 'put', ReturnType<typeof vi.fn>>;
const ID = '11111111-2222-4333-8444-555555555555';
const day = (n: number, kind: string, ids: string[], topic: string, plan: unknown = null) => ({ day: n, kind, chapter: 2, lesson_ids: ids, topic, plan });
const UNIT = {
  id: ID, grade: 3, subject: 'math', book_stem: 'g3_math', chapter_from: 2, chapter_to: 2, period_minutes: 35, pace: 'recommended', status: 'active', next: 1,
  days: [day(1, 'lesson', ['a'], 'Adding'), day(2, 'lesson', ['b'], 'Estimating'), day(3, 'review', ['r'], 'Review'), day(4, 'test', ['t'], 'Test')],
};
const answers: Record<string, (p?: unknown) => unknown> = {
  '/me/grade-subjects': () => ({ success: true, combos: [
    { grade: 3, gradeCode: 'grade_3', subject: 'Mathematics', subjectKey: 'maths', source: 'class', featureKey: 'math', available: true },
  ] }),
  '/curriculum/grades': () => ({ grades: [{ grade: 3, subject_count: 1 }] }),
  '/lp612/grades': () => ({ grades: [] }),
  '/curriculum/subjects': () => ({ subjects: [{ subject_key: 'math', subject: 'Math', lesson_count: 80 }] }),
  '/lp/own/units': () => ({ success: true, units: [] }),
  '/lp/own/unit/chapters': () => ({ success: true, book: 'g3_math', period: 35, chapters: [
    { number: 1, title: 'Number Ninjas', days: 10 }, { number: 2, title: 'Plus and Minus', days: 11 }, { number: 3, title: 'Multiplication', days: 10 },
  ] }),
  '/lp/own/unit/paces': () => ({ success: true, counts: { recommended: 21, slower: 25, faster: 17 } }),
  [`/lp/own/units/${ID}`]: () => ({ success: true, unit: UNIT }),
};

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

const at = (path: string) => {
  const [pathname, search] = path.split('?');
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : '' }]}>
      <Routes>
        <Route path={pathname === OWN_START.split('?')[0] ? pathname : '/x'} element={<NewLessonPage />} />
        <Route path={LESSONS_UNIT_NEW} element={<UnitNewPage />} />
        <Route path={LESSONS_UNIT} element={<UnitPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
};
const where = () => screen.getByTestId('where').textContent ?? '';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetLessonPlans();
  try { window.localStorage.clear(); } catch { /* none */ }
  flag.goal = false;
  flag.unit = true;
  http.get.mockImplementation(async (url: string) => {
    const hit = answers[url];
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: hit() };
  });
});

describe('the third card', () => {
  it('switch on: "A whole unit" beside the book card, to her class first', () => {
    at(OWN_START);
    expect(screen.getByRole('link', { name: new RegExp(U.wholeUnit) }).getAttribute('href')).toBe(OWN_UNIT);
  });

  it('switch off: no card, today\'s class picker', async () => {
    flag.unit = false;
    at(OWN_START);
    expect(await screen.findByRole('button', { name: new RegExp(L.selectGradeSubject) })).toBeTruthy();
    expect(screen.queryByRole('link', { name: new RegExp(U.wholeUnit) })).toBeNull();
  });

  it('her class → the unit\'s chapters', async () => {
    at(OWN_UNIT);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(L.selectGradeSubject) }));
    const sheet = screen.getByRole('dialog', { name: L.selectGradeSubject });
    fireEvent.click(await within(sheet).findByRole('radio', { name: /^Grade 3 · Your class/ }));
    expect(within(sheet).getByRole('link', { name: /Grade 3 · Mathematics · Your class/ }).getAttribute('href')).toBe(unitNewUrl({ grade: 3, subject: 'math' }));
  });

  it('switch off: the unit pages send her back', async () => {
    flag.unit = false;
    at(unitUrl(ID));
    await waitFor(() => expect(where()).toBe(OWN_UNIT));
  });
});

describe('chapters, period and pace', () => {
  it('first and last chapter, her saved period, the paces with their days, then the unit is saved and opened', async () => {
    http.post.mockResolvedValue({ data: { success: true, unit: UNIT } });
    at(unitNewUrl({ grade: 3, subject: 'math' }));
    fireEvent.click(await screen.findByTestId('unit-ch-2'));
    fireEvent.click(screen.getByTestId('unit-ch-3'));
    await waitFor(() => expect(screen.getByTestId('unit-paces').textContent).toContain('Recommended · 21 days'));
    expect(screen.getByTestId('unit-paces').textContent).toContain('Slower · 25 days');
    expect(http.get).toHaveBeenCalledWith('/lp/own/unit/paces', { params: { grade: 3, subject: 'math', from: 2, to: 3, period: 35 } });
    fireEvent.click(screen.getByTestId('unit-see-days'));
    await waitFor(() => expect(where()).toBe(unitUrl(ID)));
    expect(http.post).toHaveBeenCalledWith('/lp/own/units', { grade: 3, subject: 'math', from: 2, to: 3, period: 35, pace: 'recommended' });
  });
});

describe('her days', () => {
  it('join with next day, undo, join again, save sends the changed days', async () => {
    http.put.mockImplementation(async (_u: string, b: { outline: unknown[] }) => ({ data: { success: true, unit: { ...UNIT, days: b.outline.map((d, i) => ({ ...(d as object), day: i + 1, plan: null })) } } }));
    at(unitUrl(ID));
    expect((await screen.findByTestId('unit-summary')).textContent).toBe('4 days · 35 min · Recommended');
    fireEvent.click(screen.getByTestId('unit-more-1'));
    fireEvent.click(screen.getByTestId('unit-menu-join'));
    expect(screen.getByTestId('unit-summary').textContent).toBe('3 days · 35 min · Recommended');
    fireEvent.click(screen.getByTestId('unit-undo'));
    expect(screen.getByTestId('unit-summary').textContent).toBe('4 days · 35 min · Recommended');
    fireEvent.click(screen.getByTestId('unit-more-1'));
    fireEvent.click(screen.getByTestId('unit-menu-join'));
    fireEvent.click(screen.getByTestId('unit-save'));
    await waitFor(() => expect(http.put).toHaveBeenCalled());
    const sent = http.put.mock.calls[0][1].outline;
    expect(sent[0]).toEqual({ kind: 'lesson', chapter: 2, lesson_ids: ['a', 'b'], topic: 'Adding + Estimating' });
    expect(await screen.findByTestId('unit-note')).toHaveProperty('textContent', U.saved);
  });

  it('no ⋯ on the test day', async () => {
    at(unitUrl(ID));
    await screen.findByTestId('unit-day-4');
    expect(screen.queryByTestId('unit-more-4')).toBeNull();
  });
});

describe('opening a day', () => {
  it('a review day opens the book\'s own day: no make', async () => {
    http.post.mockResolvedValue({ data: { success: true, outcome: 'book', lessonId: 'r' } });
    at(unitUrl(ID));
    fireEvent.click(await screen.findByTestId('unit-open-3'));
    await waitFor(() => expect(where()).toContain('plan=k5%3Ar'));
  });

  it('a lesson day asks for her class first, then is made once with the unit\'s answers', async () => {
    http.post.mockResolvedValue({ status: 202, data: { success: true, state: 'authoring', renderId: 'own-9' } });
    at(unitUrl(ID));
    fireEvent.click(await screen.findByTestId('unit-open-2'));
    expect(http.post).not.toHaveBeenCalled();
    expect(screen.getByTestId('unit-note').textContent).toBe(U.yourClass);
    const cls = screen.getByTestId('unit-class');
    fireEvent.click(within(cls).getByRole('radio', { name: '31 – 50' }));
    fireEvent.click(within(cls).getByRole('radio', { name: 'Mixed' }));
    fireEvent.click(screen.getByTestId('unit-open-2'));
    await waitFor(() => expect(http.post).toHaveBeenCalledTimes(1));
    expect(http.post).toHaveBeenCalledWith(`/lp/own/units/${ID}/days/2/open`, { answers: { size: '31_50', level: 'mixed', way: 'tarl', resources: ['textbook'], note: '' } });
    await waitFor(() => expect(where()).toContain('render=own-9'));
  });
});
