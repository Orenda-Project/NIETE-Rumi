/**
 * bd-2446 — the module CTA must describe what the tap actually does.
 *
 * bd-2390 turned the module quick-check into a GATE: tapping the module
 * button on a module WITH active questions sends the quiz and delivers no
 * video, and the next module is released only after the teacher passes
 * (quiz-delivery.gradeAttempt). None of the copy was updated for that, so
 * teachers saw a button labelled "▶ Next video" that sent a quiz, sitting
 * under a caption telling them to tap "✓ Done" — a button that has not
 * existed since before bd-2390.
 *
 * The contract this file locks:
 *   1. Module WITH active questions   → the button says "Take quiz".
 *   2. Module WITHOUT active questions → the button still says "Next video"
 *      (that tap genuinely does advance — see bd-2390's no-quiz path).
 *   3. Captions name the button that is actually rendered — never "✓ Done".
 *   4. PDF modules say read/reading, not watch/watching.
 *   5. The quiz intro does not claim progress is unblocked; it quotes the
 *      vendor's real module bar, the one gradeAttempt marks against.
 *
 * Both delivery entry points are covered: deliverNextModule (course start,
 * and the post-pass advance) and deliverModuleById (the Flow module-picker).
 */

let ContentDelivery;
let QuizDelivery;
let supabaseFrom;
let whatsappSend;
let whatsappButtons;
let whatsappDocument;
let whatsappInteractive;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, isCount: false, mutation: null };

  const chain = {};
  const track = () => {
    if (record.mutation && !record._tracked) {
      state._mutations = state._mutations || [];
      state._mutations.push(record.mutation);
      record._tracked = true;
    }
  };
  const resolveCount = () =>
    typeof state.count === 'function' ? state.count(record.filters) : (state.count ?? 0);
  const resolveRows = () =>
    typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
  const finalize = () => {
    track();
    if (record.isCount) return { count: resolveCount(), data: null, error: null };
    if (state.error) return { data: null, error: state.error };
    return { data: resolveRows()[0] || null, error: null };
  };
  const finalizeMany = () => {
    track();
    if (record.isCount) return { count: resolveCount(), data: null, error: null };
    if (state.error) return { data: null, error: state.error };
    return { data: resolveRows(), error: null };
  };

  chain.select = jest.fn((_cols, opts) => {
    if (opts && opts.count === 'exact' && opts.head === true) record.isCount = true;
    return chain;
  });
  chain.insert = jest.fn((payload) => { record.mutation = { op: 'insert', payload }; return chain; });
  chain.update = jest.fn((payload) => { record.mutation = { op: 'update', payload }; return chain; });
  chain.upsert = jest.fn((payload, opts) => { record.mutation = { op: 'upsert', payload, opts }; return chain; });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'contains'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.filter = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.single = jest.fn(async () => finalize());
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers({ doNotFake: ['nextTick'] });
  tableStates = {};

  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(),
    getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));

  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: supabaseFrom,
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));

  whatsappSend = jest.fn().mockResolvedValue(true);
  whatsappButtons = jest.fn().mockResolvedValue(true);
  whatsappDocument = jest.fn().mockResolvedValue(true);
  whatsappInteractive = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: whatsappSend,
    sendInteractiveMessage: whatsappInteractive,
    sendInteractiveButtons: whatsappButtons,
    sendDocumentByLink: whatsappDocument,
  }));

  jest.doMock('../../bot/shared/storage/r2', () => ({
    getPresignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed'),
  }));

  ContentDelivery = require('../../bot/shared/services/training/content-delivery.service');
  QuizDelivery = require('../../bot/shared/services/training/quiz-delivery.service');
});

afterEach(() => {
  jest.useRealTimers();
  jest.resetModules();
});

const USER = 'user-uuid-1';
const PHONE = '923001234567';
const MODULE_ID = 42;
const COURSE_ID = 7;

/**
 * @param {object} opts
 * @param {number} opts.questions how many active questions the module has
 * @param {'video'|'pdf'|'none'} opts.asset what the module ships
 */
