/**
 * A REUSED LESSON IS STILL A LESSON A TEACHER READS — bd-jpfww.
 *
 * `one_screen` is the WhatsApp body the teacher reads on her phone BEFORE the PDF arrives, and
 * since bd-uu4lr it has a SHAPE: six paragraphs, one per beat, each opening with a `*cue*`.
 * That rule lives in `lint_lp.js` gate 12b — and `lint_lp.js` is not on every road to a teacher.
 *
 * `lp612-author.worker.js` re-renders a STORED document when the template version moves
 * (`reuseFromPreviousVersion`), and that lane is the FIRST thing tried: it runs before
 * `authorLessonPlan`, so no author brief, no lint ladder and no gate ever sees the document. The
 * row it writes records the truth of that — `lint_clean: null`, "we did not look".
 *
 * The shape rule landed on 2026-09-12 (23a8746d), AFTER v9.3. So every document stored at v9.3 or
 * earlier is one unbroken 200-word paragraph, and the v9.6 bump walked the whole lineage back to
 * them and re-rendered them into v9.6 rows. The operator's report, from prod: *"the whatsapp text
 * message wasnt formatted"*.
 *
 * What is pinned here:
 *
 *   • a stored document whose `one_screen` has no shape is REFUSED for reuse and falls through to
 *     authoring — `reuseFromPreviousVersion`'s own contract is to look for a document "under the
 *     versions this renderer is known to accept", and a pre-shape body is not one;
 *   • the refusal is MEASURED, not silent, so the cost of it is knowable (rule 24(b));
 *   • a stored document that DOES carry the shape is still reused with zero LLM calls — the
 *     saving this whole lane exists for is not thrown away to fix the grey wall;
 *   • the worker and the linter share ONE implementation of the rule, so they cannot drift.
 */

const mockAuthorLessonPlan = jest.fn();
const mockOverlayLessonPlan = jest.fn();
const mockRenderLessonPlan = jest.fn();
const mockUploadBuffer = jest.fn();
const mockDownloadFromR2 = jest.fn();
const mockDeliverRender = jest.fn();
const mockReadFile = jest.fn();
const mockLogEvent = jest.fn();

jest.mock('../../bot/shared/services/lp612-author.service', () => ({
  authorLessonPlan: (...a) => mockAuthorLessonPlan(...a),
  overlayLessonPlan: (...a) => mockOverlayLessonPlan(...a),
}));
jest.mock('../../bot/shared/services/lp612-render.service', () => ({
  renderLessonPlan: (...a) => mockRenderLessonPlan(...a),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: (...a) => mockUploadBuffer(...a),
  downloadFromR2: (...a) => mockDownloadFromR2(...a),
}));
// The serving service is the REAL one apart from the send: `readStoredDoc` is on the path under
// test, and a double for it would make this suite pass while production still reused a grey wall.
jest.mock('../../bot/shared/services/lp612-serving.service', () => {
  const real = jest.requireActual('../../bot/shared/services/lp612-serving.service');
  return { ...real, deliverRender: (...a) => mockDeliverRender(...a) };
});
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: (...a) => mockLogEvent(...a) }));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: { ...jest.requireActual('fs').promises, readFile: (...a) => mockReadFile(...a) },
}));

const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null, filters: [] };
  const settle = () => {
    mockDbCalls.push({ ...state });
    if (state.op === 'update') {
      const idFilter = state.filters.find((f) => f[0] === 'id');
      return Promise.resolve({ data: { id: idFilter ? idFilter[1] : 'row' }, error: null });
    }
    return Promise.resolve(mockDbResults.length ? mockDbResults.shift() : { data: null, error: null });
  };
  const b = {
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
const WAITERS = [{ user_id: 'u1', phone: '923001111111' }];
const mockRpc = jest.fn(() => Promise.resolve({ data: WAITERS, error: null }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)),
  rpc: (...a) => mockRpc(...a),
}));

const path = require('path');
const Worker = require('../../bot/workers/lp612-author.worker');
const { lint, oneScreenShapeDefects } = require(path.join(
  __dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'lint_lp.js',
));

const SEG_ID = 'grade_9_chemistry.c01.p007-008';

const JOB = {
  renderId: 'render-1',
  segmentId: SEG_ID,
  lang: 'en',
  templateVersion: 'v9.2',
  correlationId: 'corr-1',
};

