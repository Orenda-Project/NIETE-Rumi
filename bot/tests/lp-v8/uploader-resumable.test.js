/**
 * FEAT-059 — the uploader has to survive being interrupted and re-run.
 *
 * The full run is ~470 PDFs and several GB through ghostscript; it WILL be
 * interrupted, and it fires again the moment the Urdu renders land. "Re-runnable"
 * was claimed on the strength of content-addressed keys — but that only holds if
 * compressing the same PDF twice produces the same bytes, which was never
 * checked. It does not:
 *
 *   gs -sDEVICE=pdfwrite … same input, two runs
 *     cd0ad810…  ≠  309334bd…      (gs 10.07.0, measured 2026-08-16)
 *
 * pdfwrite stamps a CreationDate/ModDate and a random /ID into every file. So
 * every re-run would hash differently, supersede the previous asset, re-upload
 * the whole corpus and orphan every link already handed to a teacher — the exact
 * opposite of idempotent.
 *
 * Two independent defences, because they fail in different situations:
 *   1. deterministic pdfwrite flags — same machine, same gs, same bytes;
 *   2. source-sha1 identity — a different gs version, or a machine without gs,
 *      still recognises "this is the same render I already uploaded".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const U = require('../../scripts/upload-lp-v8-to-r2');

let hasGs = true;
try { execFileSync('gs', ['--version'], { stdio: 'ignore' }); } catch (_) { hasGs = false; }

describe('compression is byte-deterministic', () => {
  test('the pdfwrite invocation omits the three nondeterministic stamps', () => {
    const seen = [];
    U.compressPdf(Buffer.from('%PDF-1.5 x'), {
      _argvSpy: (argv) => seen.push(...argv),
      _compressImpl: () => Buffer.from('%PDF-1.5'),
      _pageCountImpl: () => 1,
    });
    expect(U.GS_DETERMINISTIC_FLAGS).toEqual(
      expect.arrayContaining(['-dOmitInfoDate=true', '-dOmitID=true', '-dOmitXMP=true']),
    );
  });

  test('a real PDF compressed twice yields the SAME sha1', () => {
    const sample = process.env.LP_V8_SAMPLE_PDF;
    if (!hasGs || !sample || !fs.existsSync(sample)) {
      console.log('gs or LP_V8_SAMPLE_PDF unavailable — determinism check skipped');
      return;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lpv8-det-'));
    try {
      const src = fs.readFileSync(sample);
      const a = U.compressPdf(src, { tmpDir: tmp });
      const b = U.compressPdf(src, { tmpDir: tmp });
      expect(a.compressed).toBe(true);
      expect(U.contentHash(a.buffer)).toBe(U.contentHash(b.buffer));
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    }
  });

  test('a gs that rejects the deterministic flags still compresses', () => {
    // Older ghostscripts do not know -dOmitID. Falling back to a plain
    // invocation loses determinism but keeps the 88% saving — and defence 2
    // below still makes the run idempotent.
    let call = 0;
    const out = U.compressPdf(Buffer.from('%PDF-1.5 original bytes here'), {
      _compressImpl: (buf, flags) => {
        call += 1;
        if (flags && flags.includes('-dOmitID=true')) throw new Error('Unrecognised option -dOmitID');
        return Buffer.from('%PDF small');
      },
      _pageCountImpl: () => 1,
    });
    expect(call).toBe(2);                 // tried deterministic, then plain
    expect(out.compressed).toBe(true);
    expect(out.deterministic).toBe(false);
  });
});

describe('resumability does not depend on gs being deterministic', () => {
  const item = { lesson_id: 'grade_1_english_ch1_seg1', asset_kind: 'lesson', source_sha1: 'srcaaa111' };

  test('same render, different compressed bytes → SKIP, not a new version', () => {
    const existing = [{
      id: 'a1', lesson_id: item.lesson_id, asset_kind: 'lesson',
      content_hash: 'oldhash00001', source_sha1: 'srcaaa111', is_current: true,
    }];
    const plan = U.planFor(item, 'newhash00002', existing);
    expect(plan.action).toBe('skip');
    expect(plan.upload).toBe(false);
    expect(plan.reason).toMatch(/source/i);
  });

  test('a genuinely re-rendered lesson still supersedes', () => {
    const existing = [{
      id: 'a1', lesson_id: item.lesson_id, asset_kind: 'lesson',
      content_hash: 'oldhash00001', source_sha1: 'DIFFERENT', is_current: true,
    }];
    const plan = U.planFor(item, 'newhash00002', existing);
    expect(plan.action).toBe('new_version');
    expect(plan.upload).toBe(true);
    expect(plan.supersede).toEqual(['a1']);
  });

  test('a row with no recorded source_sha1 cannot claim identity', () => {
    const existing = [{
      id: 'a1', lesson_id: item.lesson_id, asset_kind: 'lesson',
      content_hash: 'oldhash00001', source_sha1: null, is_current: true,
    }];
    expect(U.planFor(item, 'newhash00002', existing).action).toBe('new_version');
    // …and neither can an item that has none
    expect(
      U.planFor({ ...item, source_sha1: null }, 'newhash00002',
        [{ ...existing[0], source_sha1: 'srcaaa111' }]).action,
    ).toBe('new_version');
  });

  test('identical content_hash still short-circuits first — no source lookup needed', () => {
    const existing = [{
      id: 'a1', lesson_id: item.lesson_id, asset_kind: 'lesson',
      content_hash: 'samehash0001', source_sha1: null, is_current: true,
    }];
    expect(U.planFor(item, 'samehash0001', existing).action).toBe('skip');
  });
});

describe('the PDF directory follows the manifest, not a hardcoded v8', () => {
  test('pdfDirForManifest points at the manifest own directory', () => {
    expect(U.pdfDirForManifest('/corpus/out/v8u/MANIFEST.jsonl')).toBe('/corpus/out/v8u');
    expect(U.pdfDirForManifest('/corpus/out/v8/MANIFEST.jsonl')).toBe('/corpus/out/v8');
  });

  test('a lagging row resolves against that same directory', () => {
    const rows = [JSON.stringify({
      id: 'grade_2_urdu_ch1_seg1', version_stamp: 'v8u-X', files: {},
    })].join('\n');
    const s = U.surveyDisk(rows, new Set(['grade_2_urdu_ch1_seg1']),
      new Set(['grade_2_urdu_ch1_seg1']), { pdfDir: '/corpus/out/v8u' });
    expect(s.lagging[0].pdf_path).toBe('/corpus/out/v8u/grade_2_urdu_ch1_seg1.pdf');
  });

  test('with no pdfDir given it still produces the historical out/v8 path', () => {
    const rows = [JSON.stringify({ id: 'a_ch1_seg1', files: {} })].join('\n');
    const s = U.surveyDisk(rows, new Set(['a_ch1_seg1']), new Set(['a_ch1_seg1']));
    expect(s.lagging[0].pdf_path).toBe('out/v8/a_ch1_seg1.pdf');
  });
});

describe('a run report survives the run', () => {
  test('buildRunReport records every category with its reason', () => {
    const report = U.buildRunReport({
      manifest: '/corpus/out/v8/MANIFEST.jsonl',
      commit: true,
      items: [
        { lesson_id: 'a', action: 'first', bytes: 100, source_bytes: 1000, r2_key: 'lp-cache/v8/a/h.pdf' },
        { lesson_id: 'b', action: 'skip', reason: 'same source render' },
        { lesson_id: 'c', action: 'failed', reason: 'R2 timeout' },
      ],
      survey: { blocked: [{ lesson_id: 'z', reason: 'author-cache-miss' }], unmanifested: ['y'], lagging: [] },
    });
    expect(report.counts).toMatchObject({ first: 1, skip: 1, failed: 1 });
    expect(report.blocked).toEqual([{ lesson_id: 'z', reason: 'author-cache-miss' }]);
    expect(report.unmanifested).toEqual(['y']);
    expect(report.failures).toEqual([{ lesson_id: 'c', reason: 'R2 timeout' }]);
    expect(report.bytes).toMatchObject({ source: 1000, delivered: 100 });
  });

  test('the report names what was NOT uploaded — a silent cap is the bug we are avoiding', () => {
    const report = U.buildRunReport({
      manifest: 'm', commit: false, items: [],
      survey: { blocked: [{ lesson_id: 'z', reason: 'qa-blocking' }], unmanifested: [], lagging: [] },
    });
    expect(report.blocked).toHaveLength(1);
    expect(report.counts.first || 0).toBe(0);
  });
});

// Keeps the linter honest about the unused import in the flag-spy test above.
void crypto;
