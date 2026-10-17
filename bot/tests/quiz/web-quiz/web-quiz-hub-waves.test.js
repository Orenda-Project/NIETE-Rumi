'use strict';
/**
 * The kid hub's round trips (web_quiz_fast). The hub's server time is almost all serial database round trips, so this
 * test counts them: every read takes READ_MS at the boundary (Supabase, faked) and is given a WAVE, 1 + the highest wave
 * of the reads already finished when it started. The page waits for the highest wave.
 *
 * On: once the child and their quizzes are known, the hub's five parts (keep-my-place, the teacher card, the
 * recommendations, Jugnu's corner, the Book) are read together, and a stale switch is answered from its cache while it
 * is read again in the background. The payload (and the hub_open event) is the one recorded before the change (golden),
 * byte for byte. Off: the payload, the reads per table and the waves are exactly the recorded ones.
 *
 * Supabase, Redis and the loggers are the boundaries; every first-party module on the path runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable() { return true; },
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); return true; }),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const path = require('path');
const Fx = require('./hub-waves-fixture');

const { S, NOW, KID, SIB, DEVICE, CEILING_KEYS, NOT_SWITCHES, askedKeys, settle, boot, waveList, measure, tokenOne, tokenTwo } = Fx;
const GOLDEN = path.join(__dirname, 'web-quiz-hub-waves.golden.json');

const SAVED = { ...process.env };
let golden;
let record = false;
beforeAll(() => {
  Fx.useClock();
  golden = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : {};
});
afterAll(() => {
  if (record) fs.writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 1)}\n`);
  jest.useRealTimers();
  process.env = SAVED;
});
beforeEach(() => {
  process.env = Fx.hubEnv(SAVED);
});

/** The recorded value (recorded on today's code, before the change) or, once recorded, the check that this run gives the same. */
function same(name, value) {
  if (!(name in golden)) { golden[name] = value; record = true; return; }
  expect(value).toEqual(golden[name]);
}
/** Today's wave count for a case (recorded on today's code, before the change), for the before -> after line. */
function today(name, waves) {
  if (!(name in golden)) { golden[name] = waves; record = true; }
  return golden[name];
}

