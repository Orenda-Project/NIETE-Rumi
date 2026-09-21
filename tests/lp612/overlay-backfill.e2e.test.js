/**
 * THE 302 — bd-idneu, e2e half of the corpus driver.
 *
 * `topUpOverlay` repairs a document in memory. This is the thing that walks the cache and puts the
 * repaired document back where teachers read it, and it is the half that touches production: it
 * overwrites live R2 objects and patches live rows.
 *
 * So the suite is written around what could go wrong OUT THERE, not around the happy path:
 *
 *   1. THE DEFAULT MUST BE A DRY RUN. A driver whose no-argument call rewrites 302 production
 *      objects is one absent-minded `node -e` away from a corpus-wide accident. The default is
 *      inventory-only, it spends no model tokens, and it is the artifact the live run gets approved
 *      from.
 *   2. IT OVERWRITES IN PLACE, NEVER BESIDE. The cache key is `segment_id + lang + template_version`
 *      and the row already points at `r2_key`. A repaired PDF written to any other key is invisible
 *      to every future cache hit — the run would report 302 successes and change nothing a teacher
 *      sees. So the test asserts the written key is BYTE-IDENTICAL to the row's own.
 *   3. THE DOCUMENT IS WRITTEN BEFORE THE PDF. If the run dies between the two, doc-then-pdf leaves
 *      a repaired document under a stale PDF — the next template bump reuses the repaired document
 *      and the lesson comes out right. Pdf-then-doc leaves the opposite: a correct PDF that a
 *      re-render would silently regress. Both orders are idempotent; only one fails safely.
 *   4. ONE BAD DOCUMENT MUST NOT COST THE OTHER 301, AND 301 BAD ONES MUST NOT BE GROUND THROUGH.
 *      A per-row failure is recorded and the walk continues; a run of consecutive failures means the
 *      model or the bucket is down, and continuing just spends money on a wall.
 *
 * Mocked at their network boundaries only: supabase, R2, and the renderer (which launches Chromium).
 * `lp612-overlay-backfill.service`, `lp612-overlay-topup.service` and the linter are genuine.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const rawFixture = fs.readFileSync(BASE, 'utf8');
const doc = () => JSON.parse(rawFixture);

const EXISTING_UR = 'یہ اردو ہدایت ہے جو اس سبق کے لیے پہلے ہی لکھی جا چکی ہے۔';

// ── the doubles ───────────────────────────────────────────────────────────────

jest.mock('../../bot/shared/config/supabase', () => {
  const state = { rows: [], updates: [], selectError: null };
  const builder = () => {
    const q = {
      _filters: {},
      select: () => q,
      eq(col, val) { q._filters[col] = val; return q; },
      order: () => q,
      limit(n) { return Promise.resolve(state.selectError
        ? { data: null, error: state.selectError }
        : { data: state.rows.slice(0, n == null ? undefined : n), error: null }); },
      update(patch) {
        return {
          eq: (col, val) => {
            state.updates.push({ patch, by: { [col]: val } });
            return Promise.resolve({ error: null });
          },
        };
      },
      then(res) { return Promise.resolve({ data: state.rows, error: null }).then(res); },
    };
    state.lastQuery = q;
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

/** A row as it sits in `niete_lp612_renders` today: ready, Urdu, cached. */
const row = (segmentId, over = {}) => ({
  id: `row-${segmentId}`,
  segment_id: segmentId,
  lang: 'ur',
  template_version: TV,
  status: 'ready',
  r2_key: `lp612/${TV}/ur/${segmentId}.pdf`,
  page_count: 4,
  ...over,
});

/** The document that row points at: authored before bd-x3dn6, so every pointer but provenance. */
const storedDoc = () => {
  const d = doc();
  d.ur_overlay = {};
  for (const ptr of overlayDefects.targets(d)) {
    if (ptr.startsWith('/provenance/')) continue;
    d.ur_overlay[ptr] = EXISTING_UR;
  }
  return d;
};

const completeDoc = () => {
  const d = doc();
  d.ur_overlay = Object.fromEntries(overlayDefects.targets(d).map((p) => [p, 'اردو']));
  return d;
};

const reply = (obj) => ({
  choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 320, completion_tokens: 90, total_tokens: 410 },
});

const urduFor = (pointers) => Object.fromEntries(
  pointers.map((p, i) => [p, `اردو عنوان نمبر ${i + 1}`]),
);

