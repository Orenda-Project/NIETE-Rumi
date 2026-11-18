'use strict';
/**
 * web_quiz_audio.settings_failed names its cause (bd-ehz254.12).
 *
 * The daily-cap count is a supabase-js `head: true` count. When it fails, PostgREST sends no body, so the client's
 * error carries an EMPTY message and the HTTP status sits on the response, not the error. The line used to say only
 * "count failed" (prod 12 Nov: 5 in 24 h), which names no cause. The cap still fails open (the child's quiz is
 * recorded); the line now carries the status and the error code so the cause can be read off the log.
 */

const Store = require('../../../shared/services/quiz/web-quiz-audio-store');

const QUIZ = '22222222-2222-4222-8222-222222222222';

function fakeDb(countReply) {
  return {
    from(table) {
      const api = {
        select() { return api; },
        eq() { return table === 'quizzes' ? Promise.resolve(countReply) : api; },
        or() { return Promise.resolve(countReply); },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      };
      return api;
    },
  };
}

describe('web_quiz_audio.settings_failed on a failed cap count', () => {
  beforeEach(() => Store.resetSettingsCache());

  test('an empty-message count error logs its HTTP status and code, and still fails open', async () => {
    const logError = jest.fn();
    const db = fakeDb({ count: null, error: { message: '', code: '57014', details: '', hint: '' }, status: 500, statusText: 'Internal Server Error' });
    const res = await Store.recordingAllowed({ db, quizId: QUIZ, logEvent: jest.fn(), logError });
    expect(res.ok).toBe(true);
    expect(logError).toHaveBeenCalledTimes(1);
    const [name, payload] = logError.mock.calls[0];
    expect(name).toBe('web_quiz_audio.settings_failed');
    expect(payload).toMatchObject({ quizId: QUIZ, step: 'count', status: 500, code: '57014' });
  });

  test('a count error with a message keeps the message', async () => {
    const logError = jest.fn();
    const db = fakeDb({ count: null, error: { message: 'canceling statement due to statement timeout', code: '57014' }, status: 500 });
    await Store.recordingAllowed({ db, quizId: QUIZ, logEvent: jest.fn(), logError });
    expect(logError.mock.calls[0][1]).toMatchObject({ step: 'count', error: 'canceling statement due to statement timeout', status: 500, code: '57014' });
  });

  test('a good count logs nothing', async () => {
    const logError = jest.fn();
    const res = await Store.recordingAllowed({ db: fakeDb({ count: 0, error: null, status: 200 }), quizId: QUIZ, logEvent: jest.fn(), logError });
    expect(res).toMatchObject({ ok: true });
    expect(logError).not.toHaveBeenCalled();
  });
});
