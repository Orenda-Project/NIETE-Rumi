/**
 * L39 (bd-s1oo0.50.5, CONTRACT §21.8): a whole battery-v3 visit, five children, through the real handler.
 *
 *   /egra → list → Start → Start with … → per child: presence → one step per task (18; a gap task is named by the
 *   bot's honest line instead) → one voice note per recorded task → the third child's ma.add1 comes back all wrong,
 *   so the coach types "skip" at ma.add2 → doneNext → … → after the fifth child the results (text) and the review
 *   (Flow pages) → the coach saves each page → coach_marks + checked_at on every task row.
 *   Plus the 4-minute nudge on the first step.
 *
 * Real: the handler and conversation (L36), the draw and the store (L3, on L3's in-memory Supabase), the item bank
 * (L35), the review and its completion (L39, through check-flow's completion as whatsapp-bot.js routes it).
 * Mocked at the network boundary: WhatsApp, Redis, R2, the Supabase client, the model HTTP (openai).
 * Scoring is a CONTRACT fake at its port (§21.5): it writes ai-marks-v3 from tests/child-test/L39/fixtures through
 * the real store, so this test depends on L37 only through the contract.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const { createFakeRedis, createWhatsAppRecorder } = require('../child-test/L4/helpers/boundary');

const mockRedis = createFakeRedis();
const mockWa = createWhatsAppRecorder();
let mockDb;
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn(async (b, key) => `https://r2.example/${key}`) }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/menu.service', () => ({ sendMenu: jest.fn(async () => true) }));
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: '{}' } }], usage: { cost: 0 } }) } } })));

mockWa.sendImageBufferWithButtons = jest.fn(async (to, buf, body, buttons) => { mockWa.__sent.push({ kind: 'imageButtons', to, body, buttons }); return true; });
mockWa.sendFlow = jest.fn(async (to, msg) => { mockWa.__sent.push({ kind: 'flow', to, ...msg }); return true; });

const { logError } = require('../../bot/shared/utils/logger');
const ports = require('../../bot/shared/services/child-test/conversation/ports');
const H = require('../../bot/shared/handlers/child-test.handler');
const nudge = require('../../bot/shared/services/child-test/conversation/nudge');
const store = require('../../bot/shared/services/child-test/store');
const itemBank = require('../../bot/shared/services/child-test/item-bank');
const { handleCheckCompletion } = require('../../bot/shared/services/child-test/check-flow');
const { detectFlowType } = require('../../bot/shared/utils/flow-type-detector');
const { TASKS_V3 } = require('../../bot/shared/services/child-test/tasks');
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('../child-test/L3/helpers/fake-supabase');
const { buildRoster } = require('../child-test/L3/helpers/roster');
const F = require('../child-test/L39/fixtures/marks-v3');

const COACH = { id: 'coach-1', role: 'coach', region: 'niete', preferred_language: 'en', phone_number: '923000000001' };
const PHONE = COACH.phone_number;
const SAVED = { ...process.env };
const WEAK = 2;                                              // the third child: every ma.add1 answer wrong
const GAPS = TASKS_V3.filter((task) => itemBank.getTaskSpec({ grade: 3, set: 'A', task }).gap);
const titleOf = (task) => itemBank.getTaskSpec({ grade: 3, set: 'A', task }).title.en;

const T = () => mockDb.__tables;
const sent = () => mockWa.__sent;
const textOf = (m) => [m.text, typeof m.body === 'string' ? m.body : m.body && m.body.text].filter(Boolean).join('\n');
let noteNo = 0;
const voice = () => { noteNo += 1; return { id: `wamid.v3-${noteNo}`, timestamp: String(Math.floor(Date.now() / 1000) + noteNo), audio: { id: `v3-${noteNo}`, mime_type: 'audio/ogg' } }; };

/** CONTRACT §21.5 scoring fake: the session's child (by test order) gets its fixture's ai-marks-v3 for the task. */
function contractScoring() {
  const order = [];
  const calls = [];
  return {
    calls,
    async scoreBlock(args) {
      calls.push(args);
      if (!order.includes(args.sessionId)) order.push(args.sessionId);
      const k = order.indexOf(args.sessionId);
      const marks = (k === WEAK ? F.weakChild() : F.child())[args.block];
      if (!marks) return { ok: false, aiStatus: 'failed', reason: 'no_fixture' };
      const r = await store.saveAiMarks({ sessionId: args.sessionId, block: args.block, aiMarks: marks, aiStatus: 'scored' });
      return r.ok || r.alreadyScored ? { ok: true, aiStatus: 'scored' } : { ok: false, aiStatus: 'failed', reason: r.error || r.reason };
    },
  };
}

