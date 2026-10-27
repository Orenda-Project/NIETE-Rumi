/**
 * bd-bos0ki — the question's RUBRIC must reach the CRQ grader on BOTH paths.
 *
 * scoreAnswer() (bd-60161) marks against the question's own rubric when the
 * question it is handed carries one, and falls back to a generic prompt when
 * it does not. Neither caller handed it one:
 *
 *   WhatsApp  routeOpenEndedAnswer got its question from loadQuestionBank,
 *             which projects id / order_index / bloom_level / options /
 *             correct_option. No question_text, no rubric: the generic prompt
 *             ran with "Question: undefined".
 *   Portal    submitModuleExamPaper selected question_text but not rubric, so
 *             the rubric prompt never ran there either.
 *
 * 36 of the 37 live I-SAPS module-exam CRQs have a rubric, and the
 * isaps_crq_results_released flag shows new grades to teachers at once.
 *
 * These tests EXECUTE both paths against a database stub that honours the
 * `select(columns)` projection, so a column left out of a select is absent from
 * the row — exactly as in production — and capture the payload sent to the LLM.
 *
 *   (a) WhatsApp, rubric CRQ  -> rubric prompt, question text + criteria
 *   (b) portal background grade -> the same
 *   (c) rubric-less CRQ       -> generic prompt, REAL question text
 *   (d) neither `rubric` nor `correct_option` reaches a client payload
 *   (e) scale: the stored score is on the VENDOR scale
 */

let svc;
let llmCalls;
let llmReply;
let writes;
let selects;
let noRubric;
let vendorPoints;
let warnings;

const RUBRIC = (id) => ({
  total_marks: 10,
  source: 'ISAPS rubric sheet',
  criteria: [
    { name: `Criterion A for ${id}`, marks: 4, bands: { 4: `SECRET-BAND-4-${id}`, 2: `SECRET-BAND-2-${id}` } },
    { name: `Criterion B for ${id}`, marks: 3, bands: { 3: `SECRET-BAND-3-${id}`, 1: `SECRET-BAND-1-${id}` } },
    { name: `Criterion C for ${id}`, marks: 3, bands: { 3: `SECRET-BAND-C3-${id}`, 0: `SECRET-BAND-C0-${id}` } },
  ],
});

function fullRows() {
  const all = {};
  for (let i = 1; i <= 8; i += 1) {
    all[i] = { id: i, order_index: i, bloom_level: null, question_text: `MCQ text ${i}`, options: ['a', 'b', 'c', 'd'], correct_option: '2', option_images: null, rubric: null };
  }
  for (let i = 1; i <= 4; i += 1) {
    const id = 100 + i;
    all[id] = {
      id, order_index: 900 + i, bloom_level: null, question_text: `Explain classroom concept ${id}`,
      options: [], correct_option: '', option_images: null, rubric: noRubric ? null : RUBRIC(id),
    };
  }
  return all;
}

const ATTEMPT = {
  id: 'att-1',
  user_id: 'user-1',
  level_id: 26,
  grand_quiz_id: 36,
  training_module_id: null,
  quiz_kind: 'grand',
  program_id: 'prog-1',
  current_question_index: 4,
  total_questions: 5,
  total_score: 30,
  status: 'in_progress',
};

/** Projection-aware chainable stub: a row only carries the columns that were selected. */
function makeFrom() {
  return function from(table) {
    const q = { _t: table, _f: {}, _cols: null };
    const chain = () => q;
    q.select = (cols) => {
      q._cols = typeof cols === 'string' ? cols.split(',').map(s => s.trim()) : null;
      if (table === 'training_questions') selects.push(q._cols);
      return q;
    };
    q.eq = (k, v) => { q._f[k] = v; return q; };
    q.in = (k, v) => { q._f[k] = v; return q; };
    q.order = chain;
    q.limit = chain;
    q.is = chain;
    q.lt = chain;
    q.ilike = chain;
    const project = (row) => {
      if (!row || !q._cols || table !== 'training_questions') return row;
      const out = {};
      q._cols.forEach((c) => { if (c in row) out[c] = row[c]; });
      return out;
    };
    const resolve = (single) => {
      if (table === 'training_questions') {
        const all = Object.values(fullRows());
        const ids = q._f.id === undefined ? null : (Array.isArray(q._f.id) ? q._f.id : [q._f.id]);
        const found = (ids ? all.filter(r => ids.includes(r.id)) : all).map(project);
        return single ? (found[0] || null) : found;
      }
      if (table === 'users') return { id: 'user-1', name: 'Test Teacher' };
      if (table === 'training_assessment_attempts') return single ? ATTEMPT : [ATTEMPT];
      if (table === 'training_levels') return { id: 26, vendor_id: 'v-isaps' };
      if (table === 'training_vendors') return { id: 'v-isaps', key: 'ISAPS', capstone_points_per_question: vendorPoints };
      if (table === 'training_courses') return single ? { id: 1, title: 'Module 1 - X', level_id: 26 } : [];
      if (table === 'training_grand_quizzes') return single ? { id: 36, quiz_type: 'grand_quiz', source_quiz_id: 901 } : [{ id: 36, quiz_type: 'grand_quiz', source_quiz_id: 901 }];
      return single ? null : [];
    };
    q.maybeSingle = () => Promise.resolve({ data: resolve(true), error: null });
    q.single = q.maybeSingle;
    q.then = (res) => Promise.resolve({ data: resolve(false), error: null }).then(res);
    q.upsert = (payload) => {
      (Array.isArray(payload) ? payload : [payload]).forEach(p => writes.push({ table, op: 'upsert', payload: p }));
      return Promise.resolve({ data: null, error: null });
    };
    q.update = (payload) => {
      writes.push({ table, op: 'update', payload });
      const u = { eq: () => u, then: (r) => Promise.resolve({ data: null, error: null }).then(r) };
      return u;
    };
    q.insert = (payload) => {
      writes.push({ table, op: 'insert', payload });
      return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new' } }) }) };
    };
    return q;
  };
}

