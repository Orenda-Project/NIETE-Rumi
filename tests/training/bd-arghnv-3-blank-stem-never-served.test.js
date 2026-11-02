/**
 * bd-arghnv.3 — a question with a blank stem is never served.
 *
 * The I-SAPS Level 2 seed read a stem line opening "A teacher…", "After…", "At…" as option A, and 43
 * active questions went in with question_text ''. Teachers met them in module exams and quick checks
 * as four options under no question. The rows are repaired (scripts/migrations/
 * 2026-11-02-isaps-l2-blank-stem-repair.py) and the parser is fixed; this pins the third line of
 * defence: whatever the next seed does, a blank-stem question never reaches a paper.
 *
 * One rule (question-stem.rules.js, zero requires so the portal can load it), applied where papers are
 * chosen and where a quick check's existence is decided:
 *
 *   selectServedQuestions / selectPaperWithOneCrq   every paper, both surfaces (the selection layer)
 *   loadQuestionBank                                WhatsApp level exam, module exam, quick check, and the
 *                                                   portal's module exam paper; skipped rows are logged
 *   countActiveQuestions                            a quick check whose every question is blank is no quick
 *                                                   check: the teacher carries on rather than being stuck
 *   serve-paper (internal API)                      the portal's level exam and quick check papers
 *   loadCapstoneQuestions                           the Beacon House written exam on WhatsApp
 *   portal routes                                   module question list, legacy submit, capstone, and the
 *                                                   "has a quiz" probes the Mark complete control reads
 *
 * A row loaded WITHOUT question_text is kept: a projection that does not carry the column says
 * nothing about the stem (the bd-60131 lesson), and emptying every bank would be far worse.
 */

const fs = require('fs');
const path = require('path');

const BLANK = (id, extra = {}) => ({ id, question_text: '', options: ['a', 'b', 'c', 'd'], correct_option: '1', order_index: id, ...extra });
const MCQ = (id, extra = {}) => ({ id, question_text: `Question ${id}?`, options: ['a', 'b', 'c', 'd'], correct_option: '2', order_index: id, ...extra });
const CRQ = (id, extra = {}) => ({ id, question_text: `Write about ${id}.`, options: [], correct_option: '', order_index: 900 + id, ...extra });

describe('the rule', () => {
  const { hasQuestionStem, servableQuestions } = require('../../bot/shared/services/training/question-stem.rules');

  test('an empty, whitespace-only or null stem is blank; a real one is not', () => {
    expect(hasQuestionStem(BLANK(1))).toBe(false);
    expect(hasQuestionStem(MCQ(1, { question_text: '  \n ' }))).toBe(false);
    expect(hasQuestionStem(MCQ(1, { question_text: null }))).toBe(false);
    expect(hasQuestionStem(MCQ(1))).toBe(true);
  });

  test('a row loaded without question_text is kept: the projection says nothing about the stem', () => {
    expect(hasQuestionStem({ id: 1, order_index: 1, options: ['a'], correct_option: '1' })).toBe(true);
  });

  test('servableQuestions drops blank stems and names them in ONE log line', () => {
    const log = jest.fn();
    const out = servableQuestions([MCQ(1), BLANK(2), MCQ(3), BLANK(4)], { log, where: { quizKind: 'grand' } });
    expect(out.map(q => q.id)).toEqual([1, 3]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][1]).toEqual(expect.objectContaining({ quizKind: 'grand', questionIds: [2, 4] }));
  });

  test('nothing is logged when nothing is skipped', () => {
    const log = jest.fn();
    servableQuestions([MCQ(1)], { log });
    expect(log).not.toHaveBeenCalled();
  });

  test('the rule file has no requires, so the portal can load it', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../bot/shared/services/training/question-stem.rules.js'), 'utf8');
    expect(src).not.toMatch(/require\(/);
  });
});

