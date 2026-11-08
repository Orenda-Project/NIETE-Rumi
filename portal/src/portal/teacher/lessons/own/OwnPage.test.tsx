import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * bd-snkn32 — "Make my own" as a teacher walks it (BDD over the real pages; the network stubbed):
 *
 *   Given the flag is off       the chapter page is today's: no "Make my own", and its address sends her back
 *   Given the flag is on        a grades 6–12 chapter shows the row; a grades 1–5 chapter does not
 *   When she answers the five   OK moves her on, each answer in the address; the teaching way is suggested first
 *   And taps Make my plan       her codes go to POST /lp612/own and the Preparing page opens on her fork's id
 *   But it cannot be started    she sees "Couldn't make it" and stays on the check screen
 */

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../lib/recordingSession', () => ({ useRecordingSession: () => null }));
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const flag = vi.hoisted(() => ({ on: true }));
vi.mock('../../../lib/useNewUi', async (orig) => ({
  ...(await orig<object>()),
  readConfigShared: () => Promise.resolve({ success: true, features: { lpMakeOwn: flag.on } }),
}));

import api from '../../../services/api';
import { resetLessonPlans } from '../../../newui/lessons/lessonPlansApi';
import { LessonsPage } from '../LessonsPage';
import { OwnPage } from './OwnPage';
import { lessonsUrl, LESSONS_HOME } from '../paths';
import { LESSONS_OWN } from './state';
import { OWN_COPY as C } from './copy';

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

function at(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={`${LESSONS_HOME}/lessons`} element={<LessonsPage />} />
        <Route path={LESSONS_OWN} element={<OwnPage />} />
        <Route path="*" element={<div />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId('where').textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  resetLessonPlans();
  flag.on = true;
  try { localStorage.clear(); } catch { /* none */ }
  http.get.mockImplementation(async (url: string) => {
    const data: Record<string, unknown> = {
      '/curriculum/grades': { grades: [{ grade: 4, subject_count: 1 }] },
      '/lp612/grades': { grades: [{ grade: 8 }] },
      '/lp612/subjects': { subjects: [{ subject: 'Science', lesson_count: 2 }] },
      '/curriculum/subjects': { subjects: [{ subject_key: 'math', subject: 'Math', lesson_count: 1 }] },
      '/lp612/chapters': { chapters: [{ chapter_key: 'c02', chapter_number: 2, chapter_title: 'Motion', lesson_count: 2 }] },
      '/curriculum/chapters': { chapters: [{ chapter_number: 1, chapter_title: 'Numbers', lesson_count: 1 }] },
      '/lp612/lessons': { lessons: [
        { segment_id: 'sci8.c02.p010', title: 'Speed', pages_label: 'p.10–13', sent: false },
        { segment_id: 'sci8.c02.p014', title: 'Distance', pages_label: 'p.14–16', sent: false },
      ] },
      '/curriculum/lps': { lessons: [{ lesson_id: 'g4m1', lp_type: 'content', day_label: 'Day 1', topic: 'Counting', pages_label: 'p.2' }] },
    };
    if (!(url in data)) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: data[url] };
  });
});

describe('the chapter page', () => {
  it('flag off: no Make my own, the ready plans as today', async () => {
    flag.on = false;
    at(lessonsUrl('lessons', { grade: 8, subject: 'Science', chapter: 'c02' }));
    await screen.findByText('Speed');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('own-entry')).toBeNull();
  });

  it('flag on, grades 6–12: one more row under the ready plans, into step 1', async () => {
    at(lessonsUrl('lessons', { grade: 8, subject: 'Science', chapter: 'c02' }));
    const row = await screen.findByTestId('own-entry-row');
    expect(row.textContent).toContain(C.makeMyOwn);
    expect(row.getAttribute('href')).toBe(`${LESSONS_OWN}?grade=8&subject=Science&chapter=c02`);
  });

  it('flag on, grades 1–5: no row (nothing to rewrite from)', async () => {
    at(lessonsUrl('lessons', { grade: 4, subject: 'math', chapter: '1' }));
    await screen.findByText('Counting');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('own-entry')).toBeNull();
  });
});

