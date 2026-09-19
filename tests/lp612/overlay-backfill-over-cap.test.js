/**
 * bd-0t9ce — THE REPAIR PATH MUST NOT BE STRICTER THAN THE DELIVERY PATH.
 *
 * `lp612-render-policy.service.js` is the product's ONE rule for what a render defect means, and
 * it says PAGE COUNT is DELIVERABLE, flagged `over_cap` — "a long lesson is not a damaged one"
 * (bd-vjk68, operator 2026-09-04: "we will stop cancelling or delaying lesson plans now because of
 * the length issue"). `lp612-author.worker.js` applies that verdict, so a PAGE COUNT lesson reaches
 * the teacher today.
 *
 * `repairRow()` called `renderLessonPlan()` bare. The same throw the worker turns into a delivery,
 * the backfill turned into a failure — and because the render is step 2 of 5 it wrote NOTHING, after
 * already paying for the overlay model call.
 *
 * Measured on production 2026-09-16: 52 repairable rows -> 16 repaired, 36 refused, 35 of them
 * PAGE COUNT, 0 TRUNCATION. Worse, TWO rows that rendered CLEAN untouched failed only AFTER the
 * top-up — the three added Urdu provenance strings pushed them past the teach cap. So the pass was
 * SELF-LIMITING: it pushed documents over the cap and then refused them for being over it.
 *
 * What must NOT change: TRUNCATION still fails. Pages of the lesson are missing from the file.
 * That is the one class `deliveryVerdict` blocks and the one class this must keep blocking.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const rawFixture = fs.readFileSync(BASE, 'utf8');
const doc = () => JSON.parse(rawFixture);

const EXISTING_UR = 'یہ اردو ہدایت ہے جو اس سبق کے لیے پہلے ہی لکھی جا چکی ہے۔';

// ── the doubles: supabase, R2 and Chromium. The backfill and the policy are genuine. ──

jest.mock('../../bot/shared/config/supabase', () => {
  const state = { rows: [], updates: [] };
  const builder = () => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: (n) => Promise.resolve({ data: state.rows.slice(0, n ?? undefined), error: null }),
      update(patch) {
        return {
          eq: (col, val) => {
            state.updates.push({ patch, by: { [col]: val } });
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return q;
  };
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

const row = () => ({
  id: `row-${SEG}`,
  segment_id: SEG,
  lang: 'ur',
  template_version: TV,
  status: 'ready',
  r2_key: `lp612/${TV}/ur/${SEG}.pdf`,
  page_count: 5,
});

/** The real shape of the production row: every pointer translated EXCEPT provenance. */
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

/**
 * The renderer's real throw for a defect, verbatim from lp612-render.service.js:344.
 * The PDF EXISTS at this point — the service writes the file and only then inspects the report.
 */
const renderThrew = (problems) => {
  const e = new Error(`render of ${SEG} produced ${problems.length} defect(s): ${problems.join(' | ')}`);
  e.code = 'RENDER_FAILED';
  Object.assign(e, {
    problems,
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

const OVER_CAP = 'PAGE COUNT: teach needs 6 pages; the cap is 5. The 2 block(s) past the cap are 380px of content.';
const TRUNCATED = 'TRUNCATION: the PDF has 4 page(s) but the layout built 6';

let tmpPdf;

beforeAll(() => {
  tmpPdf = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'lp612-overcap-')), 'out.pdf');
  fs.writeFileSync(tmpPdf, Buffer.from('%PDF-1.7 over-cap but complete\n'));
});

beforeEach(() => {
  jest.clearAllMocks();
  supabase.__state.rows = [row()];
  supabase.__state.updates = [];
  downloadFromR2.mockResolvedValue(Buffer.from(JSON.stringify(storedDoc())));
  uploadBuffer.mockResolvedValue({ ok: true });
  create.mockImplementation(async () => reply(
    Object.fromEntries(missingOverlayPointers(storedDoc()).map((p, i) => [p, `اردو عنوان نمبر ${i + 1}`])),
  ));
});

const run = () => backfillUrduOverlays({
  dryRun: false, templateVersion: TV, limit: 10, correlationId: 'test-over-cap',
});

// ── 1. the defect the product already delivers ────────────────────────────────

describe('a lesson the bot itself would deliver is repaired, not refused', () => {
  test('THE RED TEST — an over-cap render is written back, not dropped on the floor', async () => {
    renderLessonPlan.mockRejectedValue(renderThrew([OVER_CAP]));

    const out = await run();

    expect(out.repaired).toBe(1);
    expect(out.failed).toEqual([]);
  });

  test('both objects reach R2 — the repaired document AND the over-cap PDF', async () => {
    renderLessonPlan.mockRejectedValue(renderThrew([OVER_CAP]));

    await run();

    const keys = uploadBuffer.mock.calls.map((c) => c[1]);
    expect(keys).toEqual([`lp612/${TV}/ur/${SEG}.lp.json`, `lp612/${TV}/ur/${SEG}.pdf`]);
  });

  test('the row is patched with the page count the renderer actually measured', async () => {
    renderLessonPlan.mockRejectedValue(renderThrew([OVER_CAP]));

    await run();

    expect(supabase.__state.updates).toHaveLength(1);
    expect(supabase.__state.updates[0].patch.page_count).toBe(6);
  });

  test('the summary SAYS it is over cap — a repair that quietly ships a long lesson is a lie', async () => {
    renderLessonPlan.mockRejectedValue(renderThrew([OVER_CAP]));

    const out = await run();

    const repaired = (out.rows || []).find((r) => r.segmentId === SEG);
    expect(repaired.overCap).toBe(true);
  });
});

// ── 2. the one class that must still fail ─────────────────────────────────────

describe('a document that is actually broken is still refused', () => {
  test('TRUNCATION fails — pages of the lesson are missing from the file', async () => {
    renderLessonPlan.mockRejectedValue(renderThrew([TRUNCATED]));

    const out = await run();

    expect(out.repaired).toBe(0);
    expect(out.failed).toHaveLength(1);
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(supabase.__state.updates).toEqual([]);
  });

  test('a MIXED set containing TRUNCATION fails — one blocking defect blocks', async () => {
    renderLessonPlan.mockRejectedValue(renderThrew([OVER_CAP, TRUNCATED]));

    const out = await run();

    expect(out.repaired).toBe(0);
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  test('an INFRA failure fails — a Chromium that never launched produced no PDF at all', async () => {
    const e = new Error('render of ' + SEG + ' could not launch');
    Object.assign(e, { code: 'RENDER_FAILED', problems: ['spawn failed'], infra: true, pdfPath: '' });
    renderLessonPlan.mockRejectedValue(e);

    const out = await run();

    expect(out.repaired).toBe(0);
    expect(uploadBuffer).not.toHaveBeenCalled();
  });
});

// ── 3. a degraded-but-deliverable defect follows the same rule ────────────────

describe('the other deliverable classes follow the product rule, not a second copy of it', () => {
  test('a FIGURE defect is delivered and flagged degraded, never dropped', async () => {
    renderLessonPlan.mockRejectedValue(renderThrew([
      'FIGURE TOO SMALL: label is 13.25px in a 729px column (floor 13.5px)',
    ]));

    const out = await run();

    expect(out.repaired).toBe(1);
    const repaired = (out.rows || []).find((r) => r.segmentId === SEG);
    expect(repaired.degraded).toBe(true);
  });
});