describe('the selection layer never picks a blank stem', () => {
  const Serving = require('../../bot/shared/services/training/quiz-serving.service');
  const { selectPaperWithOneCrq } = require('../../bot/shared/services/training/isaps-crq-paper.rules');

  test('a quick check (serve everything) leaves the blank one out', () => {
    const served = Serving.selectServedQuestions([BLANK(1), MCQ(2), MCQ(3)], {
      attemptId: 'a-1', isModuleQuiz: true, config: Serving.normalizeServingConfig(null),
    });
    expect(served.map(q => q.id)).toEqual([2, 3]);
  });

  test('a capped level exam never draws the blank one, whatever the seed', () => {
    const bank = [BLANK(1), ...[2, 3, 4, 5, 6].map(i => MCQ(i))];
    for (const attemptId of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const served = Serving.selectServedQuestions(bank, {
        attemptId, isModuleQuiz: false, config: Serving.normalizeServingConfig({ exam_question_cap: 3 }),
      });
      expect(served).toHaveLength(3);
      expect(served.map(q => q.id)).not.toContain(1);
    }
  });

  test('an i-SAPS module exam paper never carries a blank MCQ or a blank CRQ', () => {
    const bank = [BLANK(1), MCQ(2), MCQ(3), MCQ(4), MCQ(5), BLANK(6), CRQ(7), CRQ(8, { question_text: ' ' })];
    for (const attemptId of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const ids = selectPaperWithOneCrq(bank, attemptId).map(q => q.id);
      expect(ids).not.toContain(1);
      expect(ids).not.toContain(6);
      expect(ids).not.toContain(8);
      expect(ids).toContain(7);
    }
  });
});

// ── WhatsApp: the bank loader and the quick-check count ─────────────────────────────────────────────
const PHONE = '92300' + '0000000';
const USER = 'u-1';
const MODULE = 42;

function makeSupabase(bank, writes) {
  const build = (table) => {
    const st = { table, op: null, payload: null, selectArgs: null };
    const chain = {
      select(...a) { st.selectArgs = a; return chain; },
      insert(p) { st.op = 'insert'; st.payload = p; writes.push({ table, op: 'insert', payload: p }); return chain; },
      upsert(p) { st.op = 'upsert'; st.payload = p; return chain; },
      update(p) { st.op = 'update'; st.payload = p; return chain; },
      eq() { return chain; },
      in() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      then(res) { return res(settle()); },
      maybeSingle: async () => settle(true),
      single: async () => settle(true),
    };
    function settle(one = false) {
      if (table === 'training_questions') {
        const head = st.selectArgs && st.selectArgs[1] && st.selectArgs[1].head;
        if (head) return { data: null, count: bank.length, error: null };   // what PostgREST would say: every active row
        return { data: one ? bank[0] || null : bank, error: null };
      }
      if (table === 'training_modules') return { data: one ? { id: MODULE, course_id: 7, title: 'Unit 2101' } : [], error: null };
      if (table === 'training_courses') return { data: one ? { id: 7, level_id: 3 } : [], error: null };
      if (table === 'teacher_training_assignments') return { data: one ? { program_id: 'p-1' } : [], error: null };
      if (table === 'training_assessment_attempts') {
        if (st.op === 'insert') return { data: { id: 'att-1' }, error: null };
        return { data: one ? null : [], error: null };
      }
      return { data: one ? null : [], error: null };
    }
    return chain;
  };
  return { from: (t) => build(t), rpc: jest.fn() };
}

function loadQuizDelivery(bank) {
  jest.resetModules();
  const sent = [];
  const writes = [];
  const logToFile = jest.fn();
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile, logError: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  jest.doMock('pdfkit', () => jest.fn(), { virtual: true });
  jest.doMock('../../bot/shared/config/supabase', () => makeSupabase(bank, writes));
  const capture = jest.fn(async (_to, p) => { sent.push(typeof p === 'string' ? p : JSON.stringify(p)); return true; });
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: capture, sendInteractiveButtons: capture, sendInteractiveMessage: capture,
    sendInteractiveList: capture, sendListMessage: capture,
  }));
  const svc = require('../../bot/shared/services/training/quiz-delivery.service');
  const progress = require('../../bot/shared/services/training/progress.service');
  return { svc, progress, sent, writes, logToFile };
}

