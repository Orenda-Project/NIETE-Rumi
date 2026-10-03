/**
 * L21 / bd-s1oo0.27 — the check message tells the truth (ISSUES P3, CONTRACT §18).
 *
 * Run sandbox5-syn-2032, child 1: the Flow message said "Urdu 57 words, English 58 words, maths 28 quick
 * sums … About a minute", the form's Urdu story count arrived EMPTY (confidence 0.69, under its bar), and
 * the check took 107–144 s. So the message now:
 *   - states only the numbers the form will show filled in (strict: cleared the bar; assist: filled but
 *     "please check"), and names plainly what the coach must fill in;
 *   - names the child, full name first, roll as a hint (header ≤ 60 code points);
 *   - promises about two minutes, not one.
 * The check Flow's child label (endpoint INIT) and the completion line are name-first too.
 *
 * Real: sendCheck, the check store, planBlock, the endpoint, the completion. Mocked: the database client
 * (in memory), WhatsApp (network), the log sinks. Bars pinned to bars.DEFAULT_BARS so the test is about
 * the message, not the calibration.
 */
const { createFakeSupabase } = require('../../observe2/helpers/fake-supabase');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendMessage: jest.fn(() => Promise.resolve(true)),
}));

const WhatsAppService = require('../../../bot/shared/services/whatsapp.service');
const { sendCheck, handleCheckCompletion } = require('../../../bot/shared/services/child-test/check-flow');
const Check = require('../../../bot/shared/routes/child-test-check-endpoint');
const Bars = require('../../../bot/shared/services/child-test/check-flow/bars');
const F = require('../L6/fixtures/ai-marks');

Bars.__pinBarsForTest(Bars.DEFAULT_BARS);
afterAll(() => Bars.__pinBarsForTest(null));

const NAME = 'Test Child Alpha';

function seed({ lang = 'en', blocks, roll = '8', name = NAME, nameUrdu = null } = {}) {
  const b = blocks || { urdu: F.urduConfident(), english: F.englishConfident(), maths: F.mathsConfident() };
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', preferred_language: lang }],
    child_test_sessions: [{ id: 'sess-1', coach_user_id: 'coach-1', grade: 3, form: 'A', student_id: 'stu-1', draw_id: 'draw-1', class_id: 'cls-3a', status: 'in_progress', timings: {} }],
    classes: [{ id: 'cls-3a', grade_code: 'grade_3', section: 'A', shift_code: 'morning' }],
    child_test_draws: [{ id: 'draw-1', student_id: 'stu-1', roll_number: roll }],
    students: [{ id: 'stu-1', student_name: name, student_name_urdu: nameUrdu, roll_number: roll, is_active: true }],
    child_test_blocks: Object.entries(b).map(([block, ai]) => ({
      session_id: 'sess-1', block, ai_marks: ai, ai_status: ai ? 'scored' : 'failed', coach_marks: null, checked_at: null,
    })),
  });
}

/** Child 1 of sandbox5-syn-2032, in fixture form: Urdu story 57 at 0.69 (under the 0.7 bar), English 58, maths 28. */
function syn2032Child1() {
  const urdu = F.urduConfident();
  urdu.story = { ...urdu.story, words_correct: 57, words_attempted: 60, confidence: 0.69 };
  const english = F.englishConfident();
  english.story = { ...english.story, words_correct: 58, words_attempted: 61 };
  const maths = F.mathsConfident();
  maths.maths.quick_sums = { ...maths.maths.quick_sums, correct: 28, attempted: 30 };
  return { urdu, english, maths };
}

const flowMsg = () => WhatsAppService.sendFlow.mock.calls[0][1];
const cps = (s) => [...s].length;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CHILD_TEST_ENABLED = 'true';
  process.env.CHILD_TEST_CHECK_FLOW_ID = 'flow-123';
  delete process.env.CHILD_TEST_PREFILL_MODE;
});

