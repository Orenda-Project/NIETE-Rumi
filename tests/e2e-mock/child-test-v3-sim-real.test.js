/**
 * L39 (bd-s1oo0.50.5, CONTRACT §21.8): the SIMULATED COACH (coach.js runVisitV3, the code L0 points at the sandbox)
 * plays a whole v3 visit against the real handler in process — so its matchers are proven on the real bot's
 * messages, not only on fake-bot-v3. The transport below turns the recorded WhatsApp sends into the outbox shape
 * the sandbox transport delivers, and the coach's moves into handler calls. Setup as child-test-v3-visit.test.js.
 *
 * (Setup copied from child-test-v3-visit.test.js:) a whole battery-v3 visit, five children, through the real handler.
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

const { runVisitV3 } = require('../../bot/scripts/e2e/child-test-sim/coach');
const { createTimeline } = require('../../bot/scripts/e2e/child-test-sim/timeline');
const { taskTitles } = require('../../bot/scripts/e2e/child-test-sim/driver');

/** The real handler as a transport: sends become handler calls; recorded WhatsApp sends become outbox items. */
function handlerTransport() {
  let seen = 0;
  const outbox = [];
  const norm = (m) => {
    if (m.kind === 'flow') return { type: 'interactive.flow', txt: m.header, flow: { id: m.flowId, token: m.flowToken, data: m.screenData } };
    if (m.buttons) return { type: 'interactive.button', txt: textOf(m), raw: { interactive: { action: { buttons: m.buttons.map((b) => ({ reply: { id: b.id, title: b.title } })) } } } };
    return { type: 'text', txt: textOf(m) };
  };
  const after = async () => { await H.__drain(); while (seen < sent().length) outbox.push({ seq: outbox.length + 1, ...norm(sent()[seen++]) }); };
  return {
    pollMs: 1,
    async sendText(t) { await H.handleText(PHONE, t, COACH); await after(); },
    async tapButton(id) { await H.handleButton(COACH, PHONE, id); await after(); },
    async sendMedia(kind) { if (kind !== 'audio') throw new Error('v3 sends only voice notes'); await H.handleVoice(voice(), PHONE, COACH); await after(); },
    async submitFlow(flowId, response) {
      expect(detectFlowType(response)).toBe('child_test_check');
      await handleCheckCompletion(response, PHONE, COACH); await after();
    },
    async poll(cursor) { return outbox.filter((it) => it.seq > cursor); },
  };
}

test('runVisitV3 plays five children against the real bot: every note lands on its task, the skip, the review saved from the keys', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l39-simreal-'));
  const fixtures = [0, 1, 2, 3, 4].map((k) => {
    const id = `sim-${k}`;
    const fdir = path.join(dir, id);
    fs.mkdirSync(fdir);
    const marks = k === WEAK ? F.weakChild() : F.child();
    const tasks = {};
    for (const task of TASKS_V3) {
      if (GAPS.includes(task)) { tasks[task] = { gap: true, audio: null }; continue; }
      if (marks[task].skipped_by_coach) { tasks[task] = { skipped_by_coach: true, audio: null }; continue; }
      fs.writeFileSync(path.join(fdir, `${task}.ogg`), 'x');
      tasks[task] = { audio: `${task}.ogg`, items: marks[task].items.map((x) => ({ i: x.i, verdict: x.i % 2 ? 'wrong' : 'correct' })),
        ...(marks[task].comprehension ? { comprehension: marks[task].comprehension.map((q) => ({ id: q.id, verdict: 'correct' })) } : {}) };
    }
    fs.writeFileSync(path.join(fdir, 'key.json'), JSON.stringify({ fixture_id: id, grade: 3, tasks }));
    return { id, dir: fdir, grade: 3 };
  });
  const tl = createTimeline(path.join(dir, 'run', 'timeline.jsonl'));
  const res = await runVisitV3({ transport: handlerTransport(), timeline: tl, fixtures, titles: taskTitles(null, 3), timeoutMs: 3000, reviewWaitMs: 3000, sleep: async () => {} });
  expect(res.error).toBeUndefined();
  expect(res).toMatchObject({ ok: true, review: { pages: 2, submitted: 2, items: 25 } });
  const rows = T().child_test_blocks;
  expect(rows).toHaveLength(90);
  expect(rows.every((b) => b.checked_at)).toBe(true);
  // the coach answered each slot from its child's key: odd item NUMBERS wrong, even right, questions right.
  // items[] positions are 0-based; their i (the item number) is 1-based, as L37 writes it (bd-s1oo0.50.8):
  // discrimination reviewed item 3 (position 2), missing reviewed item 8 (position 7).
  const s0 = T().child_test_sessions[0].id;
  expect(rows.find((b) => b.session_id === s0 && b.block === 'ma.discrimination').coach_marks.items[2].verdict).toBe('wrong');
  expect(rows.find((b) => b.session_id === s0 && b.block === 'ma.missing').coach_marks.items[7].verdict).toBe('correct');
  expect(rows.find((b) => b.session_id === s0 && b.block === 'ur.story').coach_marks.comprehension[3].verdict).toBe('correct');
  const s2 = T().child_test_sessions[WEAK].id;
  expect(rows.find((b) => b.session_id === s2 && b.block === 'ma.add2').ai_marks.skipped_by_coach).toBe(true);
  expect(fs.readFileSync(path.join(dir, 'run', 'timeline.jsonl'), 'utf8')).not.toMatch(/Child 3A-/);
});
