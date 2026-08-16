/**
 * FEAT-059 / bd-9s1ie + bd-9dmq2 — v8 uploader + compression (TDD, red first).
 *
 * The uploader is the one pipeline that takes out/v8 to servable, and it is
 * re-runnable at any point while render-ops is still producing — that
 * re-runnability IS the "upload-ready the moment rendering completes" property.
 * So the tests are mostly about idempotency, the old-cache guard, and never
 * shipping a PDF that compression broke.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const U = require('../../scripts/upload-lp-v8-to-r2');

const hasGs = (() => {
  try { execFileSync('gs', ['--version'], { stdio: 'ignore' }); return true; } catch (_) { return false; }
})();

describe('r2 key shape', () => {
  test('lp-cache/v8/<lesson_id>/<content_hash>.pdf', () => {
    expect(U.r2KeyFor('grade_1_english_ch1_seg1', 'a1b2c3d4e5f6', 'lesson'))
      .toBe('lp-cache/v8/grade_1_english_ch1_seg1/a1b2c3d4e5f6.pdf');
  });

  test('answer keys sit beside the lesson under the same id', () => {
    expect(U.r2KeyFor('grade_1_english_ch1_seg995', 'deadbeef1234', 'answer_key'))
      .toBe('lp-cache/v8/grade_1_english_ch1_seg995/deadbeef1234.answer_key.pdf');
  });

  test('the key ALWAYS lands under the new prefix — the old prod cache is untouchable', () => {
    // The whole point of the new prefix: this feature must not be able to
    // write over lesson_plans/… or whatever pre_generated_lps points at.
    expect(U.assertNewPrefix('lp-cache/v8/x/abc.pdf')).toBe(true);
    for (const bad of [
      'lesson_plans/u/s_lesson_plan.pdf',
      'lp-cache/v7/x/abc.pdf',
      'reports/u/s_report.pdf',
      '../lp-cache/v8/x/abc.pdf',
      'lp-cache/v8x/abc.pdf',
    ]) {
      expect(() => U.assertNewPrefix(bad)).toThrow(/lp-cache\/v8/);
    }
  });

  test('content hash is 12 hex chars of sha1 over the DELIVERED bytes', () => {
    const h = U.contentHash(Buffer.from('hello'));
    expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect(h).toBe('aaf4c61ddcc5'); // sha1('hello') = aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
    expect(U.contentHash(Buffer.from('hello'))).toBe(h);
    expect(U.contentHash(Buffer.from('hello!'))).not.toBe(h);
  });
});

describe('manifest → work items', () => {
  const manifestLine = (o) => JSON.stringify({
    id: 'grade_1_english_ch1_seg1',
    round: 'v8',
    status: 'judged',
    files: { pdf: 'out/v8/grade_1_english_ch1_seg1.pdf' },
    pdf_sha1: 'abc123',
    pdf_bytes: 14783613,
    rendered_at: '2026-08-16T07:15:24.450Z',
    prompt_layer_sha_at_render: 'unknown:pre-log',
    version_stamp: 'v8-20260816T1650',
    ...o,
  });

  test('carries the full provenance chain off the manifest row', () => {
    const [item] = U.parseManifest(manifestLine({}), new Set(['grade_1_english_ch1_seg1']));
    expect(item).toMatchObject({
      lesson_id: 'grade_1_english_ch1_seg1',
      version_stamp: 'v8-20260816T1650',
      source_sha1: 'abc123',
      prompt_layer_sha: 'unknown:pre-log',
      rendered_at: '2026-08-16T07:15:24.450Z',
      asset_kind: 'lesson',
    });
  });

  test('a manifest id that is NOT in the catalog is reported, never invented', () => {
    const known = new Set(['grade_1_english_ch1_seg1']);
    const items = U.parseManifest(manifestLine({ id: 'grade_9_martian_ch1_seg1' }), known);
    expect(items).toEqual([]);
    expect(U.parseManifest.lastUnknown).toContain('grade_9_martian_ch1_seg1');
  });

  test('rows with no pdf are skipped', () => {
    expect(U.parseManifest(manifestLine({ files: { pdf: null } }), new Set(['grade_1_english_ch1_seg1']))).toEqual([]);
  });

  test('a blocked row is skipped — a judged-and-blocked LP must not reach a teacher', () => {
    const items = U.parseManifest(
      manifestLine({ blocked_by: 'design_gate' }),
      new Set(['grade_1_english_ch1_seg1']),
    );
    expect(items).toEqual([]);
  });

  test('malformed JSON lines do not kill the run', () => {
    expect(() => U.parseManifest('{not json\n' + manifestLine({}), new Set(['grade_1_english_ch1_seg1']))).not.toThrow();
  });
});

describe('manifest ↔ disk survey — no silent caps', () => {
  // A PDF on disk is NOT the same as a servable PDF. Measured against the real
  // corpus 2026-08-16: 338 lesson PDFs on disk, but only 272 manifest rows carry
  // files.pdf. The other 66 split three ways, and they must be reported
  // separately because they mean completely different things:
  //   65 are blocked_by a quality gate (author-cache-miss / not-rendered /
  //      prompt-over-cap / qa-blocking) — a PDF exists from an earlier render
  //      but must NOT reach a teacher;
  //    1 has no manifest row at all — render-ops has to explain it, we must not
  //      invent provenance for it;
  //    0 were genuine manifest lag on this run, though lag is possible while a
  //      render is in flight, so it stays a distinct category.
  // Shipping 272 and printing "done" would read as full coverage.
  const rows = [
    JSON.stringify({ id: 'a_ch1_seg1', status: 'rendered', files: { pdf: 'out/v8/a_ch1_seg1.pdf' }, version_stamp: 'v8-X' }),
    JSON.stringify({ id: 'a_ch1_seg2', status: 'authored', files: { pdf: null }, version_stamp: 'v8-X' }),
    JSON.stringify({ id: 'a_ch1_seg3', status: 'authored', files: { pdf: null }, blocked_by: 'qa-blocking', version_stamp: 'v8-X' }),
    JSON.stringify({ id: 'a_ch1_seg4', status: 'authored', files: { pdf: null }, version_stamp: 'v8-X' }),
  ].join('\n');
  const known = new Set(['a_ch1_seg1', 'a_ch1_seg2', 'a_ch1_seg3', 'a_ch1_seg4', 'a_ch1_seg9']);
  // seg1 planned, seg2 lagging, seg3 on disk but gate-blocked, seg9 unmanifested,
  // seg4 genuinely not rendered yet.
  const onDisk = new Set(['a_ch1_seg1', 'a_ch1_seg2', 'a_ch1_seg3', 'a_ch1_seg9']);

  test('by default only manifest rows WITH a pdf become work items', () => {
    expect(U.parseManifest(rows, known).map((i) => i.lesson_id)).toEqual(['a_ch1_seg1']);
  });

  test('surveyDisk splits the gap into lagging / blocked / unmanifested', () => {
    const s = U.surveyDisk(rows, known, onDisk);
    expect(s.lagging.map((i) => i.lesson_id)).toEqual(['a_ch1_seg2']);
    expect(s.blocked).toEqual([{ lesson_id: 'a_ch1_seg3', reason: 'qa-blocking' }]);
    expect(s.unmanifested).toEqual(['a_ch1_seg9']);
  });

  test('a gate-blocked PDF is NEVER picked up, even with --reconcile-disk', () => {
    const s = U.surveyDisk(rows, known, onDisk);
    expect(s.lagging.map((i) => i.lesson_id)).not.toContain('a_ch1_seg3');
  });

  test('an unmanifested PDF is reported, never uploaded — we cannot invent provenance', () => {
    const s = U.surveyDisk(rows, known, onDisk);
    expect(s.unmanifested).toContain('a_ch1_seg9');
    expect(s.lagging.map((i) => i.lesson_id)).not.toContain('a_ch1_seg9');
  });

  test('lagging rows keep their manifest provenance and a conventional path', () => {
    const [item] = U.surveyDisk(rows, known, onDisk).lagging;
    expect(item.pdf_path).toBe('out/v8/a_ch1_seg2.pdf');
    expect(item.version_stamp).toBe('v8-X');
    expect(item.reconciled).toBe(true);
  });

  test('surveyDisk never resurrects an id the catalog does not know', () => {
    const s = U.surveyDisk(rows, new Set(['a_ch1_seg1']), onDisk);
    expect(s.lagging).toEqual([]);
    expect(s.unmanifested).toEqual([]);
  });

  test('--reconcile-disk is opt-in, off by default', () => {
    expect(U.parseArgs([]).reconcileDisk).toBe(false);
    expect(U.parseArgs(['--reconcile-disk']).reconcileDisk).toBe(true);
  });
});

describe('compression (bd-9dmq2)', () => {
  let tmp;
  beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lpv8-')); });
  afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best effort */ } });

  const REAL_PDF = process.env.LP_V8_SAMPLE_PDF;

  test('a real v8 PDF compresses hard and stays intact', () => {
    if (!hasGs || !REAL_PDF || !fs.existsSync(REAL_PDF)) {
      console.log('gs or LP_V8_SAMPLE_PDF unavailable — real-PDF compression check skipped');
      return;
    }
    const src = fs.readFileSync(REAL_PDF);
    const out = U.compressPdf(src, { tmpDir: tmp });
    expect(out.buffer.length).toBeLessThan(src.length);
    expect(out.pages).toBe(U.pdfPageCount(src, tmp));   // never ship a truncated PDF
    expect(out.compressed).toBe(true);
    // measured on this corpus: ~12% of the original
    expect(out.buffer.length / src.length).toBeLessThan(0.5);
  });

  test('when gs is missing the original bytes are used and the run continues', () => {
    const src = Buffer.from('%PDF-1.5 fake');
    const out = U.compressPdf(src, { tmpDir: tmp, gsBin: '/nonexistent/gs' });
    expect(out.buffer).toEqual(src);
    expect(out.compressed).toBe(false);
    expect(out.reason).toMatch(/gs/i);
  });

  test('when the compressed output is not smaller, the original is kept', () => {
    const src = Buffer.from('%PDF-1.5 tiny');
    const out = U.compressPdf(src, {
      tmpDir: tmp,
      _compressImpl: () => Buffer.alloc(src.length + 100),  // "compression" that grew it
      _pageCountImpl: () => 1,
    });
    expect(out.buffer).toEqual(src);
    expect(out.compressed).toBe(false);
    expect(out.reason).toMatch(/larger|not smaller/i);
  });

  test('a page-count mismatch rejects the compressed output — a truncated PDF never ships', () => {
    const src = Buffer.from('%PDF-1.5 four pages');
    let call = 0;
    const out = U.compressPdf(src, {
      tmpDir: tmp,
      _compressImpl: () => Buffer.from('%PDF-1.5 two'),
      _pageCountImpl: () => (call++ === 0 ? 4 : 2),
    });
    expect(out.buffer).toEqual(src);
    expect(out.compressed).toBe(false);
    expect(out.reason).toMatch(/page count/i);
  });
});

