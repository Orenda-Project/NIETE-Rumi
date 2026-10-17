/**
 * Every URL a storybook code answers (boot `story`, app_settings web_quiz_stories_teacher), as a page and as the
 * link preview WhatsApp fetches (answered from the bot's kept facts), in English, Urdu and Urdu with the finish card's
 * Urdu digits: never a quiz's words, never the class scoreboard picture. /schools is the weekly school league for any
 * code, by design, and is the one allowed exception.
 */
const { renderQuizPage, renderPreviewPage } = require('../routes/web-quiz.routes');
const BotOg = require('../../bot/shared/services/quiz/web-quiz-og');

const BOOK = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEACH = 't.MzMzMzMzMzNDM0MzMzMzMw.abcdefghijkl';
const CARD = 'c.Kid0000000001.abcdefghijkl';
const K = 'k'.repeat(48);
const ART = { class: 'l.AB12CD.v1bw_tRX32tq', teach: TEACH, teach_v: '0a1b2c3d' };
const BASE = { quiz: { id: 'q-1', code: 'AB12CD', topic: 'Book 1 Testwala', lang: 'en', dir: 'ltr', n: 0, questions: [] },
  cls: { label: 'Class 2', teacher: 'Teacher', chips: [] }, live: {}, video: null, preview: false, art: ART,
  story: { id: BOOK, from_teacher: true, code: 'AB12CD' } };
const LANGS = {
  en: BASE,
  ur: { ...BASE, quiz: { ...BASE.quiz, lang: 'ur', dir: 'rtl' } },
  ur_card_v3: { ...BASE, quiz: { ...BASE.quiz, lang: 'ur', dir: 'rtl' }, card_v3: true },
};
// The six URLs: the class link, the teacher's reminder (?v=), a child's own card (?a=), the finish card (?k=), the
// class view and the schools league.
const URLS = {
  '/q/<code>': { view: 'quiz' },
  '/q/<code>?v=5': { view: 'quiz', v: '5' },
  '/q/<code>?a=<card>': { view: 'quiz', a: CARD },
  '/q/<code>?k=<card>': { view: 'quiz', k: K },
  '/q/<code>/class': { view: 'class' },
  '/q/<code>/schools': { view: 'schools' },
};
const ALLOWED = new Set(['/q/<code>/schools']);
const QUIZ_WORDS = /quiz|questions|league|کوئز|سوال|لیگ/i;
const ogMeta = (html, prop) => ((html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`)) || [])[1] || '').replace(/&amp;/g, '&');
const PATHS = {
  page: (payload, u) => renderQuizPage({ payload, code: 'AB12CD', origin: 'https://x', assetV: 'v1', ...u }),
  preview: (payload, u) => renderPreviewPage({ facts: BotOg.facts(payload), code: 'AB12CD', origin: 'https://x', assetV: 'v1', ...u }),
};

const rows = [];
Object.keys(URLS).forEach((url) => Object.keys(PATHS).forEach((path) => Object.keys(LANGS).forEach((lang) => rows.push([url, path, lang]))));

test.each(rows.filter(([url]) => !ALLOWED.has(url)))('%s as a %s (%s): a story, never a quiz\'s words or the scoreboard picture', (url, path, lang) => {
  const html = PATHS[path](LANGS[lang], URLS[url]);
  const title = ogMeta(html, 'og:title');
  const desc = ogMeta(html, 'og:description');
  expect(title).toContain('Testwala');
  expect(`${title} ${desc}`).not.toMatch(QUIZ_WORDS);
  expect(ogMeta(html, 'og:image')).not.toMatch(/\/art\/class\.jpg/);
});

test('a child\'s own card link (?a=, ?k=) keeps the child\'s own picture', () => {
  expect(ogMeta(PATHS.page(BASE, URLS['/q/<code>?a=<card>']), 'og:image')).toBe(`https://x/q/AB12CD/art/card.jpg?a=${CARD}`);
  expect(ogMeta(PATHS.page(BASE, URLS['/q/<code>?k=<card>']), 'og:image')).toBe(`https://x/wq/card/${K}.png`);
});

test('the one allowed exception, /schools, is the weekly school league for any code', () => {
  expect(ogMeta(PATHS.page(BASE, URLS['/q/<code>/schools']), 'og:title')).toBe('School league this week');
  expect(rows.length).toBe(36);
});
