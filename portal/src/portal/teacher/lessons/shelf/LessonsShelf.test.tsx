import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-snkn32.42 — the chapter page with "Made by a teacher" (BDD over the real page; the network stubbed):
 *
 *   Given the shelf flag is off   the chapter page is today's, and the shelf is never asked for
 *   Given it is on                approved plans for this chapter's lessons follow the ready plans
 *   Given the check page          it is registered under Lesson Plans
 */
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../lib/recordingSession', () => ({ useRecordingSession: () => null }));
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const flag = vi.hoisted(() => ({ on: true }));
vi.mock('../../../lib/useNewUi', async (orig) => ({
  ...(await orig<object>()),
  readConfigShared: () => Promise.resolve({ success: true, features: { lpOwnShelf: flag.on } }),
}));

import api from '../../../services/api';
import { resetLessonPlans } from '../../../newui/lessons/lessonPlansApi';
import { LessonsPage } from '../LessonsPage';
import routes from '../routes';
import { lessonsUrl, LESSONS_HOME } from '../paths';
import { LESSONS_CHECK } from './ReviewPage';
import { SHELF_COPY as C } from './copy';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const show = () => render(
  <MemoryRouter initialEntries={[lessonsUrl('lessons', { grade: 4, subject: 'math', chapter: '1' })]}>
    <Routes><Route path={`${LESSONS_HOME}/lessons`} element={<LessonsPage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  resetLessonPlans();
  flag.on = true;
  http.get.mockImplementation(async (url: string) => {
    const data: Record<string, unknown> = {
      '/curriculum/grades': { grades: [{ grade: 4, subject_count: 1 }] },
      '/lp612/grades': { grades: [{ grade: 8 }] },
      '/curriculum/subjects': { subjects: [{ subject_key: 'math', subject: 'Math', lesson_count: 1 }] },
      '/curriculum/chapters': { chapters: [{ chapter_number: 1, chapter_title: 'Numbers', lesson_count: 1 }] },
      '/curriculum/lps': { lessons: [{ lesson_id: 'g4m1', lp_type: 'content', day_label: 'Day 1', topic: 'Counting', pages_label: 'p.2' }] },
      '/lp612/shelf': { plans: [{ ownId: 'o1', lesson: 'g4m1', band: 'k5', lang: 'en' }] },
    };
    if (!(url in data)) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: data[url] };
  });
});

describe('Made by a teacher on the chapter page', () => {
  it('flag off: today’s page, the shelf never asked for', async () => {
    flag.on = false;
    show();
    await screen.findByText('Counting');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('own-shelf')).toBeNull();
    expect(http.get.mock.calls.some(([u]) => u === '/lp612/shelf')).toBe(false);
  });

  it('flag on: the shelf follows the ready plans', async () => {
    show();
    const shelf = await screen.findByTestId('own-shelf');
    expect(shelf.textContent).toContain(C.shelfTitle);
    const ready = screen.getAllByText('Counting')[0];
    expect(ready.compareDocumentPosition(shelf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the check page is a Lesson Plans route', () => {
    expect(routes.some((r) => r.path === LESSONS_CHECK)).toBe(true);
  });
});
