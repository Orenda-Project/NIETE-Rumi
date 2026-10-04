/**
 * L36 (bd-s1oo0.50.2) — the coach conversation, battery v3 (design/COACH_JOURNEY_V3.md §3, CONTRACT §21.1/21.2/21.4).
 *
 *   per child: presence → 18 tasks (ur.* 5, en.* 5, ma.* 8), ONE plain step message and ONE voice note each
 *   → "✅ <name> done." + the next child (v2 doneNext) → after the last child, the visit end (L39's review)
 *   + skip (skip / چھوڑیں / next / اگلا), gap tasks skipped with an honest line, the 4-minute nudge and the
 *   resume prompt per task.
 *
 * Driven through the real handler. Mocked at the network boundary only (WhatsApp, Redis, R2, Supabase); the
 * other lanes' modules are contract fakes (ports), and the item bank is a §21.3-shaped fixture until L35 lands.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFakeRedis, createWhatsAppRecorder } = require('../L4/helpers/boundary');
const { createFakeSupabase } = require('../../observe2/helpers/fake-supabase');
const { createLaneFakes } = require('../L4/helpers/lane-fakes');
const { bankV3 } = require('./fixtures/bank-v3.fixture');

const mockRedis = createFakeRedis();
const mockWa = createWhatsAppRecorder();
mockWa.sendImageBufferWithButtons = jest.fn(async (to, buf, body, buttons) => {
  mockWa.__sent.push({ kind: 'imageButtons', to, bytes: buf.length, body, buttons });
  return true;
});
const mockR2 = { uploadBuffer: jest.fn(async (buf, key) => `https://r2.example/${key}`) };
let mockDb;
jest.mock('../../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../../bot/shared/storage/r2', () => mockR2);
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.from(t) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/services/menu.service', () => ({ sendMenu: jest.fn(async () => true) }));
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: '{}' } }], usage: { cost: 0 } }) } } })));

const { logError } = require('../../../bot/shared/utils/logger');
const ports = require('../../../bot/shared/services/child-test/conversation/ports');
const H = require('../../../bot/shared/handlers/child-test.handler');
const nudge = require('../../../bot/shared/services/child-test/conversation/nudge');
const SW = require('../../../bot/shared/services/child-test/conversation/switches');
const bank = require('../../../bot/shared/services/child-test/conversation/bank-v3');
const stepsV3 = require('../../../bot/shared/services/child-test/conversation/steps-v3');
const { TASKS_V3 } = require('../../../bot/shared/services/child-test/tasks');
const { UX_STRINGS } = require('../../../bot/shared/config/ux-strings');

const COACH_ID = '11111111-1111-4111-8111-111111111111';
const SCHOOL_ID = '22222222-2222-4222-8222-222222222222';
const COACH = { id: COACH_ID, role: 'coach', region: 'niete', preferred_language: 'en', phone_number: '923000000001' };
const COACH_UR = { ...COACH, preferred_language: 'ur' };
const PHONE = COACH.phone_number;
const SAVED = { ...process.env };

const NAMES = { d1: 'Ayesha Khan', d2: 'Bilal Ahmed', d3: 'Hamza Ali', d4: 'Zainab Noor', d5: 'Fatima Riaz', d6: 'Usman Ghani', d7: 'Sana Iqbal' };
function shapeList(list) {
  const dress = (c) => ({ ...c, displayName: NAMES[c.drawId], section: 'A', classId: 'class-3a', classLabel: '3-A', grade: 3,
    teacherName: 'Saima Bibi', teacherUserId: 'teacher-1' });
  const children = list.children.map(dress);
  return { ...list, children, alternates: list.alternates.map(dress),
    classes: [{ classId: 'class-3a', classLabel: '3-A', teacherName: 'Saima Bibi', teacherUserId: 'teacher-1', drawIds: children.map((c) => c.drawId) }] };
}

const GAP = 'ur.nonwords';                                   // the fixture's gap slot (no official Urdu list)
const RECORDED = TASKS_V3.filter((x) => x !== GAP);          // 17 notes per child

let lanes;
let review;
let tmpDir;

/** The real store creates a block row on first write (ensureBlock); the fake does too, here. */
function withEnsure(l) {
  const save = l.store.saveAiMarks;
  l.store.saveAiMarks = async (a) => {
    const k = `${a.sessionId}:${a.block}`;
    if (!l.blocks[k]) l.blocks[k] = { id: `blk-${k}`, session_id: a.sessionId, block: a.block, ai_marks: null, ai_status: 'pending', checked_at: null, updated_at: new Date().toISOString() };
    l.calls.push(['saveAiMarks', a]);
    return save(a);
  };
  return l;
}

