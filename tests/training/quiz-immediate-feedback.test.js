/**
 * bd-2523 / bd-2525 — a training quiz must tell the teacher, per question,
 * whether the answer was right or wrong.
 *
 * Reported by a NIETE teacher reviewer (Primary TT, P1): "it doesn't show
 * whether the option we selected is correct or incorrect. When I complete 4/4
 * questions then at the end it shows 2/4 options are incorrect making it
 * difficult to track progress."
 *
 * The maddening part was that the answer was ALREADY graded at the moment of
 * the tap — the handler computes `isCorrect`, writes it, advances the cursor,
 * then sends the next question. The verdict existed and was thrown away. Two
 * signals close that gap: a ✅/❌ reaction on the teacher's own message, and a
 * one-line text echo.
 *
 * These were SOURCE-LEVEL greps (`expect(tail).toMatch(/sendMessage\(/)`) until
 * bd-43496. They broke the moment the two send calls moved into a shared
 * `sendAnswerVerdict` helper — behaviour unchanged and in fact extended to a
 * second surface, but every assertion failed because the literal call was no
 * longer inside the function body being scanned. A test that a
 * behaviour-preserving refactor cannot survive does not protect the behaviour;
 * it protects one spelling of it. Rewritten to drive the real functions.
 *
 * Now covers BOTH answer surfaces, which is the point: the interactive list
 * (handleQuizButton) and the Flow (handleQuizFlowSubmission, bd-43496). The
 * Flow path shipped with no verdict at all — a teacher answering an oversized
 * question got silence.
 *
 * Scope note: WHY an option was wrong is separate, larger work (bd-2524 — the
 * source bank has per-option explanations for ~43% of questions that were never
 * migrated). This pins the tick/cross only.
 *
 * What this canNOT tell you: how the two messages look arriving back-to-back on
 * a real handset. That wants a human on the PR.
 */
let supabaseFrom, tableStates, whatsapp, callLog;

function makeChain(t) {
  const st = tableStates[t] || {};
  const rec = { filters: {} };
  const c = {};
  const rows = () => {
    let r = st.rows || [];
    for (const [col, v] of Object.entries(rec.filters)) {
      if (v && typeof v === 'object' && Array.isArray(v.in)) r = r.filter(x => v.in.includes(x[col]));
      else if (!col.includes('.')) r = r.filter(x => x[col] === v || String(x[col]) === String(v));
    }
    return r;
  };
  c.select = jest.fn(() => c);
  ['eq','neq','gt','gte','lt','lte','like','ilike','is','not'].forEach(m => { c[m] = jest.fn((col, v) => { rec.filters[col] = v; return c; }); });
  c.in = jest.fn((col, v) => { rec.filters[col] = { in: v }; return c; });
  c.order = jest.fn(() => c); c.limit = jest.fn(() => c); c.range = jest.fn(() => c);
  c.insert = jest.fn((v) => { st.rows = [...(st.rows || []), ...(Array.isArray(v) ? v : [v])]; callLog.push('recordAnswer'); return c; });
  c.upsert = jest.fn((v) => { st.rows = [...(st.rows || []), ...(Array.isArray(v) ? v : [v])]; callLog.push('recordAnswer'); return c; });
  c.update = jest.fn((patch) => { for (const r of rows()) Object.assign(r, patch); return c; });
  c.maybeSingle = jest.fn(async () => ({ data: rows()[0] || null, error: null }));
  c.single = jest.fn(async () => ({ data: rows()[0] || null, error: null }));
  c.then = (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej);
  return c;
}

const UID = 'u1', VENDOR = 'v1', LEVEL = 4, QUIZ = 4;
const ATTEMPT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PHONE = '923449320536', WAMID = 'wamid.THEIR_TAP';