function setupCatalog({ questions = 0, asset = 'video' } = {}) {
  const module = {
    id: MODULE_ID,
    course_id: COURSE_ID,
    title: 'Questioning Techniques',
    order_index: 1,
    video_url: asset === 'video' ? 'training/mod-42.mp4' : null,
    audio_url: null,
    source_media_url: asset === 'pdf' ? 'https://assets.example.com/mod-42.pdf' : null,
  };
  tableStates.training_modules = { rows: [module] };
  tableStates.training_courses = { rows: [{ id: COURSE_ID, level_id: 3, title: 'Effective Teaching' }] };
  tableStates.training_levels = { rows: [{ id: 3, name: 'Level 1', order_index: 0, vendor_id: 'vendor-1' }] };
  tableStates.training_vendors = {
    rows: [{ id: 'vendor-1', key: 'TALEEMABAD', module_passing_pct: 100, passing_pct: 80, unlock_logic: 'chain' }],
  };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.teacher_training_assignments = { rows: [{ program_id: 'program-uuid-1' }] };
  // The attempts table is read three ways in one startTrainingQuiz call, and
  // the status has to differ between them: the "previous attempt" lookup
  // (filtered by user_id) must NOT be in_progress or the quiz resumes instead
  // of starting, while the freshly-inserted row that sendQuestion then reads
  // back (filtered by id, or unfiltered on the insert's .select()) must be.
  const attempt = {
    id: 'attempt-uuid-1', user_id: USER, quiz_kind: 'training_module',
    grand_quiz_id: null, training_module_id: MODULE_ID, level_id: 3,
    program_id: 'program-uuid-1', current_question_index: 0,
    total_questions: questions,
  };
  tableStates.training_assessment_attempts = {
    rows: (filters) => [{ ...attempt, status: filters.user_id ? 'passed' : 'in_progress' }],
  };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.training_questions = {
    count: questions,
    rows: Array.from({ length: questions }, (_, i) => ({
      id: 100 + i, training_module_id: MODULE_ID, question_text: `Q${i + 1}`,
      options: ['A', 'B', 'C', 'D'], correct_option: '1', is_active: true, order_index: i,
    })),
  };
}

/** Run a delivery that awaits the anti-race setTimeout, with timers faked. */
async function runDelivery(promiseFactory) {
  const p = promiseFactory();
  await jest.advanceTimersByTimeAsync(2000);
  return p;
}

/** Every button title rendered across all sendInteractiveButtons calls. */
function buttonTitles() {
  return whatsappButtons.mock.calls.flatMap(c => (c[1]?.buttons || []).map(b => String(b.title)));
}

/** Every button body rendered. */
function buttonBodies() {
  return whatsappButtons.mock.calls.map(c => String(c[1]?.body || ''));
}

/**
 * Everything the teacher READS, whatever bubble it arrived in.
 *
 * This used to be the plain-text sends only. Since bd-w2daa.8 the module card
 * rides in the body of its own buttons message, a PDF module's card is the
 * document's caption, and the module-check intro opens Q1's list body — the
 * same words, fewer bubbles. These tests are about the COPY, so they read all
 * of it: text, button bodies, list bodies and document captions.
 */
function saidText() {
  return [
    ...whatsappSend.mock.calls.map(c => String(c[1])),
    ...buttonBodies(),
    ...whatsappInteractive.mock.calls.map(c => String(c[1]?.body?.text || c[1]?.body || '')),
    ...whatsappDocument.mock.calls.map(c => String(c[3] || '')),
  ].join('\n');
}

describe('bd-2446 — the module button names the action it performs', () => {
  test('deliverNextModule: a module WITH a quiz offers "Take quiz", not "Next video"', async () => {
    setupCatalog({ questions: 5 });

    await runDelivery(() => ContentDelivery.deliverNextModule(USER, COURSE_ID, PHONE));

    const titles = buttonTitles();
    expect(titles.some(t => /take quiz/i.test(t))).toBe(true);
    expect(titles.some(t => /next video/i.test(t))).toBe(false);
  });

  test('deliverNextModule: a module with NO quiz keeps "Next video" (that tap really does advance)', async () => {
    setupCatalog({ questions: 0 });

    await runDelivery(() => ContentDelivery.deliverNextModule(USER, COURSE_ID, PHONE));

    const titles = buttonTitles();
    expect(titles.some(t => /next video/i.test(t))).toBe(true);
    expect(titles.some(t => /take quiz/i.test(t))).toBe(false);
  });

  test('deliverModuleById: a module WITH a quiz offers "Take quiz", not "Next video"', async () => {
    setupCatalog({ questions: 5 });

    await runDelivery(() => ContentDelivery.deliverModuleById(MODULE_ID, PHONE, { userId: USER }));

    const titles = buttonTitles();
    expect(titles.some(t => /take quiz/i.test(t))).toBe(true);
    expect(titles.some(t => /next video/i.test(t))).toBe(false);
  });

  test('deliverModuleById: a module with NO quiz keeps "Next video"', async () => {
    setupCatalog({ questions: 0 });

    await runDelivery(() => ContentDelivery.deliverModuleById(MODULE_ID, PHONE, { userId: USER }));

    const titles = buttonTitles();
    expect(titles.some(t => /next video/i.test(t))).toBe(true);
    expect(titles.some(t => /take quiz/i.test(t))).toBe(false);
  });

  test('a module WITH a quiz never renders a button the tap does not honour', async () => {
    // Guards the whole class: whatever the caption or button says, it must
    // not promise a video when the tap opens a quiz.
    setupCatalog({ questions: 5 });

    await runDelivery(() => ContentDelivery.deliverNextModule(USER, COURSE_ID, PHONE));

    const everything = [...buttonTitles(), ...buttonBodies(), saidText()].join('\n');
    expect(everything).not.toMatch(/next video/i);
  });
});

