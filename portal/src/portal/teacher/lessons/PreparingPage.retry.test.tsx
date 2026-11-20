import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * bd-m8zwt1.8 (queue #164 testing) — her OWN plan failed: "Try again" goes back to her own answers (the check screen),
 * never to the ready-made plan of that lesson (which dropped her answers and kept the failure strip). A ready-made
 * plan's Try again is unchanged.
 */
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../services/api';
import { resetLessonPlans } from '../../newui/lessons/lessonPlansApi';
import { PreparingPage } from './PreparingPage';
import { lessonsUrl, readAt } from './paths';
import { LESSONS_V2_COPY as C } from './copy';
import { ownUrl } from './own/state';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const back = ownUrl({ grade: 3, subject: 'math', chapter: 'ch2', seg: 'grade_3_math_ch2_seg1', step: 'check', size: 'over70' });
const AT = { grade: 3, subject: 'math', chapter: 'ch2', lesson: 'grade_3_math_ch2_seg1', render: 'own-7', back };

function Where() { const l = useLocation(); return <p data-testid="where">{`${l.pathname}${l.search}`}</p>; }
function mount(at: Record<string, string | number>) {
  const path = lessonsUrl('preparing', at as Parameters<typeof lessonsUrl>[1]);
  const [pathname, search] = path.split('?');
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: `?${search}` }]}>
      <Routes><Route path={pathname} element={<PreparingPage />} /><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks(); resetLessonPlans();
  http.get.mockImplementation(async (url: string) => {
    if (url.startsWith('/lp612/status')) return { data: { success: true, state: 'failed', errorCode: 'NOT_ACCEPTED' } };
    throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
  });
});
afterEach(() => { cleanup(); });

describe('Try again after her own plan failed', () => {
  it('the preparing address carries her own answers screen, and only an own-plan address', () => {
    expect(readAt(lessonsUrl('preparing', AT).split('?')[1])?.back).toBe(back);
    expect(readAt('grade=3&subject=math&back=https://evil.example')?.back).toBeUndefined();
  });

  it('goes back to her check screen with her answers', async () => {
    mount(AT);
    await waitFor(() => expect(screen.getByText(C.tryAgain)).toBeTruthy(), { timeout: 8000 });
    fireEvent.click(screen.getByText(C.tryAgain));
    expect((await screen.findByTestId('where')).textContent).toBe(back);
  }, 10000);
});