describe('the numbers in the message are the numbers the form shows filled in', () => {
  test('strict: an Urdu count under its bar is NOT stated; it is named as one for the coach to fill', async () => {
    seed({ blocks: syn2032Child1() });
    expect(await sendCheck('sess-1')).toEqual({ ok: true });
    const { body } = flowMsg();
    expect(body).not.toMatch(/57/);
    expect(body).toMatch(/English 58 words/);
    expect(body).toMatch(/maths 28 quick sums/);
    // the coach is told plainly what arrives empty, by block
    expect(body).toMatch(/You fill in[^\n]*Urdu: story count/);
  });

  test('the form agrees: the endpoint opens the Urdu story count empty for the same child', async () => {
    seed({ blocks: syn2032Child1() });
    const out = await Check.handleChildTestCheckInit('coach-1:child-test-check:sess-1');
    expect(out.data.wc_i).toBe('');
  });

  test('items that arrive empty are counted per block (questions, first sounds, made-up words, numbers…)', async () => {
    seed();
    await sendCheck('sess-1');
    const { body } = flowMsg();
    // urduConfident under DEFAULT_BARS: Q3 0.4, first sounds 1/2/5 at 0.4 and 4 at 0 → 4, made-up word 4 at 0.5
    expect(body).toMatch(/Urdu: 1 question, 4 first sounds, 1 made-up word/);
    // englishConfident: made-up word 8 at 0.2
    expect(body).toMatch(/English: 1 made-up word/);
    // mathsConfident: number 6 at 0.5, written 3 unreadable at 0, word problem 0.6 < 0.7
    expect(body).toMatch(/maths: 1 number, 1 written sum, word problem/);
  });

  test('every headline clears its bar: all three numbers are stated, none of them as "fill in"', async () => {
    seed();
    await sendCheck('sess-1');
    const { body } = flowMsg();
    expect(body).toMatch(/Filled in: Urdu 41 words, English 17 words, maths 12 quick sums/);
    expect(body).not.toMatch(/story count/);
  });

  test('a block with no marks at all is named whole for the coach, and no number is invented for it', async () => {
    seed({ blocks: { urdu: F.urduConfident(), english: F.englishConfident(), maths: null } });
    await sendCheck('sess-1');
    const { body } = flowMsg();
    expect(body).not.toMatch(/quick sums/);
    expect(body).toMatch(/maths: all of it/);
  });

  test('a non-reader: the letters count is stated only when it clears its bar', async () => {
    const fb = F.urduFallback();
    seed({ blocks: { urdu: fb, english: F.englishConfident(), maths: F.mathsConfident() } });
    await sendCheck('sess-1');
    expect(flowMsg().body).toMatch(/Urdu 7\/10 letters/);
    jest.clearAllMocks();
    const low = F.urduFallback();
    low.fallback.confidence = 0.4;
    seed({ blocks: { urdu: low, english: F.englishConfident(), maths: F.mathsConfident() } });
    await sendCheck('sess-1');
    expect(flowMsg().body).not.toMatch(/7\/10/);
    expect(flowMsg().body).toMatch(/Urdu: letters and words/);
  });

  test('assist: the unsure count IS filled in, so it is stated, marked "please check"', async () => {
    process.env.CHILD_TEST_PREFILL_MODE = 'assist';
    seed({ blocks: syn2032Child1() });
    await sendCheck('sess-1');
    const { body } = flowMsg();
    expect(body).toMatch(/please check: Urdu 57 words/);
    expect(body).not.toMatch(/Urdu: story count/);
    const out = await Check.handleChildTestCheckInit('coach-1:child-test-check:sess-1');
    expect(out.data.wc_i).toBe('57');
  });

  test('Urdu: the same truth — the unsure count is absent and named for the coach; numbers in Urdu digits', async () => {
    seed({ lang: 'ur', blocks: syn2032Child1() });
    await sendCheck('sess-1');
    const { body } = flowMsg();
    expect(body).not.toMatch(/57|۵۷/);
    expect(body).toMatch(/انگریزی ۵۸ الفاظ/);
    expect(body).toMatch(/حساب ۲۸ فوری سوال/);
    expect(body).toMatch(/آپ خود بھریں[^\n]*اردو: کہانی کی گنتی/);
  });
});