const SEGMENT = {
  segment_id: SEG_ID,
  book_stem: 'grade_9_chemistry',
  grade: 9,
  subject: 'Chemistry',
  subtopic_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
  language: 'en',
  is_religious: false,
};

/** The shape, as bd-uu4lr defined it: one paragraph per beat, each opening with a `*cue*`. */
const SHAPED = [
  '*Objective* Students name the five branches of chemistry and give one example of each.',
  '*Warm-up* Ask what a chemist actually does all day; take three answers onto the board.',
  '*Worked example* Sort "rusting iron" together — physical or inorganic — and say why.',
  '*Practice* In pairs, sort six everyday examples into the branches, then swap and check.',
  '*Misconception* Organic does not mean natural. Name two organics made only in a lab.',
  '*Exit* Each student writes one branch and one example of it on a slip before leaving.',
].join('\n\n');

/** The same lesson as it was written BEFORE the shape rule existed: a grey wall. */
const GREY_WALL = 'Students name the five branches of chemistry and give one example of each. '
  + 'Ask what a chemist actually does all day and take three answers onto the board. Sort '
  + '"rusting iron" together and say why it belongs where it does. In pairs, students sort six '
  + 'everyday examples into the branches, then swap and check. Remind them that organic does not '
  + 'mean natural. Each student writes one branch and one example of it on a slip before leaving.';

const storedDoc = (oneScreen) => ({
  lesson_id: 'grade_9_chemistry.c01.p007-008',
  schema_version: '2.0',
  template_version: 'v9.1',
  one_screen: oneScreen,
  materials: ['blackboard'],
  objectives: ['name the branches'],
  sections: [{ id: 'introduction', minutes: 5, blocks: [] }],
  page2: { practice: [] },
});

function seed(seg = SEGMENT) {
  mockDbResults.push({ data: { id: 'render-1', status: 'authoring', waiters: WAITERS }, error: null });
  mockDbResults.push({ data: seg, error: null });
}

function r2Holding(map) {
  mockDownloadFromR2.mockImplementation(async (key) => {
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      return Buffer.from(map[key], 'utf8');
    }
    throw Object.assign(new Error(`NoSuchKey: ${key}`), { name: 'NoSuchKey' });
  });
}

const lastPatch = () => mockDbCalls.filter((c) => c.op === 'update').pop();
const eventsNamed = (name) => mockLogEvent.mock.calls.filter((c) => c[0] === name);

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  delete process.env.LP_612_TEMPLATE_FALLBACK;
  mockRpc.mockReset().mockImplementation(() => Promise.resolve({ data: WAITERS, error: null }));
  mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
  mockUploadBuffer.mockResolvedValue('ok');
  mockDownloadFromR2.mockRejectedValue(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
  mockAuthorLessonPlan.mockResolvedValue({
    lpDoc: { lesson_id: 'freshly-authored', one_screen: SHAPED, sections: [] },
    lintClean: true, fails: [], warns: [], rounds: 3,
    model: 'anthropic/claude-sonnet-5',
  });
  mockOverlayLessonPlan.mockResolvedValue({
    overlay: { '/one_screen': 'خلاصہ' }, coverage: 1, usage: { total_tokens: 1 },
  });
  mockRenderLessonPlan.mockResolvedValue({
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 9, warnings: [],
    pagesByPart: { teach: 5, support: 4 }, overlayApplied: ['/one_screen'],
  });
});

afterEach(() => {
  delete process.env.LP_612_TEMPLATE_FALLBACK;
  delete process.env.LP_612_TEMPLATE_VERSION;
});

// ── 1 · the bug: a pre-shape stored document must not be reused ──────────────

