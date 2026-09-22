'use strict';
/**
 * PLAN R8 §2.2 (lane S) — the uploader records the slide script the served PDF
 * was rendered from, in the SAME run that makes the asset row.
 *
 * This is the only moment where the binding is free: the bytes, the hash, the
 * version stamp and the script are all in hand at once. Anything later has to
 * prove the script belongs to the PDF (that is what the backfill's link gate is
 * for, and why it can only ever reach `is_current` rows).
 *
 * Two levels, on purpose:
 *   1. `persistAssetRow` directly — every branch (first / reinstate / answer key /
 *      dry run / missing script / unreadable script / insert error);
 *   2. `main()` end to end over a real temp render tree with fs untouched and
 *      only supabase + R2 stubbed — so a `persistAssetRow` that nothing calls
 *      fails here rather than in production (root rule 6: the red test must
 *      execute the changed line on the live branch).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/storage/r2', () => ({ uploadBuffer: jest.fn().mockResolvedValue(true) }));
jest.mock('../../shared/services/quiz/lp-asset-source.store', () => ({
  upsertSource: jest.fn().mockResolvedValue({ asset_id: 'asset-new' }),
  TABLE: 'niete_lp_asset_sources',
}));

const supabase = require('../../shared/config/supabase');
const r2 = require('../../shared/storage/r2');
const SourceStore = require('../../shared/services/quiz/lp-asset-source.store');
const uploader = require('../../scripts/upload-lp-v8-to-r2');

const LESSON = 'grade_1_english_ch1_seg1';           // present in bot/data/lp_catalog.json
const STAMP = 'v8';
const SCRIPT = {
  meta: { topic: 'The sounds of m', isUrdu: false },
  iDo: { steps: [{ say: 'Watch my mouth when I say mmm.' }], misconception: { slip: 'Saying the letter name instead of the sound.' } },
  wrap: { exitOptions: ['m', 'n', 's', 't'] },
};

/** The uploader's own supabase usage: select existing rows, update flags, insert a row. */
function supabaseStub({ existing = [], insertError = null } = {}) {
  const ops = [];
  supabase.from.mockImplementation((table) => {
    const chain = {
      select: (cols) => { ops.push({ table, op: 'select', cols }); return chain; },
      eq: (f, v) => { ops.push({ table, op: 'eq', f, v }); return chain; },
      update: (patch) => { ops.push({ table, op: 'update', patch }); return chain; },
      insert: (row) => { ops.push({ table, op: 'insert', row }); return chain; },
      maybeSingle: async () => (
        ops[ops.length - 1] && ops.some((o) => o.op === 'insert')
          ? { data: insertError ? null : { id: 'asset-new' }, error: insertError }
          : { data: null, error: null }
      ),
      single: async () => ({ data: insertError ? null : { id: 'asset-new' }, error: insertError }),
      then: (resolve) => resolve({ data: existing, error: null }),
    };
    return chain;
  });
  return ops;
}

/** A render tree exactly as niete-nbpro leaves one: out/<round>/<lid>.pdf + out/<round>/<lid>/_slide_script.json */
function renderTree({ withScript = true, badScript = false, lessonId = LESSON } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lpv8-src-'));
  const outDir = path.join(root, 'out', 'v8');
  fs.mkdirSync(outDir, { recursive: true });
  const pdfPath = path.join(outDir, `${lessonId}.pdf`);
  fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.5 not a real pdf, gs will decline it\n'));
  if (withScript) {
    fs.mkdirSync(path.join(outDir, lessonId), { recursive: true });
    fs.writeFileSync(
      path.join(outDir, lessonId, '_slide_script.json'),
      badScript ? '{ this is not json' : JSON.stringify(SCRIPT),
    );
  }
  const manifest = path.join(outDir, 'MANIFEST.jsonl');
  fs.writeFileSync(manifest, `${JSON.stringify({
    id: lessonId,
    version_stamp: STAMP,
    pdf_sha1: 'sha1-of-the-render',
    rendered_at: '2026-09-20T09:00:00Z',
    files: { pdf: `out/v8/${lessonId}.pdf` },
  })}\n`);
  return { root, outDir, pdfPath, manifest };
}

const trees = [];
function tree(opts) { const t = renderTree(opts); trees.push(t); return t; }

