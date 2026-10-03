/**
 * bd-s1oo0.22 — scoring must survive a restart.
 *
 * NIETE sandbox, 2 Oct 2026: a deploy removed the old container 1 s after it logged
 * `child_test.audio_saved {block: urdu}`. The Urdu block was scored by an in-memory promise
 * (machine.offPath), so it stayed `pending` for ever, and the check — gated on an in-memory
 * counter of scoreBlock calls — was never sent.
 *
 * These tests run the REAL conversation, the REAL draw and store (on L3's in-memory Supabase) and the
 * REAL recovery sweep. Only the network boundary is replaced: Supabase, Redis, WhatsApp, R2. Scoring is
 * L5's contract (writes go through the real store, so the write-once guards apply); the "keeps failing"
 * case runs L5's REAL scoreBlock against an R2 that is down.
 */
const { createFakeRedis, createWhatsAppRecorder } = require('../L4/helpers/boundary');
const { createLaneFakes } = require('../L4/helpers/lane-fakes');

const mockRedis = createFakeRedis();
const mockWa = createWhatsAppRecorder();
const mockR2Down = { on: false, downloads: 0 };
let mockDb;
jest.mock('../../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn(async (b, key) => `https://r2.example/${key}`),
  downloadFromR2: jest.fn(async () => {
    mockR2Down.downloads += 1;
    if (mockR2Down.on) throw new Error('R2 unreachable');
    return Buffer.from('OggS');
  }),
}));
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/utils/structured-logger', () => ({
  ...jest.requireActual('../../../bot/shared/utils/structured-logger'),
  logEvent: jest.fn(),
}));
// L20: the strip's child-number read goes to OpenRouter (network boundary): it reads no number here,
// so strip photos fall back to list order, as these scenarios expect.
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"child_no":null,"confidence":0}' } }], usage: { cost: 0 } }) } } })));

const COACH = { id: 'coach-1', role: 'coach', region: 'niete', preferred_language: 'en', phone_number: '923000000001' };
const PHONE = COACH.phone_number;
const MIN = 60 * 1000;
const T = () => mockDb.__tables;
const last = (kind) => [...mockWa.__sent].reverse().find((m) => m.kind === kind);
const voice = (id) => ({ id: `wamid.${id}`, timestamp: String(Math.floor(Date.now() / 1000) + 5), audio: { id } });
const blockRow = (b) => T().child_test_blocks.find((x) => x.block === b);
const later = (ms) => new Date(Date.now() + ms);

/**
 * L5's published contract (CONTRACT §5, §10 CR-1) over the REAL store: write-once ai_marks, 'scoring'
 * while it runs, 'failed' with a reason. `plan(args, n)` → 'ok' | 'fail' | 'hang' for the n-th call.
 */
function contractScoring(plan = () => 'ok') {
  const calls = [];
  const hung = [];
  return {
    calls,
    hung,
    async scoreBlock(args) {
      calls.push(args);
      const store = require('../../../bot/shared/services/child-test/store');
      const n = calls.filter((c) => c.sessionId === args.sessionId && c.block === args.block).length;
      const got = await store.getBlock(args.sessionId, args.block);
      const row = got.block;
      if (row.ai_marks) return { ok: true, aiStatus: 'scored', reason: 'already_scored' };
      if (args.block === 'maths' && !args.force && !(row.audio_r2_key && row.photo_r2_key)) return { ok: true, aiStatus: 'pending', reason: 'awaiting_photo' };
      await store.setAiStatus({ sessionId: args.sessionId, block: args.block, aiStatus: 'scoring' });
      await new Promise((r) => setImmediate(r));
      const what = plan(args, n);
      if (what === 'hang') return new Promise((resolve) => hung.push(resolve));
      if (what === 'fail') {
        await store.setAiStatus({ sessionId: args.sessionId, block: args.block, aiStatus: 'failed', reason: 'stt_failed' });
        return { ok: false, aiStatus: 'failed', reason: 'stt_failed' };
      }
      const saved = await store.saveAiMarks({ sessionId: args.sessionId, block: args.block, aiMarks: { version: 'ai-marks-v1', block: args.block }, aiStatus: 'scored' });
      if (!saved.ok && saved.alreadyScored) return { ok: true, aiStatus: 'scored', reason: 'already_scored' };
      return { ok: true, aiStatus: 'scored' };
    },
  };
}

