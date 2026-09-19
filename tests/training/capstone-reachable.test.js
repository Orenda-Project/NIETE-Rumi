/**
 * bd-2472 / bd-2473 / bd-2474 — Beacon House levels can never be examined,
 * and finishing any course dead-ends.
 *
 * Reproduced live on a fresh account: seeded Beacon House English to 54/55,
 * passed the last module, and instead of the capstone got "Review · 1 of 11".
 * There are ZERO capstone attempts in the entire production database.
 *
 * Three defects in one completion path:
 *
 * bd-2472 — maybeOfferCapstone is called from exactly one place, inside the
 *   NO-QUIZ branch of handleModuleDone:
 *       if (quizQCount > 0) { startTrainingQuiz(...); return true; }   <-- exits
 *       await markModuleComplete(...); maybeOfferCapstone(...);        <-- unreachable
 *   Every BH module has a quiz, so completion happens later in gradeAttempt,
 *   which never calls it. A bd-2390 regression: when the quiz became the gate,
 *   completion forked and the capstone offer stayed on the branch BH never takes.
 *
 * bd-2473 — gradeAttempt ends with deliverNextModule(passedMod.course_id),
 *   which is COURSE-scoped. Finish a course and nothing is incomplete, so it
 *   falls into review mode and re-sends module 1. Affects NIETE too.
 *
 * bd-2474 — loadGrandQuizState filters quiz_type='grand_quiz'. BH rows are
 *   'capstone', so every BH level reports "No level exam" regardless.
 *
 * Contract:
 *   1. Completing a module runs the SAME post-step whether or not it had a
 *      quiz. One path, so the capstone offer cannot be stranded again.
 *   2. Finishing a course advances to the next course in the LEVEL.
 *   3. Finishing the LEVEL offers the exam — grand quiz or capstone — instead
 *      of re-delivering module 1.
 *   4. A level's exam is resolved by level, not by quiz_type, so BH stops
 *      reporting "No level exam".
 *   5. Review mode survives for deliberate re-watching; it just stops being
 *      where a teacher lands after passing.
 */

let ContentDelivery;
let QuizDelivery;
let Endpoint;
let tableStates;
let whatsappSend;
let whatsappButtons;
let capstoneOffer;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, isCount: false, orderCol: null, orderDir: null };
  const chain = {};
  const applyFilters = (rows) => {
    let out = rows;
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) out = out.filter(r => val.in.includes(r[col]));
      else if (!col.includes('.')) out = out.filter(r => r[col] === val);
    }
    return out;
  };
  const rowsNow = () => applyFilters(typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []));
  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const r = rowsNow();
    if (record.isCount) return { count: r.length, data: null, error: null };
    return { data: r[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let r = rowsNow();
    if (record.isCount) return { count: r.length, data: null, error: null };
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      r = [...r].sort((a, b) => (a[record.orderCol] < b[record.orderCol] ? -dir : a[record.orderCol] > b[record.orderCol] ? dir : 0));
    }
    return { data: r, error: null };
  };
  chain.select = jest.fn((_c, opts) => {
    if (opts && opts.count === 'exact' && opts.head === true) record.isCount = true;
    return chain;
  });
  chain.insert = jest.fn(() => chain);
  chain.update = jest.fn(() => chain);
  chain.upsert = jest.fn((payload) => {
    state._upserts = state._upserts || [];
    state._upserts.push(payload);
    // reflect the write so later reads in the same call see it
    if (tableName === 'teacher_training_progress' && payload && payload.module_id) {
      state.rows = [...(state.rows || []), { user_id: payload.user_id, module_id: payload.module_id }];
    }
    return chain;
  });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'not'].forEach(m => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => { record.orderCol = col; record.orderDir = opts && opts.ascending ? 'asc' : 'desc'; return chain; });
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.then = (res, rej) => Promise.resolve(finalizeMany()).then(res, rej);
  return chain;
}

