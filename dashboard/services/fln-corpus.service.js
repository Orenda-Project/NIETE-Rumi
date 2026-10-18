'use strict';
/**
 * bd-t7zk3t.11 — the Reading Hour + Numeracy (FLN) corpus: one versioned, immutable bundle on the content mirror,
 * read by this server and held in memory (SPEC v2 §1; contracts/plan-json.md v2).
 *
 *   ${base}/${ver}/corpus.json = { version, built_at, subjects[], levels[], placement[], plans{<id>: Plan} }
 *
 *   base  env FLN_CORPUS_BASE, else `${CONTENT_R2_PUBLIC_URL}/fln/corpus`
 *   ver   app_settings `fln_corpus_version` (the COS switches bundles without a redeploy), else env
 *         FLN_CORPUS_VERSION, else DEFAULT_VERSION below
 *   FLN_CORPUS_FILE  a local path (dev/QA only): loaded from disk instead of the network; its embedded version is
 *         accepted even when it differs from `ver` (logged), so a dev bundle runs without touching app_settings
 *
 * WHY HERE AND NOT IN THE REPO OR A TABLE: NIETE-Rumi is public, and the plan text is not ours to publish; a content
 * fix is a new bundle version (data), never a deploy. Nothing here writes anywhere.
 *
 * LOADING: lazy on the first ensure(); concurrent callers share ONE in-flight promise; a failure is retried only
 * after a backoff (5 s, 30 s, then every 2 min) so a dead mirror is not hammered by every page view; the version row
 * is re-read at most every 5 min and a new version is loaded in the background and swapped in atomically (the old
 * bundle keeps serving until the new one is verified). ensure() never throws; false = unavailable → the routes
 * answer 503 {error:'fln_unavailable'} and the client hides the band.
 *
 * SERVED = a placement row with shelf core|additional. isHidden(id) is "no such row" (SPEC v2 §1): an id may sit in
 * several grades, and `hidden` rows are data, never served. Positions and counts come from placement (`pos`,
 * `count`), never from the plan's `seq`.
 */

const fs = require('fs');
const zlib = require('zlib');
const supabase = require('../config/supabase');

/** Set to content's bundle v1 <ver> — the manager fills it when `content` posts the shipped version. */
const DEFAULT_VERSION = null;
const VERSION_KEY = 'fln_corpus_version';
const FETCH_TIMEOUT_MS = 20 * 1000;
const BACKOFF_MS = [5 * 1000, 30 * 1000, 2 * 60 * 1000];
const RECHECK_MS = 5 * 60 * 1000;

const SUBJECTS = Object.freeze(['rh-en', 'rh-ur', 'num']);
const STRANDS = Object.freeze(['daily', 'extended']);
/** Grade → level for grades 1-5 (SPEC v2 §1). */
const LEVEL_OF_GRADE = Object.freeze({ 1: 1, 2: 2, 3: 2, 4: 3, 5: 3 });
/** The grade whose rows a level shows to a grade 6-12 teacher (L1 → 1, L2 → 3, L3 → 5). */
const REP_GRADE = Object.freeze({ 1: 1, 2: 3, 3: 5 });
const LEVEL_GRADES = Object.freeze({ 1: [1], 2: [2, 3], 3: [4, 5] });

// The kicker words, mirrored from portal/src/portal/fln/strings.ts (subjectKicker + level) so the server-made link
// preview and share text read exactly as the page does. EN joins with « · », UR with «—» and Urdu digits.
const KICKER = Object.freeze({
  en: { 'rh-en': 'Reading Hour · English', 'rh-ur': 'Reading Hour · Urdu', num: 'Numeracy' },
  ur: { 'rh-en': 'ریڈنگ آور — انگریزی', 'rh-ur': 'ریڈنگ آور — اردو', num: 'بنیادی حساب' },
});
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const urduNum = (n) => String(n).replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)]);

let state = null; // { version, corpus, idx } — replaced whole, never mutated
let inflight = null;
let failures = 0;
let retryAt = 0;
let lastCheck = 0;
let checking = null;

const now = () => Date.now();

// ─── loading ────────────────────────────────────────────────────────────────────────────────────────────────

async function settingVersion() {
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', VERSION_KEY).maybeSingle();
    if (error || !data) return null;
    let v = data.value;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch (_) { /* a bare string */ }
    }
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch (_) {
    return null;
  }
}

async function resolveVersion() {
  return (await settingVersion()) || (process.env.FLN_CORPUS_VERSION || '').trim() || DEFAULT_VERSION || null;
}