beforeEach(() => {
  jest.resetModules();
  llmCalls = [];
  writes = [];
  selects = [];
  warnings = [];
  noRubric = false;
  vendorPoints = 10;
  llmReply = { criteria: [{ n: 1, marks: 3 }], total: 8, feedback: 'Marked against the rubric.' };

  jest.doMock('../../bot/shared/config/supabase', () => ({ from: makeFrom(), rpc: jest.fn() }));
  jest.doMock('../../bot/shared/utils/logger', () => ({
    logToFile: (msg, meta, level) => { if (level === 'warn' || /⚠️/.test(String(msg))) warnings.push({ msg, meta }); },
    logError: jest.fn(),
  }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: () => true, sendInteractiveMessage: () => true, sendInteractiveButtons: () => true,
    sendImageFromUrl: () => true, sendFlow: () => true,
  }));
  jest.doMock('../../bot/shared/services/llm-client', () => ({
    getClient: () => ({
      chat: {
        completions: {
          create: async (payload) => {
            llmCalls.push(payload);
            return { choices: [{ message: { content: JSON.stringify(llmReply) } }] };
          },
        },
      },
    }),
    getDefaultModel: () => 'test-model',
  }));
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  jest.doMock('pdfkit', () => jest.fn(), { virtual: true });

  svc = require('../../bot/shared/services/training/quiz-delivery.service');
});

const ANSWER = ('Activity: I would use a whiteboard brainstorm, first divergent then '
  + 'convergent, assessing variety of approaches in the first phase and accuracy in '
  + 'the second, because both thinking modes matter for this objective. I would '
  + 'then ask pairs to explain their choice aloud so I can check understanding. ').repeat(2).trim();

const prompt = (call) => call.messages.map(m => m.content).join('\n');
const sys = (call) => call.messages.find(m => m.role === 'system').content;
const usr = (call) => call.messages.find(m => m.role === 'user').content;

/** Wait for the portal's setImmediate background grade to reach the LLM. */
async function untilGraded() {
  for (let i = 0; i < 50 && llmCalls.length === 0; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise(r => setImmediate(r));
  }
  // let the write that follows the model reply land
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise(r => setImmediate(r));
  }
}

async function submitPortal() {
  return svc.submitModuleExamPaper({
    userId: 'user-1', attemptId: 'att-1',
    answers: [{ question_id: 1, chosen_option: '2' }, { question_id: 101, answer_text: ANSWER }],
  });
}

describe('bd-bos0ki (a) — WhatsApp CRQ is marked against its rubric', () => {
  test('the LLM gets the rubric prompt, the question text and the criteria', async () => {
    expect(await svc.routeOpenEndedAnswer('923000000000', ANSWER)).toBe(true);
    expect(llmCalls).toHaveLength(1);
    const qid = writes.find(w => w.table === 'training_assessment_answers').payload.question_id;

    expect(sys(llmCalls[0])).toMatch(/official rubric/);
    expect(usr(llmCalls[0])).toContain(`Explain classroom concept ${qid}`);
    expect(usr(llmCalls[0])).toContain(`Criterion A for ${qid}`);
    expect(usr(llmCalls[0])).toContain(`SECRET-BAND-4-${qid}`);
    expect(usr(llmCalls[0])).not.toMatch(/undefined/);
    expect(llmCalls[0].max_tokens).toBe(700);
  });

  test('the stored mark is the rubric total, on the 10-mark vendor scale', async () => {
    await svc.routeOpenEndedAnswer('923000000000', ANSWER);
    const row = writes.find(w => w.table === 'training_assessment_answers').payload;
    expect(row.answer_score).toBe(8);
    expect(row.feedback_text).toBe('Marked against the rubric.');
  });
});

describe('bd-bos0ki (b) — the portal background grade is marked against its rubric', () => {
  test('the LLM gets the rubric prompt, the question text and the criteria', async () => {
    const res = await submitPortal();
    expect(res.crq_pending).toBe(true);
    await untilGraded();
    expect(llmCalls).toHaveLength(1);

    expect(sys(llmCalls[0])).toMatch(/official rubric/);
    expect(usr(llmCalls[0])).toContain('Explain classroom concept 101');
    expect(usr(llmCalls[0])).toContain('Criterion A for 101');
    expect(usr(llmCalls[0])).toContain('SECRET-BAND-4-101');
  });

  test('the mark lands on the CRQ answer row', async () => {
    await submitPortal();
    await untilGraded();
    const upd = writes.find(w => w.table === 'training_assessment_answers' && w.op === 'update');
    expect(upd).toBeDefined();
    expect(upd.payload.answer_score).toBe(8);
  });
});

