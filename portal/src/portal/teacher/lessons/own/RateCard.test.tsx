import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * bd-snkn32.11 (queue #134 C) — on her own plan in the viewer: "How good was this plan?" 1-5 and an optional "What
 * was confusing?", sent to POST /lp612/own/:id/rating. Saved → thanks; a failure → try again, her words kept.
 */
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from '../../../services/api';
import { RateCard } from './RateCard';
import { rateOwnPlan } from './api';
import { RATE_COPY as C } from './rateCopy';

const http = api as unknown as { post: ReturnType<typeof vi.fn> };
beforeEach(() => { cleanup(); http.post.mockReset(); });

describe('rateOwnPlan', () => {
  it('posts the rating and the note for that plan; true only on success', async () => {
    http.post.mockResolvedValue({ data: { success: true } });
    expect(await rateOwnPlan('own 1', 4, 'the We Do')).toBe(true);
    expect(http.post).toHaveBeenCalledWith('/lp612/own/own%201/rating', { rating: 4, confusing: 'the We Do' });
    http.post.mockRejectedValue(new Error('net'));
    expect(await rateOwnPlan('own-1', 4, '')).toBe(false);
  });
});

describe('RateCard', () => {
  it('Send waits for a rating; then sends it with the note and says thanks', async () => {
    http.post.mockResolvedValue({ data: { success: true } });
    render(<RateCard ownId="own-1" />);
    expect(screen.getByText(C.question)).toBeTruthy();
    const send = screen.getByTestId('own-rate-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /4/ }));
    fireEvent.change(screen.getByTestId('own-rate-note'), { target: { value: 'the We Do' } });
    fireEvent.click(send);
    await waitFor(() => expect(screen.getByTestId('own-rate-thanks').textContent).toBe(C.thanks));
    expect(http.post).toHaveBeenCalledWith('/lp612/own/own-1/rating', { rating: 4, confusing: 'the We Do' });
  });

  it('a failure says try again and keeps her words', async () => {
    http.post.mockRejectedValue(new Error('net'));
    render(<RateCard ownId="own-1" />);
    fireEvent.click(screen.getByRole('radio', { name: /2/ }));
    fireEvent.change(screen.getByTestId('own-rate-note'), { target: { value: 'too long' } });
    fireEvent.click(screen.getByTestId('own-rate-send'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(C.failed));
    expect((screen.getByTestId('own-rate-note') as HTMLTextAreaElement).value).toBe('too long');
  });

  it('the note is capped at 300 characters', () => {
    render(<RateCard ownId="own-1" />);
    expect((screen.getByTestId('own-rate-note') as HTMLTextAreaElement).maxLength).toBe(300);
  });
});
