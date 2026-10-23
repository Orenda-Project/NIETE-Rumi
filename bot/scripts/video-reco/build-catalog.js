#!/usr/bin/env node
'use strict';
/**
 * Build the bot's training-video catalogue (bd-gzfdu9): bot/shared/data/video-catalog.v1.json + the
 * thumbnails in bot/assets/video-thumbs/, from the VIDREC team's contracts/catalog.json (m-catalog).
 *
 *   node bot/scripts/video-reco/build-catalog.js <catalog.json | cards dir> <keywords.json> <thumbs dir>
 *        [--crosswalk indicator_crosswalk.json] [--meta catalog.meta.json] [--modules modules.json] [--out file] [--thumbs-out dir]
 *        [--vetoes ped/vetoes.json]...   (repeatable: the panel's binding vetoes, module or chapter entries)
 *
 * A cards dir (one <module_id>.json per module, DB fields absent) is merged with --modules (the DB rows).
 * Only the fields the engine reads are kept: no transcripts, no provenance. Thumbnails over 25 KB are
 * re-encoded with sharp. Idempotent: the same inputs give the same file except `built_at`/version time.
 * Refuses to write a file the validator rejects.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const V4_IDS = Object.freeze('B1 B2 B3 B4 B5 B6 B7 C1 C2 C3 C4 D1 D2 D3 D4 D5 F1 F2 F3 F4 F5 F6 F7 F8 F9 F10'.split(' '));
const THUMB_MAX_BYTES = 25 * 1024;

const MODULE_FIELDS = ['module_id', 'level_id', 'cpd_level', 'level_name', 'course_title', 'title', 'video_url', 'duration_s',
  'language', 'format', 'subjects', 'grade_band', 'teacher_line_en', 'teacher_line_ur', 'summary_en', 'summary_ur', 'moves',
  'fico', 'symptoms', 'not_for', 'topic', 'quality', 'recommendable', 'recommendable_reason', 'media_ok'];
// fico_main37: the prod scheme's ids per chapter (native match before the crosswalk); language: a chapter's own spoken
// language (module 60 splices Urdu and English). continues_to is dropped (SPEC v1.2.1: one chapter = one playable unit).
const SEGMENT_FIELDS = ['seg_id', 'start_s', 'end_s', 'title_en', 'title_ur', 'summary_en', 'moves', 'fico', 'fico_main37', 'language', 'recommendable', 'recommendable_reason', 'phase', 'grade_band'];

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}

function keywordIndex(keywords) {
  const idx = new Map();
  if (Array.isArray(keywords)) {
    for (const k of keywords) if (k && k.seg_id) idx.set(String(k.seg_id), Array.isArray(k.keywords) ? k.keywords : []);
  } else if (keywords && typeof keywords === 'object') {
    for (const [segId, v] of Object.entries(keywords)) {
      if (Array.isArray(v)) idx.set(segId, v);
      else if (v && Array.isArray(v.keywords)) idx.set(segId, v.keywords);
    }
  }
  return idx;
}

/**
 * 37-id (prod scheme) → {exact: v4 id|null, approx: [v4 ids], name} (target.js uses approx only under the subject rule;
 * name = the crosswalk's display name, part of the v1.3 step-text query).
 * The two schemes share ids with different meanings (37-B7 = use of the plan, v4-B7 = closure), so a crosswalk row
 * wins over identity; identity fills only the v4 ids the crosswalk does not name. A v4 analysis never reads this table.
 */
function aliasesFrom(crosswalk) {
  const out = {};
  const map = crosswalk && crosswalk.map && typeof crosswalk.map === 'object' ? crosswalk.map : {};
  for (const [id, row] of Object.entries(map)) {
    out[id] = {
      exact: (row && typeof row.exact === 'string' && row.exact) || null,
      approx: row && Array.isArray(row.approx) ? row.approx.filter((x) => V4_IDS.includes(x)) : [],
      name: (row && typeof row.name === 'string' && row.name) || null,
    };
  }
  for (const id of V4_IDS) if (!(id in out)) out[id] = { exact: id, approx: [], name: null };
  return out;
}

