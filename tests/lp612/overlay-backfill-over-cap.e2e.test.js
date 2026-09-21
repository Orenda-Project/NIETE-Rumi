/**
 * bd-0t9ce — e2e half: THE OVER-CAP LESSON REACHES THE TEACHER IN URDU.
 *
 * The unit half proves `repairRow` stops refusing a document the product delivers. This half proves
 * the thing that actually matters: the bytes that land in the cache are the REPAIRED document, and
 * the page a teacher opens is the Urdu one.
 *
 * This is the case that made the live pass self-limiting. Two rows on production rendered CLEAN
 * untouched and failed only AFTER the top-up — the three added Urdu provenance strings are longer
 * in Nastaliq than the English they replace, and that alone pushed a document sitting at the teach
 * cap past it. The repair created the condition it was then refused for, so those lessons could
 * never be fixed by any number of re-runs.
 *
 * Genuine here: the backfill, the top-up, the linter, the overlay applier and the HTML builder.
 * Doubled at their network boundaries only: supabase, R2, the LLM and Chromium.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));
const { applyOverlay } = require(path.join(V, 'lib', 'overlay.js'));
const { buildHtml } = require(path.join(V, 'lib', 'template.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const rawFixture = fs.readFileSync(BASE, 'utf8');
const doc = () => JSON.parse(rawFixture);

const EXISTING_UR = 'یہ اردو ہدایت ہے جو اس سبق کے لیے پہلے ہی لکھی جا چکی ہے۔';

jest.mock('../../bot/shared/config/supabase', () => {
  const state = { rows: [], updates: [] };
  const builder = () => ({
    select: function s() { return this; },
    eq: function e() { return this; },
    order: function o() { return this; },
    limit: (n) => Promise.resolve({ data: state.rows.slice(0, n ?? undefined), error: null }),
    update: (patch) => ({
      eq: (col, val) => {
        state.updates.push({ patch, by: { [col]: val } });
        return Promise.resolve({ error: null });
      },
    }),
  });
  return { from: jest.fn(builder), __state: state };
});

jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(),
  uploadBuffer: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../bot/shared/services/lp612-render.service', () => ({
  renderLessonPlan: jest.fn(),
}));
jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({
      client: { chat: { completions: { create } } }, model: String(m || ''),
    }),
    __create: create,
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const { downloadFromR2, uploadBuffer } = require('../../bot/shared/storage/r2');
const { renderLessonPlan } = require('../../bot/shared/services/lp612-render.service');
const create = require('../../bot/shared/services/llm-client').__create;
const { missingOverlayPointers } = require('../../bot/shared/services/lp612-overlay-topup.service');
const { backfillUrduOverlays } = require('../../bot/shared/services/lp612-overlay-backfill.service');

const TV = 'v9.6';
const SEG = 'grade_9_physics.c03.p071-072';
const DOC_KEY = `lp612/${TV}/ur/${SEG}.lp.json`;

/** The Urdu the model returns for the provenance delta — real chapter/topic prose. */
const UR_CHAPTER = 'باب ۳ — حرکت اور قوت';
const UR_TOPIC = 'رفتار، اسراع اور نیوٹن کا دوسرا قانون';

const row = () => ({
  id: `row-${SEG}`,
  segment_id: SEG,
  lang: 'ur',
  template_version: TV,
  status: 'ready',
  r2_key: `lp612/${TV}/ur/${SEG}.pdf`,
  page_count: 5,
});

const storedDoc = () => {
  const d = doc();
  d.ur_overlay = {};
  for (const ptr of overlayDefects.targets(d)) {
    if (ptr.startsWith('/provenance/')) continue;
    d.ur_overlay[ptr] = EXISTING_UR;
  }
  return d;
};

const reply = (obj) => ({
  choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 320, completion_tokens: 90, total_tokens: 410 },
});

const OVER_CAP = 'PAGE COUNT: teach needs 6 pages; the cap is 5. The 2 block(s) past the cap are 380px of content.';