describe('upload plan — idempotency and versioning (bd-9s1ie)', () => {
  const item = {
    lesson_id: 'grade_1_english_ch1_seg1',
    asset_kind: 'lesson',
    version_stamp: 'v8-20260816T1650',
    source_sha1: 'abc123',
  };

  test('identical bytes on a re-run → skipped, with no R2 call', () => {
    const existing = [{ lesson_id: item.lesson_id, asset_kind: 'lesson', content_hash: 'aaaaaaaaaaaa', is_current: true }];
    const plan = U.planFor(item, 'aaaaaaaaaaaa', existing);
    expect(plan.action).toBe('skip');
    expect(plan.upload).toBe(false);
  });

  test('changed bytes → upload, insert current, supersede the previous row', () => {
    const existing = [{ id: 'row-1', lesson_id: item.lesson_id, asset_kind: 'lesson', content_hash: 'aaaaaaaaaaaa', is_current: true }];
    const plan = U.planFor(item, 'bbbbbbbbbbbb', existing);
    expect(plan.action).toBe('new_version');
    expect(plan.upload).toBe(true);
    expect(plan.supersede).toEqual(['row-1']);
    expect(plan.r2_key).toBe('lp-cache/v8/grade_1_english_ch1_seg1/bbbbbbbbbbbb.pdf');
  });

  test('a first upload has nothing to supersede', () => {
    const plan = U.planFor(item, 'cccccccccccc', []);
    expect(plan.action).toBe('first');
    expect(plan.upload).toBe(true);
    expect(plan.supersede).toEqual([]);
  });

  test('reverting to a PREVIOUS version re-flags the old row rather than re-uploading', () => {
    // A re-render that lands back on earlier bytes: the object is already in R2
    // and the row already exists, so this is a flag flip, not an upload.
    const existing = [
      { id: 'row-1', lesson_id: item.lesson_id, asset_kind: 'lesson', content_hash: 'aaaaaaaaaaaa', is_current: false },
      { id: 'row-2', lesson_id: item.lesson_id, asset_kind: 'lesson', content_hash: 'bbbbbbbbbbbb', is_current: true },
    ];
    const plan = U.planFor(item, 'aaaaaaaaaaaa', existing);
    expect(plan.action).toBe('reinstate');
    expect(plan.upload).toBe(false);
    expect(plan.supersede).toEqual(['row-2']);
    expect(plan.reinstate).toBe('row-1');
  });

  test('lesson and answer_key for the same lesson_id are versioned independently', () => {
    const existing = [{ id: 'row-1', lesson_id: item.lesson_id, asset_kind: 'lesson', content_hash: 'aaaaaaaaaaaa', is_current: true }];
    const plan = U.planFor({ ...item, asset_kind: 'answer_key' }, 'dddddddddddd', existing);
    expect(plan.action).toBe('first');
    expect(plan.supersede).toEqual([]);
  });
});

describe('safety rails', () => {
  test('dry-run is the default — --commit is required to write', () => {
    expect(U.parseArgs([]).commit).toBe(false);
    expect(U.parseArgs(['--dry-run']).commit).toBe(false);
    expect(U.parseArgs(['--commit']).commit).toBe(true);
  });

  test('--only filters by lesson id substring, --limit caps the run', () => {
    const a = U.parseArgs(['--only', 'grade_1_english', '--limit', '5']);
    expect(a.only).toBe('grade_1_english');
    expect(a.limit).toBe(5);
  });
});
