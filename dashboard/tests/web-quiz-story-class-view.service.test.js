/**
 * A storybook the teacher sent (boot `story`, app_settings web_quiz_stories_teacher), opened on its class view
 * (/q/<code>/class): a story has no league table, so the page opens the story's own landing, never the class board.
 * A quiz's class view is today's board. Runs the whole shipped page in the harness's vm.
 */
const { page } = require('./wq-page-harness');

const BOOK = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const boardAsked = (p) => p.fetches.some((f) => /\/api\/wq\/board\//.test(f.url));

test('a story\'s /class link opens the story\'s landing; the class board is never asked for', () => {
  const p = page({ lang: 'en', view: 'class', topic: 'Book 1 Testwala', bootExtra: { story: { id: BOOK, from_teacher: true, code: 'TEST' } } });
  expect(p.moment()).toBe('M3');
  expect(boardAsked(p)).toBe(false);
});

test('a quiz\'s /class link is today\'s class board', () => {
  const p = page({ lang: 'en', view: 'class' });
  expect(p.moment()).toBe('M11-wait');
  expect(boardAsked(p)).toBe(true);
});
