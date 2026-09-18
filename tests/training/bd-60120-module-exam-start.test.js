/**
 * bd-60120 — starting a module exam, and not breaking the level one.
 *
 * `startGrandQuiz` resolves a level's exam with `.maybeSingle()`, which THROWS
 * on more than one row. I-SAPS now has 18 per-module quizzes on one level
 * (bd-60119), so that lookup has to exclude the per-module range — otherwise
 * every I-SAPS exam start dies, and so does the level-exam path it shares with
 * Beacon House and Taleemabad.
 *
 * `startModuleExam` is the new entry point: it takes a course, resolves that
 * module's own quizzes, and runs the SAME preconditions the level exam does.
 * The gate is the point. bd-2452/2453 hardened the level exam after a teacher
 * sat one at 38/40 modules and minted a duplicate certificate, because every
 * CTA in this Flow is a tappable link with no disabled state. A module exam
 * gets the same treatment: unfinished units, an already-passed module and an
 * active cooldown all refuse.
 */

const {
  isPerModuleQuiz,
  PER_MODULE_SOURCE_BASE,
} = require('../../bot/shared/services/training/isaps-module-exam.rules');

describe('bd-60120 — the level-exam lookup must skip per-module quizzes', () => {
  test('a level exam is a NULL or legacy source id; a module exam is 900+', () => {
    // This is the predicate the level lookup filters on. If it ever returns
    // true for a legacy id, Taleemabad and Beacon House lose their exams; if it
    // returns false for 901+, .maybeSingle() sees 18 rows and throws.
    expect(isPerModuleQuiz(null)).toBe(false);          // level exam
    expect(isPerModuleQuiz(4)).toBe(false);             // Taleemabad
    expect(isPerModuleQuiz(11)).toBe(false);            // Beacon House
    expect(isPerModuleQuiz(PER_MODULE_SOURCE_BASE)).toBe(false);      // boundary
    expect(isPerModuleQuiz(PER_MODULE_SOURCE_BASE + 1)).toBe(true);   // module 1
    expect(isPerModuleQuiz(PER_MODULE_SOURCE_BASE + 9)).toBe(true);   // module 9
  });
});

describe('bd-60120 — startModuleExam preconditions', () => {
  let svc;
  let sent;
  let rows;

  /** A chainable supabase stub whose terminal value comes from `rows`. */
  function table(name) {
    const q = {
      _t: name, _f: {},
      select() { return q; },
      eq(k, v) { q._f[k] = v; return q; },
      in(k, v) { q._f[k] = v; return q; },
      order() { return q; },
      limit() { return q; },
      maybeSingle() { return Promise.resolve({ data: rows(q._t, q._f, true) }); },
      single() { return Promise.resolve({ data: rows(q._t, q._f, true) }); },
      then(res) { return Promise.resolve({ data: rows(q._t, q._f, false) }).then(res); },
    };
    return q;
  }

  beforeEach(() => {
    jest.resetModules();
    sent = [];
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: table, rpc: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/utils/structured-logger', () => ({
      logEvent: jest.fn(), getCurrentCorrelationId: () => null,
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage: (to, text) => { sent.push(String(text)); return true; },
      sendInteractiveMessage: () => true,
      sendImageFromUrl: () => true,
    }));
    jest.doMock('../../bot/shared/services/llm-client', () => ({
      getClient: jest.fn(), getDefaultModel: () => 'test-model',
    }));
    jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
    jest.doMock('pdfkit', () => jest.fn(), { virtual: true });
    svc = require('../../bot/shared/services/training/quiz-delivery.service');
  });

  test('startModuleExam is exported — the Flow closure has something to call', () => {
    expect(typeof svc.startModuleExam).toBe('function');
  });

  test('an unknown course refuses and tells the teacher, rather than throwing', async () => {
    rows = () => null;
    const out = await svc.startModuleExam('user-1', 999, '923000000000');
    expect(out).toBe(false);
    expect(sent.join(' ')).toMatch(/could not|not available|support/i);
  });

  test('a module with no active questions refuses instead of opening an empty exam', async () => {
    rows = (t, f, single) => {
      if (t === 'training_courses') return { id: 11, title: 'Module 1 - X', level_id: 26 };
      if (t === 'training_grand_quizzes') return single ? null : [];
      if (t === 'training_questions') return [];
      return single ? null : [];
    };
    const out = await svc.startModuleExam('user-1', 11, '923000000000');
    expect(out).toBe(false);
    expect(sent.join(' ')).toMatch(/no exam|no active|support/i);
  });
});
