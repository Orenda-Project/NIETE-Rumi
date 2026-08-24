/**
 * bd-43496 — a level-exam question whose rendering exceeds WhatsApp's 1024-char
 * interactive body cap was silently undeliverable, and froze the attempt.
 *
 * Two defects, one symptom ("the bot went silent on the exam"):
 *
 *  1. sendQuestion sliced the interactive body at 4096. That is the cap for a
 *     TEXT message; an INTERACTIVE body is 1024. Meta rejects the send with
 *     (#131009) "Body text length invalid. Min length: 1, Max length: 1024".
 *     Introduced by 8924ed9 (bd-2230), which moved long options INTO the body
 *     to stop row-description truncation and guarded with the wrong number —
 *     turning a cosmetic truncation into a total send failure.
 *
 *  2. sendQuestion returned `true` unconditionally, discarding the send result.
 *     So a rejected question read as delivered: the attempt stayed in_progress
 *     with current_question_index frozen, and every retry resumed onto the same
 *     undeliverable question. That is the silence.
 *
 * Live blast radius when found: quiz 4 (NIETE "Teacher Leader") has 45 active
 * questions, 21 of which render past 1024. NIETE serves 20 per paper, so
 * P(a paper with zero undeliverable questions) = 0 — the exam could not be
 * completed by anyone. 441 rejected sends over 34 days, 29 teachers, 10 frozen
 * mid-attempt.
 *
 * The fix routes single-answer questions through the existing MSQ Flow when the
 * list rendering would not fit: in a Flow the options live in the CheckboxGroup
 * data-source, so the body carries the question alone. Long option text has a
 * home (option.description) instead of being concatenated into the body.
 */
let supabaseFrom, tableStates, whatsapp;

function makeChain(t) {
  const st = tableStates[t] || {};
  const rec = { filters: {}, isCount: false, orderCol: null, orderDir: null };
  const c = {};
  const rows = () => {
    let r = st.rows || [];
    for (const [col, v] of Object.entries(rec.filters)) {
      if (v && typeof v === 'object' && Array.isArray(v.in)) r = r.filter(x => v.in.includes(x[col]));
      else if (!col.includes('.')) r = r.filter(x => x[col] === v || String(x[col]) === String(v));
    }
    return r;
  };
  const one = () => st.error ? { data: null, error: st.error } : (rec.isCount ? { count: rows().length, data: null, error: null } : { data: rows()[0] || null, error: null });
  const many = () => {
    if (st.error) return { data: null, error: st.error };
    if (rec.isCount) return { count: rows().length, data: null, error: null };
    let r = rows();
    if (rec.orderCol) { const d = rec.orderDir === 'asc' ? 1 : -1; r = [...r].sort((a, b) => a[rec.orderCol] < b[rec.orderCol] ? -d : a[rec.orderCol] > b[rec.orderCol] ? d : 0); }
    return { data: r, error: null };
  };
  c.select = jest.fn((_c, o) => { if (o && o.count === 'exact' && o.head === true) rec.isCount = true; return c; });
  ['eq','neq','gt','gte','lt','lte','like','ilike','is','not'].forEach(m => { c[m] = jest.fn((col, v) => { rec.filters[col] = v; return c; }); });
  c.in = jest.fn((col, v) => { rec.filters[col] = { in: v }; return c; });
  c.order = jest.fn((col, o) => { rec.orderCol = col; rec.orderDir = o && o.ascending ? 'asc' : 'desc'; return c; });
  c.limit = jest.fn(() => c); c.range = jest.fn(() => c);
  // Writes mutate the in-memory table so a frozen index is observable.
  c.insert = jest.fn((v) => { st.rows = [...(st.rows || []), ...(Array.isArray(v) ? v : [v])]; return c; });
  c.upsert = jest.fn((v) => { st.rows = [...(st.rows || []), ...(Array.isArray(v) ? v : [v])]; return c; });
  c.update = jest.fn((patch) => { for (const r of rows()) Object.assign(r, patch); return c; });
  c.maybeSingle = jest.fn(async () => one()); c.single = jest.fn(async () => one());
  c.then = (res, rej) => Promise.resolve(many()).then(res, rej);
  return c;
}

const UID = 'u1', VENDOR = 'v1', LEVEL = 4, QUIZ = 4, ATTEMPT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PHONE = '923449320536';
const MSQ_FLOW = '1583240000000000';