describe('the time it promises', () => {
  test('about two minutes (measured 107–144 s per child), never "about a minute"', async () => {
    seed();
    await sendCheck('sess-1');
    expect(flowMsg().body).toMatch(/About 2 minutes/);
    expect(flowMsg().body).not.toMatch(/About a minute/);
    jest.clearAllMocks();
    seed({ lang: 'ur' });
    await sendCheck('sess-1');
    expect(flowMsg().body).toMatch(/تقریباً دو منٹ/);
    expect(flowMsg().body).not.toMatch(/ایک منٹ/);
  });
});

describe('the child is named, full name first, then the class — never a roll (CONTRACT §18–§19, L25)', () => {
  test('header and body lead with the full name; the class follows', async () => {
    seed();
    await sendCheck('sess-1');
    expect(flowMsg().header).toBe(`Check: ${NAME} · 3-A`);
    expect(flowMsg().body.startsWith(NAME)).toBe(true);
  });

  test('Urdu: the Urdu-script name when the roster has one, the class in Urdu digits, no roll', async () => {
    seed({ lang: 'ur', nameUrdu: 'آزمائشی بچہ' });
    await sendCheck('sess-1');
    expect(flowMsg().header.replace(/[\u200e\u200f\u2066-\u2069]/g, '')).toBe('جانچ: آزمائشی بچہ · ۳-A');
  });

  test('no roll: the name alone — never "null", never a dash for a roll', async () => {
    seed({ roll: null });
    await sendCheck('sess-1');
    expect(flowMsg().header).toBe(`Check: ${NAME} · 3-A`);
    expect(flowMsg().body).not.toMatch(/null|undefined|roll/);
  });

  test('a long name stays inside the 60-code-point header, and the body carries it whole', async () => {
    const long = 'Muhammad Abdul Rehman Siddiqui Khan Yousafzai Qureshi Awan';
    seed({ name: long });
    await sendCheck('sess-1');
    expect(cps(flowMsg().header)).toBeLessThanOrEqual(60);
    expect(flowMsg().header.startsWith('Check: Muhammad Abdul')).toBe(true);
    expect(flowMsg().body).toContain(long);
  });

  test('the check Flow heading (data_exchange INIT) is name-first: "<name> · 3-A · Grade 3", no roll', async () => {
    seed();
    const out = await Check.handleChildTestCheckInit('coach-1:child-test-check:sess-1');
    expect(out.data.child_line).toBe(`${NAME} · 3-A · Grade 3`);
  });

  test('Urdu Flow heading: name first, no "رول نمبر" lead', async () => {
    seed({ lang: 'ur' });
    const out = await Check.handleChildTestCheckInit('coach-1:child-test-check:sess-1');
    // the catalog isolates a Latin name inside an Urdu line (RLM + FSI … PDI): compare without them
    const shown = out.data.child_line.replace(/[\u200e\u200f\u2066-\u2069]/g, '');
    expect(shown).toBe(`${NAME} · ۳-A · جماعت ۳`);
    expect(shown).not.toMatch(/^رول نمبر/);
  });

  test('the completion line names the child', async () => {
    seed();
    for (const b of mockFake.__tables.child_test_blocks) b.checked_at = '2026-10-03T10:00:00.000Z';
    await handleCheckCompletion({ flow_token: 'coach-1:child-test-check:sess-1' }, '923000000001', { id: 'coach-1', preferred_language: 'en' });
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toBe(`✓ Marks for ${NAME} · 3-A saved.`);
  });
});
