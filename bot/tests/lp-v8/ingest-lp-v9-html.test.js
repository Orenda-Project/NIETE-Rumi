'use strict';
/**
 * `ingest-lp-v9-html.js` — the v9 lesson-plan HTMLs into the quiz source store.
 *
 * The sheet row pairs a shipped PDF with its HTML. A row is only ingested when it
 * PROVES it is about a version we serve: sha1(shipped PDF) === niete_lp_assets.source_sha1
 * — the asset's own record of the render it was made from. The source row is then
 * written under THAT asset's (lesson_id, version_stamp, content_hash), so the quiz
 * for a teacher is written from the version in their hand.
 *
 * supabase, R2 and the file reads are stubbed; the script's own logic runs.
 */

const crypto = require('crypto');
const ingest = require('../../scripts/ingest-lp-v9-html');
const V9 = require('../../shared/services/quiz/lp-v9-html-source');
const { EN } = require('../../../tests/quiz/fixtures/lp-v9-html');

const LESSON = 'grade_2_math_ch6_seg3';
const PDF_SHA1 = 'a'.repeat(40);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const ASSET = {
  id: 'asset-9', lesson_id: LESSON, version_stamp: 'ch37_2Oct', content_hash: 'c0ffee000001',
  source_sha1: PDF_SHA1, asset_kind: 'lesson', is_current: true,
};

function row(extra = {}) {
  return {
    tab: 'Maths', row: 10, status: 'fetched', lesson_id: LESSON, pdf_sha1: PDF_SHA1,
    html_path: '/cache/x.html', html_sha256: sha256(EN), html_bytes: Buffer.byteLength(EN), ...extra,
  };
}

/** A fake store: the asset rows and the existing source rows, and what was upserted. */
function deps({ assets = [ASSET], sources = [], files = { '/cache/x.html': EN }, r2Has = {} } = {}) {
  const upserts = [];
  const puts = [];
  return {
    upserts,
    puts,
    readAssets: jest.fn(async (lessonIds) => assets.filter((a) => lessonIds.includes(a.lesson_id))),
    readSources: jest.fn(async (assetIds) => sources.filter((s) => assetIds.includes(s.asset_id))),
    upsertSource: jest.fn(async (r) => { upserts.push(r); return { asset_id: r.asset_id }; }),
    r2: {
      headObject: jest.fn(async (key) => (r2Has[key] ? { exists: true, sizeBytes: r2Has[key] } : { exists: false })),
      uploadBuffer: jest.fn(async (buf, key) => { puts.push({ key, bytes: buf.length }); return key; }),
    },
    readFile: jest.fn(async (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; }),
  };
}

test('a proven row: the HTML goes to R2 under the served hash and its source row under the served triple', async () => {
  const d = deps();
  const out = await ingest.run([row()], { ...d, applyR2: true, applyDb: true });
  expect(out[0]).toMatchObject({
    outcome: 'ingested', lesson_id: LESSON, version_stamp: 'ch37_2Oct', content_hash: 'c0ffee000001', language: 'en',
    r2_key: `lp/v9/html/${LESSON}/c0ffee000001.html`,
  });
  expect(d.puts).toEqual([{ key: `lp/v9/html/${LESSON}/c0ffee000001.html`, bytes: Buffer.byteLength(EN) }]);
  expect(d.upserts).toHaveLength(1);
  const up = d.upserts[0];
  expect(up).toMatchObject({
    asset_id: 'asset-9', lesson_id: LESSON, version_stamp: 'ch37_2Oct', content_hash: 'c0ffee000001',
    verified: 'v9_html', source_url: `lp/v9/html/${LESSON}/c0ffee000001.html`,
  });
  expect(up.slide_script.meta).toMatchObject({ source: 'v9_html', htmlSha256: sha256(EN), lessonId: LESSON });
  expect(up.slide_script.goal).toBe('Sharing means putting the same number of things in every group.');
});

test('a row whose shipped PDF is not a version we serve is never ingested (no guessing by lesson id)', async () => {
  const d = deps();
  const out = await ingest.run([row({ pdf_sha1: 'b'.repeat(40) })], { ...d, applyR2: true, applyDb: true });
  expect(out[0].outcome).toBe('no_served_version');
  expect(d.upserts).toHaveLength(0);
  expect(d.puts).toHaveLength(0);
});

test('idempotent: the same HTML already ingested for that version is skipped (content-hash rule)', async () => {
  const key = `lp/v9/html/${LESSON}/c0ffee000001.html`;
  const d = deps({
    sources: [{ asset_id: 'asset-9', verified: 'v9_html', html_sha: sha256(EN), adapter_v: String(V9.ADAPTER_VERSION) }],
    r2Has: { [key]: Buffer.byteLength(EN) },
  });
  const out = await ingest.run([row()], { ...d, applyR2: true, applyDb: true });
  expect(out[0].outcome).toBe('unchanged');
  expect(d.upserts).toHaveLength(0);
  expect(d.puts).toHaveLength(0);
});

test('a version that already has a proven slide script is never overwritten by an HTML', async () => {
  const d = deps({ sources: [{ asset_id: 'asset-9', verified: 'backfill:link', html_sha: null }] });
  const out = await ingest.run([row()], { ...d, applyR2: true, applyDb: true });
  expect(out[0].outcome).toBe('has_other_source');
  expect(d.upserts).toHaveLength(0);
});

test('an invalid document is named, not ingested; a dry run writes nothing', async () => {
  const bad = deps({ files: { '/cache/x.html': '<html lang="en"><body><script>x()</script></body></html>' } });
  expect((await ingest.run([row()], { ...bad, applyR2: true, applyDb: true }))[0].outcome).toBe('invalid:has_script');
  const dry = deps();
  const out = await ingest.run([row()], { ...dry, applyR2: false, applyDb: false });
  expect(out[0].outcome).toBe('would_ingest');
  expect(dry.upserts).toHaveLength(0);
  expect(dry.puts).toHaveLength(0);
});

test('two sheet rows for the same served version: the second is a duplicate, not a second write', async () => {
  const d = deps();
  const out = await ingest.run([row(), row({ row: 11 })], { ...d, applyR2: true, applyDb: true });
  expect(out.map((o) => o.outcome)).toEqual(['ingested', 'duplicate_row']);
  expect(d.upserts).toHaveLength(1);
});

test('an assessment day (_seg995) is never a quiz source: named, not read, not written', async () => {
  const d = deps({ assets: [{ ...ASSET, lesson_id: 'grade_2_math_ch6_seg995' }] });
  const out = await ingest.run([row({ lesson_id: 'grade_2_math_ch6_seg995' })], { ...d, applyR2: true, applyDb: true });
  expect(out[0].outcome).toBe('skipped:assessment_day');
  expect(d.readFile).not.toHaveBeenCalled();
  expect(d.upserts).toHaveLength(0);
});

test('the same HTML read by an OLDER adapter is re-read, not skipped (the skip rule is HTML hash + adapter version)', async () => {
  const key = `lp/v9/html/${LESSON}/c0ffee000001.html`;
  const d = deps({
    sources: [{ asset_id: 'asset-9', verified: 'v9_html', html_sha: sha256(EN), adapter_v: null }],
    r2Has: { [key]: Buffer.byteLength(EN) },
  });
  const out = await ingest.run([row()], { ...d, applyR2: true, applyDb: true });
  expect(out[0].outcome).toBe('ingested');
  expect(d.puts).toHaveLength(0); // the object in R2 is already this HTML
  expect(d.upserts[0].slide_script.meta.adapterV).toBe(V9.ADAPTER_VERSION);
});