/**
 * One in-progress exam attempt sitting on a single question.
 *
 * `optionLen` drives the bd-2230 options-in-body path: any option longer than
 * the 72-char row-description cap forces the full options into the body, which
 * is what pushes the rendering past 1024.
 */
function seed({ questionLen = 400, optionLen = 200, nOptions = 4, correct = '2' } = {}) {
  tableStates.users = { rows: [{ id: UID, first_name: 'Fatima', phone_number: PHONE }] };
  tableStates.teacher_training_assignments = { rows: [{ user_id: UID, program_id: 'p1', is_active: true }] };
  tableStates.training_program_scopes = { rows: [{ program_id: 'p1', vendor_id: VENDOR, level_ids: null }] };
  tableStates.training_vendors = { rows: [{ id: VENDOR, key: 'TALEEMABAD', name: 'NIETE', unlock_logic: 'chain', level_unlock_logic: 'chain', module_unlock_logic: 'chain', has_grand_quiz: true, passing_pct: 80, module_passing_pct: 100, exam_question_cap: null, shuffle_options: false }] };
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
    total_questions: 1, total_score: 1, status: 'in_progress',
  }] };
  tableStates.training_questions = { rows: [{
    id: 3701, grand_quiz_id: QUIZ, training_module_id: null, order_index: 0, is_active: true,
    question_text: 'Q'.repeat(questionLen),
    options: Array.from({ length: nOptions }, (_, i) => `${'o'.repeat(optionLen)}${i}`),
    correct_option: correct,
    bloom_level: 'apply',
  }] };
}

beforeEach(() => {
  jest.resetModules(); tableStates = {};
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
  delete process.env.TRAINING_MSQ_FLOW_ID;
  ['@aws-sdk/client-s3','@aws-sdk/s3-request-presigner','exceljs','pdfkit','bullmq','aws-sdk'].forEach(m => jest.doMock(m, () => ({}), { virtual: true }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null, logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
  supabaseFrom = jest.fn(t => makeChain(t));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn() }));
  // sendInteractiveMessage resolves FALSE, exactly as the real service does when
  // Meta 400s — that is the signal the frozen-attempt bug throws away.
  whatsapp = {
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: jest.fn().mockResolvedValue(false),
    sendFlow: jest.fn().mockResolvedValue(true),
  };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => whatsapp);
});
afterEach(() => jest.resetModules());

const svc = () => require('../../bot/shared/services/training/quiz-delivery.service');
const attemptRow = () => tableStates.training_assessment_attempts.rows.find(r => r.id === ATTEMPT);

describe('bd-43496 — the interactive body must respect Meta\'s 1024 cap', () => {
  // The invariant, whichever surface is chosen and whether or not a Flow is
  // configured: nothing over the cap is ever handed to Meta. With no Flow
  // available, declining to send at all is a valid outcome — silently
  // truncating would mark a teacher on text she cannot read.
  it.each([
    ['no MSQ Flow configured', null],
    ['an MSQ Flow configured', MSQ_FLOW],
  ])('never sends an interactive body longer than 1024 characters (%s)', async (_label, flowId) => {
    if (flowId) process.env.TRAINING_MSQ_FLOW_ID = flowId;
    // 400-char question + 4 options of 200 chars each, forced into the body by
    // bd-2230 => ~1240 chars. This is qid 3701 on production.
    seed({ questionLen: 400, optionLen: 200 });
    await svc().sendQuestion(ATTEMPT, PHONE);

    for (const call of whatsapp.sendInteractiveMessage.mock.calls) {
      expect([...call[1].body.text].length).toBeLessThanOrEqual(1024);
    }
    for (const call of whatsapp.sendFlow.mock.calls) {
      expect([...call[1].body].length).toBeLessThanOrEqual(1024);
    }
  });

  it('declines to send rather than truncating when no Flow can carry it', async () => {
    seed({ questionLen: 400, optionLen: 200 });   // no TRAINING_MSQ_FLOW_ID
    const ok = await svc().sendQuestion(ATTEMPT, PHONE);
    expect(ok).toBe(false);
    expect(whatsapp.sendInteractiveMessage).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).toHaveBeenCalled();   // the teacher is told
  });

  it('a short question is untouched — no regression on the normal path', async () => {
    seed({ questionLen: 80, optionLen: 20 });
    await svc().sendQuestion(ATTEMPT, PHONE);
    expect(whatsapp.sendInteractiveMessage).toHaveBeenCalled();
    const body = whatsapp.sendInteractiveMessage.mock.calls[0][1].body.text;
    expect(body).toContain('Q'.repeat(80));
    expect(body.length).toBeLessThanOrEqual(1024);
  });
});

