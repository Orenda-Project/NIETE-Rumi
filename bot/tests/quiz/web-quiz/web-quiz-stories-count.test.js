'use strict';
/**
 * The read-only storybook count (scripts/web-quiz/counts/web_quiz_stories.js): the per grade × language table is pure,
 * and the script refuses anything but sandbox. Rows are invented.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/storage/r2', () => ({ presignKey: async (key) => `https://r2.example.test/${key}` }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { tableOf, main, SANDBOX_REF } = require('../../../../scripts/web-quiz/counts/web_quiz_stories');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const F = require('./__fixtures__/stories-testwala');

describe('tableOf', () => {
  test('live vs not live by status; text / picture pages; word-timed, line-timed and unvoiced text pages; reviewed questions', () => {
    const books = [
      { id: 'b1', grade: 1, lang: 'en', status: 'ready' },
      { id: 'b2', grade: 1, lang: 'en', status: 'ready' },
      { id: 'b3', grade: 1, lang: 'en', status: 'draft' },
      { id: 'b4', grade: 1, lang: 'ur', status: 'held' },
      { id: 'b5', grade: 2, lang: 'ur', status: 'ready' },
    ];
    const pages = [
      { id: 'p1', book_id: 'b1', is_picture: false }, { id: 'p2', book_id: 'b1', is_picture: false }, { id: 'p3', book_id: 'b1', is_picture: true },
      { id: 'p4', book_id: 'b2', is_picture: false }, { id: 'p5', book_id: 'b3', is_picture: false }, { id: 'p6', book_id: 'b5', is_picture: false },
    ];
    const voices = [
      { page_id: 'p1', quality: null, is_current: true }, { page_id: 'p2', quality: 'low', is_current: true },
      { page_id: 'p4', quality: null, is_current: false }, { page_id: 'p5', quality: null, is_current: true }, { page_id: 'p6', quality: 'low', is_current: true },
    ];
    const questions = [{ book_id: 'b1', review_status: 'reviewed' }, { book_id: 'b2', review_status: 'draft' }, { book_id: 'b3', review_status: 'reviewed' }];
    const t = tableOf({ books, pages, voices, questions });
    expect(t.live).toBe(3);
    expect(t.waiting).toBe(2);
    expect(t.rows).toHaveLength(10);
    expect(t.rows.find((r) => r.grade === 1 && r.lang === 'en')).toEqual({
      grade: 1, lang: 'en', live: 2, waiting: { draft: 1 }, text: 3, picture: 1, word_timed: 1, line_timed: 1, no_voice: 1, with_questions: 1,
    });
    expect(t.rows.find((r) => r.grade === 1 && r.lang === 'ur')).toEqual(expect.objectContaining({ live: 0, waiting: { held: 1 }, text: 0 }));
    expect(t.rows.find((r) => r.grade === 2 && r.lang === 'ur')).toEqual(expect.objectContaining({ live: 1, line_timed: 1 }));
  });
});

describe('main', () => {
  test('refuses anything but sandbox (exit 2), before reading anything', async () => {
    const err = []; const io = { stdout: { write: () => {} }, stderr: { write: (s) => err.push(s) } };
    expect(await main({ argv: ['someotherref'], env: { SUPABASE_URL: `https://${SANDBOX_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: 'x' }, io })).toBe(2);
    expect(await main({ argv: [SANDBOX_REF], env: { SUPABASE_URL: 'https://prodref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'x' }, io })).toBe(2);
    expect(await main({ argv: [SANDBOX_REF], env: { SUPABASE_URL: `https://${SANDBOX_REF}.supabase.co` }, io })).toBe(2);
    expect(err.join('')).toContain('REFUSED: not sandbox');
  });
  test('past the guard: the table, then each new child\'s shelf and the storybooks the next-thing slot may offer (exit 0)', async () => {
    process.env.WEB_QUIZ_TOKEN_SECRET = process.env.WEB_QUIZ_TOKEN_SECRET || 'count-test-secret';
    const books = [1, 2, 3, 4].map((n) => F.book(n));
    books.push(F.book(5, { grade: 1, lang: 'ur', title: 'کتاب ٹیسٹ والا', slug: 'g1-ur-testwala-5' }));
    Object.assign(supabase, makeFake({ app_settings: [], story_books: books, story_pages: [], story_page_voices: [], story_questions: [], story_events: [] }));
    const out = []; const err = [];
    const io = { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } };
    const env = { SUPABASE_URL: `https://${SANDBOX_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: 'x', WEB_QUIZ_TOKEN_SECRET: process.env.WEB_QUIZ_TOKEN_SECRET };
    expect(await main({ argv: [SANDBOX_REF], env, io })).toBe(0);
    const text = out.join('');
    expect(text).toContain('5 live; 0 not live yet');
    expect(text).toMatch(/new-en-g2 \(nothing read\): shelf 4 books \(4 with a cover\); next-thing slot: 3 storybooks \(resume 0, unread 3\)/);
    expect(text).toMatch(/new-ur-g1 \(nothing read\): shelf 1 books \(1 with a cover\); next-thing slot: 1 storybooks \(resume 0, unread 1\)/);
    expect(text).not.toMatch(/Testwala|کتاب/);   // counts only: never a title
    expect(err.join('')).toBe('');
  });
});

