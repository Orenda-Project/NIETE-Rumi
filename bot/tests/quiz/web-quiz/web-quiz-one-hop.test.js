'use strict';
/**
 * The shelf, the videos door and a story open in one hop: its own switch (app_settings web_quiz_one_hop, default off,
 * only the JSON boolean true, 30 s cache, fail closed), on only together with the fast first page (web_quiz_fast).
 *
 * On (both): the hub's answer (the internal GET /hub/:token) says `one_hop: true`. Off: the hub's answer is today's,
 * byte for byte (web-quiz-hub.js's own answer, untouched by this switch). The switch costs the hub no serial wave and no
 * app_settings read of its own on a warm hub; with web_quiz_fast off it is never read at all.
 * A wave = every database read that is in flight together; the fake answers each wave after a short tick.
 * Supabase and Redis are the boundaries and are faked; every first-party module on the path runs for real.
 * Children and books are invented ("Testwala").
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Play = require('../../../shared/services/quiz/web-quiz-hub-play');
const Home = require('../../../shared/services/quiz/web-quiz-hub-home');
const Stories = require('../../../shared/services/quiz/web-quiz-stories');
const Fast = require('../../../shared/services/quiz/web-quiz-fast');

// Required on use: the tests below are seen failing on the code without this switch (no such module there).
const Hop = () => require('../../../shared/services/quiz/web-quiz-one-hop');

const KID = '44444444-4444-4444-8444-000000000091';
const TEACHER = '11111111-1111-4111-8111-000000000091';
const LIST = '55555555-5555-4555-8555-000000000091';
const BOOK = '5b000091-0000-4000-8000-000000000000';
const NOW = Date.now();
const ago = (h) => new Date(NOW - h * 3600000).toISOString();
const ahead = (h) => new Date(NOW + h * 3600000).toISOString();
const TRUE = (k) => ({ key: k, value: true });
// The v3 home with its storybook shelf and the fast first page: the hub the one-hop open builds on.
const HOME = ['web_quiz_hub', 'web_quiz_challenge', 'web_quiz_child_quiz_home', 'web_quiz_library', 'web_quiz_home_v3', 'web_quiz_stories', 'web_quiz_fast'].map(TRUE);
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
const OFF_VALUES = [['the string "true"', 'true'], ['the string \'"true"\'', '"true"'], ['"yes"', 'yes'], ['1', 1], ['{enabled:true}', { enabled: true }], ['false', false], ['null', null]];

// The hub's waves and app_settings reads on a warm hub (fast on), measured with the product at the base (the code before
// this switch): the internal GET /hub/:token answered Hub.hub there.
const BASE_WARM_WAVES = 7;
const BASE_WARM_SETTINGS_READS = 0;

let waves = 0;
let settingsReads = 0;
let batch = null;
let failSettings = false;
let failOneHop = false; // only the one-hop switch's own read fails (every other switch reads as usual)
function seed(settings) {
  const fake = makeFake({
    app_settings: settings,
    students: [{ id: KID, student_name: 'Zara Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '+92300FIXTURE9', created_at: ago(500) }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [{ id: 'q-1', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: null }],
    quiz_share_codes: [{ id: 'sc-1', code: 'MATH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(30) }],
    quiz_sessions: [{ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 8, total_questions_answered: 10, mastery_percentage: 80, completed_at: ago(1), created_at: ago(1), student_class: '3' }],
    story_books: [{ id: BOOK, title: 'Book Testwala', grade: 3, lang: 'en', status: 'ready', pages: 2, cover_file: 'cover-aaaa0091.webp' }],
    story_events: [],
  });
  // every read waits for its wave: reads started before the tick share it
  const wave = (q) => {
    const then = q.then.bind(q);
    q.then = (res, rej) => new Promise((go) => {
      if (!batch) { batch = []; setTimeout(() => { const b = batch; batch = null; waves += 1; b.forEach((f) => f()); }, 2); }
      batch.push(go);
    }).then(() => then(res, rej));
    return q;
  };
  Object.assign(supabase, {
    from: (t) => {
      if (t === 'app_settings') { settingsReads += 1; if (failSettings) throw new Error('db down'); }
      const q = fake.from(t);
      if (t === 'app_settings' && failOneHop) {
        const eq = q.eq.bind(q);
        q.eq = (c, v) => (v === 'web_quiz_one_hop' ? { maybeSingle: () => Promise.resolve({ data: null, error: { message: 'db down' } }) } : eq(c, v));
      }
      return wave(q);
    },
    rpc: fake.rpc,
  });
  Hub._resetCache(); Play._resetCache(); Home._resetCache(); Stories._reset(); Fast._reset();
  try { Hop()._reset(); } catch (_) { /* the code without the switch */ }
}
// The hub's links carry a hub token signed with an expiry in seconds (today too): two opens a second apart differ there
// alone, so the answers are compared with that token written as <t>; every other byte is compared as it is.
const bytes = (o) => JSON.stringify(o).replace(/\/lib\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\?/g, '/lib/<t>?');
const tick = () => new Promise((r) => setTimeout(r, 10));
// The internal route's answer for this hub, as web-quiz-internal.routes.js GET /hub/:token builds it (the route itself:
// the last test).
const answer = async (tok) => Hop().mark(await Hub.hub(tok, A));
async function warmed(settings) {
  seed(settings);
  Fast.on(); await tick(); // the fast switch's own background read (never waited for), done before the hub opens
  await answer(T.signHub([KID]));
  await tick(); // any background switch read the first open started
  waves = 0; settingsReads = 0;
  const out = await answer(T.signHub([KID]));
  return { waves, settingsReads, out };
}