let scoring;
let tmpDir;
beforeEach(() => {
  const seed = buildRoster({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }, { id: 'g5a', grade: 5, section: 'A', size: 25 }] });
  seed.users = [COACH, { id: 'teacher-1', role: 'teacher', school_id: 'school-1', name: 'Test Teacher', phone_number: '923009990399' }];
  seed.class_teachers = [{ teacher_user_id: 'teacher-1', class_id: 'g3a', is_active: true, is_class_teacher: true }];
  seed.observation_field_forms[0] = { ...seed.observation_field_forms[0], teacher_user_id: 'teacher-1', created_at: new Date().toISOString() };
  mockDb = createFakeSupabase(seed, { unique: CHILD_TEST_UNIQUE });
  for (const k of ['CHILD_TEST_MATHS_MODE', 'CHILD_TEST_CHECK_MODE', 'CHILD_TEST_STEP_NUDGE_MS', 'CHILD_TEST_COACH_IDS']) delete process.env[k];
  Object.assign(process.env, {
    CHILD_TEST_ENABLED: 'true', CHILD_TEST_OBSERVE_LINK: 'true', CHILD_TEST_DRAW_SECRET: 'test-secret', RAILWAY_ENVIRONMENT: 'sandbox',
    CHILD_TEST_BATTERY: 'v3', CHILD_TEST_REVIEW_FLOW_ID: 'review-flow-1',
  });
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'l39-e2e-'));
  process.env.CHILD_TEST_SETUP_PICTURE_DIR = tmpDir;
  fs.writeFileSync(path.join(tmpDir, 'setup-picture-en.png'), Buffer.from('png-en'));
  mockRedis.__data.clear();
  sent().length = 0;
  jest.clearAllMocks();
  scoring = contractScoring();
  ports.__setForTest({ scoring });                            // every other lane is the real module
});
afterEach(async () => { await H.__drain(); fs.rmSync(tmpDir, { recursive: true, force: true }); });
afterAll(() => { process.env = SAVED; ports.__setForTest(null); });

