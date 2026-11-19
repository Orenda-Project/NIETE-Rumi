import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * bd-snkn32.56 (queue #134 E) — "Start from a learning goal or topic", as a teacher walks it (same stubs as
 * OwnPage.test.tsx):
 *
 *   Given the goal switch is off   step 1 is today's, and a goal address goes back to the book pages
 *   Given it is on (grades 6–12)   step 1 offers it; her pick of a learning goal leads on to what the lesson is for
 *   And taps Make my plan          her goal goes with the lesson under it, and no textbook, no pages
 */

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../lib/recordingSession', () => ({ useRecordingSession: () => null }));
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const flag = vi.hoisted(() => ({ on: true, goal: true }));
vi.mock('../../../lib/useNewUi', async (orig) => ({
  ...(await orig<object>()),
  readConfigShared: () => Promise.resolve({ success: true, features: { lpMakeOwn: flag.on, lpOwnGoalStart: flag.goal } }),
}));

import api from '../../../services/api';
import { resetLessonPlans } from '../../../newui/lessons/lessonPlansApi';
import { LessonsPage } from '../LessonsPage';
import { OwnPage } from './OwnPage';
import { LESSONS_HOME } from '../paths';
import { LESSONS_OWN } from './state';
import { GOAL_COPY as G } from './goalCopy';

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
  flag.goal = true;
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
      '/curriculum/lps': { lessons: [
        { lesson_id: 'g4m1', lp_type: 'content', day_label: 'Day 1', topic: 'Counting', pages_label: 'p.2' },
        { lesson_id: 'g4m2', lp_type: 'content', day_label: 'Day 2', topic: 'Adding', pages_label: 'p.3' },
        { lesson_id: 'g4m990', lp_type: 'assessment', day_label: 'Worksheet', topic: 'Worksheet' },
      ] },
    };
    if (url === '/lp612/own/goals') return { data: { success: true, outcomes: [{ segmentId: 'sci8.c05.p040', text: 'Explain air pressure', chapter: 'Air' }] } };
    if (!(url in data)) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: data[url] };
  });
});



const pages = `${LESSONS_OWN}?grade=8&subject=Science&chapter=c02`;

describe('Make my own from a learning goal or topic', () => {
  it('off: step 1 is today\'s, and a goal address goes back to the book pages', async () => {
    flag.goal = false;
    at(pages);
    await screen.findByTestId('own-opt-sci8.c02.p010');
    expect(screen.queryByTestId('own-goal-start')).toBeNull();
    cleanup();
    at(`${pages}&step=goal&start=goal`);
    await waitFor(() => expect(where()).not.toContain('start=goal'));
  });

  it('on: step 1 offers it; a learning goal leads on to what the lesson is for', async () => {
    at(pages);
    fireEvent.click(await screen.findByTestId('own-goal-start'));
    await waitFor(() => expect(where()).toContain('step=goal'));
    expect(where()).toContain('start=goal');
    expect(screen.getByTestId('own-ok')).toBeDisabled();
    fireEvent.click(await screen.findByText('Explain air pressure'));
    await waitFor(() => expect(screen.getByTestId('own-ok')).not.toBeDisabled());
    expect(where()).toContain('seg=sci8.c05.p040');
    fireEvent.click(screen.getByTestId('own-ok'));
    await waitFor(() => expect(where()).toContain('step=purpose'));
  });

  it('Make my plan sends her goal with the lesson under it, and no textbook or pages', async () => {
    http.post.mockResolvedValue({ data: { success: true, renderId: 'own-9' } });
    at(`${pages}&step=check&start=goal&gk=outcome&gt=Explain%20air%20pressure&seg=sci8.c05.p040&size=up30&level=ahead&way=practical&res=board&purpose=new`);
    expect((await screen.findByTestId('own-check')).textContent).toContain(G.noBook);
    fireEvent.click(await screen.findByTestId('own-make'));
    await waitFor(() => expect(http.post).toHaveBeenCalled());
    const [url, body] = http.post.mock.calls[0];
    expect(url).toBe('/lp612/own');
    expect(body.segment_id).toBe('sci8.c05.p040');
    expect(body.answers.goal).toEqual({ kind: 'outcome', text: 'Explain air pressure' });
    expect(body.answers.resources).toEqual(['board']);
    expect(body.answers).not.toHaveProperty('pages');
  });
});