const UID = 'user-1';
const PHONE = '923001234567';
const BH = 'v-bh';
const NIETE = 'v-niete';

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: jest.fn((t) => makeChain(t)), rpc: jest.fn(),
  }));
  whatsappSend = jest.fn().mockResolvedValue(true);
  whatsappButtons = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: whatsappSend,
    sendInteractiveButtons: whatsappButtons,
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
    sendDocumentByLink: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    getPresignedUrl: jest.fn().mockResolvedValue('https://r2/signed'),
  }));
  capstoneOffer = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/training/capstone-delivery.service', () => ({
    maybeOfferCapstone: capstoneOffer,
    handleCapstoneButton: jest.fn(),
    levelFullyComplete: jest.fn(),
  }));
  jest.doMock('../../bot/shared/services/training/certificate.service', () => ({
    issueCertificate: jest.fn().mockResolvedValue({ certificate_code: 'X', teacher_name: 'T', level_name: 'L' }),
    maybeIssueQuizScoreCertificate: jest.fn().mockResolvedValue({ issued: false }),
  }));
  ContentDelivery = require('../../bot/shared/services/training/content-delivery.service');
  QuizDelivery = require('../../bot/shared/services/training/quiz-delivery.service');
  Endpoint = require('../../bot/shared/routes/teacher-training-endpoint');
});

afterEach(() => jest.resetModules());

/**
 * A level with two courses. Course 1 has `c1` modules, course 2 has `c2`.
 * Module ids: course N module M -> N*100+M. Every module has `questions`.
 */
function seedLevel({
  levelId = 18, vendorKey = 'BEACONHOUSE', vendorId = BH, unlock = 'all_modules',
  quizType = 'capstone', c1 = 2, c2 = 2, done = [], questions = 1,
} = {}) {
  const courses = [
    { id: 1, level_id: levelId, title: 'Course One', order_index: 1, is_active: true },
    { id: 2, level_id: levelId, title: 'Course Two', order_index: 2, is_active: true },
  ];
  const modules = [];
  for (let m = 1; m <= c1; m++) modules.push({ id: 100 + m, course_id: 1, title: `M1.${m}`, order_index: m, is_active: true, video_url: 'v.mp4' });
  for (let m = 1; m <= c2; m++) modules.push({ id: 200 + m, course_id: 2, title: `M2.${m}`, order_index: m, is_active: true, video_url: 'v.mp4' });

  tableStates.training_levels = { rows: [{ id: levelId, name: 'English', order_index: 1, vendor_id: vendorId, is_active: true }] };
  tableStates.training_vendors = { rows: [{ id: vendorId, key: vendorKey, unlock_logic: unlock, passing_pct: 70, module_passing_pct: 70 }] };
  tableStates.training_courses = { rows: courses };
  tableStates.training_modules = { rows: modules };
  tableStates.teacher_training_progress = { rows: done.map(id => ({ user_id: UID, module_id: id })) };
  tableStates.teacher_training_assignments = { rows: [{ user_id: UID, program_id: 'p1', is_active: true }] };
  tableStates.training_program_scopes = { rows: [{ program_id: 'p1', vendor_id: vendorId, level_ids: null }] };
  tableStates.training_grand_quizzes = { rows: [{ id: 29, level_id: levelId, quiz_type: quizType, is_active: true }] };
  tableStates.training_questions = {
    rows: modules.flatMap(m => Array.from({ length: questions }, (_, i) => ({
      id: m.id * 10 + i, training_module_id: m.id, question_text: 'Q', options: ['a', 'b'],
      correct_option: '1', is_active: true, order_index: i,
    }))),
  };
  tableStates.training_assessment_attempts = { rows: [] };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.training_certificates = { rows: [] };
  return { courses, modules };
}