describe('a stored document whose one_screen has no shape is refused for reuse', () => {
  test('the lesson is authored instead, and no grey wall reaches the row', async () => {
    r2Holding({ [`lp612/v9.1/en/${SEG_ID}.lp.json`]: JSON.stringify(storedDoc(GREY_WALL)) });
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    // THE BUG. Today the stored document wins unconditionally and this is 0.
    expect(mockAuthorLessonPlan).toHaveBeenCalledTimes(1);
    expect(eventsNamed('lp612.render.reused').length).toBe(0);

    // The teacher's phone gets the authored body, which has the shape.
    expect(lastPatch().payload.one_screen).toBe(SHAPED);
    expect(lastPatch().payload.model_used).toBe('anthropic/claude-sonnet-5');
  });

  test('the refusal is measured — a saving given up silently is not knowable', async () => {
    r2Holding({ [`lp612/v9.1/en/${SEG_ID}.lp.json`]: JSON.stringify(storedDoc(GREY_WALL)) });
    seed();

    await Worker.process(JOB);

    const rejected = eventsNamed('lp612.render.reuse_rejected');
    expect(rejected.length).toBe(1);
    expect(rejected[0][1]).toMatchObject({
      renderId: 'render-1',
      segmentId: SEG_ID,
      lang: 'en',
      fromVersion: 'v9.1',
      toVersion: 'v9.2',
      reason: 'one_screen_shape',
    });
    expect(rejected[0][1].defects).toContain('ONESCREEN_FORMAT');
  });

  test('a body that bolds the PDF way is refused too — WhatsApp prints ** literally', async () => {
    const doubled = SHAPED.replace(/\*/g, '**');
    r2Holding({ [`lp612/v9.1/en/${SEG_ID}.lp.json`]: JSON.stringify(storedDoc(doubled)) });
    seed();

    await Worker.process(JOB);

    expect(mockAuthorLessonPlan).toHaveBeenCalledTimes(1);
    expect(eventsNamed('lp612.render.reuse_rejected')[0][1].defects).toContain('ONESCREEN_BOLD');
  });
});

// ── 2 · …and the saving the lane exists for is NOT thrown away ───────────────

describe('a stored document that carries the shape is still reused', () => {
  test('zero LLM calls, and the row still names the reuse', async () => {
    r2Holding({ [`lp612/v9.1/en/${SEG_ID}.lp.json`]: JSON.stringify(storedDoc(SHAPED)) });
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockAuthorLessonPlan).not.toHaveBeenCalled();
    expect(eventsNamed('lp612.render.reuse_rejected').length).toBe(0);
    expect(lastPatch().payload).toMatchObject({ model_used: 'reused:v9.1', rounds_used: 0 });
    expect(lastPatch().payload.one_screen).toBe(SHAPED);
  });
});

// ── 3 · one implementation, so the worker and the linter cannot drift ────────

describe('the shape rule has a single implementation', () => {
  test('the predicate names the same codes the linter fails with', () => {
    expect(oneScreenShapeDefects(SHAPED)).toEqual([]);

    const codes = oneScreenShapeDefects(GREY_WALL).map((d) => d.code);
    expect(codes).toContain('ONESCREEN_FORMAT');

    const doubled = oneScreenShapeDefects(SHAPED.replace(/\*/g, '**')).map((d) => d.code);
    expect(doubled).toContain('ONESCREEN_BOLD');
  });

  test('every defect carries the message a teacher-facing author needs to act on', () => {
    for (const d of oneScreenShapeDefects(GREY_WALL)) {
      expect(typeof d.message).toBe('string');
      expect(d.message.length).toBeGreaterThan(20);
    }
  });

  test('an absent or empty body is not a SHAPE defect — gate 12 owns that fact', () => {
    expect(oneScreenShapeDefects(undefined)).toEqual([]);
    expect(oneScreenShapeDefects('')).toEqual([]);
    expect(oneScreenShapeDefects('   \n  ')).toEqual([]);
  });

  /**
   * The drift assertion. Gate 12b and the worker must be the SAME rule, so the linter's
   * one_screen failures are compared message-for-message against the predicate's — not merely
   * "both complain". A second implementation that agreed on the codes and differed on the
   * threshold would pass a code-only check and still put a grey wall on a phone.
   */
  test('lint() reports exactly what the predicate reports, message for message', () => {
    const fs = require('fs');
    const fixture = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
    const doc = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    doc.one_screen = GREY_WALL;

    const fromLint = lint(doc, fixture).fails
      .filter((f) => /^ONESCREEN_(FORMAT|BOLD):/.test(f))
      .sort();
    const fromPredicate = oneScreenShapeDefects(GREY_WALL)
      .map((d) => `${d.code}: ${d.message}`)
      .sort();

    expect(fromPredicate.length).toBeGreaterThan(0);
    expect(fromLint).toEqual(fromPredicate);
  });
});
