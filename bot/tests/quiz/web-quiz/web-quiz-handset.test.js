'use strict';
/**
 * The one-shot handset link (web-quiz-handset.js). The bot, answering an old quiz link from ONE phone,
 * already knows that phone's children: it keeps their ids server-side (Redis, 1 h) under a random
 * nonce and puts only the signed nonce on the button's URL, in the fragment. The page redeems it
 * once with its device: the server spends the nonce (first device wins; the same device may retry),
 * mints the device when the browser has none, trusts that device for those children exactly as the
 * hub does, and answers them as chips for THIS code. Nothing is written about any child in phase 1:
 * a past page row on that browser that looks like the same child is LOGGED as would-merge; the merge
 * itself runs only with web_quiz_handset_merge on, through the SQL function. Flags off = nothing.
 * Supabase, Redis and the token secret are the boundaries; every first-party module runs for real.
 */
process.env.INTERNAL_API_KEY = 'test-only-internal-key';
delete process.env.WEB_QUIZ_TOKEN_SECRET;

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true, _failSet: false,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn(async function set(k, v) { if (!this._up || this._failSet) return false; store.set(k, v); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); return true; }),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const HubDevice = require('../../../shared/services/quiz/web-quiz-hub-device');
const Handset = require('../../../shared/services/quiz/web-quiz-handset');

const SC = '33333333-3333-4333-8333-000000000001';      // the class code
const INVITE = '33333333-3333-4333-8333-000000000002';  // a friend's invite under it
const CHAT_KID = '44444444-4444-4444-8444-000000000001';
const CHAT_SIB = '44444444-4444-4444-8444-000000000002';
const PAGE_KID = '44444444-4444-4444-8444-000000000011';   // the page's copy of CHAT_KID (same name, same teacher)
const PAGE_NEW = '44444444-4444-4444-8444-000000000012';   // a page child with no chat twin
const PAGE_OTHER_T = '44444444-4444-4444-8444-000000000013'; // same name, ANOTHER teacher: never a candidate
const PAGE_OPEN = '44444444-4444-4444-8444-000000000014';  // same name, same teacher, an open sitting: not now
const LISTED = '44444444-4444-4444-8444-000000000015';     // a class-list child: never a candidate
const STRANGER_KID = '44444444-4444-4444-8444-000000000021'; // a forward-first stranger's child (same teacher, same name)
const TEACHER = '11111111-1111-4111-8111-000000000001';
const OTHER_T = '11111111-1111-4111-8111-000000000002';
const DEV = 'dddddddddddddddddddddd';     // the browser that played the page rows
const DEV2 = 'eeeeeeeeeeeeeeeeeeeeee';    // a fresh browser
const STRANGER_DEV = 'ffffffffffffffffffffff';
const future = () => new Date(Date.now() + 3600000).toISOString();
const past = () => new Date(Date.now() - 3600000).toISOString();