beforeEach(() => {
  process.env.CHILD_TEST_ENABLED = 'true';
  process.env.DEFAULT_REGION = 'niete-sandbox';
  process.env.RAILWAY_ENVIRONMENT = 'sandbox';
  process.env.CHILD_TEST_BATTERY = 'v3';
  delete process.env.CHILD_TEST_OBSERVE_LINK;
  delete process.env.CHILD_TEST_MATHS_MODE;
  delete process.env.CHILD_TEST_CHECK_MODE;
  delete process.env.CHILD_TEST_STEP_NUDGE_MS;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'l36-'));
  process.env.CHILD_TEST_SETUP_PICTURE_DIR = tmpDir;
  fs.writeFileSync(path.join(tmpDir, 'setup-picture-en.png'), Buffer.from('png-en'));
  fs.writeFileSync(path.join(tmpDir, 'setup-picture-ur.png'), Buffer.from('png-ur'));
  mockRedis.__data.clear();
  mockWa.__sent.length = 0;
  Object.assign(mockWa.__ok, { text: true, buttons: true, list: true, image: true });
  jest.clearAllMocks();
  mockDb = createFakeSupabase({ users: [COACH], leader_schools: [{ leader_user_id: COACH_ID, school_id: SCHOOL_ID, school_name: 'SIM — School', emis: '111' }] });
  lanes = withEnsure(createLaneFakes({ shapeList }));
  review = { visitSummary: jest.fn(async () => 'summary'), sendReview: jest.fn(async () => ({ ok: true, items: 2 })) };
  ports.__setForTest({ ...lanes, review });
  bank.__setForTest(bankV3());
});
afterEach(async () => { await H.__drain(); fs.rmSync(tmpDir, { recursive: true, force: true }); });
afterAll(() => { process.env = SAVED; ports.__setForTest(null); bank.__setForTest(null); });

const sent = () => mockWa.__sent;
const last = (kind) => [...sent()].reverse().find((m) => !kind || m.kind === kind);
const allText = (msgs = sent()) => msgs.map((m) => [m.text, typeof m.body === 'string' ? m.body : m.body && m.body.text,
  ...(m.buttons || []).map((b) => b.title)].filter(Boolean).join('\n')).join('\n');
const cp = (s) => [...s].length;
let noteNo = 0;
const voice = (id) => ({ id: `wamid.${id}`, timestamp: String(Math.floor(Date.now() / 1000) + 5), audio: { id, mime_type: 'audio/ogg' } });

async function startVisit(user = COACH) {
  expect(await H.handleText(PHONE, '/egra', user)).toBe(true);
  await H.handleButton(user, PHONE, 'ctst_start');
  await H.handleButton(user, PHONE, 'ctst_go');
}
async function present(drawId, user = COACH) { expect(await H.handleButton(user, PHONE, `ctst_pres:${drawId}:p`)).toBe(true); }
async function note(user = COACH) { noteNo += 1; expect(await H.handleVoice(voice(`n${noteNo}`), PHONE, user)).toBe(true); }
async function testChild(drawId, user = COACH) {
  await present(drawId, user);
  for (let i = 0; i < RECORDED.length; i += 1) await note(user);
  await H.__drain();
}
const stepHeaders = (msgs = sent()) => msgs.filter((m) => m.kind === 'text').map((m) => (m.text.match(/\*[^*\n]+\* · [^\n]+/) || [])[0]).filter(Boolean);

// ---------------------------------------------------------------------------------------- switch