describe('the kid hub, switch on (web_quiz_fast)', () => {
  test('a child with a teacher card, recommendations, a challenge and the Book: the payload is today\'s, in at most 6 waves warm', async () => {
    boot({ fast: true });
    await measure(tokenOne(), { device: DEVICE });               // cold: the first read of each switch waits
    const warm = await measure(tokenOne(), { device: DEVICE });
    const p = JSON.parse(warm.out);
    // The fixture reaches every part of the hub.
    expect(p.teacher && p.teacher.code).toBe('NEWQ01');
    expect(p.recs.length).toBe(3);
    expect(p.challenge).toEqual({ on: true });
    expect(p.last && p.last.state).toBe('open');
    expect(p.last.answered).toBe(3);
    expect(p.play && p.play.lantern).toBeTruthy();
    expect(p.book_on).toBe(true);
    expect(p.bind && p.bind.offer).toBe(true);
    expect(p.fast).toBe(true);
    same('on_warm_payload', warm.out);
    same('on_warm_hub_open', warm.open);
    console.log(`hub warm waves (switch on): today ${today('on_warm_waves_today', warm.waves)} -> ${warm.waves}; reads ${JSON.stringify(warm.perTable)}`);
    // A child on a class list: the canonical ids and the hub each read the list (1 wave a loose child has not).
    expect(warm.waves).toBeLessThanOrEqual(6);
  });

  test('the child\'s Jugnu runs are read once for the lantern, the shelf and the Book (not three times)', async () => {
    boot({ fast: true });
    await measure(tokenOne(), { device: DEVICE });
    const warm = await measure(tokenOne(), { device: DEVICE });
    // One read of the child's runs + the class lights' read of the class's runs.
    expect(warm.perTable.web_quiz_challenge_runs).toBe(2);
    // The canonical ids are read once (wave 1), not again for the hub pick.
    expect(warm.perTable.class_enrollments).toBeLessThanOrEqual(4);
  });

  test('every switch stale (31 s later): answered from the cache, read again in the background; same payload, at most 8 waves', async () => {
    boot({ fast: true });
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    const warm = await measure(tok, { device: DEVICE });
    jest.setSystemTime(NOW + 31 * 1000);
    const stale = await measure(tok, { device: DEVICE });
    console.log(`hub stale waves (switch on): today ${today('on_stale_waves_today', stale.waves)} -> ${stale.waves}; reads ${JSON.stringify(stale.perTable)}`);
    expect(stale.out).toBe(warm.out);
    expect(stale.open).toBe(warm.open);
    // Every switch is answered from its cache; the 2 waves over warm are the class roster's own 30 s cache (identity roster).
    expect(stale.waves).toBeLessThanOrEqual(8);
  });

  test('a loose child (no class list, no enrolment; the usual quiz child): the payload is today\'s, in at most 5 waves warm', async () => {
    boot({ fast: true, loose: true });
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    const warm = await measure(tok, { device: DEVICE });
    const p = JSON.parse(warm.out);
    expect(p.teacher && p.teacher.src).toBe('teacher');
    expect(p.recs.length).toBe(3);
    expect(p.challenge).toEqual({ on: true });
    same('on_loose_payload', warm.out);
    same('on_loose_hub_open', warm.open);
    jest.setSystemTime(NOW + 31 * 1000);
    const stale = await measure(tok, { device: DEVICE });
    expect(stale.out).toBe(warm.out);
    console.log(`hub loose child waves (switch on): warm today ${today('on_loose_waves_today', warm.waves)} -> ${warm.waves}, stale today ${today('on_loose_stale_waves_today', stale.waves)} -> ${stale.waves}`);
    expect(warm.waves).toBeLessThanOrEqual(5);
    expect(stale.waves).toBeLessThanOrEqual(5);
  });

  test('the "who is playing?" picker (two children, none picked): the payload is today\'s', async () => {
    boot({ fast: true });
    await measure(tokenTwo(), { device: DEVICE });
    const warm = await measure(tokenTwo(), { device: DEVICE });
    expect(JSON.parse(warm.out).kids.length).toBe(2);
    same('on_picker_payload', warm.out);
    same('on_picker_hub_open', warm.open);
  });

  test('the locked hub (no device): the payload is today\'s, in 3 waves', async () => {
    boot({ fast: true });
    await measure(tokenOne(), {});
    const warm = await measure(tokenOne(), {});
    expect(JSON.parse(warm.out).locked).toBe(true);
    same('on_locked_payload', warm.out);
    console.log(`hub locked waves (switch on): ${warm.waves}`);
    expect(warm.waves).toBeLessThanOrEqual(3);
  });
});

// Old vs new on the same fake DB where no recorded case reaches: switch off is today's hub (the golden cases below
// prove it), and on the hub's payload is the off one plus `fast: true` (as every recorded case shows).
describe('the kid hub, switch on: the same payload as switch off where the early reads guess', () => {
  // req(): the request's options, made once the modules are loaded (a chip is signed with the token module).
  const both = async (opts, tok, req) => {
    boot({ ...opts, fast: false });
    await measure(tok(), req());
    const off = await measure(tok(), req());
    boot({ ...opts, fast: true });
    await measure(tok(), req());
    const on = await measure(tok(), req());
    const p = JSON.parse(on.out);
    expect(p.fast).toBe(true);
    delete p.fast;
    expect(JSON.stringify(p)).toBe(off.out);
    expect(on.open).toBe(off.open);
    return { on, off };
  };
  const chip = (id) => S.T.chipId('h', id);

  test('two children, the second picked by its chip', async () => {
    const { on } = await both({}, tokenTwo, () => ({ device: DEVICE, kid: chip(SIB) }));
    expect(JSON.parse(on.out).kid).toBe(chip(SIB));
  });

  test('the chip names a child whose row is gone: the other child opens (the early reads were for the wrong child)', async () => {
    const { on } = await both({ sibGone: true }, tokenTwo, () => ({ device: DEVICE, kid: chip(SIB) }));
    expect(JSON.parse(on.out).kid).toBe(chip(KID));
  });

  test('the last quiz\'s video is of another grade: the recommendations are of that grade', async () => {
    await both({ otherGrade: true }, tokenOne, () => ({ device: DEVICE }));
  });

  test('a child at the runs read\'s 500 cap: the lantern and the shelf read their own runs, as today', async () => {
    const { on } = await both({ manyRuns: true }, tokenOne, () => ({ device: DEVICE }));
    expect(JSON.parse(on.out).play).toBeTruthy();
  });
});