/** Whatever it is asked for, answered in Urdu — the corpus is not one fixed delta. */
const answerInUrdu = () => create.mockImplementation(async (params) => {
  const user = params.messages[1].content;
  const asked = missingOverlayPointers(storedDoc()).filter((p) => user.includes(p));
  return reply(urduFor(asked));
});

let tmpPdf;

beforeAll(() => {
  tmpPdf = path.join(
    fs.mkdtempSync(path.join(require('os').tmpdir(), 'lp612-backfill-')), 'out.pdf',
  );
  fs.writeFileSync(tmpPdf, Buffer.from('%PDF-1.7 repaired\n'));
});

beforeEach(() => {
  jest.clearAllMocks();
  supabase.__state.rows = [];
  supabase.__state.updates = [];
  supabase.__state.selectError = null;
  downloadFromR2.mockResolvedValue(Buffer.from(JSON.stringify(storedDoc())));
  renderLessonPlan.mockResolvedValue({ pdfPath: tmpPdf, pageCount: 5, warnings: [] });
  uploadBuffer.mockResolvedValue({ ok: true });
  answerInUrdu();
});

// ── 1. the default is an inventory, and it costs nothing ──────────────────────

describe('a no-argument call is an inventory, not a corpus rewrite', () => {
  test('THE RED TEST — the default run writes NOTHING and spends NOTHING', async () => {
    supabase.__state.rows = [row('grade_9_maths.c01.p024-025'), row('grade_9_maths.c01.p026-027')];

    const out = await backfillUrduOverlays();

    expect(out.dryRun).toBe(true);
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(supabase.__state.updates).toEqual([]);
  });

  test('and it still says exactly what a live run would do, per row', async () => {
    supabase.__state.rows = [row('grade_9_maths.c01.p024-025')];

    const out = await backfillUrduOverlays();

    expect(out.scanned).toBe(1);
    expect(out.wouldRepair).toBe(1);
    const [r] = out.rows;
    expect(r.segmentId).toBe('grade_9_maths.c01.p024-025');
    expect(r.missing).toEqual(expect.arrayContaining([
      '/provenance/topic', '/provenance/chapter', '/provenance/chapter_title',
    ]));
  });

  test('a document that needs nothing is counted separately from one that does', async () => {
    supabase.__state.rows = [row('a'), row('b')];
    downloadFromR2.mockImplementation(async (key) => Buffer.from(JSON.stringify(
      key.includes('/a.') ? completeDoc() : storedDoc(),
    )));

    const out = await backfillUrduOverlays();

    expect(out.wouldRepair).toBe(1);
    expect(out.skipped.already_complete).toBe(1);
  });
});

// ── 2. the live run, and where it puts things ─────────────────────────────────

describe('a live run repairs the object the cache actually serves', () => {
  test('it overwrites the row\'s OWN r2_key — a repair written beside it would be invisible', async () => {
    const r = row('grade_9_maths.c01.p024-025');
    supabase.__state.rows = [r];

    await backfillUrduOverlays({ dryRun: false });

    const keys = uploadBuffer.mock.calls.map((c) => c[1]);
    expect(keys).toContain(r.r2_key);
    expect(keys).toContain(r.r2_key.replace(/\.pdf$/, '.lp.json'));
    for (const k of keys) expect(k.startsWith('lp612/')).toBe(true);
  });

  test('the DOCUMENT is written before the PDF, so a half-run fails safely', async () => {
    supabase.__state.rows = [row('grade_9_maths.c01.p024-025')];

    await backfillUrduOverlays({ dryRun: false });

    const keys = uploadBuffer.mock.calls.map((c) => c[1]);
    expect(keys.findIndex((k) => k.endsWith('.lp.json')))
      .toBeLessThan(keys.findIndex((k) => k.endsWith('.pdf')));
  });

  test('the renderer is handed the TOPPED-UP document, not the stored one', async () => {
    supabase.__state.rows = [row('grade_9_maths.c01.p024-025')];

    await backfillUrduOverlays({ dryRun: false });

    const handed = renderLessonPlan.mock.calls[0][0].lpDoc;
    expect(handed.ur_overlay['/provenance/topic']).toMatch(/[؀-ۿ]/);
    // and the strings already in front of teachers came through untouched
    expect(Object.values(handed.ur_overlay)).toContain(EXISTING_UR);
    expect(renderLessonPlan.mock.calls[0][0].lang).toBe('ur');
  });

  test('the row is patched with the page count the REPAIRED render actually produced', async () => {
    supabase.__state.rows = [row('grade_9_maths.c01.p024-025', { page_count: 4 })];

    await backfillUrduOverlays({ dryRun: false });

    const [u] = supabase.__state.updates;
    expect(u.by).toEqual({ id: 'row-grade_9_maths.c01.p024-025' });
    expect(u.patch.page_count).toBe(5);
  });

  test('a row that needs nothing is not re-rendered and not re-uploaded', async () => {
    supabase.__state.rows = [row('a')];
    downloadFromR2.mockResolvedValue(Buffer.from(JSON.stringify(completeDoc())));

    const out = await backfillUrduOverlays({ dryRun: false });

    expect(create).not.toHaveBeenCalled();
    expect(renderLessonPlan).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(out.repaired).toBe(0);
  });
});

