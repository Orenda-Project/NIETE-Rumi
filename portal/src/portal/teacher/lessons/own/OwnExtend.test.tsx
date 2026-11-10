import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * bd-snkn32.14 — "Add the next lesson's pages", as a teacher walks it (the network stubbed):
 *
 *   Given she picks a lesson that has a next lesson in the chapter   she can add its pages: one period, or double
 *   Given she picks the chapter's last lesson                          the choice is not there
 *   When she makes the plan                                            the next lesson and the shape go to the bot
 */

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../lib/recordingSession', () => ({ useRecordingSession: () => null }));
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../../lib/useNewUi', async (orig) => ({
  ...(await orig<object>()),
  readConfigShared: () => Promise.resolve({ success: true, features: { lpMakeOwn: true } }),
}));

import api from '../../../services/api';
import { resetLessonPlans } from '../../../newui/lessons/lessonPlansApi';
import { OwnPage } from './OwnPage';
import { LESSONS_OWN } from './state';
import { OWN_COPY as C } from './copy';

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}
const at = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path={LESSONS_OWN} element={<OwnPage />} /><Route path="*" element={<div />} /></Routes>
    <Where />
  </MemoryRouter>,
);
const where = () => screen.getByTestId('where').textContent ?? '';
const BASE = `${LESSONS_OWN}?grade=8&subject=Science&chapter=c02`;

beforeEach(() => {
  vi.clearAllMocks();
  resetLessonPlans();
  http.get.mockImplementation(async (url: string) => {
    const data: Record<string, unknown> = {
      '/lp612/grades': { grades: [{ grade: 8 }] },
      '/lp612/subjects': { subjects: [{ subject: 'Science', lesson_count: 2 }] },
      '/lp612/chapters': { chapters: [{ chapter_key: 'c02', chapter_number: 2, chapter_title: 'Motion', lesson_count: 2 }] },
      '/lp612/lessons': { lessons: [
        { segment_id: 'sci8.c02.p010', title: 'Speed', pages_label: 'p.10–13', sent: false },
        { segment_id: 'sci8.c02.p014', title: 'Distance', pages_label: 'p.14–16', sent: false },
      ] },
    };
    if (url in data) return { data: data[url] };
    throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
  });
});

describe("Add the next lesson's pages", () => {
  it('a lesson with a next one: she can add its pages, one period or double, kept in the address', async () => {
    at(`${BASE}&seg=sci8.c02.p010`);
    expect((await screen.findByTestId('own-add-next')).textContent).toContain(C.addNext);
    expect(screen.getByTestId('own-opt-none').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('own-opt-one_period').textContent).toContain(C.extends.one_period);
    fireEvent.click(screen.getByTestId('own-opt-double'));
    await waitFor(() => expect(where()).toContain('ext=double'));
    fireEvent.click(screen.getByTestId('own-opt-none'));
    await waitFor(() => expect(where()).not.toContain('ext='));
  });

  it("the chapter's last lesson: no such choice", async () => {
    at(`${BASE}&seg=sci8.c02.p014`);
    await screen.findByTestId('own-opt-sci8.c02.p014');
    expect(screen.queryByTestId('own-add-next')).toBeNull();
    expect(screen.queryByTestId('own-opt-double')).toBeNull();
  });

  it('Make my plan sends the next lesson and the shape, and the check screen says so', async () => {
    http.post.mockResolvedValue({ data: { success: true, state: 'authoring', renderId: 'own-1' } });
    at(`${BASE}&step=check&seg=sci8.c02.p010&size=up30&level=behind&way=tarl&ext=one_period`);
    expect(await screen.findByText(C.extends.one_period)).toBeTruthy();
    fireEvent.click(await screen.findByTestId('own-make'));
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/lp612/own', {
      segment_id: 'sci8.c02.p010',
      answers: {
        size: 'up30', resources: ['textbook'], level: 'behind', way: 'tarl', note: '',
        extend: { next: 'sci8.c02.p014', shape: 'one_period' },
      },
    }));
  });
});