describe('the kid hub, switch off: exactly today\'s (golden: payload, reads per table, waves)', () => {
  test('a child with every part', async () => {
    boot({ fast: false });
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    const warm = await measure(tok, { device: DEVICE });
    jest.setSystemTime(NOW + 31 * 1000);
    const stale = await measure(tok, { device: DEVICE });
    console.log(`hub waves (switch off): warm ${warm.waves}, stale ${stale.waves}`);
    same('off_warm', warm);
    same('off_stale', stale);
  });

  test('a loose child', async () => {
    boot({ fast: false, loose: true });
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    same('off_loose', await measure(tok, { device: DEVICE }));
  });

  test('the picker and the locked hub', async () => {
    boot({ fast: false });
    await measure(tokenTwo(), { device: DEVICE });
    same('off_picker', await measure(tokenTwo(), { device: DEVICE }));
    boot({ fast: false });
    await measure(tokenOne(), {});
    same('off_locked', await measure(tokenOne(), {}));
  });
});

// ── the standing ceiling ─────────────────────────────────────────────────────────────────────────────
// The hub's bot time is serial database round trips (about 250 ms each in production). This is the most it may cost
// with every child switch on and the fast page on: a change that adds a round trip to the hub's chain goes red here.
// Add your part as a parallel branch instead (HUB_BRANCHES in web-quiz-hub.js), and read nothing the hub already read.
// Raise a ceiling only with the reason in the change's description.
const HUB_CEILING = { warm: 7, stale: 9 };
const overCeiling = (what, got, max) => `${what}: ${got} serial round trips, the ceiling is ${max}. The waves (table, caller):\n${waveList(S.lastReads)}`;

describe('the hub\'s round-trip ceiling (every child switch on, fast page on)', () => {
  test(`at most ${HUB_CEILING.warm} waves warm, ${HUB_CEILING.stale} stale (31 s, every 30 s cache expired)`, async () => {
    // JSON true rows (as the flips write them): a switch read that takes JSON true only is on here too
    boot({ fast: true, every: true, json: true });
    askedKeys.clear();
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    const warm = await measure(tok, { device: DEVICE });
    const warmList = S.lastReads;
    const p = JSON.parse(warm.out);
    expect(p.fast).toBe(true);
    expect(p.teacher && p.recs.length && p.challenge && p.play && p.book_on).toBeTruthy();
    jest.setSystemTime(NOW + 31 * 1000);
    const stale = await measure(tok, { device: DEVICE });
    console.log(`hub ceiling: warm ${warm.waves} (ceiling ${HUB_CEILING.warm}), stale ${stale.waves} (ceiling ${HUB_CEILING.stale})\n${waveList(warmList)}`);
    if (warm.waves > HUB_CEILING.warm) { S.lastReads = warmList; throw new Error(overCeiling('hub, warm', warm.waves, HUB_CEILING.warm)); }
    if (stale.waves > HUB_CEILING.stale) throw new Error(overCeiling('hub, stale', stale.waves, HUB_CEILING.stale));
    // Every switch the hub asked for is on in this case (a new switch joins CEILING_KEYS, so the ceiling sees its reads).
    const missing = [...askedKeys].filter((k) => !CEILING_KEYS.includes(k) && !NOT_SWITCHES.includes(k)).sort();
    expect(missing).toEqual([]);
  });
});

describe('the hub\'s parallel branches (HUB_BRANCHES)', () => {
  test('one more branch with its own read runs beside the others: no extra wave, the payload unchanged, the shared context handed in', async () => {
    boot({ fast: true });
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    const before = await measure(tok, { device: DEVICE });
    const seen = [];
    S.Hub.addHubBranch({ name: 'probe', run: async (s) => {
      seen.push({ kid: s.chosen.id, grade: s.ctx.grade, runs: Boolean(s.runs), flags: Boolean(s.f && s.f.hub) });
      const { data } = await require('../../../shared/config/supabase').from('students').select('id').eq('id', s.chosen.id);
      return data;
    } });
    const after = await measure(tok, { device: DEVICE });
    expect(seen).toEqual([{ kid: KID, grade: '3', runs: true, flags: true }]);
    expect(after.out).toBe(before.out);
    expect(after.perTable.students).toBe(before.perTable.students + 1);
    expect(after.waves).toBe(before.waves);
    expect(() => S.Hub.addHubBranch({ name: 'probe', run: () => null })).toThrow(/already/);
    expect(S.Hub.HUB_BRANCHES.map((b) => b.name)).toEqual(['extras', 'teacher', 'answered', 'recs', 'play', 'bits', 'bound', 'stories', 'probe']);
  });
});