describe('WhatsApp quick check', () => {
  test('a module whose only question has a blank stem is no quick check: count 0, the teacher carries on', async () => {
    const { svc, progress, sent, writes } = loadQuizDelivery([BLANK(501)]);
    expect(await progress.countActiveQuestions(MODULE)).toBe(0);
    await svc.startTrainingQuiz(USER, MODULE, PHONE);
    expect(writes.filter(w => w.table === 'training_assessment_attempts')).toHaveLength(0);
    expect(sent.join(' ')).toMatch(/no quick check/i);
  });

  test('a blank question beside real ones is left out of the paper and logged', async () => {
    const { svc, progress, writes, logToFile } = loadQuizDelivery([BLANK(501), MCQ(502), MCQ(503)]);
    expect(await progress.countActiveQuestions(MODULE)).toBe(2);
    await svc.startTrainingQuiz(USER, MODULE, PHONE);
    const attempt = writes.find(w => w.table === 'training_assessment_attempts');
    expect(attempt && attempt.payload.total_questions).toBe(2);
    const skipLog = logToFile.mock.calls.find(c => /blank stem/i.test(String(c[0])));
    expect(skipLog).toBeTruthy();
    expect(skipLog[1].questionIds).toEqual([501]);
  });
});

describe('the portal\'s papers, chosen by the bot over serve-paper', () => {
  function findRoute(r, method, p) {
    for (const layer of r.stack) {
      if (layer.route && (layer.route.methods || {})[method] && layer.route.path === p) return layer.route.stack.map(s => s.handle);
    }
    return null;
  }

  test('serve-paper never returns a blank-stem question, and logs it', async () => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = 'k';
    const logToFile = jest.fn();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile, logError: jest.fn() }));
    const router = require('../../bot/shared/routes/internal-api.routes');
    const stack = findRoute(router, 'post', '/training/serve-paper');
    let payload = null;
    const req = { headers: { 'x-api-key': 'k' }, body: { questions: [BLANK(1), MCQ(2), MCQ(3)], attemptId: 'att-9', isModuleQuiz: true, vendor: null } };
    const res = { status() { return this; }, json(b) { payload = b; return this; } };
    for (const h of stack) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { const m = h(req, res, resolve); if (m && m.then) m.then(resolve, resolve); });
      if (payload) break;
    }
    expect(payload.success).toBe(true);
    expect(payload.questions.map(q => q.id)).toEqual([2, 3]);
    expect(logToFile.mock.calls.some(c => /blank stem/i.test(String(c[0])))).toBe(true);
    delete process.env.INTERNAL_API_KEY;
  });
});

describe('the Beacon House written exam on WhatsApp', () => {
  test('loadCapstoneQuestions leaves a blank prompt out', async () => {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => makeSupabase([CRQ(1), CRQ(2, { question_text: '' }), CRQ(3)], []));
    const Capstone = require('../../bot/shared/services/training/capstone-delivery.service');
    const qs = await Capstone.loadCapstoneQuestions(77);
    expect(qs.map(q => q.id)).toEqual([1, 3]);
  });
});

describe('the portal routes apply the same rule (source level, as bd-60149 pins the module exam)', () => {
  const ROUTES = fs.readFileSync(path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
  function routeBody(decl) {
    const start = ROUTES.indexOf(decl);
    if (start === -1) return '';
    const next = ROUTES.indexOf('\nrouter.', start + decl.length);
    return ROUTES.slice(start, next === -1 ? ROUTES.length : next);
  }

  test('the portal loads the bot\'s rule, not a copy of it', () => {
    expect(ROUTES).toMatch(/require\('\.\.\/\.\.\/bot\/shared\/services\/training\/question-stem\.rules'\)/);
  });

  test.each([
    "router.get('/training/module/:id/questions'",
    "router.post('/training/module/:id/quiz-attempts'",
    "router.get('/training/level/:id/capstone/questions'",
    "router.post('/training/level/:id/capstone/attempts'",
  ])('%s serves only questions with a stem', (decl) => {
    const body = routeBody(decl);
    expect(body).not.toBe('');
    expect(body).toMatch(/servableQuestions\(/);
  });

  test.each([
    "router.get('/training/modules'",
    "router.get('/training/module/:id'",
    "router.post('/training/module/:id/complete'",
  ])('%s decides "has a quiz" on questions with a stem', (decl) => {
    const body = routeBody(decl);
    expect(body).not.toBe('');
    expect(body).toMatch(/servableQuestions\(|hasQuestionStem\(/);
  });
});
