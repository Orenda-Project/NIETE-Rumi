/**
 * A REUSED URDU LESSON MUST NOT BRING BACK ENGLISH OBJECTIVES — bd-oak77.40.
 *
 * The overlay pass is skipped on a reuse (`!authored.reusedFrom`, bd-oak77.12), so the stored
 * `ur_overlay` is re-rendered exactly as it was written. `reuseFromPreviousVersion` already
 * refuses a stored overlay with no Urdu for the lesson's title (`overlayChromeGaps`, bd-yhd16) —
 * and nothing else. An overlay whose objectives were never translated passes the 50% coverage
 * floor, reaches this lane, and is cached into a fresh row as a permanent cache hit: the objectives
 * box, the one a teacher reads aloud word for word, stays English for every teacher after the first.
 *
 * The lane must apply the same objectives rule the overlay gate does (urdu-plan-english-residue
 * .test.js pins the gate's half). An objectives-complete overlay, an Urdu-medium book and an
 * English render are still reused for free.
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

const JOB = { renderId: 'render-1', segmentId: SEG_ID, lang: 'ur', templateVersion: 'v9.6', correlationId: 'corr-1' };

/**
 * A stored Urdu document in the CURRENT objectives shape (schema/lp_doc.schema.json: outcome,
 * by_the_end, items[].text), with its title overlaid and every target Urdu except `untranslated`.
 */
function storedDoc({ untranslated = [], medium = 'en' } = {}) {
  const doc = storedUrduDoc({ chrome: true, medium });
  doc.objectives = {
    outcome: 'You can name three features of the Indus Valley cities and say why each mattered.',
    by_the_end: 'By the end you can answer a 3-mark question naming one feature and its purpose.',
    items: [
      { text: 'You can describe how the drainage of an Indus city worked.', slo_code: 'O1' },
      { text: 'You can explain why a planned city needs a shared system of weights.', slo_code: 'O2' },
    ],
  };
  for (const ptr of overlayDefects.targets(doc)) {
    if (!doc.ur_overlay[ptr]) doc.ur_overlay[ptr] = 'اردو متن';
  }
  for (const ptr of untranslated) delete doc.ur_overlay[ptr];
  return doc;
}

function seed(seg = SEGMENT) {
  mockDbResults.push({ data: { id: 'render-1', status: 'authoring', waiters: WAITERS }, error: null });
  mockDbResults.push({ data: seg, error: null });
}

function r2Holding(map) {
  mockDownloadFromR2.mockImplementation(async (key) => {
    if (Object.prototype.hasOwnProperty.call(map, key)) return Buffer.from(map[key], 'utf8');
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
    lintClean: true, fails: [], warns: [], rounds: 3, model: 'anthropic/claude-sonnet-5',
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

describe('a stored Urdu document with an English objective is refused for reuse', () => {
  test.each([
    '/objectives/outcome',
    '/objectives/by_the_end',
    '/objectives/items/1/text',
  ])('%s untranslated: authored instead, and the refusal names the pointer', async (ptr) => {
    const doc = storedDoc({ untranslated: [ptr] });
    expect(overlayDefects.chromeGaps(doc)).toEqual([]);   // the title is NOT the defect here

    r2Holding(storedAt('v9.2', 'ur', doc));
    seed();
    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockAuthorLessonPlan).toHaveBeenCalledTimes(1);
    expect(eventsNamed('lp612.render.reused').length).toBe(0);
    const rejected = eventsNamed('lp612.render.reuse_rejected');
    expect(rejected.length).toBe(1);
    expect(rejected[0][1]).toMatchObject({ segmentId: SEG_ID, lang: 'ur', fromVersion: 'v9.2' });
    expect(rejected[0][1].defects).toContain(ptr);
  });
});

describe('the saving the lane exists for is kept', () => {
  test('objectives translated: reused with zero LLM calls', async () => {
    r2Holding(storedAt('v9.2', 'ur', storedDoc()));
    seed();
    await Worker.process(JOB);
    expect(mockAuthorLessonPlan).not.toHaveBeenCalled();
    expect(lastPatch().payload).toMatchObject({ model_used: 'reused:v9.2', rounds_used: 0 });
  });

  test('an Urdu-MEDIUM book is reused — its objectives are already Urdu', async () => {
    const doc = storedDoc({ untranslated: ['/objectives/outcome'], medium: 'ur' });
    r2Holding(storedAt('v9.2', 'ur', doc));
    seed({ ...SEGMENT, language: 'ur' });
    await Worker.process(JOB);
    expect(mockAuthorLessonPlan).not.toHaveBeenCalled();
    expect(lastPatch().payload.model_used).toBe('reused:v9.2');
  });

  test('an ENGLISH render is untouched by this rule', async () => {
    r2Holding(storedAt('v9.2', 'en', storedDoc({ untranslated: ['/objectives/outcome'] })));
    seed();
    await Worker.process({ ...JOB, lang: 'en' });
    expect(mockAuthorLessonPlan).not.toHaveBeenCalled();
    expect(lastPatch().payload.model_used).toBe('reused:v9.2');
  });
});
