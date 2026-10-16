'use strict';
/**
 * The story class message ends with the same return line as every other class message (one copy source,
 * teacher-home.copy.js). returnLine(lang) reads the switch, so it answers a Promise: a caller that does not await it
 * gets no line. Runs against the stories send module whenever it is on the branch (it lands separately); until then
 * only the copy's own contract runs.
 */
process.env.WHATSAPP_BOT_NUMBER = '15550001111';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/video-quiz-share.service', () => ({
  botNumber: () => '15550001111',
  mintCode: jest.fn(async () => ({ id: 'f0000000-0000-4000-8000-0000000000e1', code: 'STORY1' })),
}));
jest.mock('../../shared/services/quiz/web-quiz-link', () => ({ quizLink: jest.fn(async (code) => `https://portal.example/q/${code}`) }));
jest.mock('../../shared/services/quiz/handout-class.service', () => ({ resolveClass: jest.fn(async () => ({ state: 'none' })), classIdToMint: () => null }));

const fs = require('fs');
const path = require('path');
const supabase = require('../../shared/config/supabase');
const Flags = require('../../shared/services/first-touch/teacher-home.flags');
const Copy = require('../../shared/services/first-touch/teacher-home.copy');
const { fill } = require('../../shared/services/first-touch/teacher-home.strings');

const STORY_MODULE = path.join(__dirname, '../../shared/services/quiz/story-teacher.service.js');
const TEACHER = 'a0000000-0000-4000-8000-0000000000f1';
const BOOK = '50000000-0000-4000-8000-0000000000b1';
const LINE = (l) => fill('cm.return', l, { link: 'https://wa.me/15550001111?text=quiz' });

/** A tiny in-memory Supabase: every chain resolves from `db` by table (filters are recorded, the rows are fixed). */
function fakeDb(db) {
  supabase.from = (table) => {
    const q = { table, eq: {} };
    const rows = () => (typeof db[table] === 'function' ? db[table](q) : (db[table] || []));
    const b = {
      select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, gte: () => b,
      eq: (k, v) => { q.eq[k] = v; return b; },
      insert: (row) => { q.insert = row; return b; },
      update: () => b,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: q.insert ? { id: 'c0000000-0000-4000-8000-0000000000e1', meta: q.insert.meta } : rows()[0], error: null }),
      then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
    };
    return b;
  };
}
function seed(homeOn) {
  fakeDb({
    app_settings: (q) => [
      { key: 'web_quiz_stories_teacher', value: true },
      ...(homeOn ? [{ key: 'quiz_teacher_home', value: true }] : []),
    ].filter((r) => !q.eq.key || r.key === q.eq.key),
    story_books: [{ id: BOOK, title: 'The Thirsty Crow', grade: 2, lang: 'en', pages: 8, minutes: 4, cover_file: null, featured_rank: 1, status: 'ready' }],
    quizzes: [],
    quiz_share_codes: [],
    users: [{ name: 'Amina Testwala' }],
  });
  Flags.reset();
}

test('the copy\'s returnLine answers a Promise of the line (switch on) or of "" (off): callers await it', async () => {
  seed(true);
  const p = Copy.returnLine('en');
  expect(typeof p.then).toBe('function');
  expect(await p).toBe(LINE('en'));
  seed(false);
  expect(await Copy.returnLine('ur')).toBe('');
});

const withStories = fs.existsSync(STORY_MODULE) ? test : test.skip;

withStories('a story class message ends with the return line (switch on); off → today\'s message, no line', async () => {
  const Story = require(STORY_MODULE);
  seed(true);
  if (Story._reset) Story._reset();
  const on = await Story.prepare({ uid: TEACHER, storyId: BOOK });
  expect(on.out.class_message.endsWith(`\n\n${LINE('en')}`)).toBe(true);
  expect(decodeURIComponent(on.out.wa_href.slice('https://wa.me/?text='.length))).toBe(on.out.class_message);
  seed(false);
  if (Story._reset) Story._reset();
  const off = await Story.prepare({ uid: TEACHER, storyId: BOOK });
  expect(off.out.class_message).not.toContain('wa.me/15550001111');
  expect(on.out.class_message.startsWith(off.out.class_message)).toBe(true);
});
