/**
 * List separators on a polished Urdu page (app_settings web_quiz_ur_polish → `wq-ur2` on <html>). In Nastaliq the
 * middle dot «·» reads as the zero digit «۰», so every Urdu list joins with «، » instead: the school league's rule, the
 * "my sector" chip, the second-try chip and the practice line (the door's from/meta lines already do). The league's
 * movement arrows carry Urdu digits, like the rank beside them. English and Urdu without the polish are unchanged.
 * Runs the whole shipped page in the harness's vm; the bot API is the faked boundary.
 */
const { page, flush } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
const finished = () => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } });
const row = (place, name, points, kids, move, extra = {}) => ({ place, name, sector: 'ict', points, kids, move, ...extra });
const BOARD = {
  week_start: '2026-10-05', class_doors: true,
  rows: [row(1, 'School Bravo', 30, 4, 1), row(2, 'School Alpha', 20, 3, -1, { mine: true }), row(3, 'School Charlie', 15, 1, 'new')],
  mine: { place: 2, name: 'School Alpha', sector: 'ict', points: 20, kids: 3, move: -1 },
  ranked_n: 3, zero_n: 0,
};
const boot = (ur2) => (ur2 ? { ui: { ur2: true } } : {});

async function league(lang, ur2) {
  const p = page({ lang, store: finished(), view: 'schools', api: { '/schools/TEST': BOARD }, bootExtra: boot(ur2) });
  await flush(); await flush();
  expect(p.moment()).toBe('M16');
  return p.html();
}
const moves = (h) => Array.from(h.matchAll(/<span class="wq-move wq-(?:up|down)" dir="ltr">([^<]*)<\/span>/g), (m) => m[1]);

// The result screen's practice line (a round that does not count, the kept first score shown).
async function practice(lang, ur2) {
  const p = page({
    lang, bootExtra: boot(ur2),
    store: { wq_s_TEST: { st: 'new-st', child: CHILD, answers: { q1: { slot: 'B', ok: false } }, queue: [], result: null } },
    api: { finish: { score: { correct: 2, total: 5, pct: 40 }, counted: false, reason: 'already_finished', card_v3: true,
      card: { first: 'Zara', animal: 'owl', correct: 2, total: 5, stars: 2, practice: true, kept: { correct: 4, total: 5 } } } },
  });
  p.wq.S.st = p.wq.S.st || 'new-st';
  p.wq.results(0);
  await flush(); await flush(); await flush();
  expect(p.moment()).toBe('M9');
  return p.html();
}

describe('list separators with the Urdu polish', () => {
  test('the school league: the rule and the "my sector" chip join with «، », never «·»', async () => {
    const h = await league('ur', true);
    expect(h).toContain('<p class="wq-sub">اس ہفتے، کھیلنے کے ۱۰ پوائنٹس، اسکور کے ۱۰ تک</p>');
    expect(h).toContain('میرا سیکٹر، <bdi>ICT</bdi>');
    expect(h).not.toContain('·');
  });

  test('the league\'s movement arrows carry Urdu digits, like the rank', async () => {
    expect(moves(await league('ur', true))).toEqual(['▲۱', '▼۱']);
  });

  test('the copy: the second-try chip and the door\'s from/meta lines have no «·»', () => {
    const { T } = page({ lang: 'ur', bootExtra: boot(true) }).wq;
    expect(T.second).not.toContain('·');
    expect(T.second).toMatch(/^دوسری کوشش، /);
    expect(T.from('Teacher', 'Class 3')).not.toContain('·');
    expect(T.meta(5)).not.toContain('·');
  });

  test('the practice line joins with «، »', async () => {
    const h = await practice('ur', true);
    expect(h).toContain('مشق کا راؤنڈ، پہلی بار کا اسکور ۴/۵ شمار ہوتا ہے');
    expect(h).not.toContain('·');
  });
});

describe('without the polish, and in English, nothing changes', () => {
  test('Urdu without the polish keeps today\'s «·» and Western arrow digits', async () => {
    const h = await league('ur', false);
    expect(h).toContain('<p class="wq-sub">اس ہفتے · کھیلنے کے ۱۰ پوائنٹس، اسکور کے ۱۰ تک</p>');
    expect(h).toContain('میرا سیکٹر · <bdi>ICT</bdi>');
    expect(moves(h)).toEqual(['▲1', '▼1']);
    const { T } = page({ lang: 'ur' }).wq;
    expect(T.second).toMatch(/^دوسری کوشش · /);
    expect(await practice('ur', false)).toContain('مشق کا راؤنڈ · پہلی بار کا اسکور ۴/۵ شمار ہوتا ہے');
  });

  test('an English league and practice line never change, with or without the polish in the boot', async () => {
    const off = await league('en', false);
    expect(await league('en', true)).toBe(off);
    expect(off).toContain('This week · 10 points for playing');
    expect(off).toContain('My sector · <bdi>ICT</bdi>');
    expect(moves(off)).toEqual(['▲1', '▼1']);
    // the practice banner only: Jugnu's line above it is picked at random
    const banner = (h) => /<div class="wq-banner">([^<]*)<\/div>/.exec(h)[1];
    const poff = banner(await practice('en', false));
    expect(banner(await practice('en', true))).toBe(poff);
    expect(poff).toBe('Practice round · your first score 4/5 is the one that counts');
  });
});