/** Drive a PASS of the module quiz, the way gradeAttempt is reached in production. */
async function passModuleQuiz(moduleId, levelId = 18) {
  tableStates.training_assessment_attempts = {
    rows: [{
      id: 'att-1', user_id: UID, quiz_kind: 'training_module', grand_quiz_id: null,
      training_module_id: moduleId, level_id: levelId, program_id: 'p1',
      total_questions: 1, status: 'in_progress',
    }],
  };
  // attempt_id matters: gradeAttempt filters answers by it, and without it the
  // fixture scores 0 and the PASS path never runs — tests then pass vacuously.
  tableStates.training_assessment_answers = { rows: [{ attempt_id: 'att-1', is_correct: true }] };
  return QuizDelivery.gradeAttempt('att-1', PHONE);
}

const said = () => whatsappSend.mock.calls.map(c => String(c[1])).join('\n');

describe('bd-2472 — the capstone offer must reach quizzed modules', () => {
  test('the reported bug: passing the LAST module of a BH level offers the capstone', async () => {
    seedLevel({ done: [101, 102, 201] });          // only 202 left

    await passModuleQuiz(202);

    expect(capstoneOffer).toHaveBeenCalled();
  });

  test('it is offered for a module WITH a quiz — the branch it could never reach', async () => {
    seedLevel({ done: [101, 102, 201], questions: 3 });

    await passModuleQuiz(202);

    expect(capstoneOffer).toHaveBeenCalledWith(UID, 202, PHONE);
  });

  test('a quiz-less module still offers it (the path that already worked)', async () => {
    seedLevel({ questions: 0, done: [101, 102, 201] });

    await ContentDelivery.handleModuleDone(UID, 202, PHONE);

    expect(capstoneOffer).toHaveBeenCalled();
  });

  test('the offer is delegated on EVERY completion — the service decides, not us', async () => {
    // Corrected from an earlier assertion that mid-level completion must not
    // call it. That encoded an assumption, not the design: maybeOfferCapstone
    // early-outs on vendor type, capstone existence, full completion and prior
    // passes, and the pre-existing no-quiz branch called it after every
    // completion for exactly that reason. Pre-filtering here would be a second
    // copy of "is this level finished" — the drift that caused bd-2472.
    seedLevel({ done: [] });

    await passModuleQuiz(101);   // first of four, mid-level

    expect(capstoneOffer).toHaveBeenCalledWith(UID, 101, PHONE);
  });
});

describe('bd-2473 — finishing a course advances, it does not loop', () => {
  test('the reported bug: finishing course 1 does NOT re-send module 1 of course 1', async () => {
    seedLevel({ done: [101] });

    await passModuleQuiz(102);                      // last module of course 1

    expect(said()).not.toMatch(/Review/i);
    expect(said()).not.toMatch(/M1\.1/);
  });

  test('finishing course 1 delivers the first module of course 2', async () => {
    seedLevel({ done: [101] });

    await passModuleQuiz(102);

    const everything = [said(), ...whatsappButtons.mock.calls.map(c => String(c[1]?.body || ''))].join('\n');
    expect(everything).toMatch(/M2\.1/);
  });

  test('mid-course still advances to the next module in the same course', async () => {
    seedLevel({ c1: 3, done: [] });

    await passModuleQuiz(101);

    const everything = [said(), ...whatsappButtons.mock.calls.map(c => String(c[1]?.body || ''))].join('\n');
    expect(everything).toMatch(/M1\.2/);
  });

  test('finishing the LEVEL does not re-deliver module 1 either', async () => {
    seedLevel({ done: [101, 102, 201] });

    await passModuleQuiz(202);

    expect(said()).not.toMatch(/M1\.1/);
  });
});