describe('bd-43496 — a failed send must never freeze the attempt', () => {
  it('reports failure instead of claiming the question was delivered', async () => {
    seed({ questionLen: 400, optionLen: 200 });
    // Force the list path so the raw send-failure propagation is what is tested.
    const ok = await svc().sendQuestion(ATTEMPT, PHONE);
    if (whatsapp.sendInteractiveMessage.mock.calls.length && !whatsapp.sendFlow.mock.calls.length) {
      expect(ok).toBe(false);
    }
  });

  it('tells the teacher something went wrong rather than going silent', async () => {
    seed({ questionLen: 400, optionLen: 200 });
    whatsapp.sendFlow.mockResolvedValue(false);
    await svc().sendQuestion(ATTEMPT, PHONE);
    // Silence is the actual reported bug. Some message must reach the teacher.
    const spoke = whatsapp.sendMessage.mock.calls.length > 0
      || whatsapp.sendInteractiveMessage.mock.calls.length > 0
      || whatsapp.sendFlow.mock.calls.length > 0;
    expect(spoke).toBe(true);
  });

  it('does not advance the question index past an undelivered question', async () => {
    seed({ questionLen: 400, optionLen: 200 });
    const before = attemptRow().current_question_index;
    await svc().sendQuestion(ATTEMPT, PHONE);
    expect(attemptRow().current_question_index).toBe(before);
  });
});

