/**
 * A REUSED URDU LESSON MUST NOT BRING BACK AN ENGLISH TITLE — bd-yhd16 / bd-idneu.
 *
 * `ur_overlay` is frozen into the stored `.lp.json` at authoring time, and which pointers it may
 * carry is decided once, by `overlayTargets()` in `lint_lp.js`. bd-x3dn6 WIDENED that set:
 * `/provenance/topic`, `/provenance/chapter` and `/provenance/chapter_title` are offered now and
 * were not before. Every Urdu document stored before that fix therefore carries NO Urdu string for
 * the lesson's title — the largest type on page 1, the running header of every continued page, and
 * the PDF's own document title.
 *
 * `reuseFromPreviousVersion` is the lane that hands those documents back. It already refuses a
 * stored BODY the current renderer would not accept (`oneScreenShapeDefects`, bd-jpfww) — and then
 * accepts a stored OVERLAY the current gate would not have written. Worse, the overlay pass is
 * explicitly skipped on a reuse (`!authored.reusedFrom`, bd-oak77.12), so nothing downstream can
 * repair it: the pre-fix overlay is re-rendered as-is and cached into a NEW row at the new
 * template version, where it is a permanent cache hit for every teacher after the first.
 *
 * MEASURED IN PRODUCTION, 2026-09-17: of 389 ready Urdu renders, 82 still carry an English title.
 * 77 of them are refused by the one_screen guard already; 2 pass every existing guard, have no row
 * at the live template version, and would be re-served by this lane on the next tap.
 *
 * What is pinned here:
 *
 *   • a stored Urdu document whose overlay predates the widened target set is REFUSED for reuse
 *     and falls through to authoring, where the overlay pass runs under the current gate;
 *   • the refusal is MEASURED and names the pointers that are missing (rule 24(b));
 *   • an Urdu document whose chrome IS overlaid is still reused with zero LLM calls;
 *   • an Urdu-MEDIUM book is never refused — its title is already Urdu and has no overlay to miss;
 *   • an ENGLISH render is untouched by this rule;
 *   • the worker and the linter share ONE implementation, so they cannot drift.
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
// The serving service is the REAL one apart from the send: `readStoredDoc` is the call under
// test, and a double for it would make this suite pass while production still reused English
// chrome.
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
const { SEG_ID, SEGMENT, SHAPED, storedUrduDoc, storedAt } = require('./helpers/overlay-chrome');
const { overlayDefects } = require(path.join(
  __dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'lint_lp.js',
));

const JOB = {
  renderId: 'render-1',
  segmentId: SEG_ID,
  lang: 'ur',
  templateVersion: 'v9.6',
  correlationId: 'corr-1',
};

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
    overlay: { '/provenance/topic': 'وادیِ سندھ کی تہذیب' }, coverage: 1, usage: { total_tokens: 1 },
  });
  mockRenderLessonPlan.mockResolvedValue({
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 9, warnings: [],
    pagesByPart: { teach: 5, support: 4 }, overlayApplied: ['/provenance/topic'],
  });
});

afterEach(() => {
  delete process.env.LP_612_TEMPLATE_FALLBACK;
  delete process.env.LP_612_TEMPLATE_VERSION;
});

// ── 1 · the bug: a pre-fix Urdu overlay must not be reused ───────────────────

describe('a stored Urdu document with no overlay for its own title is refused for reuse', () => {
  test('the lesson is authored instead, so the overlay pass runs under the current gate', async () => {
    r2Holding(storedAt('v9.2', 'ur', storedUrduDoc({ chrome: false })));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    // THE BUG. Today the stored document wins, the overlay pass is skipped on a reuse, and the
    // English title is cached into a fresh v9.6 row.
    expect(mockAuthorLessonPlan).toHaveBeenCalledTimes(1);
    expect(eventsNamed('lp612.render.reused').length).toBe(0);
    expect(lastPatch().payload.model_used).toBe('anthropic/claude-sonnet-5');
  });

  test('the refusal is measured and names the pointers that are missing', async () => {
    r2Holding(storedAt('v9.2', 'ur', storedUrduDoc({ chrome: false })));
    seed();

    await Worker.process(JOB);

    const rejected = eventsNamed('lp612.render.reuse_rejected');
    expect(rejected.length).toBe(1);
    expect(rejected[0][1]).toMatchObject({
      renderId: 'render-1',
      segmentId: SEG_ID,
      lang: 'ur',
      fromVersion: 'v9.2',
      toVersion: 'v9.6',
      reason: 'overlay_chrome_stale',
    });
    expect(rejected[0][1].defects).toContain('/provenance/topic');
  });
});

// ── 2 · …and the saving the lane exists for is NOT thrown away ───────────────

describe('a stored Urdu document whose chrome is overlaid is still reused', () => {
  test('zero LLM calls, and the row still names the reuse', async () => {
    r2Holding(storedAt('v9.2', 'ur', storedUrduDoc({ chrome: true })));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockAuthorLessonPlan).not.toHaveBeenCalled();
    expect(eventsNamed('lp612.render.reuse_rejected').length).toBe(0);
    expect(lastPatch().payload).toMatchObject({ model_used: 'reused:v9.2', rounds_used: 0 });
  });

  test('an Urdu-MEDIUM book is reused — its title is already Urdu and has no overlay to miss', async () => {
    r2Holding(storedAt('v9.2', 'ur', storedUrduDoc({ chrome: false, medium: 'ur' })));
    seed({ ...SEGMENT, language: 'ur' });

    await Worker.process(JOB);

    expect(mockAuthorLessonPlan).not.toHaveBeenCalled();
    expect(lastPatch().payload.model_used).toBe('reused:v9.2');
  });

  test('an ENGLISH render is untouched by this rule', async () => {
    r2Holding(storedAt('v9.2', 'en', storedUrduDoc({ chrome: false })));
    seed();

    await Worker.process({ ...JOB, lang: 'en' });

    expect(mockAuthorLessonPlan).not.toHaveBeenCalled();
    expect(lastPatch().payload.model_used).toBe('reused:v9.2');
  });
});

// ── 3 · one implementation, so the worker and the linter cannot drift ────────

describe('the chrome rule is derived from overlayTargets, never hand-listed', () => {
  test('it names exactly the offered provenance pointers the stored overlay lacks', () => {
    const stale = storedUrduDoc({ chrome: false });
    expect(overlayDefects.chromeGaps(stale).sort())
      .toEqual(['/provenance/chapter', '/provenance/topic']);
    expect(overlayDefects.chromeGaps(storedUrduDoc({ chrome: true }))).toEqual([]);
  });

  test('every gap it reports is a pointer overlayTargets actually offers', () => {
    const stale = storedUrduDoc({ chrome: false });
    const offered = new Set(overlayDefects.targets(stale));
    for (const ptr of overlayDefects.chromeGaps(stale)) expect(offered.has(ptr)).toBe(true);
  });

  test('a document the walker cannot read is not a gap — it is not a top-up candidate', () => {
    expect(overlayDefects.chromeGaps(null)).toEqual([]);
    expect(overlayDefects.chromeGaps('not a document')).toEqual([]);
    expect(overlayDefects.chromeGaps({})).toEqual([]);
  });

  test('a blank string does not count as a translation', () => {
    const doc = storedUrduDoc({ chrome: true });
    doc.ur_overlay['/provenance/topic'] = '   ';
    expect(overlayDefects.chromeGaps(doc)).toContain('/provenance/topic');
  });
});
