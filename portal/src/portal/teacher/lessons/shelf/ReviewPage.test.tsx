import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-snkn32.42 — the staff check before a teacher's plan is listed:
 *
 *   Given she is not a listed reviewer   she is sent to Lesson Plans
 *   Given she is                         each plan shows its score, the checks below the standard, those not checked
 *   When she approves                    it is recorded, and the card says Approved
 *   When she rejects                     she must say why first
 */
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../lib/recordingSession', () => ({ useRecordingSession: () => null }));
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const who = vi.hoisted(() => ({ reviewer: true as boolean | null }));
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), useLpOwnReviewer: () => who.reviewer }));

import api from '../../../services/api';
import { ReviewPage, LESSONS_CHECK } from './ReviewPage';
import { LESSONS_HOME } from '../paths';
import { SHELF_COPY as C } from './copy';

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const plan = {
  ownId: 'o1', lesson: 'G4_math_ch3_d4', band: 'k5', lang: 'en', score: 88.2, reviewedAt: 't',
  below: [{ id: '6B', name: 'Inclusive and diverse representation', rating: 2 }], notAssessed: ['1D', '2I'],
};
const show = () => render(
  <MemoryRouter initialEntries={[LESSONS_CHECK]}>
    <Routes>
      <Route path={LESSONS_CHECK} element={<ReviewPage />} />
      <Route path={LESSONS_HOME} element={<p>home</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  cleanup();
  who.reviewer = true;
  http.get.mockReset();
  http.post.mockReset();
  http.get.mockResolvedValue({ data: { plans: [plan] } });
  http.post.mockResolvedValue({ data: { success: true, decision: 'approved' } });
});

describe('ReviewPage', () => {
  it('not a reviewer: back to Lesson Plans, nothing read', async () => {
    who.reviewer = false;
    show();
    expect(await screen.findByText('home')).toBeTruthy();
    expect(http.get).not.toHaveBeenCalled();
  });

  it('shows the score, the checks below the standard and those not checked', async () => {
    show();
    expect(await screen.findByText(C.score(88.2))).toBeTruthy();
    expect(screen.getByText('6B Inclusive and diverse representation: 2')).toBeTruthy();
    expect(screen.getByText(`${C.notAssessed}: 1D, 2I`)).toBeTruthy();
  });

  it('approve records it', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: C.approve }));
    expect(await screen.findByText(C.approved)).toBeTruthy();
    expect(http.post).toHaveBeenCalledWith('/lp612/own/review/o1', { decision: 'approve' });
  });

  it('reject needs a reason first', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: C.reject }));
    const send = screen.getByRole('button', { name: C.sendReject }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(C.reason), { target: { value: 'No hook' } });
    fireEvent.click(send);
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/lp612/own/review/o1', { decision: 'reject', reason: 'No hook' }));
    expect(await screen.findByText(C.rejected)).toBeTruthy();
  });

  it('a failed save says so and keeps the buttons', async () => {
    http.post.mockRejectedValue(new Error('502'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: C.approve }));
    expect(await screen.findByText(C.failed)).toBeTruthy();
    expect(screen.getByRole('button', { name: C.approve })).toBeTruthy();
  });
});