/** One in-progress exam attempt on a single-answer question with key "2". */
function seed({ correct = '2', optionLen = 20 } = {}) {
  tableStates.users = { rows: [{ id: UID, first_name: 'F', phone_number: PHONE }] };
  tableStates.teacher_training_assignments = { rows: [{ user_id: UID, program_id: 'p1', is_active: true }] };
  tableStates.training_program_scopes = { rows: [{ program_id: 'p1', vendor_id: VENDOR, level_ids: null }] };
  tableStates.training_vendors = { rows: [{ id: VENDOR, key: 'TALEEMABAD', name: 'NIETE', unlock_logic: 'chain', level_unlock_logic: 'chain', has_grand_quiz: true, passing_pct: 80, module_passing_pct: 100, exam_question_cap: null, shuffle_options: false }] };
  tableStates.training_levels = { rows: [{ id: LEVEL, name: 'Teacher Leader', order_index: 3, vendor_id: VENDOR, is_active: true }] };
  tableStates.training_courses = { rows: [{ id: 1, level_id: LEVEL, is_active: true, title: 'C', order_index: 1 }] };
  tableStates.training_modules = { rows: [{ id: 101, course_id: 1, is_active: true, title: 'M', order_index: 1 }] };
  tableStates.teacher_training_progress = { rows: [{ user_id: UID, module_id: 101 }] };
  tableStates.training_grand_quizzes = { rows: [{ id: QUIZ, level_id: LEVEL, quiz_type: 'grand_quiz', is_active: true }] };
  tableStates.training_certificates = { rows: [] };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.training_assessment_attempts = { rows: [{
    id: ATTEMPT, user_id: UID, program_id: 'p1', quiz_kind: 'grand', grand_quiz_id: QUIZ,
    training_module_id: null, level_id: LEVEL, current_question_index: 0,
    total_questions: 2, total_score: 2, status: 'in_progress',
  }] };
  tableStates.training_questions = { rows: [
    { id: 1, grand_quiz_id: QUIZ, training_module_id: null, order_index: 0, is_active: true,
      question_text: 'Q one', options: Array.from({ length: 4 }, (_, i) => `${'o'.repeat(optionLen)}${i}`),
      correct_option: correct, bloom_level: 'apply' },
    { id: 2, grand_quiz_id: QUIZ, training_module_id: null, order_index: 1, is_active: true,
      question_text: 'Q two', options: ['a', 'b'], correct_option: '1', bloom_level: 'apply' },
  ] };
}

beforeEach(() => {
  jest.resetModules(); tableStates = {}; callLog = [];
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
  delete process.env.TRAINING_MSQ_FLOW_ID;
  ['@aws-sdk/client-s3','@aws-sdk/s3-request-presigner','exceljs','pdfkit','bullmq','aws-sdk'].forEach(m => jest.doMock(m, () => ({}), { virtual: true }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null, logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
  supabaseFrom = jest.fn(t => makeChain(t));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn() }));
  whatsapp = {
    sendMessage: jest.fn(async (_p, text) => { callLog.push(`sendMessage:${text}`); return true; }),
    sendInteractiveButtons: jest.fn(async () => true),
    sendInteractiveMessage: jest.fn(async () => { callLog.push('sendQuestion'); return true; }),
    sendFlow: jest.fn(async () => { callLog.push('sendQuestion'); return true; }),
    sendReaction: jest.fn(async (_p, id, emoji) => { callLog.push(`sendReaction:${id}:${emoji}`); return true; }),
  };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => whatsapp);
});
afterEach(() => jest.resetModules());

const svc = () => require('../../bot/shared/services/training/quiz-delivery.service');
const verdicts = () => whatsapp.sendMessage.mock.calls.map(c => c[1]).filter(t => /Correct|correct/.test(t));

// Every case runs against BOTH surfaces: the interactive list a teacher taps,
// and the Flow used when a question is too long for a list (bd-43496).
const SURFACES = [
  ['list', async (chosen, messageId) => {
    await svc().handleQuizButton(UID, `training_quiz_${ATTEMPT}_${chosen}`, PHONE, messageId);
  }],
  ['flow', async (chosen, messageId) => {
    process.env.TRAINING_MSQ_FLOW_ID = '1583240000000000';
    await svc().handleQuizFlowSubmission(UID, {
      attempt_ref: `${ATTEMPT}:0`, selected_option: String(chosen),
    }, PHONE, messageId);
  }],
];

