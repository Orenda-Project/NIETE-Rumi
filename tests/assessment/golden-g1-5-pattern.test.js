/**
 * Goldens for the board-pattern path, grades 1-5, as prod serves it today (captured at 820045b41).
 *
 * For every registered pattern and every subject it holds: the teacher's create call goes through
 * the real route, the queued job through the real buildPaper (per-section writer, layout, scheme,
 * checkers, both renderers). Only the edges are faked (helpers/golden-g1-5.js). Pinned per cell:
 *
 *   prompts   every message handed to the model, in call order, with model and max_tokens
 *   layout    the stored exam_json._layout
 *   paper     the paper HTML handed to the PDF engine, and its pdfOptions
 *   scheme    the marking-scheme HTML handed to the PDF engine, and its pdfOptions
 *   outcome   what buildPaper returned, and the stored row's status and marks
 *
 * The model replays a recorded reply (helpers RECORDINGS). A cell with no recording gets an empty
 * reply: its golden pins the prompts and the failure path, and its file name says `norec`.
 *
 * Each cell runs twice: with assessment_grades_6_12 absent, and with it true and no G6-12 rows.
 * Both runs must equal the same files (captured with the flag absent): the G6-12 flag must not
 * move one byte of a G1-5 paper. Goldens are add-only: a red here is a regression, not a re-capture.
 */
require('./helpers/skip-giveaway-check'); // recorded replies hold real give-aways (bd-5jmnfj.4.51.3)
const H = require('./helpers/golden-g1-5');

const KEY = 'golden-g1-5-key';
const Patterns = require('../../bot/shared/services/assessment/patterns');

let state;
function load() {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => H.fakeDb(state));
  jest.doMock('../../bot/shared/services/queue', () => ({ queueJob: async (...a) => { state.queued.push(a); return { messageId: 'm' }; } }));
  jest.doMock('../../bot/shared/services/assessment/assessment-browse.service', () => ({
    bookFor: async () => ({ id: 'book-golden' }), listChapters: async () => [],
  }));
  jest.doMock('../../bot/shared/services/assessment/book-content.service', () => ({
    loadPageRangeContent: async ({ pageRanges }) => ({
      content: `=== Page 30 ===\nBook text for ${pageRanges}.`, pageReference: pageRanges, chapterTitle: null,
    }),
    loadChapterContent: async () => ({ content: 'Book text.', pageReference: '1-2', chapterTitle: null }),
  }));
  jest.doMock('../../bot/shared/services/llm-client', () => ({
    getClient: () => ({ chat: { completions: { create: async (req) => {
      state.calls.push({ model: req.model, max_tokens: req.max_tokens, messages: req.messages });
      return H.replayReply(state.rec, req.messages.map((m) => m.content).join('\n'), state.oral);
    } } } }),
  }));
  jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({
    htmlToPdf: async (html, opts) => { state.pdfs.push({ html, opts }); return H.fakePdf(state.pdfs.length === 1 ? 4 : 5); },
  }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    uploadExamBuffer: async ({ filename }) => { state.uploads.push(filename); return `exams/u1/${filename}`; },
    buildR2PublicUrl: (k) => k,
    // Every picture is already in the store, so none is drawn (no image model, no sharp): the paper links it.
    headObject: async () => ({ exists: true }),
    downloadFromR2: async () => Buffer.from('fake-jpeg'),
    uploadBuffer: async () => null,
  }));
  // Root jest has no sharp. The stored picture is read once to check it has no frame: a white 8x8 has none.
  jest.doMock('sharp', () => () => {
    const chain = { grayscale: () => chain, raw: () => chain, resize: () => chain, jpeg: () => chain,
      toBuffer: async () => ({ data: Buffer.alloc(64, 255), info: { width: 8, height: 8 } }) };
    return chain;
  }, { virtual: true });
  return {
    router: require('../../bot/shared/routes/internal-api.routes'),
    Orchestrator: require('../../bot/shared/services/assessment/assessment-orchestrator.service'),
  };
}

// The clock is frozen (Date only; timers stay real so the generator's awaits still run): layout and
// row stamps would otherwise differ on every run.
const REAL_TIMERS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'nextTick', 'queueMicrotask', 'hrtime', 'performance'];
beforeAll(() => jest.useFakeTimers({ doNotFake: REAL_TIMERS, now: new Date('2026-11-01T05:00:00.000Z') }));
afterAll(() => jest.useRealTimers());

const CELLS = [];
Patterns.list().forEach((id) => Object.keys(Patterns.get(id).subjects).forEach((s) => CELLS.push([id, s])));
const FLAG_STATES = [['absent', {}], ['true-no-g612-rows', { assessment_grades_6_12: true }]];

describe.each(FLAG_STATES)('assessment_grades_6_12 %s', (_flagName, g612) => {
  test.each(CELLS)('%s %s', async (id, subject) => {
    const P = Patterns.get(id);
    const cell = `${id}.${subject}`;
    state = { rec: H.recording(cell), oral: P.subjects[subject].oral || null, rows: {}, seq: 0, settings: { assessment_fde_pattern_enabled: true, ...g612 },
      queued: [], calls: [], pdfs: [], uploads: [], updates: [] };
    const { router, Orchestrator } = load();
    // A whole-book or FDE-syllabus pattern takes scope 'fde'; a chosen-chapter pattern (G3-4) takes the pages she picked.
    const wholeBook = Boolean(P.subjects[subject].scope && P.subjects[subject].scope.page_ranges);
    const body = { userId: 'u-golden-1', grade: P.grade, subject, pattern: id, ...(wholeBook ? { scope: 'fde' } : { pageRanges: '30-34' }) };
    const made = await H.callRoute(router, '/assessment/create', body, KEY);
    let outcome = null;
    if (state.queued.length) {
      const [, jobType, job] = state.queued[0];
      try { outcome = await Orchestrator.buildPaper(job, {}); } catch (e) { outcome = { threw: e.message }; }
      outcome = { jobType, job, returned: outcome };
    }
    const row = (state.rows.assessment_papers || [])[0] || null;
    const source = `${state.rec ? 'replay' : 'norec'}${state.oral ? '-oralfix' : ''}`;
    const base = `pattern/g${P.grade}.${subject}.${id}.${source}.g612-absent`;
    H.golden(`${base}.prompts.json`, H.json(state.calls));
    H.golden(`${base}.outcome.json`, H.json({ create: made, outcome, uploads: state.uploads,
      row: row && { status: row.status, total_marks: row.total_marks, error: row.error || null } }));
    H.golden(`${base}.layout.json`, H.json(row && row.exam_json ? row.exam_json._layout || null : null));
    H.golden(`${base}.pdf-inputs.json`, H.digests(H.json(state.pdfs.map((p) => p.opts))));
    state.pdfs.forEach((p, i) => H.golden(`${base}.${i === 0 ? 'paper' : 'scheme'}.html`, H.digests(p.html)));
  });
});