describe('a stale switch (30 s cache)', () => {
  const FLAG_MODULES = [
    ['hub flags', () => require('../../../shared/services/quiz/web-quiz-hub-flags').flags(), (v) => v.hub],
    ['identity flags', () => require('../../../shared/services/quiz/web-quiz-identity-flags').flags(), (v) => v.canon],
    ['hub play switches', () => require('../../../shared/services/quiz/web-quiz-hub-play').switches(), (v) => v.v2],
    ['challenge record switch', () => require('../../../shared/services/quiz/web-quiz-challenge').recordOn(), (v) => v],
    ['challenge listen switch', () => require('../../../shared/services/quiz/web-quiz-challenge').listenOn(), (v) => v],
    ['book flags', () => require('../../../shared/services/quiz/web-quiz-book').flags(), (v) => v.book],
    ['home v3 flags', () => require('../../../shared/services/quiz/web-quiz-hub-home').flags(), (v) => v.home],
    ['student join flags', () => require('../../../shared/services/quiz/web-quiz-student-join').flags(), (v) => v.on],
    ['stories flags', () => require('../../../shared/services/quiz/web-quiz-stories').storiesOn(), (v) => v],
    ['Urdu polish', () => require('../../../shared/services/quiz/web-quiz-ur-polish').ui(), (v) => Boolean(v && v.ur2)],
  ];
  const timed = async (fn) => { S.reads = []; S.doneMax = 0; const v = await fn(); return { v, waves: S.doneMax }; };

  test.each(FLAG_MODULES)('%s, switch on: answered from the cache at once; a failed background read keeps the value', async (_, read, pick) => {
    boot({ fast: true, every: true, json: true });
    await require('../../../shared/services/quiz/web-quiz-fast').on();
    await settle();
    expect(pick((await timed(read)).v)).toBe(true);                 // cold: waited for, as today
    jest.setSystemTime(NOW + 31 * 1000);
    require('../../../shared/services/quiz/web-quiz-fast').on();     // the fast switch itself read fresh (it fails closed)
    await settle();
    S.down = true;
    const stale = await timed(read);
    expect(pick(stale.v)).toBe(true);
    expect(stale.waves).toBe(0);                                     // nothing waited for
    await settle();
    expect(S.reads.filter((r) => r.t === 'app_settings').length).toBeGreaterThanOrEqual(1); // read again in the background
    expect(pick((await timed(read)).v)).toBe(true);                  // the failed read kept the value
    await settle();
    S.down = false;
    await timed(read);
    await settle();
    jest.setSystemTime(NOW + 32 * 1000);
    expect(pick((await timed(read)).v)).toBe(true);
  });

  test.each(FLAG_MODULES)('%s, switch off: a stale cache waits for its read, as today', async (_, read, pick) => {
    boot({ fast: false, every: true, json: true });
    await require('../../../shared/services/quiz/web-quiz-fast').on();
    await settle();
    expect(pick((await timed(read)).v)).toBe(true);
    jest.setSystemTime(NOW + 31 * 1000);
    expect((await timed(read)).waves).toBeGreaterThanOrEqual(1);
  });

  test('switch on: a stale switch read by many requests at once is read again only once', async () => {
    boot({ fast: true });
    await require('../../../shared/services/quiz/web-quiz-fast').on();
    await settle();
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    await Flags.flags();
    await require('../../../shared/services/quiz/web-quiz-fast').on();
    jest.setSystemTime(NOW + 31 * 1000);
    S.reads = [];
    await Promise.all([Flags.flags(), Flags.flags(), Flags.flags()]);
    await settle();
    // the hub flags' own read once (the fast switch's own background read may be the other app_settings read)
    expect(S.reads.filter((r) => r.t === 'app_settings').length).toBeLessThanOrEqual(2);
  });
});