describe('1. the switch (CONTRACT §21.1)', () => {
  test('CHILD_TEST_BATTERY=v3 → v3; it implies oral maths and the end review; the default stays v2', () => {
    expect(SW.battery()).toBe('v3');
    expect(SW.v3()).toBe(true);
    process.env.CHILD_TEST_MATHS_MODE = 'strip';
    process.env.CHILD_TEST_CHECK_MODE = 'per_child';
    expect(SW.mathsMode()).toBe('oral');
    expect(SW.checkMode()).toBe('end_review');
    expect(SW.journeyV2()).toBe(true);
    expect(SW.endReview()).toBe(true);
    delete process.env.CHILD_TEST_BATTERY;
    expect(SW.battery()).toBe('v2');
    expect(SW.v3()).toBe(false);
    expect(SW.mathsMode()).toBe('strip');
  });
});

// ---------------------------------------------------------------------------------------- the 18 tasks

describe('2. eighteen tasks, one step and one note each', () => {
  test('the first step is Urdu 1 of 5 · Listening: plain text, no buttons, the story to read twice and its questions', async () => {
    await startVisit();
    const before = sent().length;
    await present('d1');
    const after = sent().slice(before);
    expect(after).toHaveLength(1);
    const m = after[0];
    expect(m.kind).toBe('text');
    expect(m.text).toMatch(/^\*Ayesha Khan\* · Urdu 1 of 5 · Listening/);
    expect(m.text).toContain('ایک دن ثنا بازار گئی۔');
    expect(m.text).toMatch(/twice/i);
    expect(m.text).toContain('ثنا کہاں گئی؟');
    expect(m.text).toContain('اس نے کیا خریدا؟');
    expect(m.text).not.toMatch(/1:05/);
  });

  test('a whole child: the steps run in task order; each note claims its task row; the gap is skipped honestly; then doneNext', async () => {
    await startVisit();
    const from = sent().length;
    await testChild('d1');
    const headers = stepHeaders(sent().slice(from));
    expect(headers.map((h) => h.replace(/^\*Ayesha Khan\* · /, ''))).toEqual([
      'Urdu 1 of 5 · Listening', 'Urdu 2 of 5 · Letters', 'Urdu 4 of 5 · Familiar words', 'Urdu 5 of 5 · Story',
      'English 1 of 5 · Listening', 'English 2 of 5 · Letters', 'English 3 of 5 · Made-up words', 'English 4 of 5 · Familiar words', 'English 5 of 5 · Story',
      'Maths 1 of 8 · Number identification', 'Maths 2 of 8 · Which is bigger', 'Maths 3 of 8 · Missing number', 'Maths 4 of 8 · Addition',
      'Maths 5 of 8 · Subtraction', 'Maths 6 of 8 · Harder addition', 'Maths 7 of 8 · Harder subtraction', 'Maths 8 of 8 · Word problems',
    ]);
    // each note → its own task row, in order; the gap gets a row with no audio and no model call
    const attached = lanes.calls.filter((c) => c[0] === 'attachBlockMedia').map((c) => c[1].block);
    expect(attached).toEqual(RECORDED);
    expect(lanes.calls.filter((c) => c[0] === 'scoreBlock').map((c) => c[1].block).sort()).toEqual([...RECORDED].sort());
    const gapSave = lanes.calls.find((c) => c[0] === 'saveAiMarks' && c[1].block === GAP);
    expect(gapSave[1].aiMarks).toMatchObject({ version: 'ai-marks-v3', task: GAP, gap: true, skipped_by_coach: true });
    expect(allText(sent().slice(from))).toMatch(/Made-up words: not part of this test yet/);
    // the gap line rides on the next step, so the step stays the last bubble
    const gapMsg = sent().slice(from).find((m) => /not part of this test yet/.test(m.text || ''));
    expect(gapMsg.text).toMatch(/\*Ayesha Khan\* · Urdu 4 of 5 · Familiar words/);
    // after task 18: the v2 doneNext + the next child's presence prompt
    const m = last();
    expect(m.kind).toBe('buttons');
    expect(m.body).toMatch(/^✅ Ayesha Khan done\. Thank the child\.\n\n\*Child 2 of 5 · Bilal Ahmed/);
    expect(lanes.calls.find((c) => c[0] === 'setSessionStatus' && c[2] === 'completed')).toBeTruthy();
  });

  test('with L35\'s real bank (item-bank.js tasksFor/getTaskSpec): a whole child, 18 steps in order, then doneNext', async () => {
    bank.__setForTest(null);
    const ib = require('../../../bot/shared/services/child-test/item-bank');
    await startVisit();
    const from = sent().length;
    await present('d1');
    const tasks = bank.tasksFor({ grade: 3 });
    expect(tasks).toEqual(TASKS_V3);
    const recorded = tasks.filter((x) => !ib.getTaskSpec({ grade: 3, set: 'A', task: x }).gap);
    for (let i = 0; i < recorded.length; i += 1) await note();
    await H.__drain();
    expect(lanes.calls.filter((c) => c[0] === 'attachBlockMedia').map((c) => c[1].block)).toEqual(recorded);
    expect(stepHeaders(sent().slice(from))).toHaveLength(recorded.length);
    expect(last().body).toMatch(/^✅ Ayesha Khan done/);
  });

  test('the ack names the task just received and rides on the next step', async () => {
    await startVisit();
    await present('d1');
    await note();
    expect(last().text).toMatch(/^🎧 Got it · Listening\n\*Ayesha Khan\* · Urdu 2 of 5 · Letters/);
  });

  test('five children: the visit ends, the review is called once, no per-child check', async () => {
    await startVisit();
    for (const d of ['d1', 'd2', 'd3', 'd4', 'd5']) await testChild(d);
    await H.__drain();
    expect(allText()).toMatch(/🎉 All 5 children done/);
    expect(review.sendReview).toHaveBeenCalledTimes(1);
    expect(lanes.calls.filter((c) => c[0] === 'sendCheck')).toHaveLength(0);
  });

  // L39's v3 review sends the results itself (summarySent) and splits long results (visitSummaryMessages).
  test('the visit end hands to L39: results it already sent are never sent again', async () => {
    review.sendReview.mockImplementation(async () => ({ ok: true, items: 0, pages: 0, summarySent: true }));
    await startVisit();
    for (const d of ['d1', 'd2', 'd3', 'd4', 'd5']) await testChild(d);
    await H.__drain();
    expect(review.visitSummary).not.toHaveBeenCalled();
    expect(allText()).not.toMatch(/^summary$/m);
  });

  test('the review could not be sent: the results go as L39\'s split messages, each one sent', async () => {
    review.sendReview.mockImplementation(async () => ({ ok: false, reason: 'send_failed' }));
    review.visitSummaryMessages = jest.fn(async () => ['results part 1', 'results part 2']);
    await startVisit();
    for (const d of ['d1', 'd2', 'd3', 'd4', 'd5']) await testChild(d);
    await H.__drain();
    expect(review.visitSummaryMessages).toHaveBeenCalledWith('en', expect.stringMatching(/^day:/), expect.objectContaining({ coachUserId: COACH_ID }));
    const txt = sent().filter((m) => m.kind === 'text').map((m) => m.text);
    expect(txt).toEqual(expect.arrayContaining(['results part 1', 'results part 2']));
    expect(review.visitSummary).not.toHaveBeenCalled();
  });

  test('an Urdu coach: Urdu header with Urdu digits, Urdu step copy', async () => {
    await startVisit(COACH_UR);
    await present('d1', COACH_UR);
    await note(COACH_UR);
    const s = last().text;
    expect(s).toMatch(/اردو ۲ از ۵ · حروف/);
    expect(s).not.toMatch(/Tap|slide|Practice/);
  });
});

