/**
 * WHERE THE REPAIR IS ALLOWED TO LAND — bd-idneu, unit half of the corpus driver.
 *
 * The e2e suite drives the walk. This one pins the two pure decisions the walk makes 302 times,
 * because both of them fail SILENTLY and both of them fail across the whole corpus at once:
 *
 *   THE KEY. The row carries `r2_key`, and `segment_id + lang + template_version` derives it. Those
 *   two must agree. If they do not, this row is not the plain cache entry the repair assumes — a
 *   hand-patched row, an edit fork, a template_version that moved under it — and overwriting the
 *   object it points at is writing a repair on top of something we have not identified. The driver
 *   refuses it and says so rather than guessing which of the two is right.
 *
 *   THE VERDICT. Every row resolves to exactly one outcome before any money is spent: repair it,
 *   skip it by a named reason, or refuse it. A row that falls through unclassified is a row the
 *   summary cannot count, and the summary is the only thing anyone reads after a 302-row run.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const rawFixture = fs.readFileSync(BASE, 'utf8');
const doc = () => JSON.parse(rawFixture);

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(), uploadBuffer: jest.fn(),
}));
jest.mock('../../bot/shared/services/lp612-render.service', () => ({ renderLessonPlan: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const {
  backfillKeysFor,
  classifyRow,
  BACKFILL_SKIPPED,
} = require('../../bot/shared/services/lp612-overlay-backfill.service');

const TV = 'v9.6';
const SEG = 'grade_9_mathematics.c01.p024-025';

const row = (over = {}) => ({
  id: 'row-1',
  segment_id: SEG,
  lang: 'ur',
  template_version: TV,
  status: 'ready',
  r2_key: `lp612/${TV}/ur/${SEG}.pdf`,
  ...over,
});

/** Authored before bd-x3dn6: every offered pointer translated EXCEPT the provenance trio. */
const preFixDoc = () => {
  const d = doc();
  d.ur_overlay = {};
  for (const ptr of overlayDefects.targets(d)) {
    if (!ptr.startsWith('/provenance/')) d.ur_overlay[ptr] = 'اردو';
  }
  return d;
};

// ── A. the key ────────────────────────────────────────────────────────────────

describe('A — the repair lands on the object the row itself points at', () => {
  test('a plain cache row derives exactly its own r2_key, and the doc key beside it', () => {
    const r = row();
    const { pdfKey, docKey } = backfillKeysFor(r);

    expect(pdfKey).toBe(r.r2_key);
    expect(docKey).toBe(`lp612/${TV}/ur/${SEG}.lp.json`);
  });

  test('a row whose r2_key DISAGREES with its own cache key is refused, not overwritten', () => {
    // Nothing good is on the other side of this. Either the row was hand-patched, or it is an
    // edit fork (`lp612/{tv}/{lang}/edits/...`), or template_version moved after the render. In
    // every one of those the object is not the plain cache entry this repair is written for.
    expect(() => backfillKeysFor(row({ r2_key: `lp612/${TV}/ur/edits/${SEG}/ab12cd34.pdf` })))
      .toThrow(/r2_key/i);
    expect(() => backfillKeysFor(row({ r2_key: `lp612/v9.5/ur/${SEG}.pdf` })))
      .toThrow(/r2_key/i);
  });

  test('a row with no r2_key at all is refused — there is nothing to overwrite', () => {
    expect(() => backfillKeysFor(row({ r2_key: null }))).toThrow(/r2_key/i);
  });

  test('every key it derives stays inside the lane\'s prefix', () => {
    const { pdfKey, docKey } = backfillKeysFor(row());
    expect(pdfKey.startsWith('lp612/')).toBe(true);
    expect(docKey.startsWith('lp612/')).toBe(true);
  });
});

// ── B. the verdict ────────────────────────────────────────────────────────────

describe('B — every row gets exactly one named verdict before anything is spent', () => {
  test('a pre-bd-x3dn6 Urdu document is a repair, and names the pointers it is missing', () => {
    const v = classifyRow(row(), preFixDoc());

    expect(v.action).toBe('repair');
    expect(v.missing).toEqual(expect.arrayContaining([
      '/provenance/topic', '/provenance/chapter', '/provenance/chapter_title',
    ]));
  });

  test('a fully-covered document is skipped as already_complete — most of the corpus is free', () => {
    const d = doc();
    d.ur_overlay = Object.fromEntries(overlayDefects.targets(d).map((p) => [p, 'اردو']));

    expect(classifyRow(row(), d).action).toBe('skip');
    expect(classifyRow(row(), d).reason).toBe(BACKFILL_SKIPPED.COMPLETE);
  });

  test('a document with NO overlay is skipped as not_overlaid, never partly translated', () => {
    const d = doc();
    delete d.ur_overlay;

    const v = classifyRow(row(), d);
    expect(v.action).toBe('skip');
    expect(v.reason).toBe(BACKFILL_SKIPPED.NOT_OVERLAID);
  });

  test('a missing document is skipped as no_stored_doc rather than treated as empty', () => {
    // `null` here means R2 had no object at the doc key. Reading that as "an empty overlay" would
    // turn an unreadable lesson into the most urgent repair in the corpus.
    const v = classifyRow(row(), null);
    expect(v.action).toBe('skip');
    expect(v.reason).toBe(BACKFILL_SKIPPED.NO_DOC);
  });

  test('every named reason is reachable, so the run summary can never total short', () => {
    const reasons = new Set(Object.values(BACKFILL_SKIPPED));
    const d = doc();
    d.ur_overlay = Object.fromEntries(overlayDefects.targets(d).map((p) => [p, 'اردو']));
    const seen = new Set([
      classifyRow(row(), null).reason,
      classifyRow(row(), (() => { const x = doc(); delete x.ur_overlay; return x; })()).reason,
      classifyRow(row(), d).reason,
    ]);
    expect(seen).toEqual(reasons);
  });
});
