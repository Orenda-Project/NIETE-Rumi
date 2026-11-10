import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * bd-snkn32.15 — "Change this plan" as a teacher uses it (BDD over the real pages; the network stubbed):
 *
 *   Given her own plan is ready     Preparing hands the viewer how many changes are left, and the viewer offers
 *                                   "Change this plan (N left)"; with none left it says to start fresh from the chapter
 *   When she picks a part and asks  her words go to POST /lp612/own/:id/change and the waiting screen opens on the change
 *   But the bot refuses             she is told why in plain words, and stays to try again
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
import { PreparingPage } from '../PreparingPage';
import { LESSONS_HOME, LESSONS_VIEWER, lessonsUrl } from '../paths';
import { ChangePage } from './ChangePage';
import { ChangeEntry } from './ChangeEntry';
import { LESSONS_CHANGE, changeUrl, type ChangeAt } from './change';
import { OWN_COPY as C } from './copy';

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const AT: ChangeAt = { own: 'own-1', band: 'k5', left: 2, grade: 4, subject: 'math', chapter: '1', lesson: 'g4m2', title: 'Adding' };

function Where() {
  const l = useLocation();
  return <div data-testid="where" data-own={JSON.stringify((l.state as { own?: unknown } | null)?.own ?? null)}>{`${l.pathname}${l.search}`}</div>;
}
function at(url: string, extra?: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={LESSONS_CHANGE} element={<ChangePage />} />
        <Route path={`${LESSONS_HOME}/preparing`} element={<PreparingPage />} />
        <Route path="*" element={<div />} />
      </Routes>
      {extra}
      <Where />
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId('where').textContent ?? '';
const words = 'Make the we do a group game with stones';

beforeEach(() => {
  vi.clearAllMocks();
  resetLessonPlans();
  flag.on = true;
  http.get.mockImplementation(async (url: string) => {
    if (url === '/curriculum/lps') return { data: { lessons: [] } };
    throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
  });
});

describe('the viewer\'s entry', () => {
  it('changes left: "Change this plan (N left)", into the change page', () => {
    at('/x', <ChangeEntry at={{ ...AT, left: 1 }} />);
    const link = screen.getByTestId('own-change-entry');
    expect(link.textContent).toContain(C.changeThisPlan(1));
    expect(link.getAttribute('href')).toBe(changeUrl({ ...AT, left: 1 }));
  });

  it('none left: start fresh from the chapter, and no link', () => {
    at('/x', <ChangeEntry at={{ ...AT, left: 0 }} />);
    expect(screen.queryByTestId('own-change-entry')).toBeNull();
    expect(screen.getByTestId('own-change-used').textContent).toBe(C.usedBoth);
  });

  it('Preparing hands the viewer her plan\'s changes left', async () => {
    http.get.mockImplementation(async (url: string) => {
      if (url === '/lp612/status/own-1') return { data: { success: true, state: 'ready', changesLeft: 1, ownBand: 'k5' } };
      if (url === '/curriculum/lps') return { data: { lessons: [] } };
      throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    });
    at(lessonsUrl('preparing', { grade: 4, subject: 'math', chapter: '1', lesson: 'g4m2', render: 'own-1', title: 'Adding' }));
    await waitFor(() => expect(where()).toBe(LESSONS_VIEWER), { timeout: 5000 });
    expect(JSON.parse(screen.getByTestId('where').dataset.own ?? 'null')).toEqual({ ...AT, left: 1 });
  });
});

describe('Change this plan', () => {
  it('grades 1–5: the five steps to pick from; Send waits for a part and her words', async () => {
    at(changeUrl(AT));
    for (const p of ['hook', 'i_do', 'we_do', 'you_do', 'wrap']) expect(await screen.findByTestId(`own-part-${p}`)).toBeTruthy();
    expect(screen.queryByTestId('own-part-whole')).toBeNull();
    expect(screen.getByTestId('own-change-send')).toBeDisabled();
    fireEvent.click(screen.getByTestId('own-part-we_do'));
    expect(screen.getByTestId('own-change-send')).toBeDisabled();
    fireEvent.change(screen.getByTestId('own-change-text'), { target: { value: words } });
    expect(screen.getByTestId('own-change-send')).not.toBeDisabled();
  });

  it('grades 6–12 may change the whole plan', async () => {
    at(changeUrl({ ...AT, band: 'g612', lesson: 'sci8.c02.p010' }));
    expect(await screen.findByTestId('own-part-whole')).toBeTruthy();
    expect(screen.queryByTestId('own-part-we_do')).toBeNull();
  });

  it('sends her words and opens the waiting screen on the change', async () => {
    http.post.mockResolvedValue({ data: { success: true, state: 'authoring', renderId: 'chg-1' } });
    at(changeUrl(AT));
    fireEvent.click(await screen.findByTestId('own-part-we_do'));
    fireEvent.change(screen.getByTestId('own-change-text'), { target: { value: words } });
    fireEvent.click(screen.getByTestId('own-change-send'));
    await waitFor(() => expect(where()).toContain('/lessons/preparing?'));
    expect(http.post).toHaveBeenCalledWith('/lp612/own/own-1/change', { part: 'we_do', text: words });
    expect(where()).toContain('render=chg-1');
    expect(where()).toContain('lesson=g4m2');
  });

  it('too short is said on the phone: nothing is sent', async () => {
    at(changeUrl(AT));
    fireEvent.click(await screen.findByTestId('own-part-hook'));
    fireEvent.change(screen.getByTestId('own-change-text'), { target: { value: 'more games' } });
    fireEvent.click(screen.getByTestId('own-change-send'));
    expect(await screen.findByRole('alert')).toHaveTextContent(C.refusals.too_short);
    expect(http.post).not.toHaveBeenCalled();
  });

  it.each(['too_small', 'repeat', 'in_flight', 'cap_reached', 'daily_limit'] as const)('the bot refuses (%s): she is told why and stays', async (outcome) => {
    http.post.mockRejectedValue(Object.assign(new Error('409'), { response: { status: 409, data: { success: false, outcome } } }));
    at(changeUrl(AT));
    fireEvent.click(await screen.findByTestId('own-part-wrap'));
    fireEvent.change(screen.getByTestId('own-change-text'), { target: { value: words } });
    fireEvent.click(screen.getByTestId('own-change-send'));
    expect(await screen.findByRole('alert')).toHaveTextContent(C.refusals[outcome]);
    expect(where()).toContain(LESSONS_CHANGE);
  });

  it('small fixes: she is told to make them by hand', () => {
    expect(C.refusals.too_small).toBe('Small fixes like this you can make by hand on the plan.');
    expect(C.usedBoth).toBe("You've used both changes. To start fresh, make a new plan from the chapter.");
  });

  it('a bot that cannot be reached: "Couldn\'t make it"', async () => {
    http.post.mockRejectedValue(Object.assign(new Error('502'), { response: { status: 502 } }));
    at(changeUrl(AT));
    fireEvent.click(await screen.findByTestId('own-part-wrap'));
    fireEvent.change(screen.getByTestId('own-change-text'), { target: { value: words } });
    fireEvent.click(screen.getByTestId('own-change-send'));
    expect(await screen.findByRole('alert')).toHaveTextContent(C.couldNotMake);
  });

  it('none left: the page says so, with no form', async () => {
    at(changeUrl({ ...AT, left: 0 }));
    expect(await screen.findByTestId('own-change-used')).toHaveTextContent(C.usedBoth);
    expect(screen.queryByTestId('own-change-send')).toBeNull();
  });

  it('flag off: back to Lesson Plans', async () => {
    flag.on = false;
    at(changeUrl(AT));
    await waitFor(() => expect(where()).not.toContain(LESSONS_CHANGE));
  });
});