describe('bd-bos0ki (c) — a rubric-less CRQ keeps the generic prompt, with a real question', () => {
  beforeEach(() => { noRubric = true; llmReply = { score: 6, feedback: 'ok' }; });

  test('WhatsApp: generic prompt, real question text, never "undefined"', async () => {
    await svc.routeOpenEndedAnswer('923000000000', ANSWER);
    const qid = writes.find(w => w.table === 'training_assessment_answers').payload.question_id;
    expect(sys(llmCalls[0])).not.toMatch(/official rubric/);
    expect(usr(llmCalls[0])).toContain(`Explain classroom concept ${qid}`);
    expect(prompt(llmCalls[0])).not.toMatch(/undefined/);
    expect(writes.find(w => w.table === 'training_assessment_answers').payload.answer_score).toBe(6);
  });

  test('portal: generic prompt, real question text, never "undefined"', async () => {
    await submitPortal();
    await untilGraded();
    expect(sys(llmCalls[0])).not.toMatch(/official rubric/);
    expect(usr(llmCalls[0])).toContain('Explain classroom concept 101');
    expect(prompt(llmCalls[0])).not.toMatch(/undefined/);
  });
});

describe('bd-bos0ki (d) — the rubric never reaches a client', () => {
  test('submitModuleExamPaper returns no rubric and no answer key', async () => {
    const res = await submitPortal();
    await untilGraded();
    const json = JSON.stringify(res);
    expect(json).not.toMatch(/rubric|SECRET-BAND|correct_option|Criterion/i);
  });

  test('the module-exam paper (openModuleExamAttempt) carries no rubric and no answer key', async () => {
    jest.resetModules();
    jest.doMock('../../bot/shared/routes/teacher-training-endpoint', () => ({
      loadModulesWithProgress: async () => [],
      loadModuleExamSlot: async () => ({ ok: true }),
    }));
    const fresh = require('../../bot/shared/services/training/quiz-delivery.service');
    const res = await fresh.openModuleExamAttempt({ userId: 'user-1', courseId: 1 });
    expect(res.ok).toBe(true);
    expect(res.questions.length).toBeGreaterThan(0);
    const json = JSON.stringify(res);
    expect(json).not.toMatch(/rubric|SECRET-BAND|Criterion/i);
    expect(json).not.toMatch(/correct_option/);
    res.questions.forEach((q) => {
      expect(Object.keys(q).sort()).toEqual(['id', 'index', 'is_open_ended', 'option_images', 'options', 'question_text']);
    });
  });

  test('loadQuestionBank is NOT widened: the shared bank projection stays free of rubric and text', async () => {
    await svc.routeOpenEndedAnswer('923000000000', ANSWER);
    const bankSelect = selects.find(c => c && c.includes('bloom_level'));
    expect(bankSelect).toBeDefined();
    expect(bankSelect).not.toContain('rubric');
    expect(bankSelect).not.toContain('question_text');
  });

  test('every client-facing training_questions select in the portal and endpoints is free of `rubric`', () => {
    const fs = require('fs');
    const path = require('path');
    const files = [
      '../../dashboard/routes/portal.routes.js',
      '../../bot/shared/routes/teacher-training-endpoint.js',
      '../../bot/shared/routes/internal-api.routes.js',
      '../../dashboard/services/training-library.service.js',
    ];
    files.forEach((f) => {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
      const re = /from\('training_questions'\)[\s\S]{0,200}?\.select\(([^)]*)\)/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        expect(`${f}: ${m[1]}`).not.toMatch(/rubric/);
      }
      expect(src).not.toMatch(/\.select\(\s*'[^']*\brubric\b/);
    });
  });
});

describe('bd-bos0ki (e) — the stored mark stays comparable to the pass bar', () => {
  test('rubric 10 = vendor 10 (today, all 36 rubrics): the mark is stored unchanged', async () => {
    vendorPoints = 10;
    await svc.routeOpenEndedAnswer('923000000000', ANSWER);
    expect(writes.find(w => w.table === 'training_assessment_answers').payload.answer_score).toBe(8);
    expect(warnings.filter(w => /scale/i.test(w.msg))).toHaveLength(0);
  });

  test('rubric 10 vs vendor 5: the mark is converted to the vendor scale and a warning is logged', async () => {
    vendorPoints = 5;
    await svc.routeOpenEndedAnswer('923000000000', ANSWER);
    const row = writes.find(w => w.table === 'training_assessment_answers').payload;
    expect(row.answer_score).toBe(4);   // 8/10 -> 4/5, never 8 against a 5-mark bar
    expect(warnings.filter(w => /scale/i.test(w.msg)).length).toBeGreaterThan(0);
  });
});
