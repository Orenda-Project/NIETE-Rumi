#!/usr/bin/env node
'use strict';
/**
 * Ingest the v9 K-5 lesson-plan HTMLs as the quiz source of the version each one
 * was served as.
 *
 *   node scripts/ingest-lp-v9-html.js --manifest <fetch.jsonl> --out <result.jsonl> --expect-ref <supabase ref>
 *        [--apply-r2] [--apply-db] [--emit-rows <rows.jsonl>] [--limit N]
 *
 * Nothing is written unless asked (--apply-r2 / --apply-db); without them it is a
 * dry run that names what it would do. --expect-ref is required: the script refuses
 * to run when SUPABASE_URL is not that project.
 *
 * INPUT — one line per sheet row (made by the fetcher, which reads the ICT K-5
 * curriculum sheet's `v9 · F · LP (raw HTML)` column and the row's shipped PDF):
 *   { tab, row, status:'fetched', lesson_id, pdf_sha1, html_path, html_sha256, html_bytes }
 *
 * THE PROOF. A row is ingested only when sha1(shipped PDF) equals
 * `niete_lp_assets.source_sha1` of a lesson asset of that lesson — the asset's own
 * record of the render it was made from. The HTML is the document that render was
 * made from, so it is stored under THAT asset's (lesson_id, version_stamp,
 * content_hash): the exact-version key every reader uses (lp-asset-source.store).
 * Never "the newest asset of this lesson".
 *
 * WHAT IS WRITTEN (per proven row):
 *   R2  lp/v9/html/<lesson_id>/<content_hash>.html   the raw document (text/html)
 *   DB  niete_lp_asset_sources                        slide_script = lp-v9-html-source.toSlideScript(html),
 *                                                     verified 'v9_html', source_url = the R2 key
 *
 * IDEMPOTENT. A version whose source row is already this HTML (same sha256, in
 * slide_script.meta.htmlSha256) read by this adapter (meta.adapterV) and whose R2
 * object is there at that size is `unchanged`. A version whose source is a proven v8 slide script is never
 * overwritten (`has_other_source`).
 *
 * OUTCOMES (one per row, totalled): ingested | would_ingest | unchanged | skipped:assessment_day |
 *   no_served_version | has_other_source | duplicate_row | invalid:<reason> |
 *   read_failed | write_failed | skipped:<fetch status>
 */

const fs = require('fs');
const crypto = require('crypto');
const V9 = require('../shared/services/quiz/lp-v9-html-source');

const VERIFIED = 'v9_html';
const IN_CHUNK = 200;
const ASSESSMENT_SUFFIX = '_seg995';

const r2KeyFor = (a) => `lp/v9/html/${a.lesson_id}/${a.content_hash}.html`;

function chunks(list, n = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/**
 * @param {Array<object>} rows the fetch manifest
 * @param {object} d injected: readAssets(lessonIds), readSources(assetIds), upsertSource(row),
 *   r2 {headObject, uploadBuffer}, readFile(path), applyR2, applyDb, emit(row)?
 * @returns {Promise<Array<object>>} one result per row (keys + hashes + outcome, never text)
 */
async function run(rows, d) {
  const fetched = rows.filter((r) => r.status === 'fetched' && r.lesson_id && r.pdf_sha1);
  const lessonIds = [...new Set(fetched.map((r) => r.lesson_id))];
  const assets = [];
  for (const part of chunks(lessonIds)) assets.push(...(await d.readAssets(part))); // eslint-disable-line no-await-in-loop
  const bySha = new Map();
  assets.filter((a) => a.asset_kind === 'lesson' && a.source_sha1)
    .forEach((a) => bySha.set(`${a.lesson_id}|${a.source_sha1}`, a));
  const matchedIds = [...new Set(fetched.map((r) => bySha.get(`${r.lesson_id}|${r.pdf_sha1}`)).filter(Boolean).map((a) => a.id))];
  const sources = new Map();
  for (const part of chunks(matchedIds)) (await d.readSources(part)).forEach((s) => sources.set(s.asset_id, s)); // eslint-disable-line no-await-in-loop

  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const base = { tab: r.tab, row: r.row, lesson_id: r.lesson_id || null, html_sha256: r.html_sha256 || null, html_bytes: r.html_bytes || null };
    const done = (outcome, extra = {}) => { out.push({ ...base, ...extra, outcome }); };
    if (r.status !== 'fetched' || !r.lesson_id || !r.pdf_sha1) { done(`skipped:${r.status || 'unknown'}`); continue; }
    // An assessment day is never made into a quiz (the /quiz list and the 15:00 offer both drop it).
    if (String(r.lesson_id).endsWith(ASSESSMENT_SUFFIX)) { done('skipped:assessment_day'); continue; }
    const asset = bySha.get(`${r.lesson_id}|${r.pdf_sha1}`);
    if (!asset) { done('no_served_version'); continue; }
    const keys = {
      version_stamp: asset.version_stamp, content_hash: asset.content_hash, is_current: Boolean(asset.is_current), r2_key: r2KeyFor(asset),
    };
    if (seen.has(asset.id)) { done('duplicate_row', keys); continue; }
    seen.add(asset.id);

    const existing = sources.get(asset.id);
    if (existing && existing.verified !== VERIFIED) { done('has_other_source', keys); continue; }

    let html;
    try {
      html = String(await d.readFile(r.html_path)); // eslint-disable-line no-await-in-loop
    } catch (err) { done('read_failed', keys); continue; }
    const sha = crypto.createHash('sha256').update(html).digest('hex');
    const v = V9.validate(html, { lessonId: asset.lesson_id });
    if (!v.ok) { done(`invalid:${v.reason}`, { ...keys, html_sha256: sha }); continue; }
    const withLang = { ...keys, html_sha256: sha, language: v.language, body_chars: v.bodyChars };

    const bytes = Buffer.from(html, 'utf8');
    let head = { exists: false };
    try {
      head = await d.r2.headObject(keys.r2_key); // eslint-disable-line no-await-in-loop
    } catch (err) { head = { exists: false }; }
    const r2Same = head.exists && head.sizeBytes === bytes.length;
    if (existing && existing.html_sha === sha && String(existing.adapter_v) === String(V9.ADAPTER_VERSION) && r2Same) {
      done('unchanged', withLang); continue;
    }

    const slideScript = V9.toSlideScript(html, { lessonId: asset.lesson_id });
    slideScript.meta.htmlSha256 = sha;
    const sourceRow = {
      asset_id: asset.id,
      lesson_id: asset.lesson_id,
      version_stamp: asset.version_stamp,
      content_hash: asset.content_hash,
      slide_script: slideScript,
      source_url: keys.r2_key,
      verified: VERIFIED,
    };
    if (!d.applyR2 && !d.applyDb) {
      if (d.emit) d.emit(sourceRow);
      done('would_ingest', withLang);
      continue;
    }
    try {
      if (d.applyR2 && !r2Same) await d.r2.uploadBuffer(bytes, keys.r2_key, 'text/html; charset=utf-8'); // eslint-disable-line no-await-in-loop
      if (d.emit) d.emit(sourceRow);
      if (d.applyDb) await d.upsertSource(sourceRow); // eslint-disable-line no-await-in-loop
      done('ingested', withLang);
    } catch (err) {
      done('write_failed', { ...withLang, error: String(err.message || err).slice(0, 160) });
    }
  }
  return out;
}

