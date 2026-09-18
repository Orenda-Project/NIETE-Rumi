/**
 * E2E — THE EIGHT ROWS THE LIVE RUN REFUSED FOR TRANSLATING CORRECTLY. bd-htw51 / bd-idneu.
 *
 * The unit suite pins the gate's arithmetic. This one drives the thing that actually ran against
 * production on 2026-09-18: `backfillUrduOverlays`, walking `niete_lp612_renders`, fetching the
 * stored Urdu document out of R2, topping up the pointers bd-x3dn6 widened the target set by, and
 * writing the repaired document back over the key the next cache hit reads.
 *
 * WHAT HAPPENED OUT THERE. The run attempted 23 rows and aborted with 0 repaired. Eight of the 23
 * died inside `overlayLessonPlan`'s Urdu floor — grade_12_chemistry.c10.r990 at 30.9%,
 * grade_10_physics.c16.p185-188 at 42.0%, grade_12_english.c01.p015-018.vocabulary_grammar at
 * 42.3%, and five more between 43.6% and 47.9%. Every one of them was a CORRECT translation. The
 * two strings a bd-idneu top-up asks for are `/provenance/chapter` and `/provenance/topic` —
 * chapter numbers, book names and the technical terms the overlay brief itself orders kept in
 * Latin as terms of record — and the 50% floor was calibrated for ninety strings of Urdu prose.
 *
 * The assertion is the artifact, at the layer the teacher meets it: the `.lp.json` written back to
 * the row's own `r2_key`, which is what every future cache hit for that lesson reads, must carry
 * the Urdu chapter and topic. Nothing below that proves a teacher's page changed.
 *
 * And the guarantee that was already shipped must survive: an ENGLISH answer to the delta is the
 * same defect as an English overlay, and it must still cost the row and leave R2 untouched.
 *
 * Red-first on bd-vrt20-backfill-run-driver: repaired 0, failed 1, uploads 0, reason
 * "the overlay is not Urdu — 47.3% of its letters are Urdu script", which is
 * grade_6_computer_science.c05.p078-079's number almost exactly.
 *
 * Doubled at their network boundaries only: supabase, R2, the model, and the renderer (which
 * launches Chromium out of process). `lp612-overlay-backfill.service`,
 * `lp612-overlay-topup.service`, `lp612-author.service` and the linter are the genuine modules.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const rawFixture = fs.readFileSync(BASE, 'utf8');
const doc = () => JSON.parse(rawFixture);

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
/** One of the eight, by name. It came back at 30.9% and was refused. */
const SEG = 'grade_12_chemistry.c10.r990';

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

/** The stored document: ninety strings of Urdu prose, and no provenance. */
const storedDoc = () => {
  const d = doc();
  d.ur_overlay = {};
  for (const ptr of overlayDefects.targets(d)) {
    if (ptr.startsWith('/provenance/')) continue;
    d.ur_overlay[ptr] = EXISTING_UR;
  }
  return d;
};

/**
 * What the model returns for chemistry provenance: Urdu, with the term of record left in Latin
 * because the brief orders it left there. This is a CORRECT answer, and it is the one production
 * refused.
 */
const UR_CHAPTER = 'باب 10 · Chemical Equilibrium';
const UR_TOPIC = 'حالتِ توازن اور Le Chatelier Principle کا اطلاق';
const UR_TITLE = 'کیمیائی توازن';

const reply = (obj) => ({
  choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 320, completion_tokens: 90, total_tokens: 410 },
});

const termOfRecordAnswer = () => create.mockImplementation(async () => reply({
  '/provenance/chapter': UR_CHAPTER,
  '/provenance/topic': UR_TOPIC,
  '/provenance/chapter_title': UR_TITLE,
}));

/** The document that was written back, parsed out of the R2 put. */
const uploadedDoc = () => {
  const put = uploadBuffer.mock.calls.find(([, key]) => String(key).endsWith('.lp.json'));
  return put ? JSON.parse(put[0].toString('utf8')) : null;
};

let tmpPdf;

beforeAll(() => {
  tmpPdf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-htw51-')), 'out.pdf');
  fs.writeFileSync(tmpPdf, Buffer.from('%PDF-1.7 repaired\n'));
});

beforeEach(() => {
  jest.clearAllMocks();
  supabase.__state.rows = [row()];
  supabase.__state.updates = [];
  downloadFromR2.mockResolvedValue(Buffer.from(JSON.stringify(storedDoc())));
  renderLessonPlan.mockResolvedValue({ pdfPath: tmpPdf, pageCount: 5, warnings: [] });
  uploadBuffer.mockResolvedValue({ ok: true });
  termOfRecordAnswer();
});

describe('a correctly translated provenance top-up reaches the teacher', () => {
  test('THE RED TEST — the row is repaired, not refused for being 47% Urdu', async () => {
    const out = await backfillUrduOverlays({ dryRun: false });

    // On bd-vrt20-backfill-run-driver: repaired 0, failed 1, OVERLAY_NOT_URDU at 47.3%. That is
    // the live run of 2026-09-18, reproduced.
    expect(out.failed).toEqual([]);
    expect(out.repaired).toBe(1);
  });

  test('the document behind the next cache hit carries the Urdu chapter and topic', async () => {
    await backfillUrduOverlays({ dryRun: false });

    const stored = uploadedDoc();
    expect(stored).toBeTruthy();
    expect(stored.ur_overlay['/provenance/chapter']).toBe(UR_CHAPTER);
    expect(stored.ur_overlay['/provenance/topic']).toBe(UR_TOPIC);
  });

  test('the ninety strings already in front of teachers are untouched', async () => {
    await backfillUrduOverlays({ dryRun: false });

    const stored = uploadedDoc();
    const kept = Object.entries(stored.ur_overlay)
      .filter(([ptr]) => !ptr.startsWith('/provenance/'));
    expect(kept.length).toBeGreaterThan(50);
    for (const [, ur] of kept) expect(ur).toBe(EXISTING_UR);
  });

  test('it is written over the row\'s OWN key, and the row is patched', async () => {
    await backfillUrduOverlays({ dryRun: false });

    const keys = uploadBuffer.mock.calls.map(([, k]) => k);
    expect(keys).toContain(`lp612/${TV}/ur/${SEG}.pdf`);
    expect(supabase.__state.updates.length).toBe(1);
  });
});

describe('an English answer still costs the row and writes nothing', () => {
  test('the guarantee shipped with bd-idneu survives the floor being moved onto the merge', async () => {
    // Ninety Urdu strings would carry the MERGE to ~97%. If the floor only looked there, this
    // would sail through and three lines of the teacher's page would silently be English.
    create.mockImplementation(async () => reply({
      '/provenance/chapter': 'Chapter 10 - Chemical Equilibrium',
      '/provenance/topic': 'Equilibrium and the Le Chatelier Principle',
      '/provenance/chapter_title': 'Chemical Equilibrium',
    }));

    const out = await backfillUrduOverlays({ dryRun: false });

    expect(out.repaired).toBe(0);
    expect(out.failed.length).toBe(1);
    expect(out.failed[0].error).toMatch(/no Urdu script at all/);
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(supabase.__state.updates).toEqual([]);
  });
});