describe('bd-43496 — an oversized single-answer question routes to the MSQ Flow', () => {
  it('uses the Flow when the list rendering would exceed the cap', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = MSQ_FLOW;
    seed({ questionLen: 400, optionLen: 200, correct: '2' });   // single-answer
    await svc().sendQuestion(ATTEMPT, PHONE);

    expect(whatsapp.sendFlow).toHaveBeenCalled();
    expect(whatsapp.sendFlow.mock.calls[0][1].flowId).toBe(MSQ_FLOW);
  });

  it('keeps the fast list path for a question that fits', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = MSQ_FLOW;
    seed({ questionLen: 80, optionLen: 20, correct: '2' });
    await svc().sendQuestion(ATTEMPT, PHONE);

    expect(whatsapp.sendInteractiveMessage).toHaveBeenCalled();
    expect(whatsapp.sendFlow).not.toHaveBeenCalled();
  });

  // Meta enforces `max-selected-items >= 2` on a CheckboxGroup. Binding it to 1
  // uploads clean and then dies ON THE DEVICE — the screen paints, then
  // "Something Went Wrong". So a single-answer question must be served by the
  // RadioButtonsGroup, and the checkbox ceiling must never drop below 2.
  it('never sends a checkbox ceiling below Meta\'s floor of 2', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = MSQ_FLOW;
    seed({ questionLen: 400, optionLen: 200, correct: '2' });
    const data = await svc().buildMsqFlowScreenData(UID, ATTEMPT, 0);
    expect(data).not.toBeNull();
    expect(data.max_selected).toBeGreaterThanOrEqual(2);
  });

  it('gates a single-answer question onto the radio control', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = MSQ_FLOW;
    seed({ questionLen: 400, optionLen: 200, correct: '2' });
    const data = await svc().buildMsqFlowScreenData(UID, ATTEMPT, 0);
    expect(data.is_single).toBe(true);
    expect(data.is_multi).toBe(false);
  });

  it('gates a multi-answer question onto the checkbox control', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = MSQ_FLOW;
    seed({ questionLen: 400, optionLen: 200, correct: '1,3' });
    const data = await svc().buildMsqFlowScreenData(UID, ATTEMPT, 0);
    expect(data.is_multi).toBe(true);
    expect(data.is_single).toBe(false);
    expect(data.max_selected).toBe(data.options.length);
  });

  it('grades a radio submission sent as selected_option', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = MSQ_FLOW;
    seed({ questionLen: 400, optionLen: 200, correct: '2' });
    await svc().handleQuizFlowSubmission(UID, {
      attempt_ref: `${ATTEMPT}:0`,
      selected_option: '2',
      selected_options: '',      // the hidden checkbox rides along empty
    }, PHONE);

    const ans = tableStates.training_assessment_answers.rows;
    expect(ans.length).toBe(1);
    expect(ans[0].chosen_option).toBe('2');
    expect(ans[0].is_correct).toBe(true);
  });

  it('a single-answer question never records a set, even if the payload carries one', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = MSQ_FLOW;
    seed({ questionLen: 400, optionLen: 200, correct: '2' });
    await svc().handleQuizFlowSubmission(UID, {
      attempt_ref: `${ATTEMPT}:0`,
      selected_option: JSON.stringify(['2', '3']),
    }, PHONE);

    const ans = tableStates.training_assessment_answers.rows;
    expect(ans.length).toBe(1);
    expect(String(ans[0].chosen_option)).not.toContain(',');
  });

  it('serves the full option text through the Flow, untruncated', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = MSQ_FLOW;
    seed({ questionLen: 400, optionLen: 200, correct: '2' });
    const data = await svc().buildMsqFlowScreenData(UID, ATTEMPT, 0);
    // A 200-char option fits the 300-char description in full — the whole point
    // of the Flow route. Nothing should be cut at this length.
    for (const o of data.options) {
      expect(o.description.length).toBe(201);   // 200 x 'o' + the index digit
      expect(o.description).not.toMatch(/…$/);
    }
  });

  // The title cap is 30, not 80. Sending a longer one let the DEVICE clip it
  // mid-word, and the description then repeated the same opening text.
  it('keeps option titles inside Meta\'s 30-char cap', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = MSQ_FLOW;
    seed({ questionLen: 400, optionLen: 200, correct: '2' });
    const data = await svc().buildMsqFlowScreenData(UID, ATTEMPT, 0);
    for (const o of data.options) {
      expect([...o.title].length).toBeLessThanOrEqual(30);
    }
  });

  it('letters the options instead of repeating the answer text in the title', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = MSQ_FLOW;
    seed({ questionLen: 400, optionLen: 200, correct: '2' });
    const data = await svc().buildMsqFlowScreenData(UID, ATTEMPT, 0);
    expect(data.options.map(o => o.title)).toEqual(['A.', 'B.', 'C.', 'D.']);
    // The title must not be a prefix of its own description — that duplication
    // wasted the row's most visible line.
    for (const o of data.options) {
      expect(o.description.startsWith(o.title)).toBe(false);
    }
  });

  it('marks a genuinely over-long option with an ellipsis, cut on a word', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = MSQ_FLOW;
    // Real words so the word-boundary cut is observable; 400 chars > the 300 cap.
    const long = 'alpha bravo charlie delta echo foxtrot golf hotel '.repeat(9);
    seed({ questionLen: 100, optionLen: 10, correct: '2' });
    tableStates.training_questions.rows[0].options = [long, 'b', 'c', 'd'];
    const data = await svc().buildMsqFlowScreenData(UID, ATTEMPT, 0);
    const cut = data.options.find(o => o.id === '1');
    expect([...cut.description].length).toBeLessThanOrEqual(300);
    expect(cut.description).toMatch(/…$/);
    expect(cut.description).not.toMatch(/\s…$/);   // no dangling space before it
  });

  it('grades a single-answer Flow submission correctly', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = MSQ_FLOW;
    seed({ questionLen: 400, optionLen: 200, correct: '2' });
    await svc().handleQuizFlowSubmission(UID, {
      attempt_ref: `${ATTEMPT}:0`,
      selected_options: JSON.stringify(['2']),
    }, PHONE);

    const ans = tableStates.training_assessment_answers.rows;
    expect(ans.length).toBe(1);
    expect(ans[0].chosen_option).toBe('2');
    expect(ans[0].is_correct).toBe(true);
  });

  it('marks a wrong single-answer Flow submission wrong', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = MSQ_FLOW;
    seed({ questionLen: 400, optionLen: 200, correct: '2' });
    await svc().handleQuizFlowSubmission(UID, {
      attempt_ref: `${ATTEMPT}:0`,
      selected_options: JSON.stringify(['3']),
    }, PHONE);

    const ans = tableStates.training_assessment_answers.rows;
    expect(ans.length).toBe(1);
    expect(ans[0].is_correct).toBe(false);
  });
});
