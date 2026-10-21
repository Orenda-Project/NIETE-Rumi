/**
 * The child's name in the English share words, isolated (app_settings web_quiz_share_name_bidi → the bot's
 * `name_bidi: true` beside the card's field; default OFF). The Urdu share words already wrap the name and the quiz's
 * name in first-strong isolates (U+2068 … U+2069); the English ones did not, so a name written in Urdu script turned the
 * whole English line right to left in WhatsApp («محمدعبدالرحمان got 3/8 stars on …» laid out from the right).
 * On, an English page wraps the name and the quiz's name in the same isolates in each line a child sends. Off (absent
 * or anything but true), and on an Urdu page: today's words, byte for byte.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { page } = require('./wq-page-harness');

const FC_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js'), 'utf8');
const NAME = 'محمدعبدالرحمان';
const TOPIC = 'Rocket and Space Vocabulary';
const L = '⁨';
const R = '⁩';
const words = (T, name = NAME, topic = TOPIC) => [T.shareLine(name, 3, 8, topic), T.sharePlayed(name, topic), T.chalLine(name, 3, 8, topic), T.chalPlayed(name, topic)];
const TODAY_EN = [
  `${NAME} got 3/8 stars on ${TOPIC}. Can you beat it?`,
  `${NAME} played ${TOPIC}. Your turn!`,
  `${NAME} here! I got 3/8 stars on ${TOPIC}. Can you beat me? 🏆 Tap the link to play:`,
  `${NAME} here! I played ${TOPIC}. Your turn! Tap the link to play:`,
];

describe('on: the English share words isolate the name and the quiz\'s name', () => {
  const T = () => page({ lang: 'en', bootExtra: { name_bidi: true } }).wq.T;
  test('the four lines a child sends', () => {
    expect(words(T())).toEqual([
      `${L}${NAME}${R} got 3/8 stars on ${L}${TOPIC}${R}. Can you beat it?`,
      `${L}${NAME}${R} played ${L}${TOPIC}${R}. Your turn!`,
      `${L}${NAME}${R} here! I got 3/8 stars on ${L}${TOPIC}${R}. Can you beat me? 🏆 Tap the link to play:`,
      `${L}${NAME}${R} here! I played ${L}${TOPIC}${R}. Your turn! Tap the link to play:`,
    ]);
  });
  test('a Latin name is isolated the same way (one rule for every child)', () => {
    expect(T().shareLine('Iqra', 3, 8, TOPIC)).toBe(`${L}Iqra${R} got 3/8 stars on ${L}${TOPIC}${R}. Can you beat it?`);
  });
  test('the line starts with the isolate, so WhatsApp reads the bubble left to right', () => {
    for (const s of words(T())) expect(s.charAt(0)).toBe(L);
  });
});

describe('off, or Urdu: today\'s words byte for byte', () => {
  test.each([[{}], [{ name_bidi: false }], [{ name_bidi: 'true' }], [{ name_bidi: 1 }]])('English, boot %j', (extra) => {
    expect(words(page({ lang: 'en', bootExtra: extra }).wq.T)).toEqual(TODAY_EN);
  });
  test.each([[{}], [{ ur_share: true }]])('Urdu, boot %j: the switch changes nothing', (extra) => {
    const a = words(page({ lang: 'ur', bootExtra: extra }).wq.T, 'نور', 'پودے');
    const b = words(page({ lang: 'ur', bootExtra: { ...extra, name_bidi: true } }).wq.T, 'نور', 'پودے');
    expect(b).toEqual(a);
  });
  test('the finish card\'s HTML is today\'s with the switch off', () => {
    const CHILD = { first: 'Noor Testwala', chip: 'c1', animal: 'owl' };
    const RESULT = { card: { first: 'Noor', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5, pct: 60 }, card_v3: true, no_class: true };
    const html = (extra) => {
      const p = page({ lang: 'en', bootExtra: extra, store: { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT, vdone: true } } });
      vm.runInContext(FC_SRC, p.ctx);
      p.wq.card();
      return p.html();
    };
    expect(html({ name_bidi: false })).toBe(html({}));
    expect(html({ name_bidi: 'true' })).toBe(html({}));
  });
});