describe('bd-2446 — captions name the button that is actually rendered', () => {
  test('no caption tells the teacher to tap "✓ Done" (no such button exists)', async () => {
    setupCatalog({ questions: 0 });

    await runDelivery(() => ContentDelivery.deliverNextModule(USER, COURSE_ID, PHONE));

    expect(saidText()).not.toMatch(/✓ Done/);
  });

  test('deliverModuleById captions do not tell the teacher to tap "✓ Done" either', async () => {
    setupCatalog({ questions: 0 });

    await runDelivery(() => ContentDelivery.deliverModuleById(MODULE_ID, PHONE, { userId: USER }));

    expect(saidText()).not.toMatch(/✓ Done/);
  });

  test('a quizzed module tells the teacher passing unlocks the next module', async () => {
    setupCatalog({ questions: 5 });

    await runDelivery(() => ContentDelivery.deliverNextModule(USER, COURSE_ID, PHONE));

    expect(saidText()).toMatch(/unlocks the next module/i);
  });
});

describe('bd-2446 — PDF modules say read, not watch', () => {
  test('the caption for a PDF module does not say "Watch the video"', async () => {
    setupCatalog({ questions: 0, asset: 'pdf' });

    await runDelivery(() => ContentDelivery.deliverNextModule(USER, COURSE_ID, PHONE));

    expect(saidText()).not.toMatch(/watch the video/i);
    expect(saidText()).toMatch(/read the pdf/i);
  });

  test('the button body for a PDF module asks about reading, not watching', async () => {
    setupCatalog({ questions: 0, asset: 'pdf' });

    await runDelivery(() => ContentDelivery.deliverNextModule(USER, COURSE_ID, PHONE));

    const bodies = buttonBodies().join('\n');
    expect(bodies).not.toMatch(/finished watching/i);
    expect(bodies).toMatch(/finished reading/i);
  });

  test('an unquizzed PDF module offers "Next module", never "Next video"', async () => {
    // The Beacon House corpus is 155 PDFs — nothing a teacher taps there
    // produces a video, so the label must not promise one.
    setupCatalog({ questions: 0, asset: 'pdf' });

    await runDelivery(() => ContentDelivery.deliverNextModule(USER, COURSE_ID, PHONE));

    const titles = buttonTitles();
    expect(titles.some(t => /next module/i.test(t))).toBe(true);
    expect(titles.some(t => /next video/i.test(t))).toBe(false);
  });

  test('deliverModuleById renders the same read-not-watch copy for a PDF', async () => {
    setupCatalog({ questions: 0, asset: 'pdf' });

    await runDelivery(() => ContentDelivery.deliverModuleById(MODULE_ID, PHONE, { userId: USER }));

    const everything = [saidText(), ...buttonBodies()].join('\n');
    expect(everything).not.toMatch(/watch/i);
    expect(everything).toMatch(/read the pdf/i);
  });
});

describe('bd-2446 — the quiz intro tells the truth about the gate', () => {
  test('the intro does not claim progress is unblocked', async () => {
    setupCatalog({ questions: 3 });

    await QuizDelivery.startTrainingQuiz(USER, MODULE_ID, PHONE);

    expect(saidText()).not.toMatch(/isn't blocked|is not blocked|either way/i);
  });

  test('the intro quotes the vendor module bar that gradeAttempt marks against', async () => {
    setupCatalog({ questions: 3 }); // TALEEMABAD module_passing_pct = 100

    await QuizDelivery.startTrainingQuiz(USER, MODULE_ID, PHONE);

    expect(saidText()).toMatch(/100%/);
  });

  test('the per-question footer quotes the bar instead of "Self-check"', async () => {
    setupCatalog({ questions: 3 });

    await QuizDelivery.startTrainingQuiz(USER, MODULE_ID, PHONE);

    const footers = whatsappInteractive.mock.calls.map(c => String(c[1]?.footer?.text || '')).join('\n');
    expect(footers).not.toMatch(/self-check/i);
    expect(footers).toMatch(/100% required/i);
  });
});
