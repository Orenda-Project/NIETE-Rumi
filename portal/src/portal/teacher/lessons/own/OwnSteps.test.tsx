import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * bd-snkn32.51 (queue #134 A) — every "Make my own" question screen tells the funnel she is on it (screen, grade,
 * subject code, band), and leaving the form closes it. #120: 46% who open the form leave it, and nothing said where.
 */
const funnel = vi.hoisted(() => ({ step: vi.fn(), stepEnd: vi.fn() }));
vi.mock('../../../lib/appFunnel', async (orig) => ({ ...(await orig<object>()), getAppFunnel: () => funnel }));
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
import { OwnPage } from './OwnPage';
import { LESSONS_HOME } from '../paths';
import { LESSONS_OWN } from './state';

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

function at(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
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


const own = (q: string) => `${LESSONS_OWN}?${q}`;
void LESSONS_HOME;

describe('each form screen is reported', () => {
  it('grades 6-12: the screen she lands on, with grade, subject code and band', async () => {
    at(own('grade=8&subject=Science&chapter=c02&seg=sci8.c02.p010&step=size'));
    await waitFor(() => expect(funnel.step).toHaveBeenCalledWith({ step: 'size', grade: 8, subject: 'science', band: 'g612' }));
  });

  it('grades 1-5 is band k5; OK moves on and the next screen is reported', async () => {
    at(own('grade=4&subject=math&chapter=1&seg=g4m1&step=level'));
    await waitFor(() => expect(funnel.step).toHaveBeenCalledWith({ step: 'level', grade: 4, subject: 'math', band: 'k5' }));
    fireEvent.click(await screen.findByText(/Mixed|ملی/));
    await waitFor(() => expect(where()).toContain('level=mixed'));
    fireEvent.click(screen.getByTestId('own-ok'));
    await waitFor(() => expect(funnel.step).toHaveBeenCalledWith(expect.objectContaining({ step: 'resources', band: 'k5' })));
  });

  it('leaving the form closes the open screen', async () => {
    const r = at(own('grade=8&subject=Science&chapter=c02&step=pages'));
    await waitFor(() => expect(funnel.step).toHaveBeenCalled());
    r.unmount();
    expect(funnel.stepEnd).toHaveBeenCalled();
  });
});
