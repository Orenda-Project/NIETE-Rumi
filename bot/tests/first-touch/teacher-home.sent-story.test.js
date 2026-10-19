'use strict';
/**
 * The book of each story the teacher sent, read with no extra round trip: playedOwn's ONE quizzes read (which quizzes
 * the teacher made) also brings `meta.story.book_id` as a jsonb path, and the story entries of its map carry it as
 * `book`. The class report is stood in for; the quizzes read runs on the in-memory Supabase.
 */
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const { jsonPathSelect } = require('./_json-path-select');
const { playedOwn } = require('../../shared/services/first-touch/teacher-home.data');

const UID = 'a0000000-0000-4000-8000-0000000000f1';
const OTHER = 'a0000000-0000-4000-8000-0000000000f2';
const row = (id, source, date) => ({ id, played: 3, of: 20, date, topic: `Topic ${id}`, source });

test('story entries carry their book from the same quizzes read; other entries are as before', async () => {
  const fake = makeFake({
    quizzes: [
      { id: 's1', teacher_id: UID, quiz_source: 'story', meta: { story: { book_id: 'b1', lang: 'en' }, student_message: 'x' } },
      { id: 's2', teacher_id: UID, quiz_source: 'story', meta: {} },
      { id: 'v1', teacher_id: UID, quiz_source: 'video', meta: { story: { book_id: 'b7' } } },
      { id: 's3', teacher_id: OTHER, quiz_source: 'story', meta: { story: { book_id: 'b2' } } },
    ],
  });
  const supabase = jsonPathSelect(fake);
  const Report = { classReport: jest.fn(async () => ({ quizzes: [row('s1', 'story', '2026-10-10'), row('s2', 'story', '2026-10-11'), row('v1', 'video', '2026-10-12'), row('s3', 'story', '2026-10-13')] })) };
  const out = await playedOwn(UID, { Report, supabase });
  expect([...out.keys()]).toEqual(['s1', 's2', 'v1']);
  expect(out.get('s1')).toEqual({ played: 3, of: 20, date: '2026-10-10', topic: 'Topic s1', source: 'story', book: 'b1' });
  expect(out.get('s2')).toEqual({ played: 3, of: 20, date: '2026-10-11', topic: 'Topic s2', source: 'story', book: null });
  expect(out.get('v1')).toEqual({ played: 3, of: 20, date: '2026-10-12', topic: 'Topic v1', source: 'video' });
  // still ONE quizzes read, its columns the id and the book's path (never the whole meta)
  expect(fake.calls.filter((c) => c.table === 'quizzes')).toHaveLength(1);
  expect(supabase.selects).toEqual([{ table: 'quizzes', cols: 'id, story_book:meta->story->>book_id' }]);
});
