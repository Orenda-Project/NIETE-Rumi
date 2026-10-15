import { describe, it, expect, vi, afterEach } from 'vitest';
import api, { portal, generateFailureOf } from './api';

/**
 * A refused POST /assessment/generate keeps its error exactly as before (the job tracker reads response.data.error),
 * and the screen that asked can read the server's code once: the board pattern's refusals are shown in the
 * teacher's language, not the server's English.
 */
afterEach(() => vi.restoreAllMocks());

describe('generateAssessment refusals', () => {
  it('the code, status and retry time of a 429, read once; the error is rethrown unchanged', async () => {
    const err = { response: { status: 429, data: { success: false, error: 'You have made 10 papers this hour.', errorCode: 'RATE_LIMITED', retryAt: '2026-10-16T06:40:00Z' } } };
    vi.spyOn(api, 'post').mockRejectedValue(err);
    await expect(portal.generateAssessment({ grade: 5, subject: 'maths', questionCount: 0, pattern: 'fde_g5_2027', scope: 'fde' })).rejects.toBe(err);
    expect(portal.takeGenerateFailure()).toEqual({ errorCode: 'RATE_LIMITED', status: 429, retryAt: '2026-10-16T06:40:00Z', requestId: null });
    expect(portal.takeGenerateFailure()).toBeNull();
  });

  it('a 409 carries the request it collided with', async () => {
    vi.spyOn(api, 'post').mockRejectedValue({ response: { status: 409, data: { errorCode: 'ALREADY_GENERATING', requestId: 'req-1' } } });
    await expect(portal.generateAssessment({ grade: 5, subject: 'maths', questionCount: 0 })).rejects.toBeTruthy();
    expect(portal.takeGenerateFailure()).toMatchObject({ errorCode: 'ALREADY_GENERATING', status: 409, requestId: 'req-1' });
  });

  it('no code (a network error, today\'s messages): nothing to read; a success clears an old one', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('Network Error'));
    await expect(portal.generateAssessment({ grade: 4, subject: 'science', questionCount: 15 })).rejects.toThrow('Network Error');
    expect(portal.takeGenerateFailure()).toBeNull();
    expect(generateFailureOf({ response: { status: 400, data: { error: 'Leave room for new questions.' } } })).toBeNull();
  });
});