function parseArgs(argv) {
  const a = { applyR2: false, applyDb: false, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--apply-r2') a.applyR2 = true;
    else if (k === '--apply-db') a.applyDb = true;
    else if (k === '--manifest') { a.manifest = argv[i + 1]; i += 1; } else if (k === '--out') { a.out = argv[i + 1]; i += 1; } else if (k === '--emit-rows') { a.emitRows = argv[i + 1]; i += 1; } else if (k === '--expect-ref') { a.expectRef = argv[i + 1]; i += 1; } else if (k === '--limit') { a.limit = parseInt(argv[i + 1], 10); i += 1; }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest || !args.out || !args.expectRef) {
    console.error('usage: --manifest <in.jsonl> --out <out.jsonl> --expect-ref <ref> [--apply-r2] [--apply-db] [--emit-rows <f>] [--limit N]');
    process.exit(2);
  }
  if (!String(process.env.SUPABASE_URL || '').includes(args.expectRef)) {
    console.error('REFUSED: SUPABASE_URL is not the expected project');
    process.exit(3);
  }
  const supabase = require('../shared/config/supabase');
  const Store = require('../shared/services/quiz/lp-asset-source.store');
  const r2 = require('../shared/storage/r2');
  let rows = fs.readFileSync(args.manifest, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (args.limit) rows = rows.slice(0, args.limit);
  const emitted = args.emitRows ? fs.openSync(args.emitRows, 'w') : null;
  const out = await run(rows, {
    applyR2: args.applyR2,
    applyDb: args.applyDb,
    emit: emitted ? (r) => fs.writeSync(emitted, `${JSON.stringify(r)}\n`) : null,
    readFile: (p) => fs.promises.readFile(p, 'utf8'),
    r2: { headObject: r2.headObject, uploadBuffer: r2.uploadBuffer },
    upsertSource: (r) => Store.upsertSource(r),
    readAssets: async (ids) => {
      const { data, error } = await supabase.from('niete_lp_assets')
        .select('id, lesson_id, version_stamp, content_hash, source_sha1, asset_kind, is_current').in('lesson_id', ids);
      if (error) throw new Error(`niete_lp_assets: ${error.message}`);
      return data || [];
    },
    readSources: async (ids) => {
      const { data, error } = await supabase.from('niete_lp_asset_sources')
        .select('asset_id, verified, html_sha:slide_script->meta->>htmlSha256, adapter_v:slide_script->meta->>adapterV').in('asset_id', ids);
      if (error) throw new Error(`${Store.TABLE}: ${error.message}`);
      return data || [];
    },
  });
  if (emitted) fs.closeSync(emitted);
  fs.writeFileSync(args.out, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const totals = out.reduce((t, o) => { t[o.outcome] = (t[o.outcome] || 0) + 1; return t; }, {});
  console.log(JSON.stringify({ rows: out.length, totals }));
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { run, r2KeyFor, VERIFIED };