afterAll(() => {
  for (const t of trees) { try { fs.rmSync(t.root, { recursive: true, force: true }); } catch (_) { /* best effort */ } }
});

const logs = [];
const log = (...a) => logs.push(a.join(' '));
beforeEach(() => { logs.length = 0; });

const baseItem = (extra = {}) => ({
  lesson_id: LESSON,
  asset_kind: 'lesson',
  pdf_path: `out/v8/${LESSON}.pdf`,
  version_stamp: STAMP,
  source_sha1: 'sha1-of-the-render',
  prompt_layer_sha: 'prompt-sha',
  rendered_at: '2026-09-20T09:00:00Z',
  ...extra,
});

describe('persistAssetRow — the asset row and its quiz source are written together', () => {
  test('a first upload inserts the asset and records the slide script with THAT asset\'s hash', async () => {
    const t = tree();
    const ops = supabaseStub();
    const out = await uploader.persistAssetRow({
      item: baseItem(),
      plan: { action: 'first', upload: true, supersede: [], r2_key: `lp-cache/v8/${LESSON}/abc123def456.pdf` },
      hash: 'abc123def456',
      buffer: Buffer.from('pdf-bytes'),
      sourceBytes: 42,
      pdfPath: t.pdfPath,
      commit: true,
      deps: { log },
    });

    expect(r2.uploadBuffer).toHaveBeenCalledTimes(1);
    expect(ops.find((o) => o.op === 'insert').row).toMatchObject({
      lesson_id: LESSON, content_hash: 'abc123def456', version_stamp: STAMP, asset_kind: 'lesson', is_current: true,
    });
    expect(SourceStore.upsertSource).toHaveBeenCalledTimes(1);
    expect(SourceStore.upsertSource).toHaveBeenCalledWith({
      asset_id: 'asset-new',
      lesson_id: LESSON,
      version_stamp: STAMP,
      content_hash: 'abc123def456',          // the asset's own hash, never the previous version's
      slide_script: SCRIPT,
      source_url: null,
      verified: 'upload',
    });
    expect(out).toMatchObject({ assetId: 'asset-new', source: { recorded: true } });
  });

  test('the is_current flip for an existing row records the source too, against the row it reinstates', async () => {
    const t = tree();
    supabaseStub();
    await uploader.persistAssetRow({
      item: baseItem(),
      plan: { action: 'reinstate', upload: false, reinstate: 'asset-old', supersede: ['asset-current'], r2_key: 'k' },
      hash: 'old99hash99',
      buffer: Buffer.from('pdf-bytes'),
      sourceBytes: 42,
      pdfPath: t.pdfPath,
      commit: true,
      deps: { log },
    });
    expect(SourceStore.upsertSource).toHaveBeenCalledWith(expect.objectContaining({
      asset_id: 'asset-old', content_hash: 'old99hash99', verified: 'upload',
    }));
  });

  test('no _slide_script.json → a warning line, no upsert, and the run continues', async () => {
    const t = tree({ withScript: false });
    supabaseStub();
    const out = await uploader.persistAssetRow({
      item: baseItem(),
      plan: { action: 'first', upload: true, supersede: [], r2_key: 'k' },
      hash: 'abc123def456',
      buffer: Buffer.from('pdf-bytes'),
      sourceBytes: 42,
      pdfPath: t.pdfPath,
      commit: true,
      deps: { log },
    });
    expect(SourceStore.upsertSource).not.toHaveBeenCalled();
    expect(out.source).toMatchObject({ recorded: false, reason: 'no_slide_script' });
    expect(logs.join('\n')).toMatch(/_slide_script\.json/);
    expect(logs.join('\n')).toMatch(/⚠/);
  });

  test('an unreadable _slide_script.json warns and continues — a bad script never fails the upload', async () => {
    const t = tree({ badScript: true });
    supabaseStub();
    const out = await uploader.persistAssetRow({
      item: baseItem(),
      plan: { action: 'first', upload: true, supersede: [], r2_key: 'k' },
      hash: 'abc123def456',
      buffer: Buffer.from('pdf-bytes'),
      sourceBytes: 42,
      pdfPath: t.pdfPath,
      commit: true,
      deps: { log },
    });
    expect(SourceStore.upsertSource).not.toHaveBeenCalled();
    expect(out.source).toMatchObject({ recorded: false, reason: 'bad_slide_script' });
    expect(logs.join('\n')).toMatch(/⚠/);
  });

  test('an answer key records NO source — it is not the lesson a quiz is written from', async () => {
    const t = tree();
    supabaseStub();
    await uploader.persistAssetRow({
      item: baseItem({ asset_kind: 'answer_key', pdf_path: `out/v8/${LESSON}.answer_key.pdf` }),
      plan: { action: 'first', upload: true, supersede: [], r2_key: 'k' },
      hash: 'key777hash77',
      buffer: Buffer.from('pdf-bytes'),
      sourceBytes: 42,
      pdfPath: t.pdfPath,
      commit: true,
      deps: { log },
    });
    expect(SourceStore.upsertSource).not.toHaveBeenCalled();
  });

  test('--dry-run writes nothing: no R2 object, no asset row, no source row', async () => {
    const t = tree();
    const ops = supabaseStub();
    const out = await uploader.persistAssetRow({
      item: baseItem(),
      plan: { action: 'first', upload: true, supersede: [], r2_key: 'k' },
      hash: 'abc123def456',
      buffer: Buffer.from('pdf-bytes'),
      sourceBytes: 42,
      pdfPath: t.pdfPath,
      commit: false,
      deps: { log },
    });
    expect(r2.uploadBuffer).not.toHaveBeenCalled();
    expect(ops).toEqual([]);
    expect(SourceStore.upsertSource).not.toHaveBeenCalled();
    expect(out).toMatchObject({ assetId: null });
  });

  test('a failed asset insert throws — it must not be counted as a shipped lesson', async () => {
    const t = tree();
    supabaseStub({ insertError: { message: 'duplicate key value violates unique constraint' } });
    await expect(uploader.persistAssetRow({
      item: baseItem(),
      plan: { action: 'first', upload: true, supersede: [], r2_key: 'k' },
      hash: 'abc123def456',
      buffer: Buffer.from('pdf-bytes'),
      sourceBytes: 42,
      pdfPath: t.pdfPath,
      commit: true,
      deps: { log },
    })).rejects.toThrow(/duplicate key/);
    expect(SourceStore.upsertSource).not.toHaveBeenCalled();
  });
});

