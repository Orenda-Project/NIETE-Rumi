'use strict';
/**
 * Events v2 behind app_settings `web_quiz_events_v2` (parent `web_quiz_hub`):
 *   - m_result / m_lost built from a stored v2 run row (web-quiz-measure-events.js): comp_ok / comp_n, never an
 *     option index; emitted where a run becomes scored or failed, only with the switch on AND a v2 row (mode set)
 *   - the page relay: ch_helped keeps its three-valued answer (v2 on only); every other name keeps v = a0|a1;
 *     a batch over 20 logs web_quiz.ev_dropped
 *   - the server ch_start and hub_open gain the v2 envelope (w, ev_v, kid_v, kid) and dk, only with the switch on
 * Faked boundaries only: Supabase, R2, speech, the LLM client, Redis, WhatsApp, the logger transport.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key) => `https://r2.test/put/${key}?X-Amz-Signature=x`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' })),
  downloadFromR2: jest.fn(),
  getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=x`),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key) => `https://signed.test/${key}`),
  deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true),
  listKeys: jest.fn(async () => []),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
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
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true), sendCtaUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Svc = require('../../../shared/services/quiz/web-quiz.service');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const K = require('../../../shared/services/quiz/web-quiz-kid');
const M = require('../../../shared/services/quiz/web-quiz-measure-events');

const KID = '44444444-4444-4444-8444-000000000001';
const SIB = '44444444-4444-4444-8444-000000000002';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const SC = '33333333-3333-4333-8333-333333333333';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const V2 = { key: 'web_quiz_events_v2', value: true };

// A run row as the v2 serve writes it (the columns of the runs migration; synthetic values).
const V2_COLS = {
  mode: 'check', period_id: '2026-11', form: 'G3', band: 1, exposure_no: 1, record: true, canonical_id: KID,
  id_src: 'roster_pick', id_confidence: 'high', homonym_in_list: false, via: 'quiz_card', helped: 'self',
  share_code_id: SC, class_id: LIST, passage_id: 'en.read.1.sparrow', anchor_exposure_no: null, anchor_block: null,
};

let db;
let stampV2 = false; // simulate the v2 serve: every run row written carries the v2 columns
function seed() {
  db = {
    app_settings: [{ key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_challenge', value: true }],
    students: [
      { id: KID, student_name: 'Sana Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '923001112223' },
      { id: SIB, student_name: 'Bilal Testwala', student_name_urdu: null, self_reported_class: '5', list_id: null, is_active: true, phone: '923001112223' },
    ],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [], quiz_share_codes: [], quiz_sessions: [], student_videos: [], web_quiz_challenge_runs: [],
  };
  const fake = makeFake(db);
  const from = fake.from;
  fake.from = (t) => {
    const b = from(t);
    if (t !== 'web_quiz_challenge_runs') return b;
    const insert = b.insert;
    b.insert = (row) => insert(stampV2 ? (Array.isArray(row) ? row.map((r) => ({ ...V2_COLS, ...r })) : { ...V2_COLS, ...row }) : row);
    return b;
  };
  Object.assign(supabase, fake);
}
const named = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const on = (...rows) => { db.app_settings.push(...rows); Hub._resetCache(); };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'measure-test-secret';
  process.env.WEB_QUIZ_KID_KEY = 'test-only-kid-key-0123456789abcdef0123456789';
  process.env.WEB_QUIZ_KID_KEY_V = '2026';
  process.env.CHILD_TEST_R2_ENV = 'sandbox';
  stampV2 = false;
  Hub._resetCache();
  Ch.__reset();
  K._reset();
  require('../../../shared/services/cache/railway-redis.service')._store.clear();
  seed();
});

// ── m_result / m_lost from a stored row ───────────────────────────────────────────────────────────────
const readRow = (over = {}) => ({
  id: '00000000-0000-4000-8000-000000000001', student_id: KID, exercise: 'read', grade: 3, lang: 'en', status: 'scored', wcpm: 21,
  score: { correct: 18, attempted: 24, stopped: false, finished_early: false, time_left: 0 },
  meta: { sitting: '5a1f00000000beef', comp: { asked: 3, correct: 2, v: 1, a: { 1: 1, 2: 0, 3: 1 } }, audio_key: 'child-voice/x.webm' },
  created_at: '2026-11-03T10:00:00Z', ...V2_COLS, ...over,
});

describe('m_result', () => {
  test('carries comp_ok / comp_n and the row\'s measurement fields, never the option index, picked, opt_shown or q_id', () => {
    const ev = M.mResult(readRow(), { rung: 0 });
    expect(ev).toMatchObject({
      w: 's', ev_v: 2, kid_v: '2026', kid: K.kid(KID), run: '00000000-0000-4000-8000-000000000001',
      form: 'G3', band: 1, fixed_band: 'G23', rung: 0, exercise: 'read', lang: 'en', fixed_grade: 3, mode: 'check', record: true,
      period_id: '2026-11', exposure_no: 1, passage_id: 'en.read.1.sparrow', id_src: 'roster_pick', id_confidence: 'high',
      homonym_in_list: false, via: 'quiz_card', helped: 'self', sitting: '5a1f00000000beef', ok_n: 18, n: 24, wcpm: 21,
      comp_ok: 2, comp_n: 3, stopped: false, quality: 'ok',
    });
    const s = JSON.stringify(ev);
    expect(s).not.toMatch(/picked|opt_shown|q_id|"a":|audio_key|child-voice/);
    expect(ev).not.toHaveProperty('student_id');
    expect(ev).not.toHaveProperty('class_id');
    expect(ev).not.toHaveProperty('share_code_id');
    expect(s).not.toMatch(/55555555|33333333|44444444/);
  });

  test('the per-question array shape (meta.comp[] with picked / opt_shown / q_id) reduces to the two numbers', () => {
    const comp = [{ q_id: 'q1', picked: 2, opt_shown: [0, 1, 2], ok: true }, { q_id: 'q2', picked: 0, opt_shown: [2, 0, 1], ok: false }];
    const ev = M.mResult(readRow({ meta: { comp } }));
    expect(ev).toMatchObject({ comp_ok: 1, comp_n: 2 });
    expect(JSON.stringify(ev)).not.toMatch(/picked|opt_shown|q_id|q1|q2/);
  });

  test('a tap exercise has no wcpm and no comp; an item set replaces the passage', () => {
    const ev = M.mResult(readRow({ exercise: 'bigger', wcpm: null, score: { correct: 7, n: 10, stopped: true }, meta: {}, passage_id: null, item_set_id: 'ma.big.g3.a' }));
    expect(ev).toMatchObject({ exercise: 'bigger', ok_n: 7, n: 10, stopped: true, item_set_id: 'ma.big.g3.a' });
    expect(ev).not.toHaveProperty('wcpm');
    expect(ev).not.toHaveProperty('comp_ok');
    expect(ev).not.toHaveProperty('passage_id');
  });
});

describe('m_lost', () => {
  test('reason failed or swept, the row\'s identifying fields only', () => {
    const ev = M.mLost(readRow({ status: 'failed' }), { reason: 'swept', ageMin: 14 });
    expect(ev).toEqual({
      w: 's', ev_v: 2, kid_v: '2026', kid: K.kid(KID), run: '00000000-0000-4000-8000-000000000001', exercise: 'read', band: 1,
      fixed_band: 'G23', rung: null, lang: 'en', form: 'G3', mode: 'check', record: true, reason: 'swept', age_min: 14,
    });
    expect(M.mLost(readRow({ status: 'failed' })).reason).toBe('failed');
    expect(M.mLost(readRow({ status: 'failed' }), { reason: 'whatever' }).reason).toBe('failed');
  });
});

// ── the page relay ────────────────────────────────────────────────────────────────────────────────────
describe('cleanEvent: v is name-scoped', () => {
  test('ch_helped keeps self | helped | not_asked with v2 on (and reads the page\'s 0 / 1 as self / helped)', () => {
    const v = (e) => (Svc.cleanEvent(e, { v2: true }) || {}).props.v;
    expect(v({ n: 'ch_helped', v: 'self' })).toBe('self');
    expect(v({ n: 'ch_helped', v: 'helped' })).toBe('helped');
    expect(v({ n: 'ch_helped', v: 'not_asked' })).toBe('not_asked');
    expect(v({ n: 'ch_helped', v: 0 })).toBe('self');
    expect(v({ n: 'ch_helped', v: 1 })).toBe('helped');
    expect(v({ n: 'ch_helped', v: 'a1' })).toBeUndefined();
    expect(v({ n: 'ch_helped', v: 'Sana' })).toBeUndefined();
  });

  test('ch_helped drops its answer with v2 off (today\'s behaviour, golden)', () => {
    for (const val of ['self', 'helped', 'not_asked', 0, 1]) expect(Svc.cleanEvent({ n: 'ch_helped', v: val }).props).toEqual({});
  });

  test('every other name keeps v only as a0 | a1, v2 on or off', () => {
    for (const v2 of [true, false]) {
      expect(Svc.cleanEvent({ n: 'invite_ask', v: 'a1' }, { v2 }).props.v).toBe('a1');
      expect(Svc.cleanEvent({ n: 'invite_ask', v: 'self' }, { v2 }).props.v).toBeUndefined();
      expect(Svc.cleanEvent({ n: 'door_tap', v: 'helped' }, { v2 }).props.v).toBeUndefined();
    }
  });
});

describe('cleanEvent: the name-scoped allow-list (v2 on only)', () => {
  test('with v2 on the relay stamps w = p on every page event, whatever the page sent; v2 off adds no w', () => {
    expect(Svc.cleanEvent({ n: 'answer', w: 'p' }, { v2: true }).props.w).toBe('p');
    expect(Svc.cleanEvent({ n: 'bind_offered', w: 's' }, { v2: true }).props.w).toBe('p');
    expect(Svc.cleanEvent({ n: 'answer', w: 'x' }, { v2: true }).props.w).toBe('p');
    expect(Svc.cleanEvent({ n: 'answer' }, { v2: true }).props.w).toBe('p');
    expect(Svc.cleanEvent({ n: 'answer', w: 'p' }).props).not.toHaveProperty('w');
  });

  test('surface is admitted for bind_offered only, as trail | hub | book | end_card, and only with v2 on', () => {
    for (const v of ['trail', 'hub', 'book', 'end_card']) expect(Svc.cleanEvent({ n: 'bind_offered', surface: v }, { v2: true }).props.surface).toBe(v);
    expect(Svc.cleanEvent({ n: 'bind_offered', surface: 'scorecard' }, { v2: true }).props).not.toHaveProperty('surface');
    expect(Svc.cleanEvent({ n: 'answer', surface: 'trail' }, { v2: true }).props).not.toHaveProperty('surface');
    expect(Svc.cleanEvent({ n: 'bind_offered', surface: 'trail' }).props).not.toHaveProperty('surface');
  });

  test('the map is one place: a new name-scoped rule is one entry (NAME_PROPS), checked only for its own name', () => {
    expect(Object.keys(Svc.NAME_PROPS)).toEqual(expect.arrayContaining(['ch_helped', 'bind_offered']));
    expect(Object.isFrozen(Svc.NAME_PROPS)).toBe(true);
  });

  test('a server-only name never passes the page relay with v2 on; with v2 off the relay is as today', () => {
    for (const n of ['m_result', 'm_lost', 'ch_swept', 'lamp_lit', 'light_lit', 'identity_reused', 'sample_window',
      'sample_drawn', 'class_week_forwarded', 'ev_dropped', 'reply_capped', 'bind_bound', 'bind_confirm', 'bind_undo',
      'class_round_started', 'class_round_declined']) {
      expect(Svc.cleanEvent({ n, w: 's' }, { v2: true })).toBeNull();
    }
    for (const n of ['bind_offered', 'bind_sent']) expect(Svc.cleanEvent({ n }, { v2: true }).props.w).toBe('p');   // page-written
    expect(Svc.cleanEvent({ n: 'm_result', w: 's' })).not.toBeNull();
  });

  test('door events are dropped by (name, door): only the server-written doors', () => {
    const page = (n, door) => Svc.cleanEvent({ n, door }, { v2: true });
    for (const d of ['card', 'hub_first', 'shelf', 'next', 'tomorrow', 'install', 'friend']) {
      expect(page('door_shown', d).props.w).toBe('p');
      expect(page('door_tap', d).props.w).toBe('p');
    }
    expect(page('door_shown', 'quiz_reply')).toBeNull();
    expect(page('door_tap', 'quiz_reply')).toBeNull();
    expect(page('door_shown', 'class_link')).toBeNull();
    expect(page('door_tap', 'class_link')).toBeNull();
    expect(page('door_shown', 'link_home')).toBeNull();
    expect(page('door_tap', 'link_home').props.w).toBe('p');
  });
});

describe('events(): the 20-per-batch slice is not silent with v2 on', () => {
  test('23 events: 20 logged and one ev_dropped{n:3, where:batch_slice}', async () => {
    on(V2);
    await Hub.flags();
    const batch = Array.from({ length: 23 }, (_, i) => ({ n: 'answer', i }));
    expect(Svc.events({ events: batch })).toEqual({ logged: 20 });
    expect(named('web_quiz.ev_dropped')).toEqual([{ w: 's', ev_v: 2, kid_v: '2026', kid: null, n: 3, where: 'batch_slice' }]);
  });

  test('a forged batch: server-only names dropped, one ev_dropped{why:server_only, n}, page events kept as w:p', async () => {
    on(V2);
    await Hub.flags();
    const batch = [{ n: 'm_result', w: 's', run: 'x' }, { n: 'door_shown', door: 'card' }, { n: 'door_shown', door: 'quiz_reply' },
      { n: 'lamp_lit', w: 's' }, { n: 'bind_offered', surface: 'hub' }, { n: 'answer', w: 's' }];
    expect(Svc.events({ events: batch })).toEqual({ logged: 3 });
    expect(named('web_quiz.m_result')).toHaveLength(0);
    expect(named('web_quiz.lamp_lit')).toHaveLength(0);
    expect(named('web_quiz.door_shown')).toEqual([{ door: 'card', w: 'p' }]);
    expect(named('web_quiz.answer')).toEqual([{ w: 'p' }]);
    expect(named('web_quiz.ev_dropped')).toEqual([{ w: 's', ev_v: 2, kid_v: '2026', kid: null, n: 3, why: 'server_only' }]);
  });

  test('20 or fewer: no ev_dropped', async () => {
    on(V2);
    await Hub.flags();
    Svc.events({ events: Array.from({ length: 20 }, (_, i) => ({ n: 'answer', i })) });
    expect(named('web_quiz.ev_dropped')).toHaveLength(0);
  });
});

// ── the server copies ─────────────────────────────────────────────────────────────────────────────────
describe('ch_start server copy with v2 on', () => {
  test('gains w:s and the envelope; the v2 fields only when the run has them (none today)', async () => {
    on(V2);
    await Ch.exercise(T.signHub([KID]), 'bigger', { device: DEV });
    const [ev] = named('web_quiz.ch_start');
    expect(ev).toEqual({ step: 'bigger', grade: 3, run: expect.any(String), w: 's', ev_v: 2, kid_v: '2026', kid: K.kid(KID) });
  });

  test('chStart: a run with v2 fields carries them, keyed on its canonical id; never a share code or class id', () => {
    const run = { ...V2_COLS, canonical_id: SIB, rung: 0 };
    const ev = M.chStart({ step: 'read', grade: 3, run: 'r1' }, run, KID);
    expect(ev).toEqual({
      step: 'read', grade: 3, run: 'r1', w: 's', ev_v: 2, kid_v: '2026', kid: K.kid(SIB), mode: 'check', period_id: '2026-11', form: 'G3',
      band: 1, rung: 0, passage_id: 'en.read.1.sparrow', exposure_no: 1, record: true, via: 'quiz_card',
    });
  });
});

describe('hub_open with v2 on', () => {
  test('src is the route the caller passed (opts.src), only from the allowed set; anything else is omitted', async () => {
    on(V2);
    await Hub.hub(T.signHub([KID]), { device: DEV, src: 'wa' });
    await Hub.hub(T.signHub([KID, SIB]), { device: DEV, src: 'class_link' });
    await Hub.hub(T.signHub([KID]), { device: DEV, src: 'evil<script>' });
    await Hub.hub(T.signHub([KID]), { device: DEV, src: 'page' });
    const [a, b, c, d] = named('web_quiz.hub_open');
    expect(a.src).toBe('wa');
    expect(b).toMatchObject({ picked: false, src: 'class_link' });
    expect(c).not.toHaveProperty('src');
    expect(d).not.toHaveProperty('src');
  });

  test('src passed with v2 off: hub_open is today\'s, byte for byte (no src)', async () => {
    await Hub.hub(T.signHub([KID]), { device: DEV, src: 'wa' });
    await Hub.hub(T.signHub([KID, SIB]), { device: DEV, src: 'wa' });
    const [picked, unpicked] = named('web_quiz.hub_open');
    expect(Object.keys(picked).sort()).toEqual(['again_n', 'challenge', 'has_teacher', 'kids', 'recs_n', 'teacher_src']);
    expect(unpicked).toEqual({ kids: 2, picked: false });
  });

  test('the picked copy gains dk and kid; the unpicked copy dk only; counts unchanged; no src when none is passed', async () => {
    on(V2);
    await Hub.hub(T.signHub([KID]), { device: DEV });
    await Hub.hub(T.signHub([KID, SIB]), { device: DEV });
    const [picked, unpicked] = named('web_quiz.hub_open');
    expect(picked).toMatchObject({ kids: 1, w: 's', ev_v: 2, kid_v: '2026', kid: K.kid(KID), dk: K.dk(DEV) });
    expect(unpicked).toEqual({ kids: 2, picked: false, w: 's', ev_v: 2, kid_v: '2026', kid: null, dk: K.dk(DEV) });
    expect(picked).not.toHaveProperty('src');
    expect(JSON.stringify([picked, unpicked])).not.toMatch(/AAAAAAAA|44444444|Testwala/);
  });
});

// ── where a run becomes scored or failed ─────────────────────────────────────────────────────────────
const allRight = (items) => items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 2500 }));
const bigger = async () => {
  const ex = await Ch.exercise(T.signHub([KID]), 'bigger', { device: DEV });
  await Ch.submit({ ct: ex.ct, taps: allRight(ex.items), ms: 25000 });
  return T.verify(ex.ct, 'c').r;
};

describe('m_result / m_lost are emitted where the run is stored', () => {
  test('v2 on and a v2 row (mode set): one m_result for the scored run', async () => {
    on(V2);
    stampV2 = true;
    const run = await bigger();
    const ev = named('web_quiz.m_result');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ run, kid: K.kid(KID), exercise: 'bigger', mode: 'check', ok_n: 10, n: 10, record: true });
  });

  test('v2 on but a row written today (no mode): no m_result', async () => {
    on(V2);
    await bigger();
    expect(named('web_quiz.m_result')).toHaveLength(0);
  });

  test('v2 off with a v2 row: no m_result, no m_lost', async () => {
    stampV2 = true;
    await bigger();
    expect(named('web_quiz.m_result')).toHaveLength(0);
    expect(named('web_quiz.m_lost')).toHaveLength(0);
  });

  test('a reading that fails scoring (v2 on, v2 row): one m_lost{reason:failed}, no m_result', async () => {
    on(V2);
    stampV2 = true;
    const { ct } = await Ch.exercise(T.signHub([KID]), 'read', { device: DEV, lang: 'en' });
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    r2.downloadFromR2.mockRejectedValue(new Error('r2 down'));
    const r = await Ch.submit({ ct, key, ms: 60000, lang: 'en' }, { waitMs: 60000 });
    expect(r).toMatchObject({ failed: true });
    const lost = named('web_quiz.m_lost');
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ run: T.verify(ct, 'c').r, reason: 'failed', exercise: 'read', kid: K.kid(KID) });
    expect(named('web_quiz.m_result')).toHaveLength(0);
  });
});