describe('Make my own', () => {
  it('flag off: its address sends her back to the chapter', async () => {
    flag.on = false;
    at(`${LESSONS_OWN}?grade=8&subject=Science&chapter=c02`);
    await waitFor(() => expect(where()).toContain('/lessons/lessons?'));
  });

  it('walks the five questions, then Make my plan opens Preparing on her fork', async () => {
    http.post.mockResolvedValue({ data: { success: true, state: 'authoring', renderId: 'own-1' } });
    at(`${LESSONS_OWN}?grade=8&subject=Science&chapter=c02`);

    const ok = () => screen.getByTestId('own-ok');
    await screen.findByTestId('own-opt-sci8.c02.p014');
    expect(ok()).toBeDisabled();
    fireEvent.click(screen.getByTestId('own-opt-sci8.c02.p014'));
    await waitFor(() => expect(where()).toContain('seg=sci8.c02.p014'));
    fireEvent.click(ok());

    await screen.findByTestId('own-opt-51_70');
    fireEvent.click(screen.getByTestId('own-opt-51_70'));
    await waitFor(() => expect(where()).toContain('size=51_70'));
    fireEvent.click(ok());

    await screen.findByTestId('own-opt-objects');
    fireEvent.click(screen.getByTestId('own-opt-textbook'));   // always there: a tap changes nothing
    fireEvent.click(screen.getByTestId('own-opt-board'));
    await waitFor(() => expect(where()).toContain('res=board'));
    expect(where()).not.toContain('textbook');
    fireEvent.click(ok());

    await screen.findByTestId('own-opt-mixed');
    fireEvent.click(screen.getByTestId('own-opt-mixed'));
    await waitFor(() => expect(where()).toContain('level=mixed'));
    fireEvent.click(ok());

    // Mixed → teach at each child's level, suggested and first; Science offers no CPA or phonics.
    const first = await screen.findByTestId('own-opt-tarl');
    expect(first.textContent).toContain(C.suggested);
    expect(screen.queryByTestId('own-opt-cpa')).toBeNull();
    expect(screen.queryByTestId('own-opt-phonics')).toBeNull();
    fireEvent.click(ok());   // keeps the suggestion

    await screen.findByTestId('own-make');
    expect(where()).toContain('way=tarl');
    fireEvent.change(screen.getByTestId('own-note'), { target: { value: 'Two grades in one room' } });
    fireEvent.click(screen.getByTestId('own-make'));

    await waitFor(() => expect(where()).toContain('/lessons/preparing?'));
    expect(http.post).toHaveBeenCalledWith('/lp612/own', {
      segment_id: 'sci8.c02.p014',
      answers: { size: '51_70', resources: ['textbook', 'board'], level: 'mixed', way: 'tarl', note: 'Two grades in one room' },
    });
    expect(where()).toContain('render=own-1');
    expect(where()).toContain('lesson=sci8.c02.p014');
  });

  it('remembers children in class on this phone', async () => {
    localStorage.setItem('lp-own-size', '31_50');
    at(`${LESSONS_OWN}?grade=8&subject=Science&chapter=c02&step=size&seg=sci8.c02.p010`);
    const row = await screen.findByTestId('own-opt-31_50');
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('own-ok')).not.toBeDisabled();
  });

  it('a plan that cannot be started: "Couldn\'t make it", and she stays to try again', async () => {
    http.post.mockRejectedValue(Object.assign(new Error('502'), { response: { status: 502 } }));
    at(`${LESSONS_OWN}?grade=8&subject=Science&chapter=c02&step=check&seg=sci8.c02.p010&size=up30&level=ahead&way=games`);
    fireEvent.click(await screen.findByTestId('own-make'));
    expect(await screen.findByRole('alert')).toHaveTextContent(C.couldNotMake);
    expect(where()).toContain(LESSONS_OWN);
    expect(screen.getByTestId('own-make')).toHaveTextContent(C.tryAgain);
  });
});