// ---------------------------------------------------------------------------------------- step content

const child = { name: 'Ayesha Khan' };
const step = (lang, task, grade = 3) => stepsV3.taskStep(lang, task, { ...child, grade, set: 'A' });

describe('3. the step message per task (steps-v3.taskStep)', () => {
  test('timed (Urdu letters, EN coach): booklet + page, practice first (not recorded), 🎤 lock, begin, 3 s go on, stop at 1:00, send at 1:05, the stop rule', () => {
    const s = step('en', 'ur.letters');
    expect(s).toMatch(/^\*Ayesha Khan\* · Urdu 2 of 5 · Letters\n/);
    expect(s).toMatch(/Urdu booklet, page 1: letters/i);
    expect(s).toMatch(/Practice row first/i);
    expect(s).toMatch(/not recorded/i);
    expect(s).toContain('«ان حروف کے نام بتائیں۔»');
    expect(s).toContain('ا ب پ');
    expect(s).toMatch(/Tap 🎤 and slide up to lock/);
    expect(s).toContain('«شروع کریں»');
    expect(s).toMatch(/3 seconds/);
    expect(s).toContain('«آگے پڑھیں»');
    expect(s).toMatch(/\*1:00\*/);
    expect(s).toContain('«بس، شکریہ»');
    expect(s).toMatch(/\*1:05\*/);
    expect(s).toMatch(/Nothing right in the first row\? Say/);
    expect(s.indexOf('Practice')).toBeLessThan(s.indexOf('🎤'));
    expect(cp(s)).toBeLessThanOrEqual(900);
  });

  test('timed English task: the words to the child are English (bank en), «» inside an LTR isolate in an Urdu message', () => {
    const s = step('ur', 'en.words');
    expect(s).toMatch(/انگریزی ۴ از ۵/);
    expect(s).toContain('⁦«Ready? Begin.»⁩');
    expect(s).toMatch(/پہلی لائن/);
  });

  test('untimed (which is bigger): record the whole task, the script, the per-item question, "Stop after 4 wrong in a row"; no clock', () => {
    const s = step('en', 'ma.discrimination');
    expect(s).toMatch(/^\*Ayesha Khan\* · Maths 2 of 8 · Which is bigger/);
    expect(s).toMatch(/Maths booklet Grade 3, page 2: which is bigger/i);
    expect(s).toContain('«ان نمبروں کو دیکھیں۔ بتائیں کون سا نمبر بڑا ہے۔»');
    expect(s).toContain('«کون سا نمبر بڑا ہے؟»');
    expect(s).toMatch(/Stop after 4 wrong in a row/);
    expect(s).not.toMatch(/1:0[05]/);
    expect(cp(s)).toBeLessThanOrEqual(900);
  });

  test('word problems: no card, the problems to read aloud in Urdu, one per line', () => {
    const s = step('en', 'ma.word_problems');
    expect(s).toMatch(/Maths 8 of 8 · Word problems/);
    expect(s).toMatch(/No booklet page/i);
    expect(s).toContain('بس میں ۳ بچے ہیں۔');
    expect(s).toContain('آپ کے پاس ۶ سیب ہیں۔');
    expect(s).toMatch(/Stop after 4 wrong in a row/);
  });

  test('listening: read the story twice (bank read_times), then the questions', () => {
    const s = step('en', 'en.listening');
    expect(s).toMatch(/English 1 of 5 · Listening/);
    expect(s).toMatch(/Read the story twice/);
    expect(s).toContain('One day Juma went to the market.');
    expect(s).toContain('«Where did Juma go?»');
  });

  test('story: §20 reach anchors from reach.js, questions after the stop line', () => {
    const s = step('en', 'en.story');
    expect(s).toMatch(/English 5 of 5 · Story/);
    expect(s).toMatch(/Only if the child read past:/);
    expect(s).toContain('«in the park. The ball goes into the»'.replace(/«.*»/, s.match(/«[^»]*»/g).find((x) => /park|water|into/.test(x)) || 'NONE'));
    expect(s.indexOf('«What colour is the ball?»')).toBeGreaterThan(s.indexOf('«Stop. Thank you.»'));
    expect(s).toMatch(/Nothing right in the first line\?/);
  });

  test('every step, both coach languages, both grades: ≤ 900 code points (target), plain text, no roll or form', () => {
    for (const lang of ['en', 'ur']) {
      for (const grade of [3, 5]) {
        for (const task of TASKS_V3) {
          if (task === GAP) continue;
          const s = stepsV3.taskStep(lang, task, { name: 'Muhammad Abdullah Khan Niazi', grade, set: 'A' });
          expect([task, lang, grade, cp(s) <= 900]).toEqual([task, lang, grade, true]);
          expect(s).not.toMatch(/roll|رول|\bForm\b|فارم/i);
        }
      }
    }
  });

  test('a task whose bank gives no closing line: the stop rule and the 1:00 step never show a placeholder', () => {
    const b = bankV3();
    delete b.sets.A.maths[3].missing.script.stop;
    delete b.sets.A.reading.ur.letters.script.stop;
    bank.__setForTest(b);
    const m = step('en', 'ma.missing');
    expect(m).toMatch(/_Stop after 4 wrong in a row, then send\._/);
    expect(m).not.toMatch(/«…»/);
    const l = step('en', 'ur.letters');
    expect(l).toMatch(/At \*1:00\* on the mic, stop the child\./);
    expect(l).not.toMatch(/«…»/);
  });

  // L35's bank (bot/shared/data/child-test/item-bank.v3.json), once it is on the branch: every step fits WhatsApp's
  // 4096 text cap, names its task, and quotes the bank's begin line verbatim.
  const ib = require('../../../bot/shared/services/child-test/item-bank');
  (typeof ib.getTaskSpec === 'function' ? test : test.skip)('with L35\'s real bank: every step fits the 4096 cap and quotes the begin line', () => {
    bank.__setForTest(null);
    for (const lang of ['en', 'ur']) {
      for (const grade of [3, 5]) {
        for (const task of TASKS_V3) {
          const spec = ib.getTaskSpec({ grade, set: 'A', task });
          if (spec.gap) continue;
          const s = stepsV3.taskStep(lang, task, { name: 'Muhammad Abdullah Khan Niazi', grade, set: 'A' });
          expect([task, cp(s) <= 4096]).toEqual([task, true]);
          expect(s).not.toMatch(/«…»/);
          const begin = spec.script && spec.script.begin && spec.script.begin[stepsV3.childLang(task)];
          if (begin) expect([task, s.includes(begin)]).toEqual([task, true]);
        }
      }
    }
  });

  test('a missing spec is never silent: the step still names the task and the miss is logged at error', () => {
    bank.__setForTest({ version: 'x', sets: { A: { reading: { ur: {}, en: {} }, maths: {} } } });
    const s = step('en', 'ur.letters');
    expect(s).toMatch(/Urdu 2 of 5 · Letters/);
    expect(logError).toHaveBeenCalledWith('child_test.task_spec_missing', expect.objectContaining({ task: 'ur.letters' }));
  });
});

