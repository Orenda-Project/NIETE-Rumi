import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-snkn32.77 (queue #296) — her own plan could not be made: the page says what to change (tick Board, pick another
 * teaching way, try again), not only "Couldn't make it". An unknown failure keeps the old page, no extra line.
 */
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../services/api';
import { resetLessonPlans } from '../../newui/lessons/lessonPlansApi';
import { PreparingPage } from './PreparingPage';
import { lessonsUrl } from './paths';
import { LESSONS_V2_COPY as C } from './copy';
import { ownUrl } from './own/state';
import { OWN_COPY as O } from './own/copy';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const back = ownUrl({ grade: 3, subject: 'math', chapter: 'ch2', seg: 'grade_3_math_ch2_seg1', step: 'check', size: 'over70' });
const AT = { grade: 3, subject: 'math', chapter: 'ch2', lesson: 'grade_3_math_ch2_seg1', render: 'own-7', back };

function mount() {
  const [pathname, search] = lessonsUrl('preparing', AT).split('?');
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: `?${search}` }]}>
      <Routes><Route path={pathname} element={<PreparingPage />} /></Routes>
    </MemoryRouter>,
  );
}
const failWith = (errorCode: string) => http.get.mockImplementation(async (url: string) => {
  if (url.startsWith('/lp612/status')) return { data: { success: true, state: 'failed', errorCode } };
  throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
});

beforeEach(() => { vi.clearAllMocks(); resetLessonPlans(); });
afterEach(() => { cleanup(); });

describe('her own plan was refused: the page says what to change', () => {
  it.each([
    ['OWN_NEEDS_BOARD', 'needs_board'],
    ['OWN_SLATES', 'slates'],
    ['OWN_GROUP_WORK', 'group_work'],
    ['OWN_NOT_URDU', 'not_urdu'],
  ] as const)('%s shows its line and Try again', async (code, key) => {
    failWith(code);
    mount();
    expect(await screen.findByText(O.madeRefused[key], {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText(C.notPrepared)).toBeTruthy();
    expect(screen.getByText(C.tryAgain)).toBeTruthy();
  }, 10000);

  it('any other failure: the old page, no extra line', async () => {
    failWith('NOT_ACCEPTED');
    mount();
    expect(await screen.findByText(C.tryAgain, {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByTestId('own-refused-why')).toBeNull();
  }, 10000);
});