describe.each(SURFACES)('bd-2523 — per-question verdict (%s surface)', (_name, answer) => {
  it('sends a verdict for a correct answer', async () => {
    seed(); await answer(2, WAMID);
    expect(verdicts().some(t => /✅/.test(t) && /Correct/.test(t))).toBe(true);
  });

  it('sends a verdict for a wrong answer', async () => {
    seed(); await answer(3, WAMID);
    expect(verdicts().some(t => /Not correct/.test(t))).toBe(true);
  });

  it('the verdict arrives BEFORE the next question, not after', async () => {
    seed(); await answer(2, WAMID);
    // Arriving after the next question would attach the feedback to the wrong
    // one — the teacher reads it as a verdict on what is now on screen.
    const v = callLog.findIndex(e => e.startsWith('sendMessage:'));
    const q = callLog.indexOf('sendQuestion');
    expect(v).toBeGreaterThan(-1);
    expect(q).toBeGreaterThan(-1);
    expect(v).toBeLessThan(q);
  });

  it('the answer is recorded before anything is sent', async () => {
    seed(); await answer(2, WAMID);
    // A send that beat the write would lose the answer if delivery threw.
    const rec = callLog.indexOf('recordAnswer');
    const snd = callLog.findIndex(e => e.startsWith('sendMessage:') || e.startsWith('sendReaction:'));
    expect(rec).toBeGreaterThan(-1);
    expect(rec).toBeLessThan(snd);
  });

  // bd-2525 copy review: "❌ Not quite" pulled two ways — ❌ is the loudest mark
  // in the set while "not quite" hedges, implying a near miss that often was
  // not one. The thin ✗ states it plainly; the heavy ❌ stays on the reaction.
  it('the wrong-answer copy is plain, and the heavy cross stays out of the prose', async () => {
    seed(); await answer(3, WAMID);
    const wrong = verdicts().find(t => /Not correct/.test(t));
    expect(wrong).toBeDefined();
    expect(wrong).not.toMatch(/Not quite/);
    expect(wrong).not.toMatch(/❌/);
    expect(wrong).toMatch(/✗/);
  });

  it('a delivery failure cannot strand the quiz mid-attempt', async () => {
    seed();
    whatsapp.sendMessage.mockRejectedValue(new Error('send boom'));
    await expect(answer(2, WAMID)).resolves.not.toThrow();
    // The verdict is a courtesy; the answer must still be recorded.
    expect(tableStates.training_assessment_answers.rows.length).toBe(1);
  });
});

describe.each(SURFACES)('bd-2525 — the answer itself is marked ✅/❌ (%s surface)', (_name, answer) => {
  it('reacts ✅ on a correct answer', async () => {
    seed(); await answer(2, WAMID);
    expect(whatsapp.sendReaction).toHaveBeenCalledWith(PHONE, WAMID, '✅');
  });

  it('reacts ❌ on a wrong answer', async () => {
    seed(); await answer(3, WAMID);
    expect(whatsapp.sendReaction).toHaveBeenCalledWith(PHONE, WAMID, '❌');
  });

  it('reacts to the teacher\'s own message, never to ours', async () => {
    // The inbound wamid is the only id we hold: sendInteractiveMessage returns
    // a bare boolean, so the question we sent has no id to react to.
    seed(); await answer(2, WAMID);
    for (const call of whatsapp.sendReaction.mock.calls) expect(call[1]).toBe(WAMID);
  });

  it('the reaction is optional — no messageId, no crash, verdict still sent', async () => {
    seed();
    await expect(answer(2, null)).resolves.not.toThrow();
    expect(whatsapp.sendReaction).not.toHaveBeenCalled();
    expect(verdicts().length).toBeGreaterThan(0);
  });

  it('a failed reaction cannot strand the quiz', async () => {
    seed();
    whatsapp.sendReaction.mockRejectedValue(new Error('reaction boom'));
    await expect(answer(2, WAMID)).resolves.not.toThrow();
    expect(tableStates.training_assessment_answers.rows.length).toBe(1);
    expect(verdicts().length).toBeGreaterThan(0);
  });
});

// The one assertion that genuinely belongs at source level: it is about the
// CALL SITES in the bot, which no unit test of the service can reach.
describe('bd-2525 — the bot passes the inbound message id through', () => {
  const fs = require('fs');
  const path = require('path');
  const bot = () => fs.readFileSync(path.resolve(__dirname, '../../bot/whatsapp-bot.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('every handleQuizButton call site forwards message.id', () => {
    // Quiz options ship as an interactive LIST, so the list path is the one
    // teachers actually take — wiring only the button path would have left the
    // reaction dead in practice while looking done in review.
    const calls = bot().match(/handleQuizButton\([^)]*\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) expect(call).toMatch(/message\.id/);
  });

  it('the Flow submission call site forwards message.id too (bd-43496)', () => {
    const calls = bot().match(/handleQuizFlowSubmission\([^)]*\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const call of calls) expect(call).toMatch(/message\.id/);
  });
});
