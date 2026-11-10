import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * bd-snkn32.13 / .19 — "Make my own" at grades 9–12 (split out of OwnPage.test.tsx for the 300-line limit; same stubs):
 *
 *   Given Grade 10                 board exam practice is offered (and skips which-outcomes), suggesting past papers
 *   Given a lesson whose SLOs mix  which outcomes first comes right after what the lesson is for, and is sent
 *   Given a lesson that does not   what it is for goes straight to the class size
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
      '/curriculum/lps': { lessons: [
        { lesson_id: 'g4m1', lp_type: 'content', day_label: 'Day 1', topic: 'Counting', pages_label: 'p.2' },
        { lesson_id: 'g4m2', lp_type: 'content', day_label: 'Day 2', topic: 'Adding', pages_label: 'p.3' },
        { lesson_id: 'g4m990', lp_type: 'assessment', day_label: 'Worksheet', topic: 'Worksheet' },
      ] },
    };
    if (!(url in data)) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: data[url] };
  });
});


// bd-snkn32.13 — a Grade 9–12 lesson whose FBISE SLOs mix Summative and Formative asks which come first.
describe('Make my own, grades 9–12', () => {
  const mix = (mixed: boolean) => {
    const plain = http.get.getMockImplementation()!;
    http.get.mockImplementation(async (url: string, ...rest: unknown[]) => {
      if (url === '/lp612/grades') return { data: { grades: [{ grade: 8 }, { grade: 10 }] } };
      if (url.startsWith('/lp612/own/slo/')) {
        return { data: mixed ? { success: true, mixed: true, summative: ['C-10-A-01'], formative: ['C-10-A-02'] } : { success: true, mixed: false, summative: [], formative: [] } };
      }
      return plain(url, ...rest);
    });
  };
  const base = `${LESSONS_OWN}?grade=10&subject=Chemistry&chapter=c02&seg=sci8.c02.p014&size=up30&level=ahead`;

  it('board exam practice is offered, skips which-outcomes, and suggests past papers', async () => {
    mix(true);
    at(`${base}&step=purpose`);
    fireEvent.click(await screen.findByTestId('own-opt-board'));
    await waitFor(() => expect(where()).toContain('purpose=board'));
    expect(screen.getByTestId('own-opt-board').textContent).toBe(C.purposes.board);
    await waitFor(() => expect(http.get).toHaveBeenCalledWith('/lp612/own/slo/sci8.c02.p014'));
    await waitFor(() => expect(screen.getByTestId('own-ok')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('own-ok'));
    await waitFor(() => expect(where()).toContain('step=size'));
    at(`${base}&purpose=board&step=way`);
    expect((await screen.findByTestId('own-opt-past_paper')).textContent).toContain(C.suggested);
  });

  it('a mixed lesson: after what it is for, which outcomes first; the choice is sent', async () => {
    mix(true);
    http.post.mockResolvedValue({ data: { success: true, state: 'authoring', renderId: 'own-2' } });
    at(`${base}&way=numericals&step=purpose`);
    await screen.findByTestId('own-opt-new');
    await waitFor(() => expect(http.get).toHaveBeenCalledWith('/lp612/own/slo/sci8.c02.p014'));
    await waitFor(() => expect(screen.getByTestId('own-ok')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('own-ok'));
    const summative = await screen.findByTestId('own-opt-summative');
    expect(summative.textContent).toContain(C.foci.summative);
    expect(summative.textContent).toContain(C.focusCount(1));
    expect(screen.getByTestId('own-ok')).toBeDisabled();
    fireEvent.click(summative);
    await waitFor(() => expect(where()).toContain('focus=summative'));
    fireEvent.click(screen.getByTestId('own-ok'));
    await waitFor(() => expect(where()).toContain('step=size'));
    for (const step of ['size', 'level', 'resources', 'way']) {
      await waitFor(() => expect(where()).toContain(`step=${step}`));
      fireEvent.click(screen.getByTestId('own-ok'));
    }
    const make = await screen.findByTestId('own-make');
    expect(screen.getByText(C.foci.summative)).toBeTruthy();
    await waitFor(() => expect(make).not.toBeDisabled());
    fireEvent.click(make);
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/lp612/own', {
      segment_id: 'sci8.c02.p014',
      answers: { size: 'up30', resources: ['textbook'], level: 'ahead', way: 'numericals', note: '', purpose: 'new', focus: 'summative' },
    }));
  });

  it('a lesson that is not mixed goes from what it is for straight to the class size', async () => {
    mix(false);
    at(`${base}&step=purpose`);
    await screen.findByTestId('own-opt-new');
    await waitFor(() => expect(http.get).toHaveBeenCalledWith('/lp612/own/slo/sci8.c02.p014'));
    await waitFor(() => expect(screen.getByTestId('own-ok')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('own-ok'));
    await waitFor(() => expect(where()).toContain('step=size'));
    expect(where()).toContain('purpose=new');
  });
});