/**
 * ped/vetoes.json: {module_id, seg_id, reason} vetoes one chapter; {module_id, recommendable:false, recommendable_reason}
 * vetoes the module. A veto that names nothing in the catalogue throws: a typo must not leave a vetoed clip live.
 */
function applyVetoes(out, vetoes) {
  for (const v of vetoes || []) {
    const m = out.find((x) => x.module_id === Number(v && v.module_id));
    if (v && v.seg_id) {
      const s = m && m.segments.find((x) => x.seg_id === String(v.seg_id));
      if (!s) throw new Error(`veto names chapter ${v.seg_id}, which is not in the catalogue`);
      s.recommendable = false;
      s.recommendable_reason = `panel_veto: ${v.reason || v.recommendable_reason || 'ped-panel'}`;
    } else {
      if (!m) throw new Error(`veto names module ${v && v.module_id}, which is not in the catalogue`);
      m.recommendable = false;
      m.recommendable_reason = v.recommendable_reason || `panel_veto: ${v.reason || 'ped-panel'}`;
    }
  }
}

function build({ modules, keywords, crosswalk, meta = null, vetoes = [], sourceSha, now = new Date() }) {
  const kw = keywordIndex(keywords);
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 13);
  const out = (modules || []).map((src) => {
    const m = pick(src, MODULE_FIELDS);
    m.topic = Array.isArray(src.topic) ? src.topic : [];
    m.thumb = `video-thumbs/${src.module_id}.jpg`;
    m.segments = (Array.isArray(src.segments) ? src.segments : []).map((s) => ({
      ...pick(s, SEGMENT_FIELDS),
      keywords: kw.get(String(s.seg_id)) || [],
    }));
    return m;
  }).sort((a, b) => a.module_id - b.module_id);
  applyVetoes(out, vetoes);
  return {
    version: `catalog-v1-${stamp}-${String(sourceSha || '').slice(0, 8)}`,
    built_at: now.toISOString(),
    framework: 'fico-v4',
    indicator_aliases: aliasesFrom(crosswalk),
    // The HAND list of v4 ids with no usable chapter (catalog.meta.json `holes`, m-catalog + ped-panel), not `no_strength2`.
    holes: meta && Array.isArray(meta.holes) ? meta.holes.filter((x) => V4_IDS.includes(x)) : [],
    modules: out,
  };
}

function validate(data, { thumbsDir } = {}) {
  const errs = [];
  if (!data || !Array.isArray(data.modules)) return ['no modules array'];
  const modIds = new Set();
  const segIds = new Set();
  for (const m of data.modules) {
    if (modIds.has(m.module_id)) errs.push(`duplicate module_id ${m.module_id}`);
    modIds.add(m.module_id);
    const dur = Number(m.duration_s) || 0;
    const ficoRows = [...(m.fico || [])];
    for (const s of m.segments || []) {
      if (segIds.has(s.seg_id)) errs.push(`duplicate seg_id ${s.seg_id}`);
      segIds.add(s.seg_id);
      const a = Number(s.start_s);
      const b = Number(s.end_s);
      if (!(a >= 0 && b > a && (!dur || b <= dur + 0.5))) errs.push(`segment ${s.seg_id} [${s.start_s}, ${s.end_s}] is outside the video (0, ${dur})`);
      if (m.recommendable !== false && s.recommendable !== false && !(s.keywords || []).length) errs.push(`segment ${s.seg_id} is recommendable but has no keywords`);
      ficoRows.push(...(s.fico || []));
    }
    for (const f of ficoRows) {
      if (!f || !V4_IDS.includes(f.indicator)) errs.push(`module ${m.module_id}: unknown indicator ${f && f.indicator}`);
    }
    if (m.recommendable === false && !m.recommendable_reason) errs.push(`module ${m.module_id}: recommendable:false without a reason`);
    if (thumbsDir) {
      const p = path.join(thumbsDir, `${m.module_id}.jpg`);
      if (fs.existsSync(p) && fs.statSync(p).size > THUMB_MAX_BYTES) errs.push(`thumb ${m.module_id}.jpg is over 25 KB`);
    }
  }
  return errs;
}