describe('slideScriptPathFor — where the renderer actually leaves the script', () => {
  test('finds <render dir>/<lesson_id>/_slide_script.json (generate.js writes it into the lesson dir)', () => {
    const t = tree();
    const found = uploader.slideScriptPathFor(t.pdfPath, LESSON);
    expect(found.path).toBe(path.join(t.outDir, LESSON, '_slide_script.json'));
  });

  test('also accepts the script sitting directly beside the PDF', () => {
    const t = tree({ withScript: false });
    const sibling = path.join(t.outDir, '_slide_script.json');
    fs.writeFileSync(sibling, JSON.stringify(SCRIPT));
    expect(uploader.slideScriptPathFor(t.pdfPath, LESSON).path).toBe(sibling);
    fs.unlinkSync(sibling);
  });

  test('reports every place it looked when there is nothing to read', () => {
    const t = tree({ withScript: false });
    const found = uploader.slideScriptPathFor(t.pdfPath, LESSON);
    expect(found.path).toBeNull();
    expect(found.candidates).toHaveLength(2);
  });
});

describe('main() — the uploader run actually reaches persistAssetRow', () => {
  test('a --commit run over a real render tree records the slide script', async () => {
    const t = tree();
    supabaseStub();
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpv8-log-'));
    const argv = process.argv;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env.LP_V8_LOG_DIR = logDir;
    process.argv = ['node', 'upload-lp-v8-to-r2.js',
      '--manifest', t.manifest, '--root', t.root, '--only', LESSON, '--commit'];
    try {
      await uploader.main();
    } finally {
      process.argv = argv;
      delete process.env.LP_V8_LOG_DIR;
      logSpy.mockRestore();
      fs.rmSync(logDir, { recursive: true, force: true });
    }

    expect(SourceStore.upsertSource).toHaveBeenCalledTimes(1);
    expect(SourceStore.upsertSource).toHaveBeenCalledWith(expect.objectContaining({
      lesson_id: LESSON, version_stamp: STAMP, slide_script: SCRIPT, verified: 'upload', source_url: null,
    }));
  });
});
