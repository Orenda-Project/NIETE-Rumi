import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-snkn32.25 — "Make my own" from the Lesson Plans main page (tester, 12 Nov: show it as its own option, not only
 * inside a chapter):
 *
 *   Given Make my own is on, for a teacher   the main page has a Make my own card → grade and subject, in own mode
 *   Given it is off, or she is a leader      no card
 *   In own mode                              her class goes to its chapters in own mode; a chapter goes straight
 *                                            into the Make my own steps for that grade, subject and chapter
 *   The chapter page's own card stays (OwnRow, unchanged).
 */

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../lib/recordingSession', () => ({ useRecordingSession: () => null }));
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const who = vi.hoisted(() => ({ on: true as boolean | null, leader: false }));
vi.mock('./flag', () => ({ useLpMakeOwn: () => who.on }));
vi.mock('../audience', () => ({ useLessonsLeader: () => who.leader }));

import api from '../../../services/api';
import { resetLessonPlans } from '../../../newui/lessons/lessonPlansApi';
import { OwnHomeCard } from './OwnHomeCard';
import { NewLessonPage } from '../NewLessonPage';
import { ChaptersPage } from '../ChaptersPage';
import { LESSONS_NEW, lessonsUrl } from '../paths';
import { LESSONS_V2_COPY as L } from '../copy';
import { OWN_COPY as C } from './copy';
import { OWN_PICK, OWN_START, ownUrl } from './state';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const answers: Record<string, () => unknown> = {
  '/me/grade-subjects': () => ({ success: true, combos: [
    { grade: 4, gradeCode: 'grade_4', subject: 'Mathematics', subjectKey: 'maths', source: 'class', featureKey: 'math', available: true },
  ] }),
  '/curriculum/grades': () => ({ grades: [{ grade: 4, subject_count: 1 }] }),
  '/lp612/grades': () => ({ grades: [] }),
  '/curriculum/subjects': () => ({ subjects: [{ subject_key: 'math', subject: 'Math', lesson_count: 80 }] }),
  '/curriculum/chapters': () => ({ chapters: [{ chapter_number: 3, chapter_title: 'Shapes', pages_label: 'p.20-30', lesson_count: 5 }] }),
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetLessonPlans();
  who.on = true;
  who.leader = false;
  http.get.mockImplementation(async (url: string) => {
    const hit = answers[url];
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: hit() };
  });
});

const at = (path: string, el: React.ReactElement) => {
  const [pathname, search] = path.split('?');
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : '' }]}>
      <Routes><Route path={pathname} element={el} /><Route path="*" element={null} /></Routes>
    </MemoryRouter>,
  );
};

describe('the Make my own card on the main page', () => {
  it('for a teacher with Make my own on: one card to grade and subject, in own mode', () => {
    expect(OWN_START).toBe(`${LESSONS_NEW}?pick=${OWN_PICK}`);
    render(<MemoryRouter><OwnHomeCard /></MemoryRouter>);
    const card = screen.getByRole('link', { name: new RegExp(C.makeMyOwn) });
    expect(card.getAttribute('href')).toBe(OWN_START);
  });

  it('nothing while off, unknown, or for a leader', () => {
    for (const s of [{ on: false, leader: false }, { on: null, leader: false }, { on: true, leader: true }]) {
      cleanup();
      Object.assign(who, s);
      render(<MemoryRouter><OwnHomeCard /></MemoryRouter>);
      expect(screen.queryByTestId('own-home')).toBeNull();
    }
  });
});

describe('own mode: grade and subject, then chapter, then the steps', () => {
  it('her class goes to its chapters in own mode, titled Make my own', async () => {
    at(OWN_START, <NewLessonPage />);
    expect(screen.getAllByText(C.makeMyOwn).length).toBeGreaterThan(0);
    await waitFor(() => expect(http.get).toHaveBeenCalledWith('/me/grade-subjects', { params: { feature: 'lessons' } }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(L.selectGradeSubject) }));
    const sheet = screen.getByRole('dialog', { name: L.selectGradeSubject });
    fireEvent.click(await within(sheet).findByRole('radio', { name: /^Grade 4 · Your class/ }));
    const maths = within(sheet).getByRole('link', { name: /Grade 4 · Mathematics · Your class/ });
    expect(maths.getAttribute('href')).toBe(lessonsUrl('chapters', { grade: 4, subject: 'math', key: 'maths', pick: OWN_PICK }));
  });

  it('a chapter goes straight into the Make my own steps', async () => {
    at(lessonsUrl('chapters', { grade: 4, subject: 'math', pick: OWN_PICK }), <ChaptersPage />);
    const row = await screen.findByRole('link', { name: /Shapes/ });
    expect(row.getAttribute('href')).toBe(ownUrl({ grade: 4, subject: 'math', chapter: '3' }));
  });

  it('without own mode the chapter still goes to its lessons (unchanged)', async () => {
    at(lessonsUrl('chapters', { grade: 4, subject: 'math' }), <ChaptersPage />);
    const row = await screen.findByRole('link', { name: /Shapes/ });
    expect(row.getAttribute('href')).toBe(lessonsUrl('lessons', { grade: 4, subject: 'math', chapter: '3' }));
  });
});