// ── 3. the rows it is allowed to touch ────────────────────────────────────────

describe('it reads only the rows this repair is about', () => {
  test('Urdu and ready — an English row or a failed one is not a top-up candidate', async () => {
    supabase.__state.rows = [row('a')];

    await backfillUrduOverlays();

    expect(supabase.from).toHaveBeenCalledWith('niete_lp612_renders');
    expect(supabase.__state.lastQuery._filters).toMatchObject({ lang: 'ur', status: 'ready' });
  });

  test('a stored document that is not in the bucket is skipped, never re-authored', async () => {
    supabase.__state.rows = [row('a')];
    downloadFromR2.mockResolvedValue(null);

    const out = await backfillUrduOverlays({ dryRun: false });

    // The PDF exists and is being served; the document beside it does not. The worker swallows
    // that upload failure on purpose, so this is a real state. We cannot repair what we cannot
    // read, and re-authoring is a decision this driver does not get to make.
    expect(out.skipped.no_stored_doc).toBe(1);
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test('a genuine NoSuchKey is the miss above — the object really is not there', async () => {
    supabase.__state.rows = [row('a')];
    const miss = Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    downloadFromR2.mockRejectedValue(miss);

    const out = await backfillUrduOverlays({ dryRun: false });

    expect(out.skipped.no_stored_doc).toBe(1);
    expect(out.failed).toEqual([]);
  });

  test('A BUCKET IT CANNOT REACH IS A FAILURE, NEVER A MISS', async () => {
    // Found by running the dry run for real: a DNS failure reached `no_stored_doc` and 309 of 331
    // rows were reported as "the document is not there". Both states are an unreadable document,
    // and the inventory reads the same, but they mean opposite things — a miss is a row this
    // repair must leave alone forever, an unreachable bucket is a row it must come back to. A
    // transport error counted as a miss would silently write off the whole corpus and report a
    // clean run, which is the worst outcome available here.
    supabase.__state.rows = Array.from({ length: 20 }, (_, i) => row(`s${i}`));
    downloadFromR2.mockRejectedValue(new Error('getaddrinfo ENOTFOUND r2.cloudflarestorage.com'));

    const out = await backfillUrduOverlays({ dryRun: false, maxConsecutiveFailures: 3 });

    expect(out.skipped.no_stored_doc).toBeUndefined();
    expect(out.failed).toHaveLength(3);
    expect(out.failed[0].error).toMatch(/ENOTFOUND/);
    expect(out.aborted).toBe(true);
    expect(out.scanned).toBeLessThan(20);
  });
});

// ── 4. failure, one row at a time and all at once ─────────────────────────────

describe('failure is bounded in both directions', () => {
  test('one bad document does not cost the other 301', async () => {
    supabase.__state.rows = [row('a'), row('b'), row('c')];
    let n = 0;
    renderLessonPlan.mockImplementation(async () => {
      n += 1;
      if (n === 2) throw new Error('chromium died');
      return { pdfPath: tmpPdf, pageCount: 5, warnings: [] };
    });

    const out = await backfillUrduOverlays({ dryRun: false });

    expect(out.repaired).toBe(2);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].segmentId).toBe('b');
  });

  test('a wall of consecutive failures ABORTS rather than grinding through the corpus', async () => {
    supabase.__state.rows = Array.from({ length: 20 }, (_, i) => row(`s${i}`));
    renderLessonPlan.mockRejectedValue(new Error('chromium is gone'));

    const out = await backfillUrduOverlays({ dryRun: false, maxConsecutiveFailures: 3 });

    expect(out.aborted).toBe(true);
    expect(out.failed.length).toBe(3);
    expect(out.scanned).toBeLessThan(20);
  });

  test('a read failure on the table returns an honest empty run, not a silent zero', async () => {
    supabase.__state.selectError = { message: 'permission denied for relation' };

    await expect(backfillUrduOverlays()).rejects.toThrow(/permission denied/);
  });
});

