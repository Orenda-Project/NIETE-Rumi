'use strict';
/**
 * "Keep my place" on the page side (web-quiz-bind-page.js): mint a code for the chosen child, read its status,
 * undo the binding it made, ask "Whose turn?" before a scored route, and keep the pick record of a quiz start.
 * Faked: Supabase (in-memory, filters applied), Redis (a Map), the loggers, and three modules owned by the
 * identity store (switches, the code table, the bindings table) plus the canonical-id helper — module
 * boundaries mocked by path. The hub token, the device trust and the homonym guard run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async () => true),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/quiz/web-quiz-identity-flags', () => ({ flags: jest.fn() }), { virtual: true });
jest.mock('../../../shared/services/quiz/child-bind-codes.repo', () => ({ mint: jest.fn(), get: jest.fn() }), { virtual: true });
jest.mock('../../../shared/services/quiz/child-phone-bindings.repo', () => ({ eraseOne: jest.fn(), activeForChild: jest.fn() }), { virtual: true });
jest.mock('../../../shared/services/quiz/web-quiz-identity-roster', () => ({ canonicalStudentId: jest.fn(async (id) => id) }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const Codes = require('../../../shared/services/quiz/child-bind-codes.repo');
const Bindings = require('../../../shared/services/quiz/child-phone-bindings.repo');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Sid = require('../../../shared/services/quiz/student-identity.service');
const Bind = require('../../../shared/services/quiz/web-quiz-bind-page');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');

const KID = 'c0000001-0000-4000-8000-000000000001';
const SIB = 'c0000001-0000-4000-8000-000000000002';
const LIST = 'c0000001-0000-4000-8000-0000000000aa';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const ON = { canon: true, phoneBind: true, guestHome: false };
const OFF = { canon: false, phoneBind: false, guestHome: false };
const hubOf = (ids, extra = {}) => T.sign({ k: 'h', ids, exp: 2000000000, ...extra });
const chip = (id) => T.chipId('h', id);
let fake;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'bind-page-test-secret';
  process.env.WHATSAPP_BOT_NUMBER = '+92 300 0000000';
  redis._store.clear();
  Hub._resetCache();
  Ch.__reset();
  IdFlags.flags.mockResolvedValue(ON);
  Codes.mint.mockResolvedValue({ code: 'JUGNU-7KQ2X', expires_at: '2026-10-15T18:00:00Z' });
  Bindings.activeForChild.mockResolvedValue([]);
  fake = makeFake({
    app_settings: [{ key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_challenge', value: true }],
    students: [
      { id: KID, student_name: 'Zara Khan', student_name_urdu: null, father_name: null, self_reported_class: '3', list_id: LIST, is_active: true },
      { id: SIB, student_name: 'Zara Malik', student_name_urdu: null, father_name: null, self_reported_class: '3', list_id: LIST, is_active: true },
    ],
    student_lists: [{ id: LIST, user_id: 't1', class_name: '3', section: 'A', is_active: true }],
    quiz_sessions: [], quiz_share_codes: [], quizzes: [], student_videos: [], web_quiz_challenge_runs: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

describe('mint', () => {
  test('switch off -> {off:true}, nothing minted, nothing logged', async () => {
    IdFlags.flags.mockResolvedValue(OFF);
    expect(await Bind.mint({ hub: hubOf([KID]), kid: chip(KID), device: DEV })).toEqual({ off: true });
    expect(Codes.mint).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalledWith('web_quiz.bind_confirm', expect.anything());
  });

  test('the chosen child on the trusted phone -> a code, the prefill with the code LAST, the wa.me link; bind_confirm w:s, no device or phone', async () => {
    const out = await Bind.mint({ hub: hubOf([KID]), kid: chip(KID), device: DEV, lang: 'ur' });
    expect(Codes.mint).toHaveBeenCalledWith(KID, DEV);
    expect(out.code).toBe('JUGNU-7KQ2X');
    expect(out.prefill.en).toBe('Jugnu ✨ keep my place JUGNU-7KQ2X');
    expect(out.prefill.ur).toBe('جگنو ✨ میری جگہ محفوظ کریں JUGNU-7KQ2X');
    expect(out.prefill.ur.endsWith('JUGNU-7KQ2X')).toBe(true);
    expect(out.href).toBe(`https://wa.me/923000000000?text=${encodeURIComponent(out.prefill.ur)}`);
    const ev = logEvent.mock.calls.find((c) => c[0] === 'web_quiz.bind_confirm');
    expect(ev[1]).toEqual({ w: 's' });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(DEV);
  });

  test('another phone (not the one the hub link is bound to) -> refused, nothing minted', async () => {
    await Bind.mint({ hub: hubOf([KID]), kid: chip(KID), device: DEV });
    Codes.mint.mockClear();
    const out = await Bind.mint({ hub: hubOf([KID]), kid: chip(KID), device: 'BBBBBBBBBBBBBBBBBBBBBB' });
    expect(out).toEqual({ ok: false, error: 'other_device' });
    expect(Codes.mint).not.toHaveBeenCalled();
  });

  test('a token with a teacher claim or a practice mode -> teacher_phone, nothing minted', async () => {
    expect(await Bind.mint({ hub: hubOf([KID], { t: 'teacher-1' }), kid: chip(KID), device: DEV })).toEqual({ ok: false, refused: 'teacher_phone' });
    expect(await Bind.mint({ hub: hubOf([KID], { mode: 'practice' }), kid: chip(KID), device: DEV })).toEqual({ ok: false, refused: 'teacher_phone' });
    expect(Codes.mint).not.toHaveBeenCalled();
  });

  test('the child already on 3 phones -> max_phones, nothing minted, bind_refused_page logged server-side', async () => {
    Bindings.activeForChild.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(await Bind.mint({ hub: hubOf([KID]), kid: chip(KID), device: DEV })).toEqual({ ok: false, refused: 'max_phones' });
    expect(Codes.mint).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('web_quiz.bind_refused_page', { w: 's', reason: 'max_phones' });
  });

  test('no bot number configured -> {off:true} and a log line', async () => {
    delete process.env.WHATSAPP_BOT_NUMBER;
    delete process.env.REFERRAL_BOT_NUMBER;
    expect(await Bind.mint({ hub: hubOf([KID]), kid: chip(KID), device: DEV })).toEqual({ off: true });
    expect(Codes.mint).not.toHaveBeenCalled();
  });
});

describe('status', () => {
  const row = (x) => ({ code: 'JUGNU-7KQ2X', canonical_id: KID, device_ref: DEV, minted_at: '2026-10-15T10:00:00Z', expires_at: new Date(Date.now() + 3600e3).toISOString(), used_at: null, outcome: null, ...x });
  test.each([
    [row(), { state: 'pending' }],
    [row({ used_at: '2026-10-15T10:05:00Z', outcome: 'bound' }), { state: 'bound' }],
    [row({ used_at: '2026-10-15T10:05:00Z', outcome: 'max_kids' }), { state: 'refused', reason: 'max_kids' }],
    [row({ used_at: '2026-10-15T10:05:00Z', outcome: 'teacher_phone' }), { state: 'refused', reason: 'teacher_phone' }],
    [row({ expires_at: '2026-10-01T00:00:00Z' }), { state: 'expired' }],
    [null, { state: 'refused', reason: 'code_unknown' }],
  ])('%j -> %j', async (r, want) => {
    Codes.get.mockResolvedValue(r);
    expect(await Bind.status({ code: 'JUGNU-7KQ2X' })).toEqual(want);
  });
  test('a malformed code is never looked up; switch off -> {off:true}', async () => {
    expect(await Bind.status({ code: 'drop table' })).toEqual({ state: 'refused', reason: 'code_unknown' });
    expect(Codes.get).not.toHaveBeenCalled();
    IdFlags.flags.mockResolvedValue(OFF);
    expect(await Bind.status({ code: 'JUGNU-7KQ2X' })).toEqual({ off: true });
  });
});

describe('undo', () => {
  test('erases the binding this code made (newest, bound after the mint), forgets the door verdict, bind_undo{via:page,n:1}, sends nothing', async () => {
    Codes.get.mockResolvedValue({ code: 'JUGNU-7KQ2X', canonical_id: KID, minted_at: '2026-10-15T10:00:00Z', used_at: '2026-10-15T10:05:00Z', outcome: 'bound' });
    Bindings.activeForChild.mockResolvedValue([
      { id: 'b-old', canonical_id: KID, bound_at: '2026-09-01T00:00:00Z' },
      { id: 'b-new', canonical_id: KID, bound_at: '2026-10-15T10:05:00Z' },
    ]);
    Bindings.eraseOne.mockResolvedValue({ id: 'b-new', phone_norm: '+92300FIXTURE1' });
    const forget = jest.spyOn(Sid, 'forgetDoorVerdict');
    expect(await Bind.undo({ code: 'JUGNU-7KQ2X', device: DEV })).toEqual({ ok: true });
    expect(Bindings.eraseOne).toHaveBeenCalledWith('b-new', 'page_undo');
    expect(forget).toHaveBeenCalledWith('+92300FIXTURE1', '+92300FIXTURE1');
    expect(logEvent).toHaveBeenCalledWith('web_quiz.bind_undo', { w: 's', via: 'page', n: 1 });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('FIXTURE');
  });
  test('a code that never bound -> not_bound, nothing erased', async () => {
    Codes.get.mockResolvedValue({ code: 'JUGNU-7KQ2X', canonical_id: KID, minted_at: '2026-10-15T10:00:00Z', used_at: null, outcome: null });
    expect(await Bind.undo({ code: 'JUGNU-7KQ2X', device: DEV })).toEqual({ ok: false, error: 'not_bound' });
    expect(Bindings.eraseOne).not.toHaveBeenCalled();
  });
});

describe('whose turn (a deep link to a scored route)', () => {
  test('two children and no tap -> the ask, chips with first names only and the homonym fields', async () => {
    const ask = await Bind.whoseTurn({ hub: hubOf([KID, SIB]), device: DEV });
    expect(ask.ask).toBe('whose_turn');
    expect(ask.kids.map((k) => [k.chip, k.first])).toEqual([[chip(KID), 'Zara'], [chip(SIB), 'Zara']]);
    expect(JSON.stringify(ask)).not.toMatch(/Khan|Malik|c0000001/);
  });
  test('with a kid this request -> null; one child -> null', async () => {
    expect(await Bind.whoseTurn({ hub: hubOf([KID, SIB]), kid: chip(KID), device: DEV })).toBeNull();
    expect(await Bind.whoseTurn({ hub: hubOf([KID]), device: DEV })).toBeNull();
  });
  test('challenge: two children + no tap -> the exercise route returns the ask, NO run row, no start', async () => {
    const out = await Ch.exercise(hubOf([KID, SIB]), 'bigger', { device: DEV });
    expect(out.ask).toBe('whose_turn');
    expect(fake.calls.filter((c) => c.op === 'insert')).toEqual([]);
    expect(logEvent).not.toHaveBeenCalledWith('web_quiz.ch_start', expect.anything());
    const menu = await Ch.menu(hubOf([KID, SIB]), { device: DEV });
    expect(menu.ask).toBe('whose_turn');
  });
  test('challenge: one child -> served as today', async () => {
    const out = await Ch.exercise(hubOf([KID]), 'bigger', { device: DEV });
    expect(out.ex).toBe('bigger');
    expect(out.ask).toBeUndefined();
  });
});

describe('the pick record of a quiz start', () => {
  test('canon on: stored for 24 h under wq:idpick:<session>, id_pick emitted w:s with no session id', async () => {
    await Bind.recordPick({ sessionId: 'sess-1', via: 'name', studentId: KID });
    const set = redis.set.mock.calls.find((c) => c[0] === 'wq:idpick:sess-1');
    expect(set[1]).toEqual({ id_src: 'roster_pick', id_confidence: 'low', homonym_in_list: true, canonical_id: KID });
    expect(set[2]).toBe(86400);
    expect(await Bind.pickFor('sess-1')).toEqual(set[1]);
    const ev = logEvent.mock.calls.find((c) => c[0] === 'web_quiz.id_pick');
    expect(ev[1]).toEqual({ w: 's', id_src: 'roster_pick', id_confidence: 'low', homonym_in_list: true, chips_k: 2 });
    expect(JSON.stringify(ev)).not.toContain('sess-1');
  });
  test('a hub chip is high, no homonym read', async () => {
    await Bind.recordPick({ sessionId: 'sess-2', via: 'hub', studentId: KID });
    expect(await Bind.pickFor('sess-2')).toEqual({ id_src: 'hub_chip', id_confidence: 'high', homonym_in_list: false, canonical_id: KID });
  });
  test('canon off: nothing stored, nothing emitted', async () => {
    IdFlags.flags.mockResolvedValue(OFF);
    await Bind.recordPick({ sessionId: 'sess-3', via: 'name', studentId: KID });
    expect(redis.set).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
    expect(await Bind.pickFor('sess-3')).toBeNull();
  });
});

describe('the hub payload under phoneBind', () => {
  test('a chosen child -> bind {offer, hub, kid}; no pick -> kids carry line2/played from the guard', async () => {
    const tok = hubOf([KID, SIB]);
    const picked = await Hub.hub(tok, { device: DEV, kid: chip(KID) });
    expect(picked.bind).toEqual({ offer: true, hub: tok, kid: chip(KID) });
    const who = await Hub.hub(tok, { device: DEV });
    expect(who.bind).toEqual({ offer: false });
    expect(who.kids.map((k) => k.homonym_in_list)).toEqual([true, true]);
    expect(who.kids.every((k) => 'played' in k)).toBe(true);
  });
});

describe('the pick record of a play opened from the hub (a chip tap, no quiz session)', () => {
  const crypto = require('crypto');
  const devH = crypto.createHash('sha256').update(DEV).digest('hex').slice(0, 16);
  test('src wa -> hub_chip; stored at wq:idpick:h:<canonical>:<sha256(device)[0:16]> 24 h; id_pick once; pickFor finds it', async () => {
    const tok = hubOf([KID, SIB]);
    await Hub.hub(tok, { device: DEV, kid: chip(KID), src: 'wa' });
    const key = `wq:idpick:h:${KID}:${devH}`;
    const set = redis.set.mock.calls.find((c) => c[0] === key);
    expect(set[1]).toEqual({ id_src: 'hub_chip', id_confidence: 'high', homonym_in_list: true, canonical_id: KID });
    expect(set[2]).toBe(86400);
    expect(logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.id_pick').map((c) => c[1])).toEqual([{ w: 's', id_src: 'hub_chip', id_confidence: 'high', homonym_in_list: true, chips_k: 2 }]);
    expect(await Bind.pickFor({ canonicalId: KID, device: DEV })).toEqual(set[1]);
    expect(await Bind.pickFor({ sessionId: 'nope', canonicalId: KID, device: DEV })).toEqual(set[1]);
    expect(await Bind.pickFor({ canonicalId: KID, device: 'BBBBBBBBBBBBBBBBBBBBBB' })).toBeNull();
  });
  test('no src (or not wa) -> remembered', async () => {
    await Hub.hub(hubOf([KID]), { device: DEV, kid: chip(KID) });
    expect(await Bind.pickFor({ canonicalId: KID, device: DEV })).toMatchObject({ id_src: 'remembered', id_confidence: 'high', homonym_in_list: false });
  });
  test('a session record wins over the hub record; the positional form still works', async () => {
    await Hub.hub(hubOf([KID]), { device: DEV, kid: chip(KID), src: 'wa' });
    await Bind.recordPick({ sessionId: 'sess-9', via: 'hub', studentId: KID });
    expect(await Bind.pickFor({ sessionId: 'sess-9', canonicalId: KID, device: DEV })).toMatchObject({ id_src: 'hub_chip', canonical_id: KID });
    expect(await Bind.pickFor('sess-9')).toMatchObject({ id_src: 'hub_chip' });
    expect(await Bind.pickFor({})).toBeNull();
  });
  test('hubPickKey is the one builder of the key the hub pick writes; recordPick is exported', async () => {
    await Hub.hub(hubOf([KID]), { device: DEV, kid: chip(KID), src: 'wa' });
    const written = redis.set.mock.calls.map((c) => c[0]).filter((k) => /^wq:idpick:h:/.test(k));
    expect(written).toEqual([Bind.hubPickKey(KID, DEV)]);
    expect(Bind.hubPickKey(KID, DEV)).toBe(`wq:idpick:h:${KID}:${devH}`);
    expect(Bind.hubPickKey(KID, '')).toBeNull();
    expect(Bind.hubPickKey('', DEV)).toBeNull();
    expect(typeof Bind.recordPick).toBe('function');
  });
  test('canon off -> no hub key, no id_pick', async () => {
    IdFlags.flags.mockResolvedValue(OFF);
    await Hub.hub(hubOf([KID]), { device: DEV, kid: chip(KID), src: 'wa' });
    expect(redis.set.mock.calls.filter((c) => /^wq:idpick:/.test(c[0]))).toEqual([]);
    expect(logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.id_pick')).toEqual([]);
    expect(await Bind.pickFor({ canonicalId: KID, device: DEV })).toBeNull();
  });
});