describe('bd-2474 — a Beacon House level has an exam', () => {
  test('the reported bug: a capstone level no longer reports "No level exam"', async () => {
    seedLevel({ quizType: 'capstone', done: [101, 102, 201, 202] });

    const gate = await Endpoint.loadGrandQuizState(UID, 18);

    expect(JSON.stringify(gate)).not.toMatch(/No level exam/i);
  });

  test('a completed capstone level offers a startable exam', async () => {
    seedLevel({ quizType: 'capstone', done: [101, 102, 201, 202] });

    const gate = await Endpoint.loadGrandQuizState(UID, 18);

    expect(String(gate.cta).trim()).not.toBe('');
    expect(String(gate.cta)).not.toMatch(/locked/i);
  });

  test('an INCOMPLETE capstone level is still locked', async () => {
    seedLevel({ quizType: 'capstone', done: [101] });

    const gate = await Endpoint.loadGrandQuizState(UID, 18);

    expect(String(gate.cta)).toMatch(/locked/i);
  });

  test('grand-quiz levels are unaffected', async () => {
    seedLevel({
      levelId: 3, vendorKey: 'TALEEMABAD', vendorId: NIETE, unlock: 'chain',
      quizType: 'grand_quiz', done: [101, 102, 201, 202],
    });

    const gate = await Endpoint.loadGrandQuizState(UID, 3);

    expect(JSON.stringify(gate)).not.toMatch(/No level exam/i);
    expect(String(gate.cta)).toMatch(/start exam/i);
  });

  /**
   * bd-2503 — this used to assert the literal copy "no level exam" on a level
   * where every module was already done. That copy was the bug: it sat under
   * "7/7 modules done · 100%" and told a finished teacher to finish.
   *
   * The intent — never imply an exam that does not exist — is what matters and
   * is asserted directly below. The unfinished case still gets the original
   * wording; that is pinned in tests/training/no-exam-level-completes.test.js.
   */
  test('a level with genuinely no exam row never claims one', async () => {
    seedLevel({ done: [101, 102, 201, 202] });   // every module complete
    tableStates.training_grand_quizzes = { rows: [] };

    const gate = await Endpoint.loadGrandQuizState(UID, 18);

    expect(JSON.stringify(gate)).not.toMatch(/grand quiz|start exam|take exam/i);
    expect(String(gate.body)).toMatch(/level complete/i);
  });

  test('an UNFINISHED level with no exam row shows NOTHING, not an explanation', async () => {
    seedLevel({ done: [101] });                  // partial
    tableStates.training_grand_quizzes = { rows: [] };

    const gate = await Endpoint.loadGrandQuizState(UID, 18);

    // bd-60130 — this used to assert /no level exam/. The operator's call:
    // a vendor that assesses per module has no LEVEL exam, and announcing its
    // absence reads to a teacher as something broken. The slot now renders
    // blank, and the fields must still EXIST because the Flow declares them.
    expect(gate.body.trim()).toBe('');
    expect(gate.caption.trim()).toBe('');
    expect(gate.cta.trim()).toBe('');
    expect(JSON.stringify(gate)).not.toMatch(/no level exam/i);
  });
});

describe('bd-2476 — /training Start exam reaches a capstone', () => {
  test('the reported bug: a capstone level no longer answers "No grand quiz configured"', async () => {
    // Confirmed in production: "❌ Grand quiz lookup failed levelId=18".
    // bd-2474 widened the display lookups; startGrandQuiz's own was missed, so
    // the Flow offered an exam it then refused to start.
    seedLevel({ quizType: 'capstone', done: [101, 102, 201, 202] });
    const Capstone = require('../../bot/shared/services/training/capstone-delivery.service');
    Capstone.handleCapstoneButton = jest.fn().mockResolvedValue(true);

    await QuizDelivery.startGrandQuiz(UID, 2, PHONE);   // level 18 is order_index 1

    expect(said()).not.toMatch(/No grand quiz configured/i);
  });

  test('it delegates to the capstone starter rather than reimplementing it', async () => {
    seedLevel({ quizType: 'capstone', done: [101, 102, 201, 202] });
    const Capstone = require('../../bot/shared/services/training/capstone-delivery.service');

    await QuizDelivery.startGrandQuiz(UID, 2, PHONE);

    expect(Capstone.handleCapstoneButton).toHaveBeenCalledWith(UID, 'capstone_start_18', PHONE);
  });
});