test('five children, 18 tasks each: steps, notes, the gap line, the skip, a nudge, the results, the review, the save', async () => {
  expect(await H.handleText(PHONE, '/egra', COACH)).toBe(true);
  await H.handleButton(COACH, PHONE, 'ctst_start');
  await H.handleButton(COACH, PHONE, 'ctst_go');

  const perChild = [];
  for (let k = 0; k < 5; k += 1) {
    const pres = [...sent()].reverse().find((m) => (m.buttons || []).some((b) => /^ctst_pres:.*:p$/.test(b.id)));
    expect(pres).toBeTruthy();
    const presId = pres.buttons.find((b) => /^ctst_pres:.*:p$/.test(b.id)).id;
    const from = sent().length;
    await H.handleButton(COACH, PHONE, presId);
    if (k === 0) {
      // the nudge: 4 minutes on the first step with no note, from the real store's open sessions
      expect((await nudge.sweepOnce({ now: new Date(Date.now() + 241 * 1000) })).sent).toBe(1);
      expect(textOf(sent()[sent().length - 1])).toMatch(/Did the recording stop/);
    }
    for (const task of TASKS_V3) {
      if (GAPS.includes(task)) continue;                      // the bot skips it, with a line on the next step
      const step = sent()[sent().length - 1];
      expect([task, textOf(step).includes(titleOf(task))]).toEqual([task, true]);
      expect(step.buttons).toBeUndefined();                   // plain text: the last bubble above the recorder
      if (k === WEAK && task === 'ma.add2') {
        await H.__drain();                                    // ma.add1 has been scored: all wrong
        expect(T().child_test_blocks.find((b) => b.block === 'ma.add1' && b.session_id === T().child_test_sessions[k].id).ai_marks.timed.correct).toBe(0);
        expect(await H.handleText(PHONE, 'skip', COACH)).toBe(true);
        continue;
      }
      expect(await H.handleVoice(voice(), PHONE, COACH)).toBe(true);
    }
    await H.__drain();
    const msgs = sent().slice(from);
    const nudges = msgs.filter((m) => /Did the recording stop/.test(textOf(m)));
    const steps = msgs.filter((m) => /· (Urdu|English|Maths) \d+ of \d+ · /.test(textOf(m)) && !nudges.includes(m));
    const gapLines = msgs.filter((m) => /not part of this test yet/.test(textOf(m)));
    perChild.push({ steps: steps.length, gaps: gapLines.length, nudges: nudges.length });
  }
  // 18 tasks a child: a step for every recorded or skippable task, the honest line for every gap
  for (const c of perChild) expect(c.steps + c.gaps).toBe(18);
  expect(perChild.map((c) => c.gaps)).toEqual(Array(5).fill(GAPS.length));
  expect(perChild.map((c) => c.nudges)).toEqual([1, 0, 0, 0, 0]);

  // 18 stored rows per child: notes, the coach's skip, the gaps
  const sessions = T().child_test_sessions;
  expect(sessions).toHaveLength(5);
  for (const s of sessions) {
    const rows = T().child_test_blocks.filter((b) => b.session_id === s.id);
    expect(rows.map((r) => r.block).sort()).toEqual([...TASKS_V3].sort());
    expect(s.status).toBe('completed');
  }
  const weakAdd2 = T().child_test_blocks.find((b) => b.session_id === sessions[WEAK].id && b.block === 'ma.add2');
  expect(weakAdd2.ai_marks.skipped_by_coach).toBe(true);
  expect(weakAdd2.audio_r2_key || null).toBeNull();
  expect(scoring.calls).toHaveLength(5 * (18 - GAPS.length) - 1);   // one per note; no call for a skip or a gap

  // the visit end: results as text (one line per block per child), then review page 1
  const results = sent().filter((m) => m.kind === 'text' && /^\*Child 3A-\d\d/.test(m.text || ''));
  expect(results.length).toBeGreaterThanOrEqual(1);
  const resultText = results.map((m) => m.text).join('\n');
  expect(resultText.split('\n').filter((l) => /^Urdu: /.test(l))).toHaveLength(5);
  expect(resultText).toMatch(/Maths: number ID 14\/min · bigger 7\/10 · missing 5\/10 · \+ 9\/min/);
  expect(resultText).toMatch(/\+ 0\/min · − 6\/min · harder \+ skipped/);   // the weak child
  for (const m of results) expect([...m.text].length).toBeLessThanOrEqual(4096);

  // the review: 5 items a child (listening, story question, which is bigger, missing number, word problem)
  let flows = sent().filter((m) => m.kind === 'flow');
  expect(flows).toHaveLength(1);
  expect(flows[0].header).toMatch(/1\/2/);
  for (let p = 0; p < 2; p += 1) {
    flows = sent().filter((m) => m.kind === 'flow');
    const msg = flows[p];
    const reply = { child_test: 'review', flow_token: msg.flowToken, review_ref: msg.screenData.review_ref };
    for (let i = 1; i <= 15; i += 1) { reply[`k${i}`] = msg.screenData[`i${i}_k`]; reply[`r${i}`] = msg.screenData[`i${i}_k`] ? 'correct' : ''; }
    expect(detectFlowType(reply)).toBe('child_test_check');   // whatsapp-bot.js routes it to handleCheckCompletion
    const r = await handleCheckCompletion(reply, PHONE, COACH);
    expect(r).toMatchObject({ ok: true, review: true, page: p + 1, pages: 2 });
  }
  expect(sent().filter((m) => m.kind === 'flow')).toHaveLength(2);
  expect(textOf(sent()[sent().length - 1])).toMatch(/Saved/);

  // saved: coach_marks + checked_at on every task row; the reviewed items carry the coach's verdict
  const rows = T().child_test_blocks;
  expect(rows).toHaveLength(90);
  expect(rows.every((b) => b.checked_at && b.coach_marks && b.coach_marks.version === 'coach-marks-v2')).toBe(true);
  const disc = rows.find((b) => b.session_id === sessions[0].id && b.block === 'ma.discrimination');
  expect(disc.coach_marks.items[2].verdict).toBe('correct');
  expect(disc.coach_edits).toEqual([{ path: 'items[2].verdict', ai: 'none', coach: 'correct' }]);
  expect(disc.ai_marks.items[2].verdict).toBe('none');       // the AI's mark is never overwritten
  expect(rows.filter((b) => b.coach_marks.meta.source === 'review')).toHaveLength(25);
  expect(logError).not.toHaveBeenCalled();

  // nothing coach-facing names a roll or a form
  const all = sent().map((m) => [textOf(m), ...(m.buttons || []).map((b) => b.title)].join('\n')).join('\n');
  expect(all).not.toMatch(/\broll\b|Child no\.|\bForm [AB]\b/i);
});