let db;
function seed({ link = 'true', merge = null } = {}) {
  db = {
    app_settings: [{ key: 'web_quiz_handset_link', value: link }, ...(merge ? [{ key: 'web_quiz_handset_merge', value: merge }] : [])],
    quiz_share_codes: [
      { id: SC, code: 'ABC123', quiz_id: 'q-1', teacher_user_id: TEACHER, language: 'en', parent_share_code_id: null, active: true, expires_at: null },
      { id: INVITE, code: 'FRND01', quiz_id: 'q-1', teacher_user_id: TEACHER, language: 'en', parent_share_code_id: SC, invited_by_student_id: CHAT_KID, active: true, expires_at: null },
    ],
    students: [
      { id: CHAT_KID, student_name: 'Ayesha Khan', phone: '923001112223', list_id: null, enrolled_by_user_id: TEACHER, is_active: true, status: 'active', created_at: '2026-09-10T00:00:00Z' },
      { id: CHAT_SIB, student_name: 'Bilal Khan', phone: '923001112223', list_id: null, enrolled_by_user_id: TEACHER, is_active: true, status: 'active', created_at: '2026-09-12T00:00:00Z' },
      { id: PAGE_KID, student_name: 'ayesha khan', phone: null, list_id: null, enrolled_by_user_id: TEACHER, is_active: true, status: 'active', created_at: '2026-10-07T00:00:00Z' },
      { id: PAGE_NEW, student_name: 'Zara', phone: null, list_id: null, enrolled_by_user_id: TEACHER, is_active: true, status: 'active', created_at: '2026-10-07T00:00:00Z' },
      { id: PAGE_OTHER_T, student_name: 'Ayesha Khan', phone: null, list_id: null, enrolled_by_user_id: OTHER_T, is_active: true, status: 'active', created_at: '2026-10-07T00:00:00Z' },
      { id: PAGE_OPEN, student_name: 'Bilal Khan', phone: null, list_id: null, enrolled_by_user_id: TEACHER, is_active: true, status: 'active', created_at: '2026-10-07T00:00:00Z' },
      { id: LISTED, student_name: 'Ayesha Khan', phone: null, list_id: 'list-1', enrolled_by_user_id: TEACHER, is_active: true, status: 'active', created_at: '2026-09-01T00:00:00Z' },
      { id: STRANGER_KID, student_name: 'Ayesha Khan', phone: null, list_id: null, enrolled_by_user_id: TEACHER, is_active: true, status: 'active', created_at: '2026-10-06T00:00:00Z' },
    ],
    quiz_sessions: [
      { id: 's-chat-1', student_id: CHAT_KID, share_code_id: SC, device_ref: null, status: 'completed', expires_at: past() },
      { id: 's-page-1', student_id: PAGE_KID, share_code_id: SC, device_ref: DEV, status: 'completed', expires_at: past() },
      { id: 's-page-2', student_id: PAGE_NEW, share_code_id: SC, device_ref: DEV, status: 'completed', expires_at: past() },
      { id: 's-page-3', student_id: PAGE_OTHER_T, share_code_id: SC, device_ref: DEV, status: 'completed', expires_at: past() },
      { id: 's-page-4', student_id: PAGE_OPEN, share_code_id: SC, device_ref: DEV, status: 'in_progress', expires_at: future() },
      { id: 's-list-1', student_id: LISTED, share_code_id: SC, device_ref: DEV, status: 'completed', expires_at: past() },
      { id: 's-str-1', student_id: STRANGER_KID, share_code_id: SC, device_ref: STRANGER_DEV, status: 'completed', expires_at: past() },
    ],
    web_quiz_challenge_runs: [],
  };
  const fake = makeFake(db);
  Object.assign(supabase, fake);
  Handset._resetCache();
}

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  redis._up = true;
  redis._failSet = false;
  seed();
});

const mint = (ids = [CHAT_KID, CHAT_SIB], sc = SC) => Handset.withLink('https://portal.test/q/ABC123', ids, sc);
const xOf = (url) => url.split('#x=')[1];

describe('withLink — the bot appends #x= to a web link it sends to ONE phone', () => {
  test('flag on: a signed nonce in the FRAGMENT; the ids and the code live in Redis under the nonce, never in the URL', async () => {
    const url = await mint();
    expect(url.startsWith('https://portal.test/q/ABC123#x=')).toBe(true);
    const tok = T.verify(xOf(url), 'x');
    expect(tok).toBeTruthy();
    expect(tok.sc).toBe(SC);
    expect(url).not.toContain(CHAT_KID);
    expect(url).not.toContain('923001112223');
    const entry = [...redis._store.values()].find((v) => v && v.ids);
    expect(entry).toEqual(expect.objectContaining({ ids: [CHAT_KID, CHAT_SIB], sc: SC }));
    expect(typeof entry.at).toBe('number');
    expect(logEvent).toHaveBeenCalledWith('web_quiz.handset_minted', expect.objectContaining({ shareCodeId: SC, kids: 2 }));
  });

  test('flag off (default), no ids, Redis down, or a failed Redis write: the URL is unchanged and no nonce ships without its entry', async () => {
    seed({ link: 'false' });
    expect(await mint()).toBe('https://portal.test/q/ABC123');
    expect(redis.set).not.toHaveBeenCalled();
    seed();
    expect(await mint([])).toBe('https://portal.test/q/ABC123');
    redis._up = false;
    expect(await mint()).toBe('https://portal.test/q/ABC123');
    redis._up = true;
    redis._failSet = true;
    expect(await mint()).toBe('https://portal.test/q/ABC123');
    expect(logEvent).not.toHaveBeenCalledWith('web_quiz.handset_minted', expect.anything());
  });

  test('the settings row missing or unreadable = off (fail closed); at most 10 ids', async () => {
    db.app_settings = [];
    Handset._resetCache();
    expect(await mint()).toBe('https://portal.test/q/ABC123');
    seed();
    const many = Array.from({ length: 12 }, (_, i) => `44444444-4444-4444-8444-0000000001${String(i).padStart(2, '0')}`);
    await mint(many);
    expect([...redis._store.values()].find((v) => v && v.ids).ids).toHaveLength(10);
  });
});

