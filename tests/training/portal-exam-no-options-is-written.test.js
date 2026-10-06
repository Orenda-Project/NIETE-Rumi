/**
 * A question with NO options is a written question, whatever its key says.
 *
 * Production had one grand-quiz row with options [] and correct_option 'C'. The
 * server treated the key as proof of an MCQ, served options [] with
 * is_open_ended:false, and the page drew a text box; the typed words then went
 * out as `chosen_option`, a varchar(32) column, so every autosave and every
 * submit of that paper failed with "value too long for type character
 * varying(32)".
 *
 * These tests EXECUTE submitModuleExamPaper / saveModuleExamDraft against a
 * database boundary that enforces the real column width, so a regression shows
 * up as the same error production logged, not as a source-text mismatch.
 */

let svc;
let writes;

const LONG = 'Saturday morning we walked to the market and counted the mangoes in groups of five.';

const QUESTIONS = {
  1: { id: 1, question_text: 'Pick one', options: ['a', 'b', 'c', 'd'], correct_option: '2' },
  // The bad row: no options, but a key.
  2: { id: 2, question_text: 'Saturday Morning', options: [], correct_option: 'C' },
  // An image-option MCQ is NOT written: its options live in option_images.
  3: { id: 3, question_text: 'Which picture?', options: [], correct_option: '1', option_images: ['u1', 'u2'] },
};

function makeFrom() {
  return function from(table) {
    const q = { _t: table, _f: {} };
    const chain = () => q;
    q.select = chain;
    q.eq = (k, v) => { q._f[k] = v; return q; };
    q.in = (k, v) => { q._f[k] = v; return q; };
    q.maybeSingle = () => Promise.resolve({ data: rowFor(table, q._f, true) });
    q.single = q.maybeSingle;
    q.then = (res) => Promise.resolve({ data: rowFor(table, q._f, false) }).then(res);
    q.upsert = (payload) => {
      const rows = Array.isArray(payload) ? payload : [payload];
      writes.push(...rows.map(r => ({ table, ...r })));
      // The real boundary: chosen_option is varchar(32).
      const tooLong = rows.some(r => typeof r.chosen_option === 'string' && r.chosen_option.length > 32);
      return Promise.resolve({
        data: null,
        error: tooLong ? { message: 'value too long for type character varying(32)' } : null,
      });
    };
    q.update = () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }), then: (r) => Promise.resolve({ data: null, error: null }).then(r) }) });
    return q;
  };
}

function rowFor(table, f, single) {
  if (table === 'training_assessment_attempts') {
    const a = { id: 'att-1', user_id: 'user-1', level_id: 26, program_id: 'p', grand_quiz_id: 46, total_questions: 3, status: 'in_progress' };
    return single ? a : [a];
  }
  if (table === 'training_questions') {
    const ids = Array.isArray(f.id) ? f.id : [f.id];
    const found = ids.map(i => QUESTIONS[i]).filter(Boolean);
    return single ? (found[0] || null) : found;
  }
  return single ? null : [];
}

beforeEach(() => {
  jest.resetModules();
  writes = [];
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: makeFrom(), rpc: jest.fn() }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: () => true, sendInteractiveMessage: () => true, sendInteractiveButtons: () => true,
    sendImageFromUrl: () => true, sendFlow: () => true,
  }));
  jest.doMock('../../bot/shared/services/training/capstone-delivery.service', () => ({
    meetsAnswerFloor: () => true, MIN_ANSWER_CHARS: 200,
    scoreAnswer: async () => ({ score: 8, feedback: 'ok' }),
    handleCapstoneButton: async () => true, routeTextAnswer: async () => false,
  }));
  jest.doMock('../../bot/shared/services/llm-client', () => ({ getClient: jest.fn(), getDefaultModel: () => 'm' }));
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  jest.doMock('pdfkit', () => jest.fn(), { virtual: true });
  svc = require('../../bot/shared/services/training/quiz-delivery.service');
});

describe('isOpenEndedQuestion — no options means written', () => {
  const { isOpenEndedQuestion } = require('../../bot/shared/services/training/isaps-crq-paper.rules');
  it('options [] with a stray key is written', () => {
    expect(isOpenEndedQuestion({ options: [], correct_option: 'C' })).toBe(true);
  });
  it('an image-option question is not written', () => {
    expect(isOpenEndedQuestion({ options: [], correct_option: '1', option_images: ['u1'] })).toBe(false);
  });
  it('a row that does not say what its options are is still not guessed at', () => {
    expect(isOpenEndedQuestion({ correct_option: 'C' })).toBe(false);
    expect(isOpenEndedQuestion({ id: 1, order_index: 2 })).toBe(false);
  });
});

describe('submitModuleExamPaper — the no-options question stores its words as the written answer', () => {
  it('portal payload {answer_text}: stored in answer_text, chosen_option null', async () => {
    await svc.submitModuleExamPaper({
      userId: 'user-1', attemptId: 'att-1',
      answers: [{ question_id: 1, chosen_option: '2' }, { question_id: 2, answer_text: LONG }],
    });
    const row = writes.find(w => w.question_id === 2);
    expect(row.answer_text).toBe(LONG);
    expect(row.chosen_option).toBeNull();
  });

  it('a stale portal bundle that sends the words as chosen_option does not fail with varchar(32)', async () => {
    await expect(svc.submitModuleExamPaper({
      userId: 'user-1', attemptId: 'att-1',
      answers: [{ question_id: 1, chosen_option: '2' }, { question_id: 2, chosen_option: LONG }],
    })).resolves.toBeDefined();
    const row = writes.find(w => w.question_id === 2);
    expect(row.answer_text).toBe(LONG);
    expect(row.chosen_option).toBeNull();
  });

  it('an image-option question is still marked as a pick', async () => {
    await svc.submitModuleExamPaper({
      userId: 'user-1', attemptId: 'att-1', answers: [{ question_id: 3, chosen_option: '1' }],
    });
    const row = writes.find(w => w.question_id === 3);
    expect(row.chosen_option).toBe('1');
    expect(row.is_correct).toBe(true);
  });
});

describe('saveModuleExamDraft — same rule on autosave', () => {
  it('words sent as chosen_option for a no-options question are saved as answer_text', async () => {
    const r = await svc.saveModuleExamDraft({
      userId: 'user-1', attemptId: 'att-1', questionId: 2, questionIndex: 1, chosenOption: LONG, answerText: null,
    });
    expect(r).toEqual({ ok: true });
    const row = writes.find(w => w.question_id === 2);
    expect(row.answer_text).toBe(LONG);
    expect(row.chosen_option).toBeNull();
  });

  it('a normal pick is still saved as chosen_option', async () => {
    const r = await svc.saveModuleExamDraft({
      userId: 'user-1', attemptId: 'att-1', questionId: 1, questionIndex: 0, chosenOption: '2', answerText: null,
    });
    expect(r).toEqual({ ok: true });
    expect(writes.find(w => w.question_id === 1).chosen_option).toBe('2');
  });
});
