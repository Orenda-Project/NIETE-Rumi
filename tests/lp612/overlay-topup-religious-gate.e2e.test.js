/**
 * E2E — THE REPAIR LANE MAY NOT PUT UNCLEARED RELIGIOUS URDU ON A TEACHER'S CACHED LESSON.
 * The overlay half of the G5c hold the authoring climb already enforces.
 *
 * The unit suite pins the gate. This one drives the chain that actually reaches production:
 *
 *   backfillUrduOverlays()  walks `niete_lp612_renders`
 *     -> repairRow()        pulls the stored `.lp.json` out of R2
 *       -> topUpOverlay()   works out which pointers the current gate offers and this one lacks
 *         -> overlayLessonPlan()   asks the model for them
 *     -> uploadBuffer x2    writes the document and the PDF over the row's OWN keys
 *     -> supabase update    patches the row
 *
 * `/provenance/chapter` and `/provenance/topic` are in that delta, and they are the chapter and
 * topic TITLES — for Islamiyat, Urdu and Pak Studies, the strings that name prophets and
 * companions. Before this bead nothing between the model's reply and `uploadBuffer` consulted
 * `NEVER_DELIVER_CODES`: `overlayDefects()` emits only `OVERLAY_MISSING`, and neither
 * `lp612-overlay-backfill.service` nor `lp612-overlay-topup.service` mentions religious content at
 * all. So an LLM could name the Prophet without the honorific and the repair would write it
 * straight over the object every future cache hit for that lesson reads.
 *
 * THE ASSERTION IS THE ABSENCE OF A WRITE, not merely the presence of an error. A gate that throws
 * after the upload has happened protects nobody, so `uploadBuffer` and the row patch are asserted
 * on their CALL COUNTS — R2 untouched, `niete_lp612_renders` untouched, the teacher's page exactly
 * as it was.
 *
 * Red-first on f14000f7 (= origin/sandbox): repaired 1, failed [], two uploads, one row patch, and
 * the written document carries «سیرت کا سبق: نبی کریم کی زندگی».
 *
 * Doubled at their network boundaries only: supabase, R2, the model, and the renderer (which
 * launches Chromium out of process). `lp612-overlay-backfill.service`,
 * `lp612-overlay-repair.service`, `lp612-overlay-topup.service`, `lp612-author.service` and the
 * linter are the genuine modules.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const rawFixture = fs.readFileSync(BASE, 'utf8');

// ── the doubles ───────────────────────────────────────────────────────────────

jest.mock('../../bot/shared/config/supabase', () => {
  const state = { rows: [], updates: [] };
  const builder = () => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: (n) => Promise.resolve({
        data: state.rows.slice(0, n == null ? undefined : n), error: null,
      }),
      update(patch) {
        return {
          eq: (col, val) => {
            state.updates.push({ patch, by: { [col]: val } });
            return Promise.resolve({ error: null });
          },
        };
      },
      then: (res) => Promise.resolve({ data: state.rows, error: null }).then(res),
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
const { backfillUrduOverlays } = require('../../bot/shared/services/lp612-overlay-backfill.service');

// ── the row, the document, and the answer ─────────────────────────────────────

const TV = 'v9.6';
/** A سیرت lesson: exactly the shape whose TITLE names the Prophet. */
const SEG = 'grade_9_islamiyat.c03.p041-044';

const row = () => ({
  id: `row-${SEG}`,
  segment_id: SEG,
  lang: 'ur',
  template_version: TV,
  status: 'ready',
  r2_key: `lp612/${TV}/ur/${SEG}.pdf`,
  page_count: 4,
});

const EXISTING_UR = 'یہ اردو ہدایت ہے جو اس سبق کے لیے پہلے ہی لکھی جا چکی ہے۔';

/**
 * The stored document: ninety strings of Urdu prose, no provenance, and the native-speaker hold
 * already set — so the only thing the linter can find below is what THIS pass writes.
 */