// ── 5. the pictures — bd-u8ii8 ────────────────────────────────────────────────

/**
 * THE REPAIR MUST NOT COST THE LESSON ITS DIAGRAMS.
 *
 * The renderer inlines a book crop from `<outDir>/<ref>.jpg` and the directory this driver hands
 * it is brand new every time. The authoring worker stages the crops into that directory before it
 * renders (lp612-author.worker.js:1051-1053); this driver did not. A `textbook_figure` whose crop
 * is absent renders as an empty framed box — badge and caption, no picture — and the renderer
 * reports it through `ctx.warn`, which no delivery verdict ever reads. So the repair would have
 * written a lesson with a hole in it over the live PDF, and reported success.
 *
 * Measured on the population this driver was queued against: 53 of the 81 rows carry a
 * `textbook_figure`, 67 figures in all.
 */
describe('the repair carries the lesson\'s pictures through with it', () => {
  const FIG_REF = 'grade_9_mathematics/pg_024_f0';
  const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');

  const storedDocWithFigure = () => {
    const d = storedDoc();
    d.sections[0].blocks.push({ type: 'textbook_figure', ref: FIG_REF, caption: 'Figure 1' });
    return d;
  };

  /** R2 as it actually is on this population: the document, and the crop beside it. */
  const bucketHolding = ({ crop = JPEG } = {}) => downloadFromR2.mockImplementation(async (key) => {
    if (key.endsWith('.lp.json')) return Buffer.from(JSON.stringify(storedDocWithFigure()));
    if (key.startsWith('lp612/page-truth/')) {
      if (!crop) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      return crop;
    }
    return null;
  });

  beforeEach(() => {
    bucketHolding();
    create.mockImplementation(async (params) => {
      const user = params.messages[1].content;
      const asked = missingOverlayPointers(storedDocWithFigure()).filter((p) => user.includes(p));
      return reply(urduFor(asked));
    });
  });

  test('THE RED TEST — the crop is on disk in the directory the renderer is handed', async () => {
    supabase.__state.rows = [row('grade_9_maths.c01.p024-025')];

    // Checked INSIDE the render call: the directory is deleted the moment the row is done, and
    // "it was there afterwards" is not the question. The question is whether Chromium could see it.
    let cropVisibleAtRenderTime = null;
    renderLessonPlan.mockImplementation(async ({ outDir }) => {
      cropVisibleAtRenderTime = fs.existsSync(path.join(outDir, `${FIG_REF}.jpg`));
      return { pdfPath: tmpPdf, pageCount: 5, warnings: [] };
    });

    const out = await backfillUrduOverlays({ dryRun: false });

    expect(cropVisibleAtRenderTime).toBe(true);
    expect(out.repaired).toBe(1);
  });

  test('it fetches the crop from the page-truth key, not from the lesson\'s own prefix', async () => {
    supabase.__state.rows = [row('grade_9_maths.c01.p024-025')];

    await backfillUrduOverlays({ dryRun: false });

    const keys = downloadFromR2.mock.calls.map((c) => c[0]);
    expect(keys).toContain(`lp612/page-truth/grade_9_mathematics/figures/pg_024_f0.jpg`);
  });

  test('A CROP IT CANNOT FETCH LEAVES THE LIVE PDF ALONE — a hole is worse than the bug', async () => {
    // The lesson on the teacher's phone today has the picture in it. Overwriting it with a
    // framed empty box is a regression she would have to report, and nothing would tell her
    // why. The row is left for a later run and counted by name in the summary.
    supabase.__state.rows = [row('grade_9_maths.c01.p024-025')];
    bucketHolding({ crop: null });

    const out = await backfillUrduOverlays({ dryRun: false });

    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(supabase.__state.updates).toEqual([]);
    expect(out.repaired).toBe(0);
    expect(out.skipped.figures_missing).toBe(1);
  });

  test('a lesson with no figures at all is repaired exactly as before', async () => {
    supabase.__state.rows = [row('grade_9_maths.c01.p024-025')];
    downloadFromR2.mockResolvedValue(Buffer.from(JSON.stringify(storedDoc())));
    answerInUrdu();

    const out = await backfillUrduOverlays({ dryRun: false });

    expect(out.repaired).toBe(1);
    expect(downloadFromR2.mock.calls.map((c) => c[0]).some((k) => k.includes('page-truth')))
      .toBe(false);
  });
});