async function shrinkThumb(src, dest) {
  const raw = fs.readFileSync(src);
  if (raw.length <= THUMB_MAX_BYTES) { fs.writeFileSync(dest, raw); return; }
  const sharp = require('sharp'); // eslint-disable-line global-require
  for (const [width, quality] of [[480, 72], [400, 65], [320, 60], [320, 45], [240, 45]]) {
    const buf = await sharp(raw).resize({ width, withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (buf.length <= THUMB_MAX_BYTES) { fs.writeFileSync(dest, buf); return; }
  }
  throw new Error(`cannot fit ${src} under 25 KB`);
}

function readModules(input, modulesFile) {
  if (fs.statSync(input).isDirectory()) {
    const db = modulesFile ? JSON.parse(fs.readFileSync(modulesFile, 'utf8')) : [];
    const byId = new Map(db.map((r) => [Number(r.module_id), r]));
    return fs.readdirSync(input).filter((f) => /^\d+\.json$/.test(f)).map((f) => {
      const card = JSON.parse(fs.readFileSync(path.join(input, f), 'utf8'));
      const id = Number(card.module_id || f.replace('.json', ''));
      return { ...(byId.get(id) || {}), ...card, module_id: id };
    });
  }
  return JSON.parse(fs.readFileSync(input, 'utf8'));
}

async function main(argv) {
  const pos = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] || '').startsWith('--'));
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
  const [input, keywordsFile, thumbsIn] = pos;
  if (!input) throw new Error('usage: build-catalog.js <catalog.json|cards dir> <keywords.json> <thumbs dir> [--crosswalk f] [--meta catalog.meta.json] [--modules f]');
  const root = path.join(__dirname, '../../..');
  const out = opt('out') || path.join(root, 'bot/shared/data/video-catalog.v1.json');
  const thumbsOut = opt('thumbs-out') || path.join(root, 'bot/assets/video-thumbs');
  const modules = readModules(input, opt('modules'));
  const keywords = keywordsFile && fs.existsSync(keywordsFile) ? JSON.parse(fs.readFileSync(keywordsFile, 'utf8')) : {};
  const cw = opt('crosswalk');
  const crosswalk = cw && fs.existsSync(cw) ? JSON.parse(fs.readFileSync(cw, 'utf8')) : null;
  const srcBytes = fs.statSync(input).isDirectory() ? JSON.stringify(modules) : fs.readFileSync(input);
  const vetoFiles = argv.map((a, i) => (argv[i - 1] === '--vetoes' ? a : null)).filter(Boolean);
  const vetoes = vetoFiles.flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  // The vetoes are part of the source: a rebuild with a new veto gets a new version.
  const sha = crypto.createHash('sha256').update(srcBytes);
  if (vetoes.length) sha.update(JSON.stringify(vetoes));
  const sourceSha = sha.digest('hex');
  const mf = opt('meta');
  const meta = mf && fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : null;
  const data = build({ modules, keywords, crosswalk, meta, vetoes, sourceSha });

  fs.mkdirSync(thumbsOut, { recursive: true });
  for (const m of data.modules) {
    const src = thumbsIn && path.join(thumbsIn, `${m.module_id}.jpg`);
    if (src && fs.existsSync(src)) await shrinkThumb(src, path.join(thumbsOut, `${m.module_id}.jpg`));
  }
  const errs = validate(data, { thumbsDir: thumbsOut });
  if (errs.length) throw new Error(`catalogue invalid:\n  ${errs.join('\n  ')}`);
  fs.writeFileSync(out, `${JSON.stringify(data, null, 1)}\n`);
  const segs = data.modules.reduce((n, m) => n + m.segments.length, 0);
  console.log(`wrote ${out}: ${data.version}, ${data.modules.length} modules, ${segs} segments, holes=${data.holes.join(',') || '-'}, crosswalk=${crosswalk ? 'yes' : 'identity'}, vetoes=${vetoes.length}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { build, validate, aliasesFrom, V4_IDS, THUMB_MAX_BYTES };