beforeEach(() => { process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-one-hop-secret'; failSettings = false; failOneHop = false; waves = 0; settingsReads = 0; });

describe('the switch (web-quiz-one-hop.js)', () => {
  test('its own key, default off; only the JSON boolean true is on', async () => {
    seed([TRUE('web_quiz_fast'), TRUE('web_quiz_one_hop')]);
    expect(Hop().KEY).toBe('web_quiz_one_hop');
    expect(await Hop().flag()).toBe(true);
    seed([TRUE('web_quiz_fast')]);
    expect(await Hop().flag()).toBe(false);
  });
  test.each(OFF_VALUES)('a stored %s is off', async (_, value) => {
    seed([TRUE('web_quiz_fast'), { key: 'web_quiz_one_hop', value }]);
    expect(await Hop().flag()).toBe(false);
    Fast.on(); Hop().own(); await tick();
    expect(Fast.on()).toBe(true);
    expect(Hop().on()).toBe(false);
  });
  test('a failed read is off (fail closed)', async () => {
    seed([TRUE('web_quiz_fast'), TRUE('web_quiz_one_hop')]);
    failSettings = true;
    expect(await Hop().flag()).toBe(false);
    expect(Hop().own()).toBe(false);
  });
  test('the first read after a start is off (never waited for); a value is kept 30 s', async () => {
    const settings = [TRUE('web_quiz_fast'), { key: 'web_quiz_one_hop', value: false }];
    seed(settings);
    Fast.on();
    const t0 = Date.now();
    expect(Hop().own(t0)).toBe(false);
    await tick();
    expect(Hop().own(t0)).toBe(false);
    settings[1].value = true;
    expect(Hop().own(t0 + 29000)).toBe(false);
    await tick();
    expect(Hop().own(t0 + 29000)).toBe(false);
    expect(Hop().own(Date.now() + 31000)).toBe(false); // stale: answers the old value, reads again behind it
    await tick();
    expect(Hop().own()).toBe(true);
    expect(Hop().on()).toBe(true);
  });
  test('without the fast first page it is off and never read (fast off: no app_settings read for it at all)', async () => {
    seed([TRUE('web_quiz_one_hop')]);
    Fast.on(); await tick();
    settingsReads = 0;
    expect(Hop().on()).toBe(false);
    await tick();
    expect(Hop().on()).toBe(false);
    expect(settingsReads).toBe(0);
  });
  test('the hub\'s one switch read can carry it: its raw row fills the cache, parsed as its own read parses it', () => {
    seed([]);
    const S = Hop().hubSwitches;
    expect(S.keys).toEqual(['web_quiz_one_hop']);
    expect(S.age()).toBe('cold');
    S.prime([{ key: 'web_quiz_one_hop', value: 'true' }]);
    expect(S.peek().on).toBe(false);
    expect(S.age()).toBe('fresh');
    S.prime([{ key: 'web_quiz_one_hop', value: true }]);
    expect(S.peek().on).toBe(true);
    S.prime([]);
    expect(S.peek().on).toBe(false);
    expect(S.age(Date.now() + 31000)).toBe('stale');
  });
});

describe('the hub\'s answer', () => {
  test('both on (web_quiz_fast and web_quiz_one_hop): `one_hop: true`, and otherwise today\'s answer', async () => {
    const on = await warmed([...HOME, TRUE('web_quiz_one_hop')]);
    expect(on.out.fast).toBe(true);
    expect(on.out.one_hop).toBe(true);
    const off = await warmed(HOME);
    const { one_hop: _, ...rest } = on.out;
    expect(bytes(rest)).toBe(bytes(off.out));
  });
  test('off (no row): today\'s answer byte for byte (no `one_hop` key)', async () => {
    const off = await warmed(HOME);
    expect(off.out).not.toHaveProperty('one_hop');
    seed(HOME); Fast.on(); await tick();
    await Hub.hub(T.signHub([KID]), A); await tick();
    const today = await Hub.hub(T.signHub([KID]), A);
    expect(bytes(off.out)).toBe(bytes(today));
  });
  test.each(OFF_VALUES)('a stored %s: today\'s answer byte for byte', async (_, value) => {
    const off = await warmed(HOME);
    const odd = await warmed([...HOME, { key: 'web_quiz_one_hop', value }]);
    expect(odd.out).not.toHaveProperty('one_hop');
    expect(bytes(odd.out)).toBe(bytes(off.out));
  });
  test('a failed read of the hub\'s one settings read: today\'s answer (fail closed); and a value never primed or older than 60 s is off', async () => {
    const off = await warmed(HOME);
    seed([...HOME, TRUE('web_quiz_one_hop')]);
    const H = Hop();
    Fast.on(); await tick();
    const hub = await Hub.hub(T.signHub([KID]), A);
    expect(hub.fast).toBe(true);
    expect(H.mark(hub)).toHaveProperty('one_hop', true); // the hub's own settings read filled the switch
    H._reset();
    expect(H.mark(hub)).not.toHaveProperty('one_hop'); // nothing primed: off, with no read of its own
    H.hubSwitches.prime([TRUE('web_quiz_one_hop')], Date.now());
    expect(H.mark(hub)).toHaveProperty('one_hop', true);
    expect(H.mark(hub, Date.now() + 61 * 1000)).not.toHaveProperty('one_hop');
    H.hubSwitches.fail(Date.now()); // the hub's settings read failed
    expect(H.mark(hub)).not.toHaveProperty('one_hop');
    expect(bytes(H.mark(hub))).toBe(bytes(hub));
    expect(bytes(off.out)).toBe(bytes(await Hub.hub(T.signHub([KID]), A)));
  });
  test('the hub\'s one settings read carries the key: a warm and a stale hub make the same settings reads on and off', async () => {
    const off = await warmed(HOME);
    const on = await warmed([...HOME, TRUE('web_quiz_one_hop')]);
    expect(on.out).toHaveProperty('one_hop', true);
    expect(off.out).not.toHaveProperty('one_hop');
    expect(on.settingsReads).toBe(off.settingsReads);
    const stale = async (settings) => {
      seed(settings); Fast.on(); await tick();
      await answer(T.signHub([KID])); await tick();
      Hub._resetCache(); // the hub's own switch cache goes stale: its one read runs again, once
      settingsReads = 0;
      const out = await answer(T.signHub([KID]));
      return { out, reads: settingsReads };
    };
    const sOff = await stale(HOME);
    const sOn = await stale([...HOME, TRUE('web_quiz_one_hop')]);
    expect(sOn.reads).toBe(sOff.reads);
    expect(sOn.out).toHaveProperty('one_hop', true);
  });
  test('the one_hop row throws (in any read that names it), fast on: the hub stays on, only one_hop is off (the shared switch-off matrix\'s throwOn)', async () => {
    const { throwOn } = require('../../helpers/switch-off-matrix');
    const off = await warmed(HOME);
    seed([...HOME, TRUE('web_quiz_one_hop')]);
    supabase.from = throwOn(supabase.from, 'web_quiz_one_hop');
    Fast.on(); await tick();
    await answer(T.signHub([KID])); await tick();
    const out = await answer(T.signHub([KID]));
    expect(out).not.toHaveProperty('one_hop');
    expect(out.fast).toBe(true); // the hub is on and the fast page too: nothing else went off
    expect(bytes(out)).toBe(bytes(off.out));
    expect(Hop().own()).toBe(false);
  });
  test('the fast first page off: no `one_hop`, even with the row on', async () => {
    const plain = HOME.filter((r) => r.key !== 'web_quiz_fast');
    const out = await warmed([...plain, TRUE('web_quiz_one_hop')]);
    expect(out.out).not.toHaveProperty('fast');
    expect(out.out).not.toHaveProperty('one_hop');
  });
  test('waves: on = off, off <= the base (no serial wave, no app_settings read of its own on a warm hub)', async () => {
    const off = await warmed(HOME);
    const on = await warmed([...HOME, TRUE('web_quiz_one_hop')]);
    expect(on.out.one_hop).toBe(true);
    expect(on.waves).toBe(off.waves);
    expect(off.waves).toBeLessThanOrEqual(BASE_WARM_WAVES);
    expect(on.settingsReads).toBe(off.settingsReads);
    expect(off.settingsReads).toBeLessThanOrEqual(BASE_WARM_SETTINGS_READS);
  });
});

describe('the internal route', () => {
  test('GET /hub/:token answers with the switch\'s mark; POST /hub/:token (the page\'s own call) is today\'s', async () => {
    const express = require('express');
    const SAVED = process.env.INTERNAL_API_KEY;
    process.env.INTERNAL_API_KEY = 'route-key';
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const spy = jest.spyOn(Hub, 'hub').mockResolvedValue({ kids: [], fast: true });
    try {
      seed([TRUE('web_quiz_fast'), TRUE('web_quiz_one_hop')]);
      Fast.on(); Hop().own(); await tick();
      const base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
      const get = await (await fetch(`${base}/hub/abc.def`, { headers: { 'x-api-key': 'route-key' } })).json();
      const post = await (await fetch(`${base}/hub/abc.def`, { method: 'POST', headers: { 'x-api-key': 'route-key', 'content-type': 'application/json' }, body: '{}' })).json();
      expect(get).toEqual({ kids: [], fast: true, one_hop: true });
      expect(post).toEqual({ kids: [], fast: true });
      seed([TRUE('web_quiz_fast')]);
      Fast.on(); Hop().own(); await tick();
      const off = await (await fetch(`${base}/hub/abc.def`, { headers: { 'x-api-key': 'route-key' } })).text();
      expect(off).toBe(JSON.stringify({ kids: [], fast: true }));
    } finally {
      spy.mockRestore();
      process.env.INTERNAL_API_KEY = SAVED;
      await new Promise((r) => server.close(r));
    }
  });
});
