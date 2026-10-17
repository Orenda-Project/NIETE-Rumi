'use strict';
/**
 * The hub switches that ride the home's one settings read (web-quiz-hub-switches.js) read their rows through the one
 * shared reader (shared/services/quiz/is-true.js): JSON true is on; a string ('true', '"true"', ' TRUE '), 'yes', 'on',
 * 1, null or {enabled:true} is off, with every other switch JSON true.
 */
const db = { rows: {} };
jest.mock('../../../shared/config/supabase', () => {
  const table = (name) => {
    const f = {};
    const rows = () => {
      if (name !== 'app_settings') return [];
      let r = Object.entries(db.rows).map(([key, value]) => ({ key, value }));
      if (f.eq) r = r.filter((x) => x[f.eq[0]] === f.eq[1]);
      if (f.in) r = r.filter((x) => f.in[1].includes(x[f.in[0]]));
      return r;
    };
    const q = {
      select: () => q, order: () => q, limit: () => q, abortSignal: () => q,
      eq: (c, v) => { f.eq = [c, v]; return q; },
      in: (c, v) => { f.in = [c, v]; return q; },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: null }),
      then: (ok, bad) => Promise.resolve({ data: rows(), error: null }).then(ok, bad),
    };
    return q;
  };
  return { from: table, rpc: async () => ({ data: null, error: null }) };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

// Every switch these modules read, JSON true (each row then sets its own key to the value under test).
const SWITCHES = ['web_quiz_home_v3', 'web_quiz_stories', 'web_quiz_stories_band', 'web_quiz_readalong', 'web_quiz_live_read_v3',
  'web_quiz_challenge_realtime', 'web_quiz_card_v3', 'web_quiz_next_offer', 'web_quiz_events_v3', 'web_quiz_juice', 'web_quiz_fast'];

// [module, its own switch key, how the module answers "is it on?"]
const SITES = [
  ['web-quiz-home-flags', 'web_quiz_home_v3', async (M) => (await M.flags()).home],
  ['web-quiz-stories', 'web_quiz_stories', (M) => M.storiesOn()],
  ['web-quiz-card-image', 'web_quiz_card_v3', (M) => M.on()],
  ['web-quiz-next-offer-state', 'web_quiz_next_offer', async (M) => (await M.raw()).on],
  ['web-quiz-juice', 'web_quiz_juice', (M) => M.flag()],
  ['web-quiz-return-lang', 'web_quiz_return_lang', (M) => M.on()],
];
const OFF = ['true', '"true"', ' TRUE ', 'yes', 'on', 1, null, { enabled: true }];

async function readWith([mod, key, read], own) {
  jest.resetModules();
  db.rows = { ...Object.fromEntries(SWITCHES.map((k) => [k, true])), [key]: own };
  return read(require(`../../../shared/services/quiz/${mod}`));
}

describe('a hub switch on the one read: JSON true is on, anything else is off', () => {
  test.each(SITES.map((s) => [s[0], s]))('%s', async (_, site) => {
    expect(await readWith(site, true)).toBe(true);
    for (const v of OFF) expect([JSON.stringify(v), await readWith(site, v)]).toEqual([JSON.stringify(v), false]);
  });

  test('each module reads through the shared reader (no local copy)', () => {
    const fs = require('fs');
    const path = require('path');
    for (const [mod] of SITES) {
      const src = fs.readFileSync(path.join(__dirname, `../../../shared/services/quiz/${mod}.js`), 'utf8');
      expect([mod, /require\('\.\/is-true'\)/.test(src), /function isTrue|const isTrue = \(/.test(src)]).toEqual([mod, true, false]);
    }
  });
});
