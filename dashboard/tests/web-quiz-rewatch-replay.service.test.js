/**
 * A finished lesson opened again (?again=1, the rewatch path of app_settings web_quiz_rewatch_done; the bot names the
 * switch on the quiz answer as `rewatch_done: true`): the lesson page says it is a replay — a "Done watching ✓" chip on
 * the video (T.watched + the tick icon) and the way into the questions reads "Play again" (T.playAgain, the hub's own
 * words). Everything else as today. A page without again=1, and the switch off, are byte-identical to the base
 * (goldens hashed on origin/sandbox before this change). Invented children only.
 */
const crypto = require('crypto');
const { page, flush } = require('./wq-page-harness');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const CHILD = { first: 'Zara', chip: 'kk3', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, score: { correct: 3, total: 5 } };
const STORE = { wq_s_TEST: { st: 's1', child: CHILD, answers: { q1: { slot: 'A', ok: true } }, queue: [], result: RESULT }, wq_kids: [CHILD] };
// door: from the Videos door (via=videos, the play first); lib: from the library page (no via)
const SEARCH = { door: '?k=kk3&via=videos', lib: '?k=kk3' };
async function lessonPage({ lang, from, again, on }) {
  const p = page({ lang, store: STORE, search: SEARCH[from] + (again ? '&again=1' : ''), ident: true,
    video: { url: 'https://r2.example.test/v3_web.mp4?sig', poster: 'https://r2.example.test/p3_poster.jpg?sig' },
    bootExtra: { videos_v3: true, ...(on ? { rewatch_done: true } : {}), cls: { label: 'Class 3-B', teacher: 'Ms Testwala', chips: [], identity: { mode: 'v2' } } },
    api: { '/session': { st: 's2', child: CHILD, counted: false, reason: 'already_finished' } } });
  await flush(); await flush();
  return p;
}
const PLAY_AGAIN = { en: 'Play again', ur: 'دوبارہ کھیلیں' };
const WATCHED = { en: 'Done watching', ur: 'دیکھ لیا' };

// sha of the page HTML on origin/sandbox before this change, for every page that must stay as it is
// written by running this file on origin/sandbox a860471ae with GOLDEN_PRINT=1
const GOLD = {
  'en.door.on_plain': '04916c25793b3a39',
  'en.door.off_again': '7f71e5943d630f4f',
  'en.door.off_plain': '04916c25793b3a39',
  'en.lib.on_plain': '04916c25793b3a39',
  'en.lib.off_again': '007d8b238cfcf84e',
  'en.lib.off_plain': '04916c25793b3a39',
  'ur.door.on_plain': '07fd5720c31da972',
  'ur.door.off_again': '3654685000773a2a',
  'ur.door.off_plain': '07fd5720c31da972',
  'ur.lib.on_plain': '07fd5720c31da972',
  'ur.lib.off_again': '72d082b6e4a60df6',
  'ur.lib.off_plain': '07fd5720c31da972',
};

describe('goldens: no again=1, or the switch off, are today\'s pages byte for byte', () => {
  test('every language × door × (switch on without again, switch off with again, switch off without again)', async () => {
    const got = {};
    for (const lang of ['en', 'ur']) for (const from of ['door', 'lib']) {
      for (const [k, o] of [['on_plain', { on: true, again: false }], ['off_again', { on: false, again: true }], ['off_plain', { on: false, again: false }]]) {
        const p = await lessonPage({ lang, from, ...o });
        got[`${lang}.${from}.${k}`] = sha(p.html());
      }
    }
    if (process.env.GOLDEN_PRINT) console.log(JSON.stringify(got));
    expect(got).toEqual(GOLD);
  });
});

describe('switch on, again=1: the lesson page says it is a replay', () => {
  test.each([['en', 'door'], ['ur', 'door'], ['en', 'lib'], ['ur', 'lib']])('%s from the %s: the chip on the video, "Play again" into the questions; the rest as the switch-off page', async (lang, from) => {
    const p = await lessonPage({ lang, from, again: true, on: true });
    const off = await lessonPage({ lang, from, again: true, on: false });
    expect(p.moment()).toBe('M5');
    const h = p.html();
    expect(h).toMatch(new RegExp('<div class="wq-vbox"><span class="wq-vdone wq-vwatched">' + WATCHED[lang] + ' (<svg|✓)')); // the tick icon (the harness has no icon set: its ✓ stand-in)
    expect(h).toMatch(new RegExp('id="wq-skip"[^>]*>' + PLAY_AGAIN[lang] + '</button>'));
    // nothing else moves: the off page with the chip taken out and today's skip words swapped back is the same page
    const back = h.replace(/<span class="wq-vdone wq-vwatched">[\s\S]*?<\/span>/, '').replace('>' + PLAY_AGAIN[lang] + '</button>', '>' + p.wq.T.skip + '</button>');
    expect(back).toBe(off.html());
  });
  test('the chip is a label, not a button: one primary as before', async () => {
    for (const from of ['door', 'lib']) {
      const on = (await lessonPage({ lang: 'en', from, again: true, on: true })).html();
      const off = (await lessonPage({ lang: 'en', from, again: true, on: false })).html();
      expect((on.match(/data-primary/g) || []).length).toBe((off.match(/data-primary/g) || []).length);
    }
  });
});