describe('bd-2477 — the schema permits a capstone attempt row', () => {
  // The real defect was in the DATABASE, not the code: the kind_target CHECK
  // constraint listed only 'grand' and 'training_module', so Postgres rejected
  // every capstone insert. Zero attempts existed across 17,656 rows.
  //
  // A mocked supabase client cannot enforce a CHECK, so this asserts the
  // canonical schema instead. Weaker than exercising the real constraint, but
  // it is the thing that was missing — and it would have caught this.
  const fs = require('fs');
  const path = require('path');
  const schema = () => fs.readFileSync(
    path.resolve(__dirname, '../../infrastructure/supabase/00_complete-schema.sql'), 'utf8');

  test('the kind_target constraint has a capstone branch', () => {
    const block = schema().slice(schema().indexOf('training_assessment_attempts_kind_target_ck'));
    expect(block.slice(0, 1400)).toMatch(/quiz_kind = 'capstone'/);
  });

  test('the capstone branch requires grand_quiz_id and forbids a module', () => {
    // Matches what capstone-delivery actually inserts: the capstone lives in
    // training_grand_quizzes, so it carries grand_quiz_id and no module.
    const block = schema().slice(schema().indexOf('training_assessment_attempts_kind_target_ck'));
    expect(block.slice(0, 1400)).toMatch(
      /quiz_kind = 'capstone'\s+AND grand_quiz_id IS NOT NULL AND training_module_id IS NULL/);
  });

  test('the two pre-existing branches are untouched', () => {
    const block = schema().slice(schema().indexOf('training_assessment_attempts_kind_target_ck'));
    expect(block.slice(0, 1400)).toMatch(/quiz_kind = 'grand'/);
    expect(block.slice(0, 1400)).toMatch(/quiz_kind = 'training_module'/);
  });
});

describe('bd-2478 — a written capstone answer can be stored and is scored honestly', () => {
  const fs = require('fs');
  const path = require('path');
  const schema = () => fs.readFileSync(
    path.resolve(__dirname, '../../infrastructure/supabase/00_complete-schema.sql'), 'utf8');
  const answersTable = () => {
    const s = schema();
    const i = s.indexOf('CREATE TABLE IF NOT EXISTS training_assessment_answers');
    return s.slice(i, s.indexOf(');', i));
  };

  test('the MCQ-only columns are nullable', () => {
    // is_correct NOT NULL rejected every capstone answer ever written: a free
    // text answer graded 0-5 has no binary correctness, so the service sends
    // null. The first real attempt scored 2/40 with zero rows persisted.
    expect(answersTable()).toMatch(/chosen_option\s+VARCHAR\(32\),/);
    expect(answersTable()).toMatch(/is_correct\s+BOOLEAN,/);
  });

  test('the written-answer columns exist in the canonical schema', () => {
    // These were added to prod by 2026-07-21-capstone-import.sql and never
    // folded back, so a fresh bootstrap had nowhere to store a capstone answer.
    const t = answersTable();
    expect(t).toMatch(/answer_text\s+TEXT/);
    expect(t).toMatch(/answer_score\s+SMALLINT/);
    expect(t).toMatch(/feedback_text\s+TEXT/);
  });

  test('the answer upsert checks its error instead of discarding it', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../bot/shared/services/training/capstone-delivery.service.js'), 'utf8');
    expect(src).toMatch(/const \{ error: answerErr \} = await supabase\.from\('training_assessment_answers'\)/);
    expect(src).toMatch(/if \(answerErr\)/);
  });

  test('finalize refuses to score a partial answer set', () => {
    // The bug was not just the failed write — it was scoring anyway. The
    // lastScore fallback turned eight missing rows into a 2/40.
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../bot/shared/services/training/capstone-delivery.service.js'), 'utf8');
    expect(src).toMatch(/byIdx\.size < attempt\.total_questions/);
    expect(src).toMatch(/refusing to score/);
  });
});
