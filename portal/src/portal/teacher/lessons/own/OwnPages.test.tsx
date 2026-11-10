import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * bd-snkn32.17 — the book pages of a grades 1–5 "Make my own" (BDD over the real page; the network stubbed):
 *
 *   Given she picks a day        the day's own pages are shown, ready to change
 *   When she extends or types    "Add the next day's pages" widens them; a range the bot would refuse stops OK
 *   And taps Make my plan        her pages go with her answers, and the check screen names them
 *   But a grades 6–12 lesson     has no page box (its pages are the lesson's own)
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
import { OWN_COPY } from './copy';

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}
const at = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path={LESSONS_OWN} element={<OwnPage />} />
      <Route path="*" element={<div />} />
    </Routes>
    <Where />
  </MemoryRouter>,
);
const where = () => screen.getByTestId('where').textContent ?? '';
const okButton = async () => (await screen.findAllByTestId('own-ok')).pop() as HTMLButtonElement;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetLessonPlans();
  try { localStorage.clear(); } catch { /* none */ }
  http.get.mockImplementation(async (url: string) => {
    const data: Record<string, unknown> = {
      '/curriculum/grades': { grades: [{ grade: 4, subject_count: 1 }] },
      '/lp612/grades': { grades: [{ grade: 8 }] },
      '/lp612/subjects': { subjects: [{ subject: 'Science', lesson_count: 2 }] },
      '/curriculum/subjects': { subjects: [{ subject_key: 'math', subject: 'Math', lesson_count: 1 }] },
      '/lp612/chapters': { chapters: [{ chapter_key: 'c02', chapter_number: 2, chapter_title: 'Motion', lesson_count: 2 }] },
      '/curriculum/chapters': { chapters: [{ chapter_number: 1, chapter_title: 'Numbers', lesson_count: 1 }] },
      '/lp612/lessons': { lessons: [{ segment_id: 'sci8.c02.p010', title: 'Speed', pages_label: 'p.10–13', sent: false }] },
      '/curriculum/lps': { lessons: [
        { lesson_id: 'g4m1', lp_type: 'content', day_label: 'Day 1', topic: 'Counting', pages_label: 'p.2' },
        { lesson_id: 'g4m2', lp_type: 'content', day_label: 'Day 2', topic: 'Adding', pages_label: 'p.3-4' },
        { lesson_id: 'g4m3', lp_type: 'content', day_label: 'Day 3', topic: 'Taking away', pages_label: 'p.5-6' },
      ] },
    };
    if (!(url in data)) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: data[url] };
  });
});

const DAY2 = `${LESSONS_OWN}?grade=4&subject=math&chapter=1&seg=g4m2`;

describe('Make my own, grades 1–5: the book pages (bd-snkn32.17)', () => {
  it('shows the day\'s pages; "next day" extends them, and OK keeps them in the address', async () => {
    at(DAY2);
    const from = await screen.findByTestId('own-pg-from') as HTMLInputElement;
    const to = screen.getByTestId('own-pg-to') as HTMLInputElement;
    expect([from.value, to.value]).toEqual(['3', '4']);
    fireEvent.click(screen.getByTestId('own-pg-next'));
    expect(to.value).toBe('6');
    fireEvent.click(await okButton());
    await waitFor(() => expect(where()).toContain('pg=3-6'));
    expect(where()).toContain('step=size');
  });

  it('the day\'s own pages, unchanged, add nothing to the address', async () => {
    at(DAY2);
    await screen.findByTestId('own-pg-from');
    fireEvent.click(await okButton());
    await waitFor(() => expect(where()).toContain('step=size'));
    expect(where()).not.toContain('pg=');
  });

  it('a first page after the last stops OK and says why', async () => {
    at(DAY2);
    fireEvent.change(await screen.findByTestId('own-pg-from'), { target: { value: '9' } });
    expect(screen.getByTestId('own-pg-bad')).toBeTruthy();
    expect((await okButton()).disabled).toBe(true);
  });

  it('the last day of the chapter has no "next day"', async () => {
    at(`${LESSONS_OWN}?grade=4&subject=math&chapter=1&seg=g4m3`);
    await screen.findByTestId('own-pg-from');
    expect(screen.queryByTestId('own-pg-next')).toBeNull();
  });

  it('Make my plan sends her pages, and the check screen names them', async () => {
    http.post.mockResolvedValue({ data: { success: true, state: 'authoring', renderId: 'own-k5' } });
    at(`${DAY2}&step=check&size=over70&level=behind&way=tarl&pg=3-6`);
    expect((await screen.findAllByText(/p\.3-6/)).length).toBeGreaterThan(0);
    fireEvent.click(await screen.findAllByTestId('own-make').then((b) => b[b.length - 1]));
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/lp612/own', {
      lesson_id: 'g4m2',
      answers: { size: 'over70', resources: ['textbook'], level: 'behind', way: 'tarl', note: '', pages: { start: 3, end: 6 } },
    }));
  });

  // bd-snkn32.19 — every band gets the page box now; 6–12 stays inside the lesson or runs to the next one's end.
  it('a grades 6–12 lesson has the page box too; a page outside the lesson stops OK', async () => {
    at(`${LESSONS_OWN}?grade=8&subject=Science&chapter=c02&seg=sci8.c02.p010`);
    expect(await screen.findByTestId('own-pg-box')).toBeTruthy();
    expect(screen.queryByTestId('own-pg-next')).toBeNull();   // the chapter's only lesson: nothing to add
    fireEvent.change(screen.getByTestId('own-pg-to'), { target: { value: '15' } });
    expect((await screen.findByTestId('own-pg-bad')).textContent).toBe(OWN_COPY.badPages612);
    expect(await okButton()).toBeDisabled();
    fireEvent.change(screen.getByTestId('own-pg-to'), { target: { value: '12' } });
    await waitFor(async () => expect(await okButton()).not.toBeDisabled());
    fireEvent.click(await okButton());
    await waitFor(() => expect(where()).toContain('pg=10-12'));
  });
});
