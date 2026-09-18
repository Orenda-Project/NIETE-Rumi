/**
 * E2E — A TEACHER TAPS «اردو» AND THE LESSON SHE GETS IS TITLED IN URDU. bd-yhd16 / bd-idneu.
 *
 * The unit suite pins the reuse gate's decision. It does not prove what the teacher receives,
 * and in production the two came apart at exactly one seam: a stored pre-bd-x3dn6 Urdu document
 * is handed back by `reuseFromPreviousVersion`, the overlay pass is then SKIPPED because the
 * document was reused (`!authored.reusedFrom`, bd-oak77.12), and the English title is written
 * into a fresh row at the live template version — where it is a permanent cache hit for every
 * teacher after the first.
 *
 * So this suite starts where she starts: `Serving.requestLesson`, with the segment's only stored
 * document being a v9.2 Urdu one whose overlay predates the widened target set. Everything from
 * the cache decision to the R2 upload is the shipped code. What is doubled is the network — the
 * model, R2, PostgREST, SQS, Meta — plus the renderer, which launches Chromium out of process
 * and is handed a real PDF on disk so the worker's own file read stays real.
 *
 * The assertion is the artifact: the `.lp.json` the worker stores beside the PDF, at the key the
 * next teacher's cache hit will read, must carry an Urdu string at `/provenance/topic`.
 *
 * Red-first on origin/main: the stale document is reused, no overlay pass runs, and the stored
 * document's title is still «Multiplying two 2×2 matrices».
 */

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create,
  };
});

const mockUploads = [];
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn(async (buf, key, type) => { mockUploads.push({ key, type, buf }); return 'ok'; }),
  downloadFromR2: jest.fn(),
}));

const mockQueued = [];
jest.mock('../../bot/shared/services/queue', () => ({
  queueJob: jest.fn(async (groupId, jobType, payload) => { mockQueued.push(payload); return { ok: true }; }),
}));

jest.mock('../../bot/shared/config/supabase', () => require('./helpers/lp612-db-double').db);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => ({ ok: true })),
  sendDocument: jest.fn(async () => ({ ok: true })),
}));

// Chromium runs out of process. The double returns the real PDF the harness wrote to disk, so
// the worker's `fs.promises.readFile` and its R2 put are both the shipped ones.
const mockRendered = { pdfPath: null, pageCount: 4 };
jest.mock('../../bot/shared/services/lp612-render.service', () => ({
  renderLessonPlan: jest.fn(async ({ lpDoc }) => ({
    pdfPath: mockRendered.pdfPath,
    htmlPath: mockRendered.pdfPath,
    pageCount: mockRendered.pageCount,
    warnings: [],
    pagesByPart: { teach: 2, support: 2 },
    // The renderer reports what it actually drew — that is what makes an empty overlay a drop.
    overlayApplied: Object.keys((lpDoc && lpDoc.ur_overlay) || {}),
  })),
}));

const { reset } = require('./helpers/lp612-db-double');
const { downloadFromR2 } = require('../../bot/shared/storage/r2');
const create = require('../../bot/shared/services/llm-client').__create;
const H = require('./helpers/overlay-chrome-e2e');
const Serving = require('../../bot/shared/services/lp612-serving.service');
const Worker = require('../../bot/workers/lp612-author.worker');

const tree = H.installFixtureTree();

const TAP = {
  segmentId: H.SEG_ID, userId: 'teacher-1', phone: '923001234567',
  lang: 'ur', uiLang: 'ur', correlationId: 'e2e-1', surface: 'whatsapp',
};

/** R2 holds ONE document for this segment: the stale v9.2 Urdu one. */
function r2Holding(map) {
  downloadFromR2.mockImplementation(async (key) => {
    if (Object.prototype.hasOwnProperty.call(map, key)) return Buffer.from(map[key], 'utf8');
    throw Object.assign(new Error(`NoSuchKey: ${key}`), { name: 'NoSuchKey' });
  });
}

const storedDoc = () => {
  const up = mockUploads.filter((u) => u.key.endsWith('.lp.json')).pop();
  return up ? JSON.parse(up.buf.toString('utf8')) : null;
};
const isUrdu = (s) => typeof s === 'string' && /[؀-ۿ]/.test(s);

/** The whole tap, exactly as WhatsApp drives it: decide, enqueue, then the worker runs the job. */
async function teacherTapsUrdu() {
  const decision = await Serving.requestLesson(TAP);
  expect(mockQueued.length).toBe(1);
  const out = await Worker.process(mockQueued[0]);
  return { decision, out };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUploads.length = 0;
  mockQueued.length = 0;
  reset([H.SEGMENT]);
  mockRendered.pdfPath = tree.pdfPath;
  H.installLlm(create);
  delete process.env.LP_612_TEMPLATE_FALLBACK;
  process.env.LP_612_TEMPLATE_VERSION = 'v9.6';
  r2Holding({ [`lp612/v9.2/ur/${H.SEG_ID}.lp.json`]: JSON.stringify(H.staleStoredUrdu()) });
});

afterEach(() => {
  delete process.env.LP_612_TEMPLATE_VERSION;
  delete process.env.LP_612_TEMPLATE_FALLBACK;
});

describe('the Urdu lesson a teacher receives is titled in Urdu', () => {
  test('the stored document behind the next cache hit carries an Urdu /provenance/topic', async () => {
    const { out } = await teacherTapsUrdu();

    expect(out.status).toBe('ready');
    const doc = storedDoc();
    expect(doc).toBeTruthy();
    // THE BUG, at the layer she feels it: on origin/main this is the stale v9.2 overlay, which
    // has no entry for the lesson's own title, so page 1 is headed in English.
    expect(isUrdu(doc.ur_overlay['/provenance/topic'])).toBe(true);
  });

  test('it is written at the LIVE template version, where the next tap will read it', async () => {
    await teacherTapsUrdu();

    const keys = mockUploads.map((u) => u.key);
    expect(keys).toContain(`lp612/v9.6/ur/${H.SEG_ID}.lp.json`);
    expect(keys).toContain(`lp612/v9.6/ur/${H.SEG_ID}.pdf`);
  });

  test('the overlay pass actually ran — the lesson was re-authored, not re-served', async () => {
    // Two model calls: the author, then the overlay. A reuse makes zero, which is precisely how
    // the English chrome survives a template bump.
    await teacherTapsUrdu();

    expect(create.mock.calls.length).toBe(2);
  });
});

describe('the row tells the truth about what it cost', () => {
  test('the render row names a model, not a reuse', async () => {
    const { out } = await teacherTapsUrdu();

    const { state } = require('./helpers/lp612-db-double');
    const row = state.renders.find((r) => r.id === out.renderId || r.id === mockQueued[0].renderId);
    expect(row.status).toBe('ready');
    expect(String(row.model_used || '')).not.toMatch(/^reused:/);
  });
});