let tmpPdf;

/** The renderer's real throw. The PDF EXISTS — the file is written before the report is read. */
const overCapThrow = () => {
  const e = new Error(`render of ${SEG} produced 1 defect(s): ${OVER_CAP}`);
  e.code = 'RENDER_FAILED';
  Object.assign(e, {
    problems: [OVER_CAP],
    infra: false,
    warnings: [],
    htmlPath: '/tmp/out.html',
    pdfPath: tmpPdf,
    pageCount: 6,
    pagesByPart: { teach: 6, support: 3 },
    overlayApplied: [],
  });
  return e;
};

beforeAll(() => {
  tmpPdf = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'lp612-oc-e2e-')), 'out.pdf');
  fs.writeFileSync(tmpPdf, Buffer.from('%PDF-1.7 over cap, complete, correct\n'));
});

beforeEach(() => {
  jest.clearAllMocks();
  supabase.__state.rows = [row()];
  supabase.__state.updates = [];
  downloadFromR2.mockResolvedValue(Buffer.from(JSON.stringify(storedDoc())));
  uploadBuffer.mockResolvedValue({ ok: true });
  renderLessonPlan.mockRejectedValue(overCapThrow());
  create.mockImplementation(async () => {
    const missing = missingOverlayPointers(storedDoc());
    const out = Object.fromEntries(missing.map((p) => [p, UR_CHAPTER]));
    if (missing.includes('/provenance/topic')) out['/provenance/topic'] = UR_TOPIC;
    return reply(out);
  });
});

const run = () => backfillUrduOverlays({
  dryRun: false, templateVersion: TV, limit: 10, correlationId: 'test-over-cap-e2e',
});

/** The document as it was actually written back to the cache. */
const uploadedDoc = () => {
  const call = uploadBuffer.mock.calls.find((c) => c[1] === DOC_KEY);
  return JSON.parse(call[0].toString('utf8'));
};

describe('an over-cap lesson is repaired in place and served in Urdu', () => {
  test('THE RED TEST — the repaired document reaches the cache under the row\'s own key', async () => {
    const out = await run();

    expect(out.repaired).toBe(1);
    expect(uploadBuffer.mock.calls.map((c) => c[1])).toContain(DOC_KEY);
  });

  test('the written document carries every pointer the linter offers — nothing left English', async () => {
    await run();

    const written = uploadedDoc();
    const missing = overlayDefects.targets(written)
      .filter((p) => !Object.keys(written.ur_overlay || {}).includes(p));
    expect(missing).toEqual([]);
  });

  test('the teacher opens an Urdu page — the chapter and topic render in Nastaliq, not English', async () => {
    await run();

    const { doc: applied, errors } = applyOverlay(uploadedDoc(), 'ur');
    expect(errors).toEqual([]);
    const { html } = buildHtml(applied, { docDir: path.dirname(BASE), lang: 'ur' });
    expect(html).toContain(UR_TOPIC);
    expect(html).toContain(UR_CHAPTER);
  });

  test('an existing Urdu translation is never overwritten by the top-up', async () => {
    await run();

    const written = uploadedDoc();
    const kept = Object.entries(written.ur_overlay)
      .filter(([p]) => !p.startsWith('/provenance/'));
    expect(kept.length).toBeGreaterThan(0);
    for (const [, v] of kept) expect(v).toBe(EXISTING_UR);
  });

  test('the document is written BEFORE the pdf — a crash between them must fail safely', async () => {
    await run();

    const keys = uploadBuffer.mock.calls.map((c) => c[1]);
    expect(keys.indexOf(DOC_KEY)).toBeLessThan(keys.indexOf(`lp612/${TV}/ur/${SEG}.pdf`));
  });

  test('the row records the page count that was really produced, not the one we wanted', async () => {
    await run();

    expect(supabase.__state.updates[0].patch.page_count).toBe(6);
  });
});