function baseUrl() {
  const b = (process.env.FLN_CORPUS_BASE || '').trim();
  if (b) return b.replace(/\/+$/, '');
  const pub = (process.env.CONTENT_R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return pub ? `${pub}/fln/corpus` : null;
}

function parseBody(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const raw = b.length > 1 && b[0] === 0x1f && b[1] === 0x8b ? zlib.gunzipSync(b) : b;
  return JSON.parse(raw.toString('utf8'));
}

async function fetchBundle(ver) {
  const base = baseUrl();
  if (!base) throw new Error('no FLN_CORPUS_BASE or CONTENT_R2_PUBLIC_URL');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/${encodeURIComponent(ver)}/corpus.json`, { signal: ctrl.signal });
    if (!res || !res.ok) throw new Error(`corpus fetch answered ${res && res.status}`);
    return parseBody(Buffer.from(await res.arrayBuffer()));
  } finally {
    clearTimeout(timer);
  }
}

/** Load one bundle (file or network) and build its index. Throws on any failure. */
async function loadBundle(ver) {
  const file = (process.env.FLN_CORPUS_FILE || '').trim();
  let json;
  if (file) {
    json = parseBody(fs.readFileSync(file));
    if (!json || typeof json.version !== 'string') throw new Error('corpus file has no version');
    if (ver && json.version !== ver) console.warn('⚠️ FLN corpus file version differs from the configured one (dev file accepted)', { file_version: json.version, configured: ver });
  } else {
    if (!ver) throw new Error('no FLN corpus version configured');
    json = await fetchBundle(ver);
    if (!json || json.version !== ver) throw new Error(`corpus version mismatch: asked ${ver}, got ${json && json.version}`);
  }
  return { version: json.version, corpus: json, idx: buildIndex(json) };
}

function load() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const ver = await resolveVersion();
      const next = await loadBundle(ver);
      state = next;
      failures = 0;
      retryAt = 0;
      lastCheck = now();
      return true;
    } catch (error) {
      retryAt = now() + BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
      failures += 1;
      console.error('❌ FLN corpus not loaded', { error: error && error.message, failures });
      return false;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The background version re-check: a new version is loaded and swapped in whole; a failure keeps the old one. */
function recheck() {
  if (checking) return checking;
  lastCheck = now();
  checking = (async () => {
    try {
      const ver = await resolveVersion();
      if (!ver || !state || ver === state.version || (process.env.FLN_CORPUS_FILE || '').trim()) return;
      const next = await loadBundle(ver);
      state = next;
      console.log('✅ FLN corpus swapped', { version: next.version });
    } catch (error) {
      console.error('❌ FLN corpus version re-check failed; the loaded version keeps serving', { error: error && error.message });
    } finally {
      checking = null;
    }
  })();
  return checking;
}

/** Resolves true when a bundle is loaded (loading it if needed), false when unavailable. Never throws. */
async function ensure() {
  try {
    if (state) {
      if (now() - lastCheck >= RECHECK_MS) recheck();
      return true;
    }
    if (inflight) return await inflight;
    if (retryAt && now() < retryAt) return false;
    return await load();
  } catch (_) {
    return false;
  }
}

const ready = () => Boolean(state);
const version = () => (state ? state.version : null);

// ─── the index ──────────────────────────────────────────────────────────────────────────────────────────────

const isServedShelf = (s) => s === 'core' || s === 'additional';
const sgKey = (subject, grade) => `${subject}|${grade}`;
const sgsKey = (subject, grade, strand) => `${subject}|${grade}|${strand}`;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Chips counts from the plan when a placement row has no `audio` (the dev bundle; audio_summary first). */
function planAudio(plan) {
  if (!plan) return { sounds: 0, words: 0, narration: false, video: false };
  const media = [];
  const walkItems = (items) => (items || []).forEach((it) => (it && it.media || []).forEach((m) => media.push(m)));
  (plan.sections || []).forEach((s) => (s.groups || []).forEach((g) => walkItems(g.items)));
  ['setup', 'homework', 'summary'].forEach((k) => walkItems(plan[k]));
  const video = (Array.isArray(plan.videos) && plan.videos.length > 0) || media.some((m) => m && m.kind === 'video');
  const s = plan.audio_summary;
  if (s && typeof s === 'object') {
    return { sounds: num(s.sounds) || 0, words: num(s.words) || 0, narration: Boolean(s.narration), video };
  }
  const distinct = (role) => new Set(media.filter((m) => m && m.kind === 'audio' && m.role === role).map((m) => m.src)).size;
  return { sounds: distinct('sound'), words: distinct('word'), narration: distinct('narration') > 0, video };
}

function buildIndex(corpus) {
  const plans = corpus.plans || {};
  const served = new Set();
  const rowsBySG = new Map();
  const rowsById = new Map();
  const counted = new Map(); // (subject, grade, strand) → served rows with pos > 0
  for (const r of corpus.placement || []) {
    if (!r || !isServedShelf(r.shelf) || !plans[String(r.lp_id)]) continue;
    const id = String(r.lp_id);
    served.add(id);
    const k = sgKey(r.subject, r.grade);
    if (!rowsBySG.has(k)) rowsBySG.set(k, []);
    rowsBySG.get(k).push(r);
    if (!rowsById.has(id)) rowsById.set(id, []);
    rowsById.get(id).push(r);
    if (Number(r.pos) > 0) {
      const c = sgsKey(r.subject, r.grade, r.strand);
      counted.set(c, (counted.get(c) || 0) + 1);
    }
  }
  for (const list of rowsBySG.values()) {
    list.sort((a, b) => STRANDS.indexOf(a.strand) - STRANDS.indexOf(b.strand) || Number(a.pos) - Number(b.pos));
  }
  const subjects = new Map((corpus.subjects || []).map((s) => [s.key, s]));
  const levels = new Map();
  for (const l of corpus.levels || []) levels.set(`${l.subject}|${l.level}`, l);
  return { plans, served, rowsBySG, rowsById, counted, subjects, levels };
}

const idx = () => (state ? state.idx : null);

function countOf(row) {
  if (num(row.count) != null) return row.count;
  const i = idx();
  return (i && i.counted.get(sgsKey(row.subject, row.grade, row.strand))) || 0;
}

function gradesOf(subject, level) {
  const i = idx();
  const l = i && i.levels.get(`${subject}|${level}`);
  return l && Array.isArray(l.grades) && l.grades.length ? l.grades.slice() : (LEVEL_GRADES[level] || []).slice();
}

function chipsOf(row, plan) {
  const a = row.audio && typeof row.audio === 'object' ? row.audio : planAudio(plan);
  return {
    sounds: num(a.sounds) || 0,
    words: num(a.words) || 0,
    narration: Boolean(a.narration),
    video: Boolean(a.video),
    textbook: row.label === 'needs_textbook',
    additional: row.label === 'additional_practice' || row.shelf === 'additional',
    screener: row.label === 'screener',
    guide: row.label === 'guide',
  };
}

function rowOut(row, opened) {
  const plan = idx().plans[String(row.lp_id)];
  return {
    id: row.lp_id,
    title: plan.title,
    lang: plan.lang,
    dir: plan.dir || (plan.lang === 'ur' ? 'rtl' : 'ltr'),
    minutes: num(plan.minutes && plan.minutes.total) || 0,
    chips: chipsOf(row, plan),
    opened: Boolean(opened && opened.has(String(row.lp_id))),
    pos: Number(row.pos) || 0,
    count: countOf(row),
    label: row.label || null,
    note_en: row.note_en || null,
    note_ur: row.note_ur || null,
  };
}

/** Rows of one (subject, grade) → [{strand, chapters:[{chapter_no, title_en, title_ur, plans}]}], daily first. */
function strandsFor(subject, grade, opened) {
  const rows = idx().rowsBySG.get(sgKey(subject, grade)) || [];
  const out = [];
  for (const strand of STRANDS) {
    const chapters = [];
    const byNo = new Map();
    for (const r of rows) {
      if (r.strand !== strand) continue;
      let ch = byNo.get(r.chapter_no);
      if (!ch) {
        ch = { chapter_no: r.chapter_no, title_en: r.chapter_title_en || null, title_ur: r.chapter_title_ur || null, plans: [] };
        byNo.set(r.chapter_no, ch);
        chapters.push(ch);
      }
      ch.plans.push(rowOut(r, opened));
    }
    if (chapters.length) out.push({ strand, chapters });
  }
  return out;
}

// ─── reads ──────────────────────────────────────────────────────────────────────────────────────────────────

function subjectOf(key) {
  const i = idx();
  const s = i && i.subjects.get(key);
  if (!s) return null;
  return { key: s.key, name_en: s.name_en || null, name_ur: s.name_ur || null, lang: s.lang, dir: s.dir };
}

function plan(id) {
  const i = idx();
  return (i && i.plans[String(id)]) || null;
}

function isHidden(id) {
  const i = idx();
  return !i || !i.served.has(String(id));
}

function placementOf(id) {
  const i = idx();
  const rows = (i && i.rowsById.get(String(id))) || [];
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const p = {
      subject: r.subject,
      level: r.level,
      grades: gradesOf(r.subject, r.level),
      strand: r.strand,
      chapter_title_en: r.chapter_title_en || null,
      chapter_title_ur: r.chapter_title_ur || null,
      pos: Number(r.pos) || 0,
      count: countOf(r),
      label: r.label || null,
    };
    const k = JSON.stringify(p);
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  return out;
}

/** The levels of a subject, for the grade 6-12 chooser: count, screener id/minutes/note from the bundle or computed. */
function levels(subject) {
  const i = idx();
  if (!i) return [];
  const out = [];
  for (const level of [1, 2, 3]) {
    const l = i.levels.get(`${subject}|${level}`);
    const grade = REP_GRADE[level];
    const rows = i.rowsBySG.get(sgKey(subject, grade)) || [];
    if (!l && !rows.length) continue;
    const explicit = rows.find((r) => num(r.count) != null);
    const count = explicit ? explicit.count : new Set(rows.filter((r) => Number(r.pos) > 0).map((r) => String(r.lp_id))).size;
    const screenerId = l && l.screener_id != null ? l.screener_id : null;
    const sRow = rows.find((r) => r.label === 'screener' && (screenerId == null || String(r.lp_id) === String(screenerId)))
      || (i.rowsById.get(String(screenerId)) || [])[0] || null;
    const sPlan = screenerId != null ? i.plans[String(screenerId)] : null;
    out.push({
      level,
      label_en: (l && l.label_en) || null,
      label_ur: (l && l.label_ur) || null,
      desc_en: (l && l.desc_en) || null,
      desc_ur: (l && l.desc_ur) || null,
      grades: gradesOf(subject, level),
      count: l && num(l.count) != null ? l.count : count,
      screener_id: screenerId,
      screener_minutes: sPlan ? num(sPlan.minutes && sPlan.minutes.total) : null,
      note_en: (sRow && sRow.note_en) || null,
      note_ur: (sRow && sRow.note_ur) || null,
    });
  }
  return out;
}

/**
 * @param {{grade:number, subject:string, level?:number|null, opened?:Set<string>}} q (validated by the route)
 */
function catalogue({ grade, subject, level = null, opened = null }) {
  if (!idx()) return null;
  const g = Number(grade);
  const lv = level == null || level === '' ? null : Number(level);
  const base = { subject: subjectOf(subject) || { key: subject, name_en: null, name_ur: null, lang: subject === 'rh-ur' ? 'ur' : 'en', dir: subject === 'rh-ur' ? 'rtl' : 'ltr' }, grade: g, levels: levels(subject) };
  if (g >= 1 && g <= 5) return { ...base, level: LEVEL_OF_GRADE[g], strands: strandsFor(subject, g, opened) };
  if (!lv) return { ...base, level: null, strands: [] };
  return { ...base, level: lv, strands: strandsFor(subject, REP_GRADE[lv], opened) };
}

/** 'Reading Hour · English · Level 1' / 'ریڈنگ آور — انگریزی — سطح ۱' — for the link preview and share text. */
function kickerFor(placementRow, lang = 'en') {
  if (!placementRow || !placementRow.subject) return '';
  const ur = lang === 'ur';
  const subj = (ur ? KICKER.ur : KICKER.en)[placementRow.subject];
  if (!subj) return '';
  if (!placementRow.level) return subj;
  return ur ? `${subj} — سطح ${urduNum(placementRow.level)}` : `${subj} · Level ${placementRow.level}`;
}

// ─── tests ──────────────────────────────────────────────────────────────────────────────────────────────────

function __setForTests(corpus) {
  state = { version: corpus.version, corpus, idx: buildIndex(corpus) };
  inflight = null; failures = 0; retryAt = 0; lastCheck = now();
}
function __resetForTests() {
  state = null; inflight = null; failures = 0; retryAt = 0; lastCheck = 0; checking = null;
}
/** Waits for a background re-check (tests only). */
async function __settledForTests() {
  if (checking) await checking;
  if (inflight) await inflight;
}

module.exports = {
  SUBJECTS,
  DEFAULT_VERSION,
  VERSION_KEY,
  load,
  ready,
  ensure,
  version,
  catalogue,
  plan,
  placementOf,
  levels,
  isHidden,
  subjectOf,
  kickerFor,
  __setForTests,
  __resetForTests,
  __settledForTests,
};