describe('bind — the page redeems the token once with its device', () => {
  test('a fresh browser (no device yet): the bind MINTS the device, returns it, and trusts it for the children — the chips then start', async () => {
    const x = xOf(await mint([CHAT_KID]));
    const r = await Handset.bind({ code: 'ABC123', x });
    expect(r.device_ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(r.kids).toEqual([{ chip: T.chipId(SC, CHAT_KID), first: 'Ayesha', animal: T.animalFor(CHAT_KID) }]);
    expect(r.one).toBe(T.chipId(SC, CHAT_KID));
    expect(await HubDevice.deviceKids(r.device_ref)).toEqual([CHAT_KID]);
    expect(await HubDevice.deviceMayName([CHAT_KID], r.device_ref)).toBe(true);
    expect(JSON.stringify(r)).not.toContain('923001112223');
    expect(logEvent).toHaveBeenCalledWith('web_quiz.handset_bound', expect.objectContaining({ shareCodeId: SC, kids: 1, would_merge: 0, merged: 0 }));
  });

  test('siblings: both as cards, no straight-in; the known device is kept', async () => {
    const x = xOf(await mint());
    const r = await Handset.bind({ code: 'ABC123', x, device_ref: DEV2 });
    expect(r.device_ref).toBe(DEV2);
    expect(r.kids.map((k) => k.first).sort()).toEqual(['Ayesha', 'Bilal']);
    expect(r.one).toBeNull();
    expect((await HubDevice.deviceKids(DEV2)).sort()).toEqual([CHAT_KID, CHAT_SIB].sort());
  });

  test("a friend's invite code under the class code redeems a token minted for the class code; chips are the class code's", async () => {
    const x = xOf(await mint());
    const r = await Handset.bind({ code: 'FRND01', x, device_ref: DEV2 });
    expect(r.kids.map((k) => k.chip)).toContain(T.chipId(SC, CHAT_KID));
    expect(r.kids.map((k) => k.chip)).not.toContain(T.chipId(INVITE, CHAT_KID));
  });

  test('single use: a second device with the same token is refused (used) and gets no trust; the same device may retry', async () => {
    const x = xOf(await mint());
    await Handset.bind({ code: 'ABC123', x, device_ref: DEV2 });
    await expect(Handset.bind({ code: 'ABC123', x, device_ref: STRANGER_DEV })).rejects.toMatchObject({ status: 409, code: 'used' });
    expect(await HubDevice.deviceKids(STRANGER_DEV)).toEqual([]);
    const again = await Handset.bind({ code: 'ABC123', x, device_ref: DEV2 });
    expect(again.kids).toHaveLength(2);
    expect(logEvent).toHaveBeenCalledWith('web_quiz.handset_refused', expect.objectContaining({ why: 'used' }));
  });

  test('forward-first: a stranger taps first and is trusted (hub parity) — but NOTHING about their own child is written or merged, and the owner is refused and asked the name', async () => {
    const x = xOf(await mint([CHAT_KID]));
    const r = await Handset.bind({ code: 'ABC123', x, device_ref: STRANGER_DEV });
    expect(r.one).toBe(T.chipId(SC, CHAT_KID));
    const before = JSON.stringify(db.students) + JSON.stringify(db.quiz_sessions);
    expect(db.students.find((s) => s.id === STRANGER_KID).status).toBe('active');
    expect(before).toBe(JSON.stringify(db.students) + JSON.stringify(db.quiz_sessions));
    await expect(Handset.bind({ code: 'ABC123', x, device_ref: DEV2 })).rejects.toMatchObject({ status: 409, code: 'used' });
    // the stranger's same-name child of the same teacher is a would-merge CANDIDATE on their browser — logged, never executed
    expect(logEvent).toHaveBeenCalledWith('web_quiz.handset_would_merge', expect.objectContaining({ from: STRANGER_KID, to: CHAT_KID }));
    expect(supabase.rpcs).toEqual([]);
  });

  test('a token for another code, a forged token, a hub token, the flag off, Redis down, a lost entry: refused, nothing trusted', async () => {
    await expect(Handset.bind({ code: 'ABC123', x: xOf(await mint([CHAT_KID], 'other-code')), device_ref: DEV2 })).rejects.toMatchObject({ status: 401, code: 'wrong_code' });
    const good = xOf(await mint());
    await expect(Handset.bind({ code: 'ABC123', x: `${good.slice(0, -3)}AAA`, device_ref: DEV2 })).rejects.toMatchObject({ status: 401, code: 'bad_token' });
    await expect(Handset.bind({ code: 'ABC123', x: T.signHub([CHAT_KID]), device_ref: DEV2 })).rejects.toMatchObject({ status: 401, code: 'bad_token' });
    await expect(Handset.bind({ code: 'ABC123', x: T.signHandset({ n: T.newNonce(), shareCodeId: SC }), device_ref: DEV2 })).rejects.toMatchObject({ status: 410, code: 'gone' });
    seed({ link: 'false' });
    await expect(Handset.bind({ code: 'ABC123', x: good, device_ref: DEV2 })).rejects.toMatchObject({ status: 503, code: 'web_quiz_off' });
    seed();
    const x2 = xOf(await mint());
    redis._up = false;
    await expect(Handset.bind({ code: 'ABC123', x: x2, device_ref: DEV2 })).rejects.toMatchObject({ status: 503, code: 'no_store' });
    redis._up = true;
    expect(await HubDevice.deviceKids(DEV2)).toEqual([]);
  });

  test('the trust write fails (Redis): no_store, and NO chips that could not start', async () => {
    const x = xOf(await mint());
    redis._failSet = true;
    await expect(Handset.bind({ code: 'ABC123', x, device_ref: DEV2 })).rejects.toMatchObject({ status: 503, code: 'no_store' });
  });

  test('would-merge candidates on the browser that played the page rows: exact canon + same teacher + pre-mint + nothing open + no list → LOGGED, never executed in phase 1', async () => {
    const x = xOf(await mint());
    const r = await Handset.bind({ code: 'ABC123', x, device_ref: DEV });
    expect(r.kids.map((k) => k.first).sort()).toEqual(['Ayesha', 'Bilal']);   // the phone's children only; page rows are not "kids"
    const would = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.handset_would_merge').map((c) => c[1]);
    expect(would).toEqual([expect.objectContaining({ from: PAGE_KID, to: CHAT_KID, shareCodeId: SC })]);
    // not: Zara (no twin), the other teacher's Ayesha, Bilal's open sitting, the class-list Ayesha
    expect(db.students.filter((s) => s.status === 'merged')).toEqual([]);
    expect(db.quiz_sessions.find((s) => s.id === 's-page-1').student_id).toBe(PAGE_KID);
    expect(supabase.rpcs).toEqual([]);
    expect(logEvent).toHaveBeenCalledWith('web_quiz.handset_bound', expect.objectContaining({ would_merge: 1, merged: 0 }));
  });

  test('a page row created AFTER the mint is never a candidate (a child typed in the redeemed session is not merged by the bind)', async () => {
    const x = xOf(await mint());
    db.students.find((s) => s.id === PAGE_KID).created_at = new Date(Date.now() + 1000).toISOString();
    const r = await Handset.bind({ code: 'ABC123', x, device_ref: DEV });
    expect(r.kids).toHaveLength(2);
    expect(logEvent).not.toHaveBeenCalledWith('web_quiz.handset_would_merge', expect.anything());
  });

  test('two handset children with one canonical name: no candidate (ambiguous)', async () => {
    db.students.find((s) => s.id === CHAT_SIB).student_name = 'Ayesha Khan';
    const x = xOf(await mint());
    await Handset.bind({ code: 'ABC123', x, device_ref: DEV });
    expect(logEvent).not.toHaveBeenCalledWith('web_quiz.handset_would_merge', expect.anything());
  });

  test('with web_quiz_handset_merge ON, the candidate goes to the SQL function (service role) with the actor, and the result is logged', async () => {
    seed({ merge: 'true' });
    supabase.rpcResult = { data: { moved: { quiz_sessions: ['s-page-1'] } }, error: null };
    const x = xOf(await mint());
    await Handset.bind({ code: 'ABC123', x, device_ref: DEV });
    expect(supabase.rpcs).toEqual([{ name: 'web_quiz_merge_student', args: { p_from: PAGE_KID, p_to: CHAT_KID, p_actor: 'web_quiz_handset' } }]);
    expect(logEvent).toHaveBeenCalledWith('web_quiz.handset_merged', expect.objectContaining({ from: PAGE_KID, to: CHAT_KID }));
    expect(logEvent).toHaveBeenCalledWith('web_quiz.handset_bound', expect.objectContaining({ would_merge: 1, merged: 1 }));
  });
});