// L26 (bd-s1oo0.46.2): the v2 journey is the default now; these scenarios drive today's (v1) conversation.
const V1_SWITCHES = { CHILD_TEST_BATTERY: 'v1', CHILD_TEST_MATHS_MODE: 'strip', CHILD_TEST_CHECK_MODE: 'per_child' };
beforeAll(() => { Object.assign(process.env, V1_SWITCHES); });
afterAll(() => { for (const k of Object.keys(V1_SWITCHES)) delete process.env[k]; });

describe('scoring survives a restart (bd-s1oo0.22)', () => {
  let H; let M; let ports; let lanes; let recovery; let logEvent;
  const SAVED = { ...process.env };
  const sendChecks = () => lanes.calls.filter((c) => c[0] === 'sendCheck');
  const dropped = [];

  beforeAll(() => {
    ports = require('../../../bot/shared/services/child-test/conversation/ports');
    M = require('../../../bot/shared/services/child-test/conversation/machine');
    H = require('../../../bot/shared/handlers/child-test.handler');
    ({ logEvent } = require('../../../bot/shared/utils/structured-logger'));
  });
  beforeEach(() => {
    const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('../L3/helpers/fake-supabase');
    const { buildRoster } = require('../L3/helpers/roster');
    const seed = buildRoster({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }, { id: 'g5a', grade: 5, section: 'A', size: 25 }] });
    seed.users = [COACH, { id: 'teacher-1', role: 'teacher', school_id: 'school-1' }];
    seed.class_teachers = [{ teacher_user_id: 'teacher-1', class_id: 'g3a', is_active: true }];
    seed.observation_field_forms[0] = { ...seed.observation_field_forms[0], teacher_user_id: 'teacher-1', created_at: new Date().toISOString() };
    mockDb = createFakeSupabase(seed, { unique: CHILD_TEST_UNIQUE });
    process.env.CHILD_TEST_ENABLED = 'true';
    process.env.CHILD_TEST_OBSERVE_LINK = 'true';   // these scenarios open the list through the observe2 visit
    process.env.CHILD_TEST_DRAW_SECRET = 'test-secret';
    process.env.RAILWAY_ENVIRONMENT = 'sandbox';
    delete process.env.CHILD_TEST_SCORE_RECOVERY_OFF;
    mockRedis.__data.clear();
    mockWa.__sent.length = 0;
    mockR2Down.on = false; mockR2Down.downloads = 0;
    lanes = createLaneFakes();
    dropped.length = 0;
    logEvent.mockClear();
    if (M.__setOffPathForTest) M.__setOffPathForTest(null);
    // Required lazily: the counter-gated check (old code) is proven red before this module exists.
    recovery = new Proxy({}, { get: (_, k) => require('../../../bot/shared/services/child-test/conversation/recovery')[k] });
  });
  afterEach(async () => { if (M.__setOffPathForTest) M.__setOffPathForTest(null); await H.__drain(); });
  afterAll(() => { process.env = SAVED; ports.__setForTest(null); });

  /** The process dies right after `audio_saved`: the in-memory scoring job for `block` never runs. */
  function dieAfterAudioSaved(block) {
    M.__setOffPathForTest((label, meta) => {
      if (label === 'score' && meta && meta.block === block && !dropped.includes(block)) { dropped.push(block); return 'drop'; }
      return 'run';
    });
  }

  async function testOneChild({ photo = true } = {}) {
    await H.handleText(PHONE, '/egra', COACH);
    const drawId = last('list').action.sections[0].rows[0].id.split(':')[1];
    await H.handleList(COACH, PHONE, `ctst_child:${drawId}`);
    await H.handleButton(COACH, PHONE, `ctst_pres:${drawId}:p`);
    for (const b of ['u', 'e', 'm']) expect(await H.handleVoice(voice(`rc-${b}`), PHONE, COACH)).toBe(true);
    const sessionId = T().child_test_sessions[0].id;
    if (photo === true) expect(await H.handleImage({ id: 'wamid.p', image: { id: 'strip' } }, PHONE, COACH)).toBe(true);
    if (photo === 'declined') await H.handleButton(COACH, PHONE, `ctst_nophoto:${sessionId}`);
    await H.__drain();
    return sessionId;
  }

  test('the lost Urdu job: the block stays pending, then the sweep scores it once and the check is sent once', async () => {
    const scoring = contractScoring();
    ports.__setForTest({ scoring, checkFlow: lanes.checkFlow, render: lanes.render });
    dieAfterAudioSaved('urdu');
    const sessionId = await testOneChild();

    // What the sandbox showed: Urdu never scored, English + maths scored, no check.
    expect(blockRow('urdu').ai_status).toBe('pending');
    expect(blockRow('english').ai_marks).toBeTruthy();
    expect(blockRow('maths').ai_marks).toBeTruthy();
    expect(sendChecks()).toHaveLength(0);

    // Inside the grace period the sweep leaves a just-saved block to the live path.
    expect((await recovery.sweepOnce({ now: new Date() })).recovered).toBe(0);
    expect(scoring.calls.filter((c) => c.block === 'urdu')).toHaveLength(0);

    const r = await recovery.sweepOnce({ now: later(2 * MIN) });
    expect(r.recovered).toBe(1);
    expect(scoring.calls.filter((c) => c.block === 'urdu')).toHaveLength(1);
    expect(blockRow('urdu').ai_marks).toMatchObject({ block: 'urdu' });
    expect(sendChecks()).toEqual([['sendCheck', sessionId]]);
    expect(logEvent).toHaveBeenCalledWith('child_test.score_recovered', expect.objectContaining({ sessionId, block: 'urdu', aiStatus: 'scored', prior: 'pending' }));

    // Nothing left to do: a second sweep neither scores nor sends again.
    const again = await recovery.sweepOnce({ now: later(3 * MIN) });
    expect(again.recovered).toBe(0);
    expect(scoring.calls.filter((c) => c.block === 'urdu')).toHaveLength(1);
    expect(sendChecks()).toHaveLength(1);
  });

  test('two instances sweeping at once never double-score (the claim is in the database)', async () => {
    const scoring = contractScoring();
    ports.__setForTest({ scoring, checkFlow: lanes.checkFlow, render: lanes.render });
    dieAfterAudioSaved('urdu');
    await testOneChild();
    let other;
    jest.isolateModules(() => {
      // A second bot replica: its own copy of the sweep, the store and the ports, same database.
      require('../../../bot/shared/services/child-test/conversation/ports').__setForTest({ scoring, checkFlow: lanes.checkFlow, render: lanes.render });
      other = require('../../../bot/shared/services/child-test/conversation/recovery');
    });
    const now = later(2 * MIN);
    const [a, b] = await Promise.all([recovery.sweepOnce({ now }), other.sweepOnce({ now })]);
    expect(a.recovered + b.recovered).toBe(1);
    expect(scoring.calls.filter((c) => c.block === 'urdu')).toHaveLength(1);
    expect(sendChecks()).toHaveLength(1);
  });

  test('the claim is a compare-and-set: two claimers holding the same snapshot, exactly one wins', async () => {
    const store = require('../../../bot/shared/services/child-test/store');
    ports.__setForTest({ scoring: contractScoring(), checkFlow: lanes.checkFlow, render: lanes.render });
    dieAfterAudioSaved('urdu');
    await testOneChild();
    const snap = { ...blockRow('urdu') };
    const claim = () => store.claimBlockStatus({ blockId: snap.id, fromStatus: snap.ai_status, fromUpdatedAt: snap.updated_at, toStatus: 'scoring', reason: 'claim:test' });
    const [x, y] = await Promise.all([claim(), claim()]);
    expect([x.claimed, y.claimed].sort()).toEqual([false, true]);
    expect(blockRow('urdu')).toMatchObject({ ai_status: 'scoring', ai_reason: 'claim:test' });
  });

  test('a block that fails once is retried, and the check waits for it instead of opening on a counter', async () => {
    const scoring = contractScoring((args, n) => (args.block === 'urdu' && n === 1 ? 'fail' : 'ok'));
    ports.__setForTest({ scoring, checkFlow: lanes.checkFlow, render: lanes.render });
    const sessionId = await testOneChild();

    expect(blockRow('urdu').ai_status).toBe('failed');
    expect(sendChecks()).toHaveLength(0);   // three scoreBlock calls have returned, but Urdu can still be marked

    const r = await recovery.sweepOnce({ now: later(2 * MIN) });
    expect(r.recovered).toBe(1);
    expect(blockRow('urdu').ai_marks).toBeTruthy();
    expect(sendChecks()).toEqual([['sendCheck', sessionId]]);
    expect(Object.keys(T().child_test_sessions[0].timings)).toEqual(expect.arrayContaining(['urdu.score_attempt.1', 'urdu.score_attempt.2']));
  });

  test('a block that keeps failing (REAL scorer, R2 down) ends failed after 3 attempts and the check still opens, once', async () => {
    ports.__setForTest({ checkFlow: lanes.checkFlow, render: lanes.render });   // L5's real scoreBlock
    mockR2Down.on = true;
    const sessionId = await testOneChild();
    expect(blockRow('urdu')).toMatchObject({ ai_status: 'failed', ai_reason: 'audio_download_failed' });
    expect(sendChecks()).toHaveLength(0);

    await recovery.sweepOnce({ now: later(2 * MIN) });
    expect(sendChecks()).toHaveLength(0);
    const third = await recovery.sweepOnce({ now: later(4 * MIN) });
    expect(third.gaveUp).toBe(3);
    for (const b of ['urdu', 'english', 'maths']) {
      expect(blockRow(b)).toMatchObject({ ai_status: 'failed', ai_reason: 'final:audio_download_failed' });
      expect(blockRow(b).ai_marks == null).toBe(true);
    }
    expect(sendChecks()).toEqual([['sendCheck', sessionId]]);
    const downloads = mockR2Down.downloads;
    expect(downloads).toBe(9);   // 3 blocks × 3 attempts, no more

    await recovery.sweepOnce({ now: later(6 * MIN) });
    expect(mockR2Down.downloads).toBe(downloads);
    expect(sendChecks()).toHaveLength(1);
  });

  test('died mid-score: a block left `scoring` is reclaimed only after the bound, marks are written once, the zombie does not resend', async () => {
    const scoring = contractScoring((args, n) => (args.block === 'english' && n === 1 ? 'hang' : 'ok'));
    ports.__setForTest({ scoring, checkFlow: lanes.checkFlow, render: lanes.render });
    const run = testOneChild();
    // The English job is stuck inside the scorer (a process that has gone away): let the rest finish.
    for (let i = 0; i < 200 && !(scoring.hung.length && blockRow('maths') && blockRow('maths').ai_marks); i++) await new Promise((r) => setImmediate(r));
    expect(blockRow('english').ai_status).toBe('scoring');
    expect(sendChecks()).toHaveLength(0);

    expect((await recovery.sweepOnce({ now: later(1 * MIN) })).recovered).toBe(0);   // still within the bound
    expect((await recovery.sweepOnce({ now: later(5 * MIN) })).recovered).toBe(1);
    expect(scoring.calls.filter((c) => c.block === 'english')).toHaveLength(2);
    expect(sendChecks()).toHaveLength(1);

    // The old job comes back after all: its write is refused (write-once) and the check is not sent twice.
    scoring.hung.forEach((resolve) => resolve({ ok: true, aiStatus: 'scored' }));
    await run;
    await H.__drain();
    expect(sendChecks()).toHaveLength(1);
  });

  test('maths waits for the strip; a declined strip whose job was lost is scored with force', async () => {
    const scoring = contractScoring();
    ports.__setForTest({ scoring, checkFlow: lanes.checkFlow, render: lanes.render });
    // No photo yet, nothing declined: the sweep must not score maths (the strip may still come).
    await testOneChild({ photo: false });
    expect(blockRow('maths').ai_status).toBe('pending');
    await recovery.sweepOnce({ now: later(5 * MIN) });
    expect(scoring.calls.filter((c) => c.block === 'maths')).toHaveLength(0);
    expect(sendChecks()).toHaveLength(0);

    // The coach declines the strip, and the process dies before the maths job runs.
    dieAfterAudioSaved('maths');
    const sessionId = T().child_test_sessions[0].id;
    await H.handleButton(COACH, PHONE, `ctst_nophoto:${sessionId}`);
    await H.__drain();
    expect(scoring.calls.filter((c) => c.block === 'maths')).toHaveLength(0);
    await recovery.sweepOnce({ now: later(5 * MIN) });
    expect(scoring.calls.filter((c) => c.block === 'maths')).toEqual([expect.objectContaining({ block: 'maths', force: true })]);
    expect(sendChecks()).toEqual([['sendCheck', sessionId]]);
  });

  test('a sweep only takes blocks of its own environment (mock-lane bots share the sandbox database)', async () => {
    const scoring = contractScoring();
    ports.__setForTest({ scoring, checkFlow: lanes.checkFlow, render: lanes.render });
    dieAfterAudioSaved('urdu');
    const sessionId = await testOneChild();
    expect(blockRow('urdu').audio_r2_key).toMatch(/^child-test\/sandbox\//);
    // A local mock-lane bot (CHILD_TEST_R2_ENV=local-sim) on the same database leaves the sandbox's block alone.
    process.env.CHILD_TEST_R2_ENV = 'local-sim';
    try {
      const r = await recovery.sweepOnce({ now: later(2 * MIN) });
      expect(r.recovered).toBe(0);
      expect(scoring.calls.filter((c) => c.block === 'urdu')).toHaveLength(0);
      expect(sendChecks()).toHaveLength(0);
    } finally {
      delete process.env.CHILD_TEST_R2_ENV;
    }
    expect((await recovery.sweepOnce({ now: later(2 * MIN) })).recovered).toBe(1);
    expect(sendChecks()).toEqual([['sendCheck', sessionId]]);
  });

  test('inert unless CHILD_TEST_ENABLED=true, and the kill switch stops it', async () => {
    delete process.env.CHILD_TEST_ENABLED;
    const before = mockDb.__calls.length;
    expect(await recovery.sweepOnce({ now: later(5 * MIN) })).toMatchObject({ skipped: 'disabled' });
    expect(recovery.start()).toBe(false);
    process.env.CHILD_TEST_ENABLED = 'true';
    process.env.CHILD_TEST_OBSERVE_LINK = 'true';   // these scenarios open the list through the observe2 visit
    process.env.CHILD_TEST_SCORE_RECOVERY_OFF = '1';
    expect(await recovery.sweepOnce({ now: later(5 * MIN) })).toMatchObject({ skipped: 'off' });
    expect(recovery.start()).toBe(false);
    expect(mockDb.__calls.length).toBe(before);
  });

  test('start() runs once soon after boot and then on an interval (Class P), and stop() clears both', () => {
    jest.useFakeTimers();
    try {
      const spy = jest.spyOn(recovery.__internals, 'tick').mockImplementation(async () => ({}));
      expect(recovery.start({ bootDelayMs: 1000, intervalMs: 5000 })).toBe(true);
      expect(recovery.start({ bootDelayMs: 1000, intervalMs: 5000 })).toBe(false);   // once per process
      jest.advanceTimersByTime(1000);
      expect(spy).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(5000);
      expect(spy).toHaveBeenCalledTimes(2);
      recovery.stop();
      jest.advanceTimersByTime(20000);
      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });
});
