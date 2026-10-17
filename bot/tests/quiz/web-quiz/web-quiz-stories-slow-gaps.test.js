'use strict';
/**
 * The storybook's "Slower" as gaps between phrases (app_settings `web_quiz_stories_slow_gaps`, only a literal true):
 * on, the book says `slow_gaps: true` and the reader waits between phrases instead of slowing the voice; off (or any
 * other value), the book's payload is exactly what it was before the switch existed (no new key).
 * Supabase, R2's presign and the hub are faked; books are invented ("Testwala", __fixtures__/stories-testwala.js).
 */
process.env.WEB_QUIZ_TOKEN_SECRET = 'test-only-secret';

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/quiz/web-quiz-hub', () => ({ kidFromHub: async (token) => (token === 'hub-token' ? { studentId: '44444444-4444-4444-8444-444444444444', grade: '2', rootId: null } : null) }));
jest.mock('../../../shared/storage/r2', () => ({ presignKey: async (key) => `https://r2.example.test/${key}?sig=1` }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const F = require('./__fixtures__/stories-testwala');
const Stories = require('../../../shared/services/quiz/web-quiz-stories');

const clone = (v) => JSON.parse(JSON.stringify(v));
function seed(extraSettings = []) {
  Object.assign(supabase, makeFake({
    app_settings: [{ key: 'web_quiz_stories', value: true }, ...extraSettings],
    story_books: [F.book(1)],
    story_pages: clone([F.P2, F.P1, F.P3]),
    story_page_voices: clone([F.VOICE_P1, F.VOICE_P1_OLD]),
    story_questions: clone(F.QUESTIONS),
    story_events: [],
  }));
}
async function bookWith(settings) {
  Stories._reset();
  seed(settings);
  return Stories.book(F.BOOK(1), 'hub-token', { kid: 'a' });
}

describe('web_quiz_stories_slow_gaps', () => {
  test('on (a literal true): the book says slow_gaps, for the child and for the teacher preview', async () => {
    const out = await bookWith([{ key: 'web_quiz_stories_slow_gaps', value: true }]);
    expect(out.slow_gaps).toBe(true);
    expect((await Stories.bookData(F.BOOK(1))).slow_gaps).toBe(true);
  });
  test('off, absent or not a literal true: the payload is byte-identical to the payload without the switch', async () => {
    const base = JSON.stringify(await bookWith([]));
    expect(base).not.toContain('slow_gaps');
    for (const value of [false, 'true', 1, null, { on: true }]) {
      expect(JSON.stringify(await bookWith([{ key: 'web_quiz_stories_slow_gaps', value }]))).toBe(base);
    }
  });
  test('with stories off the switch opens nothing (404 stories_off)', async () => {
    Stories._reset();
    Object.assign(supabase, makeFake({ app_settings: [{ key: 'web_quiz_stories_slow_gaps', value: true }], story_books: [F.book(1)], story_pages: [], story_page_voices: [], story_questions: [], story_events: [] }));
    await expect(Stories.bookData(F.BOOK(1))).rejects.toMatchObject({ status: 404 });
  });
});
