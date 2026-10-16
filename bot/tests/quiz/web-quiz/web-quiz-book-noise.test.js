'use strict';
/**
 * The Book (web-quiz-book.js) never rewards a read the scorer judged not a reading: a check that is scored with its
 * record lost (implausible) gives no story sticker and lights no day. Every kept row is as before. Pure functions.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const Book = require('../../../shared/services/quiz/web-quiz-book');

const NOW = Date.parse('2026-10-14T09:00:00Z');   // a Wednesday
const at = (h) => new Date(NOW - h * 3600000).toISOString();
const row = (over) => ({ id: 'r1', student_id: 's1', exercise: 'read', status: 'scored', mode: 'check', record: true, passage_id: 'p1', created_at: at(1), scored_at: at(1), ...over });

describe('a noise read (scored check, record lost): no story sticker, no lit day', () => {
  test('storyIdsOf: the noise row gives no sticker; a kept check and a practice read do', () => {
    expect(Book.storyIdsOf([row({ record: false })])).toEqual([]);
    expect(Book.storyIdsOf([row({})])).toEqual(['p1']);
    expect(Book.storyIdsOf([row({ mode: 'practice', record: false, passage_id: 'p2' })])).toEqual(['p2']);
  });
  test('daysOf: the noise row lights no day; a kept row lights its day', () => {
    expect(Book.daysOf([row({ record: false })], NOW).some(Boolean)).toBe(false);
    expect(Book.daysOf([row({})], NOW).some(Boolean)).toBe(true);
  });
});