// ---------------------------------------------------------------------------------------- skip

describe('4. skip', () => {
  async function toTask(task) {
    await startVisit();
    await present('d1');
    for (const x of RECORDED) { if (x === task) break; await note(); }
  }
  test.each(['skip', 'Skip', 'چھوڑیں', 'next', 'اگلا'])('"%s" stores the task as skipped_by_coach (no audio), confirms in one line, sends the next step', async (word) => {
    await toTask('ma.add2');
    expect(last().text).toMatch(/Maths 6 of 8 · Harder addition/);
    expect(await H.handleText(PHONE, word, COACH)).toBe(true);
    const saved = lanes.calls.find((c) => c[0] === 'saveAiMarks' && c[1].block === 'ma.add2');
    expect(saved[1].aiMarks).toMatchObject({ version: 'ai-marks-v3', task: 'ma.add2', skipped_by_coach: true });
    expect(lanes.calls.filter((c) => c[0] === 'attachBlockMedia' && c[1].block === 'ma.add2')).toHaveLength(0);
    expect(last().text).toMatch(/^⏭️ Skipped: Harder addition\.\n\*Ayesha Khan\* · Maths 7 of 8 · Harder subtraction/);
    await H.__drain();
    expect(lanes.calls.filter((c) => c[0] === 'scoreBlock' && c[1].block === 'ma.add2')).toHaveLength(0);
  });

  test('skipping the last task completes the child', async () => {
    await toTask('ma.word_problems');
    await H.handleText(PHONE, 'skip', COACH);
    await H.__drain();
    expect(allText()).toMatch(/⏭️ Skipped: Word problems\./);
    expect(last().body).toMatch(/✅ Ayesha Khan done/);
  });

  test('"skip" with no step open is not ours (falls through to the bot)', async () => {
    await startVisit();
    expect(await H.handleText(PHONE, 'skip', COACH)).toBe(false);
  });

  test('a skipped task is complete for the store: the visit end still waits for nothing', async () => {
    await toTask('ma.add2');
    await H.handleText(PHONE, 'skip', COACH);
    await note(); await note();
    await H.__drain();
    const R = require('../../../bot/shared/services/child-test/conversation/recovery');
    const sid = Object.keys(lanes.sessions)[0];
    expect(await R.checkReady(sid)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------- nudge, resume

describe('5. nudge and resume, per task', () => {
  const at = (ms) => new Date(Date.now() + ms);
  test('the 4-minute nudge names the task; a note for that task stops it; the next task has its own clock', async () => {
    await startVisit();
    await present('d1');
    expect((await nudge.sweepOnce({ now: at(200 * 1000) })).sent).toBe(0);
    expect((await nudge.sweepOnce({ now: at(241 * 1000) })).sent).toBe(1);
    expect(last().text).toMatch(/^\*Ayesha Khan\* · Urdu 1 of 5 · Listening\nDid the recording stop\?/);
    await note();
    expect((await nudge.sweepOnce({ now: at(245 * 1000) })).sent).toBe(1);
    expect(last().text).toMatch(/Urdu 2 of 5 · Letters/);
  });

  test('/egra mid-child: the resume prompt names the task; Continue re-sends that task\'s step', async () => {
    await startVisit();
    await present('d1');
    await note();
    await H.handleText(PHONE, '/egra', COACH);
    const m = last();
    expect(m.kind).toBe('buttons');
    expect(m.body).toMatch(/Ayesha Khan is on Urdu 2 of 5 \(Letters\)/);
    expect(m.buttons.map((b) => b.id)).toEqual(['ctst_resume', 'ctst_stop']);
    await H.handleButton(COACH, PHONE, 'ctst_resume');
    expect(last().text).toMatch(/^\*Ayesha Khan\* · Urdu 2 of 5 · Letters/);
  });

  test('a child stopped mid-battery resumes at the first task without a note', async () => {
    await startVisit();
    await present('d1');
    await note(); await note();
    await H.handleText(PHONE, '/cancel', COACH);
    await H.__drain();
    // the coach comes back to the same child (v2 brings a stopped child after the rest): their presence prompt
    const S = require('../../../bot/shared/services/child-test/conversation/state');
    const st = await S.get(COACH_ID);
    await S.set(COACH_ID, { ...st, step: 'presence', current: { drawId: 'd1', displayName: NAMES.d1, childNo: 1, total: 5 } });
    await present('d1');
    expect(last().text).toMatch(/Urdu 4 of 5 · Familiar words/);
  });
});

// ---------------------------------------------------------------------------------------- copy

describe('6. copy', () => {
  const L36 = Object.keys(UX_STRINGS).filter((k) => k.startsWith('childTestL36'));
  test('the L36 block exists in en and ur; Urdu has no Latin digits outside isolates and no gendered verbs', () => {
    expect(L36.length).toBeGreaterThan(15);
    for (const k of L36) {
      expect(typeof UX_STRINGS[k].en).toBe('string');
      expect(UX_STRINGS[k].ur).toMatch(/[؀-ۿ]/);
      const ur = UX_STRINGS[k].ur.replace(/\{\w+\}/g, '').replace(/⁦[^⁩]*⁩/g, '');
      expect([k, /[0-9٠-٩]/.test(ur)]).toEqual([k, false]);
      expect([k, /(رہی|رہا|رہے) (ہیں|ہو|ہے)|سکتی|سکتا ہے|چاہتا|چاہتی|گیا ہے|گئی ہے|ریاضی/.test(UX_STRINGS[k].ur)]).toEqual([k, false]);
    }
  });
});

// ---------------------------------------------------------------------------------------- v2 unchanged

describe('7. v2 stays the default', () => {
  test('without the switch, the first step is v2 1/3 Urdu story', async () => {
    delete process.env.CHILD_TEST_BATTERY;
    await startVisit();
    await present('d1');
    expect(last().text).toMatch(/^\*1\/3 Urdu story · Ayesha Khan\*/);
  });
});
