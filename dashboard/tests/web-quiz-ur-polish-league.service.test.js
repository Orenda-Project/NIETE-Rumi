/**
 * The school league on a polished Urdu page (app_settings web_quiz_ur_polish → `wq-ur2` on <html>): one digit system.
 * Ranks are Urdu digits, like the counts beside them and the class table's places, and a thousands group is split with
 * the Arabic separator «٬» (U+066C) from five digits up (a four-digit count prints whole, as school books do), never a
 * Latin comma inside Urdu digits. Without the polish, and in English, the
 * league prints exactly as before. Runs the whole shipped page in the harness's vm; the bot API is the faked boundary.
 */
const { page, flush } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
const finished = () => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } });
const row = (place, name, points, kids, move, extra = {}) => ({ place, name, sector: 'Sector One', points, kids, move, ...extra });
const BOARD = {
  week_start: '2026-10-05',
  rows: [
    row(1, 'School Bravo', 23150, 1087, 1),
    row(2, 'School Alpha', 610, 40, -1, { mine: true }),
    row(12, 'School Charlie', 15, 1, 'new'),
  ],
  mine: { place: 2, name: 'School Alpha', sector: 'Sector One', points: 610, kids: 40, move: -1 },
  ranked_n: 3, zero_n: 1312,
};

async function open(lang, ur2) {
  const p = page({ lang, store: finished(), view: 'schools', api: { '/schools/TEST': BOARD }, bootExtra: ur2 ? { ui: { ur2: true } } : {} });
  await flush();
  await flush();
  return p;
}
const places = (h) => Array.from(h.matchAll(/<span class="wq-splace">([^<]*)<\/span>/g), (m) => m[1]);

describe('the school league with the Urdu polish', () => {
  test('ranks are Urdu digits, matching the counts beside them', async () => {
    const p = await open('ur', true);
    expect(p.moment()).toBe('M16');
    expect(places(p.html())).toEqual(['۱', '۲', '۱۲']);
  });

  test('a four-digit count prints whole; five digits up split with «٬», never a Latin comma inside Urdu digits', async () => {
    const h = (await open('ur', true)).html();
    expect(h).toContain('۲۳٬۱۵۰ پوائنٹس');
    expect(h).toContain('۱۰۸۷ بچوں نے کھیلا');
    expect(h).toContain('۱۳۱۲ اسکول ابھی شروع نہیں ہوئے');
    expect(h).not.toMatch(/[۰-۹],[۰-۹]/);
  });

  test('without the polish the Urdu league prints exactly as before', async () => {
    const h = (await open('ur', false)).html();
    expect(places(h)).toEqual(['1', '2', '12']);
    expect(h).toContain('۲۳,۱۵۰ پوائنٹس');
    expect(h).toContain('۱,۰۸۷ بچوں نے کھیلا');
    expect(h).not.toContain('٬');
  });

  test('an English league never changes, with or without the polish in the boot', async () => {
    const off = (await open('en', false)).html();
    const on = (await open('en', true)).html();
    expect(on).toBe(off);
    expect(places(on)).toEqual(['1', '2', '12']);
    expect(on).toContain('23,150 points');
    expect(on).toContain('1,312 schools still to start');
  });
});
