import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-snkn32.58.3 (queue #155 C) — a goal plan is checked (facts + goal) before she sees it:
 *
 *   While it is made      the page also says "Checking it matches your goal…"
 *   Refused by the check  a calm screen: select another goal, or start from a textbook chapter (never "Try again" on
 *                         the same goal, which would be refused again)
 *   Any other failure     today's "Try again", unchanged
 */
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../services/api';
import { resetLessonPlans } from '../../newui/lessons/lessonPlansApi';
import { PreparingPage } from './PreparingPage';
import { lessonsUrl } from './paths';
import { LESSONS_V2_COPY as C } from './copy';
import { GOAL_COPY as G } from './own/goalCopy';
import { OWN_BOOK, ownUrl } from './own/state';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const AT = { grade: 3, subject: 'math', lesson: 'grade_3_math_ch2_seg1', render: 'own-7', check: 'goal' };

function mount(at: Record<string, string | number> = AT) {
  const path = lessonsUrl('preparing', at as Parameters<typeof lessonsUrl>[1]);
  const [pathname, search] = path.split('?');
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: `?${search}` }]}>
      <Routes><Route path={pathname} element={<PreparingPage />} /><Route path="*" element={null} /></Routes>
    </MemoryRouter>,
  );
}
const status = (data: object) => http.get.mockImplementation(async (url: string) => {
  if (url.startsWith('/lp612/status')) return { data };
  throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
});

beforeEach(() => { vi.clearAllMocks(); resetLessonPlans(); });
afterEach(() => { cleanup(); });

describe('preparing a goal plan', () => {
  it('says it is checking the plan against her goal', () => {
    status({ success: true, state: 'authoring' });
    mount();
    expect(screen.getByText(G.checking)).toBeTruthy();
  });

  it('refused by the goal check: another goal, or a textbook chapter; no Try again', async () => {
    status({ success: true, state: 'failed', errorCode: 'OWN_GOAL_UNSURE' });
    mount();
    expect(await screen.findByText(G.unsureTitle, {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByRole('link', { name: G.anotherGoal }).getAttribute('href'))
      .toBe(ownUrl({ grade: 3, subject: 'math', step: 'goal', goal: { kind: null, text: '' } }));
    expect(screen.getByRole('link', { name: G.fromBook }).getAttribute('href')).toBe(OWN_BOOK);
    expect(screen.queryByText(C.tryAgain)).toBeNull();
  }, 10000);

  it('any other failure: today\'s Try again', async () => {
    status({ success: true, state: 'failed', errorCode: 'RENDER_FAILED' });
    mount();
    await waitFor(() => expect(screen.getByText(C.tryAgain)).toBeTruthy(), { timeout: 8000 });
    expect(screen.queryByText(G.unsureTitle)).toBeNull();
  }, 10000);

  it('a plan from the book: no checking line', () => {
    status({ success: true, state: 'authoring' });
    const { check: _c, ...book } = AT;
    mount(book);
    expect(screen.queryByText(G.checking)).toBeNull();
  });
});
