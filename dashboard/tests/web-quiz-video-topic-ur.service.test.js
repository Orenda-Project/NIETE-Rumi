/**
 * A video lesson's quiz named in Urdu letters on an Urdu screen (the bot's quiz.topic_ur / the hub rows' topic_ur,
 * app_settings web_quiz_videos_ur_titles): the Games door rows, the Home's Next tile and Games list, the quiz page's
 * own name (finish card, share sheet) and its link preview. An English screen keeps the English name; no topic_ur
 * (switch off, or no Urdu name): today's text. Invented children only.
 */
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./wq-page-harness');
const { renderPreviewPage } = require('../routes/web-quiz.routes');
const Preview = require('../routes/web-quiz-preview');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const UR = 'جنگلی اور پالتو جانور';
const EN = 'Jangli Aur Paltu Janwar';
const HUB = { lang: 'ur', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID, teacher: null, again: [], recs: [], challenge: null, lib: null, brand: 'niete', rt: false };

function load() {
  const win = {};
  const sandbox = { window: win, localStorage: { getItem: () => null, setItem() {} }, JSON, Math, String, Number, Array, Object, encodeURIComponent, Date, isFinite, RegExp };
  vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-home.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-doors.js'), 'utf8'), sandbox);
  return win;
}
const ctxOf = (lang) => ({ token: TOKEN, lang });

describe('the hub: Games door rows, the Next tile and the Games list', () => {
  const games = (ur) => [
    { kind: 'quiz', code: 'VID001', k: 'k1', topic: EN, ...(ur ? { topic_ur: UR } : {}), subject: 'Science', done: false, from: 'teacher' },
    { kind: 'quiz', code: 'VID002', k: 'k2', topic: 'Pani Ka Chakkar', ...(ur ? { topic_ur: 'پانی کا چکر' } : {}), subject: 'Science', done: true },
  ];
  const B = (ur, extra = {}) => ({ ...HUB, home_v3: 1, doors: { stories: [], games: games(ur), videos: null }, teacher: { code: 'VID001', k: 'k1', topic: EN, ...(ur ? { topic_ur: UR } : {}) }, ...extra });
  test('Urdu screen: the Games door rows show the Urdu names', () => {
    const h = load().WQDOORS.html(B(true), ctxOf('ur'), 'games', { games: [] });
    expect(h).toContain(UR);
    expect(h).toContain('پانی کا چکر');
    expect(h).not.toContain(EN);
  });
  test('Urdu screen: the "Your last quiz" row (list_states) shows the Urdu name', () => {
    const b = B(true, { list_states: 1 });
    b.doors.games[0].from = 'last';
    const h = load().WQDOORS.html(b, ctxOf('ur'), 'games', { games: [] });
    expect(h).toContain(UR);
    expect(h).not.toContain(EN);
  });
  test('English screen: the English names, whatever topic_ur says', () => {
    const h = load().WQDOORS.html(B(true), ctxOf('en'), 'games', { games: [] });
    expect(h).toContain(EN);
    expect(h).not.toContain(UR);
  });
  test('no topic_ur: today\'s rows, byte for byte', () => {
    const W = load();
    const a = W.WQDOORS.html(B(false), ctxOf('ur'), 'games', { games: [] });
    expect(a).toContain(EN);
    expect(a).not.toContain(UR);
  });
  test('the Next tile (no ranked next): the teacher\'s quiz, the quiz left open, a door\'s quiz', () => {
    const W = load();
    expect(W.WQHOME.nextOf(B(true), ctxOf('ur')).sub).toBe(UR);
    expect(W.WQHOME.nextOf(B(true), ctxOf('en')).sub).toBe(EN);
    expect(W.WQHOME.nextOf(B(false), ctxOf('ur')).sub).toBe(EN);
    const open = { ...B(true), teacher: null, last: { code: 'VID001', k: 'k1', state: 'open', topic: EN, topic_ur: UR } };
    expect(W.WQHOME.nextOf(open, ctxOf('ur')).sub).toBe(UR);
    const door = { ...B(true), teacher: null };
    expect(W.WQHOME.nextOf(door, ctxOf('ur')).sub).toBe(UR);
  });
  test('the Home\'s own Games list (wq-home door)', () => {
    const W = load();
    const ur = W.WQHOME.door(B(true), ctxOf('ur'), 'games');
    expect(ur).toContain(UR);
    expect(ur).not.toContain(EN);
    expect(W.WQHOME.door(B(true), ctxOf('en'), 'games')).toContain(EN);
  });
});