const storedDoc = () => {
  const d = JSON.parse(rawFixture);
  d.needs_human_review = true;
  d.ur_overlay = {};
  for (const ptr of overlayDefects.targets(d)) {
    if (ptr.startsWith('/provenance/')) continue;
    d.ur_overlay[ptr] = EXISTING_UR;
  }
  return d;
};

/** The defect: the Prophet named, the honorific dropped (brief §4c.5). */
const UNHONORIFIED_TOPIC = 'سیرت کا سبق: نبی کریم کی زندگی';
/** The same lesson, written the way the brief requires. */
const HONORIFIED_TOPIC = 'سیرت کا سبق: نبی کریم ﷺ کی زندگی';
const UR_CHAPTER = 'باب 3 · سیرتِ طیبہ';
const UR_TITLE = 'سیرتِ طیبہ';

const reply = (obj) => ({
  choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 320, completion_tokens: 90, total_tokens: 410 },
});

const answersWith = (topic) => create.mockImplementation(async () => reply({
  '/provenance/chapter': UR_CHAPTER,
  '/provenance/topic': topic,
  '/provenance/chapter_title': UR_TITLE,
}));

/** The document that was written back, parsed out of the R2 put. */
const uploadedDoc = () => {
  const put = uploadBuffer.mock.calls.find(([, key]) => String(key).endsWith('.lp.json'));
  return put ? JSON.parse(put[0].toString('utf8')) : null;
};

let tmpPdf;

beforeAll(() => {
  tmpPdf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-overlay-gate-')), 'out.pdf');
  fs.writeFileSync(tmpPdf, Buffer.from('%PDF-1.7 repaired\n'));
});

beforeEach(() => {
  jest.clearAllMocks();
  supabase.__state.rows = [row()];
  supabase.__state.updates = [];
  downloadFromR2.mockResolvedValue(Buffer.from(JSON.stringify(storedDoc())));
  renderLessonPlan.mockResolvedValue({ pdfPath: tmpPdf, pageCount: 5, warnings: [] });
  uploadBuffer.mockResolvedValue({ ok: true });
  answersWith(UNHONORIFIED_TOPIC);
});

describe('an uncleared religious translation never reaches R2 or the renders row', () => {
  test('THE RED TEST — the row is refused, not repaired', async () => {
    const out = await backfillUrduOverlays({ dryRun: false });

    // On f14000f7: repaired 1, failed []. The Urdu naming the Prophet without the honorific was
    // written over the teacher's cached lesson.
    expect(out.repaired).toBe(0);
    expect(out.failed.length).toBe(1);
    expect(out.failed[0].error).toMatch(/religious/i);
  });

  test('NOTHING IS UPLOADED — R2 still holds the document the teacher has', async () => {
    await backfillUrduOverlays({ dryRun: false });

    // The call count, not the throw: a gate that fires after the upload protects nobody.
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(uploadedDoc()).toBeNull();
  });

  test('the renders row is not patched', async () => {
    await backfillUrduOverlays({ dryRun: false });

    expect(supabase.__state.updates).toEqual([]);
  });

  test('and the model was actually asked — this is the gate refusing, not the walk skipping', async () => {
    // Without this the suite could pass on a row that was never a top-up candidate at all.
    const out = await backfillUrduOverlays({ dryRun: false });

    expect(create).toHaveBeenCalledTimes(1);
    expect(out.failed[0].segmentId).toBe(SEG);
  });
});

describe('the same lesson, written correctly, still reaches the teacher', () => {
  test('the honorific makes it a repair — the gate refuses the defect, not the subject', async () => {
    answersWith(HONORIFIED_TOPIC);

    const out = await backfillUrduOverlays({ dryRun: false });

    expect(out.failed).toEqual([]);
    expect(out.repaired).toBe(1);
    expect(uploadedDoc().ur_overlay['/provenance/topic']).toBe(HONORIFIED_TOPIC);
    expect(supabase.__state.updates.length).toBe(1);
  });
});
