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
  // bd-snkn32.19 — the next lesson's pages are added from the page box; then "How will you teach both?", none picked.
  it('a lesson with a next one: add its pages, then one period or double, kept in the address', async () => {
    at(`${BASE}&seg=sci8.c02.p010`);
    fireEvent.click(await screen.findByTestId('own-pg-next'));
    const both = await screen.findByRole('radiogroup', { name: C.bothHow });
    expect(both.textContent).toContain(C.extends.one_period);
    expect(screen.getByTestId('own-ok')).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: C.extends.double }));
    await waitFor(() => expect(where()).toContain('ext=double'));
    await waitFor(() => expect(screen.getByTestId('own-ok')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('own-ok'));
    await waitFor(() => expect(where()).toContain('step=purpose'));
    expect(where()).toContain('ext=double');
    expect(where()).not.toContain('pg=');   // through the next lesson's end is the natural run: no pages sent
  });

  it("the chapter's last lesson: no such choice", async () => {
    at(`${BASE}&seg=sci8.c02.p014`);
    await screen.findByTestId('own-pg-card');
    expect(screen.queryByTestId('own-pg-next')).toBeNull();
    expect(screen.queryByTestId('own-ext')).toBeNull();
  });

  it('Make my plan sends the next lesson and the shape, and the check screen says so', async () => {
    http.post.mockResolvedValue({ data: { success: true, state: 'authoring', renderId: 'own-1' } });
    at(`${BASE}&step=check&seg=sci8.c02.p010&size=up30&level=behind&purpose=new&way=practical&ext=one_period`); // a Grade 8 plan: a 6–12 way and its purpose (bd-snkn32.13)
    expect(await screen.findByText(C.extends.one_period)).toBeTruthy();
    fireEvent.click(await screen.findByTestId('own-make'));
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/lp612/own', {
      segment_id: 'sci8.c02.p010',
      answers: {
        size: 'up30', resources: ['textbook'], level: 'behind', way: 'practical', note: '', purpose: 'new',
        extend: { next: 'sci8.c02.p014', shape: 'one_period' },
      },
    }));
  });
});