describe('the quiz page: the finish card and its share', () => {
  const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
  const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 }, art: { card: 'c.x' } };
  const store = { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } };
  const waText = (p) => { const m = /id="wq-wa"(?: target="_blank" rel="noopener")? href="([^"]+)"/.exec(p.html()); return m ? decodeURIComponent(m[1].replace(/&amp;/g, '&').replace(/^https:\/\/wa\.me\/\?text=/, '')) : ''; };
  const card = (o) => { const p = page({ store, topic: EN, ...o }); return { html: p.html(), share: (p.els['#wq-share'].fire('click'), waText(p)) }; };
  test('an English quiz on an Urdu page (ui_lang ur): the Urdu name on the card and in the share', () => {
    const c = card({ lang: 'en', bootExtra: { ui_lang: 'ur' }, quizExtra: { topic_ur: UR } });
    expect(c.html).toContain('<p class="wq-sub wq-ctopic">' + UR + '</p>');
    expect(c.html).not.toContain(EN);
    expect(c.share).toContain(UR);
    expect(c.share).not.toContain(EN);
  });
  test('an Urdu quiz page: the Urdu name', () => {
    const c = card({ lang: 'ur', quizExtra: { topic_ur: UR } });
    expect(c.html).toContain('<p class="wq-sub wq-ctopic">' + UR + '</p>');
    expect(c.share).toContain(UR);
  });
  test('an English page keeps the English name; no topic_ur: today\'s card, byte for byte', () => {
    const en = card({ lang: 'en', quizExtra: { topic_ur: UR } });
    expect(en.html).toContain('<p class="wq-sub wq-ctopic">' + EN + '</p>');
    expect(en.share).not.toContain(UR);
    expect(card({ lang: 'en', bootExtra: { ui_lang: 'ur' } })).toEqual(card({ lang: 'en', bootExtra: { ui_lang: 'ur' }, quizExtra: {} }));
    expect(card({ lang: 'en', bootExtra: { ui_lang: 'ur' } }).html).toMatch(/wq-ctopic">(<span class="wq-lat" lang="en">)?Jangli Aur Paltu Janwar/);
  });
});

describe('the link preview (og:title)', () => {
  const facts = (lang, ur) => Preview.ogFacts({ quiz: { lang, topic: EN, n: 5, ...(ur ? { topic_ur: UR } : {}) }, cls: { label: 'Class 3' }, art: {}, brand: null });
  const title = (html) => /<meta property="og:title" content="([^"]*)"/.exec(html)[1];
  const render = (f, linkLang) => renderPreviewPage({ facts: f, code: 'VID001', origin: 'https://example.test', assetV: '1', url: 'https://example.test/q/VID001', linkLang });
  test('the facts carry topic_ur only when the quiz has one', () => {
    expect(facts('ur', false).quiz).toEqual({ lang: 'ur', topic: EN, n: 5 });
    expect(facts('ur', true).quiz).toEqual({ lang: 'ur', topic: EN, n: 5, topic_ur: UR });
  });
  test('an Urdu preview names the lesson in Urdu; an English one keeps English; none: today\'s', () => {
    expect(title(render(facts('ur', true)))).toContain(UR);
    expect(title(render(facts('en', true), 'ur'))).toContain(UR);
    expect(title(render(facts('en', true)))).toContain(EN);
    expect(title(render(facts('en', true)))).not.toContain(UR);
    expect(render(facts('ur', false))).toBe(render(Preview.ogFacts({ quiz: { lang: 'ur', topic: EN, n: 5 }, cls: { label: 'Class 3' }, art: {}, brand: null })));
    expect(title(render(facts('ur', false)))).toContain(EN);
  });
});
