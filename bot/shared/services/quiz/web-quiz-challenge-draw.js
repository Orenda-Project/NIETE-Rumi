'use strict';
/**
 * The Challenge's content draw and its record rule (used by web-quiz-challenge.js only under web_quiz_challenge_v2):
 *
 *   bands        the entry band follows the child's FIXED grade (grades 2-3 → band 1, 4-5 → band 2; ceiling 2 / 3);
 *                the open band rises with the reading rung (child_rungs); the DRAW band is one lower after a line-1
 *                stop or a 0-word read on the last counted read (never below 1)
 *   the draw     random within band × language × kind over the check pool's released, not-withdrawn, calibrated or
 *                provisional passages the child has never had a run row for (twins excluded together); weights w1:
 *                the reference 0.35, each provisional 0.15 (at most two), calibrated passages share the rest; one band
 *                lower when the cell is exhausted, then "on its way" (no passage, no run row)
 *   the record   decided at serve: one record per canonical child × stop × period (a PKT calendar month read from
 *                challenge_periods, never computed here); practice is never a record
 *
 * Every draw is logged twice: a challenge_draws row (never throws) and the run row's meta.draw.
 * The pure functions take plain rows and never touch the network; the thin DB layer at the end is the only I/O.
 */
const supabase = require('../../config/supabase');
const { logError } = require('../../utils/logger');

const STOPS = Object.freeze(['missing', 'read', 'listen', 'bigger']);
const WEIGHTS = Object.freeze({ w1: Object.freeze({ reference: 0.35, provisional_each: 0.15, provisional_max: 2 }) });
const DRAWABLE = new Set(['calibrated', 'provisional']);
// ITEMS §1.1 provenance, §8.1: the counted pool (mode 'check') admits only these; 'generated' is practice and Story Time only
const COUNTED_PROVENANCE = new Set(['published_calibrated', 'reviewer_levelled']);
/** A passage the counted pool may draw: a cited published instrument or a reviewer-levelled passage (the one rule). */
const isCountedSource = (r) => !!r && COUNTED_PROVENANCE.has(r.provenance);
const FINAL = new Set(['scored', 'failed']);
const LAUNCH_SET = 'A';   // the bigger sets until clones exist: bigger.G3.A / bigger.G5.A in every period
// "A new story is on its way." (copy deck key jg.next.on_its_way; not yet in ux-strings, so inline here, verbatim)
const ON_ITS_WAY_COPY = Object.freeze({ en: 'A new story is on its way.', ur: 'ایک نئی کہانی آنے والی ہے۔' });

// ── pure: bands ──────────────────────────────────────────────────────────────────────────────────────────

const entryBand = (g) => (g === 2 || g === 3 ? 1 : (g === 4 || g === 5 ? 2 : null));
const ceilingBand = (g) => (g === 2 || g === 3 ? 2 : (g === 4 || g === 5 ? 3 : null));
const gradeBand = (g) => (g === 2 || g === 3 ? 'G23' : (g === 4 || g === 5 ? 'G45' : null));

/** A line-1 stop (the story's first-line rule) or 0 words (unheard, or silent with the mic proven working). */
function isLine1OrZero(row) {
  if (!row || row.exercise !== 'read') return false;
  const s = row.score || {};
  const m = row.meta || {};
  if (row.status === 'failed' && m.reason === 'unheard') return true;
  if (m.ended === 'silent' && m.mic_check === 'pass') return true;
  return row.status === 'scored' && (!!s.stopped || Number(m.stop_line) === 1);
}

// A counted read: a final record row; before the provenance columns, the record rule's own `counted` stamp.
const isCounted = (r) => (r.mode != null ? r.mode === 'check' && r.record === true : !!(r.meta && r.meta.counted));

/** The child's newest counted read-aloud row with a final status, any period (null when none). */
function lastCountedRead(rows) {
  const hits = (rows || []).filter((r) => r.exercise === 'read' && FINAL.has(r.status) && isCounted(r));
  hits.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return hits.length ? hits[hits.length - 1] : null;
}

/** The band to draw in and why: open band (default the entry band, never above the ceiling), minus one after a drop. */
function drawBand({ fixedGrade, openBand, lastCountedRead: last } = {}) {
  const entry = entryBand(fixedGrade);
  if (!entry) return { band: null, band_reason: null, open_band: null };
  const ceil = ceilingBand(fixedGrade);
  const open = Math.min(ceil, Math.max(entry, Number(openBand) || entry));
  if (isLine1OrZero(last)) return open > 1 ? { band: open - 1, band_reason: 'line1_drop', open_band: open } : { band: 1, band_reason: 'floor', open_band: open };
  return { band: open, band_reason: open > entry ? 'promoted' : 'entry_grade', open_band: open };
}

// ── pure: what the child has met ─────────────────────────────────────────────────────────────────────────

const formOfGrade = (g) => (g === 2 || g === 3 ? 'G3' : (g === 4 || g === 5 ? 'G5' : null));

/**
 * The passage or item set a run row served. A row written before the provenance columns (no mode) served Set A:
 * read/listen → <lang>.<kind>.2.setA, bigger/missing → <task>.<form>.A (form from the row's grade).
 */
function rowServedId(r) {
  if (!r) return null;
  if (r.passage_id) return r.passage_id;
  if (r.item_set_id) return r.item_set_id;
  if (r.mode != null || r.anchor_block) return null;
  if ((r.exercise === 'read' || r.exercise === 'listen') && r.lang) return `${r.lang}.${r.exercise}.2.setA`;
  const form = formOfGrade(Number(r.grade));
  if ((r.exercise === 'bigger' || r.exercise === 'missing') && form) return `${r.exercise}.${form}.${LAUNCH_SET}`;
  return null;
}

const seenIdsOf = (rows) => new Set((rows || []).map(rowServedId).filter(Boolean));

/** 1 + the child's rows that served this passage or item set (any status, any mode). */
const exposureNo = (rows, id) => 1 + (rows || []).filter((r) => rowServedId(r) === id).length;

/** 1 + the child's counted-Trail (mode 'check') rows that served this anchor block (served/abandoned count too). */
const anchorExposureNo = (rows, block) => 1 + (rows || []).filter((r) => r.mode === 'check' && r.anchor_block === block).length;

// A row's form: the column, else meta.form, else the row's grade (2-3 → G3, 4-5 → G5); null when none is known.
const formOfRow = (r) => {
  const f = String(r.form || (r.meta && r.meta.form) || '').replace(/^G/i, '');
  return f === '3' || f === '5' ? `G${f}` : formOfGrade(Number(r.grade));
};

/**
 * A1 serves made before the provenance columns (ITEMS §3.1, §4): a 'missing' row with no mode served the bank's form,
 * item-identical to A1 on G5 (full) and sharing A1.01-06 on G3 (partial). A row of unknown form is not counted.
 */
function anchorPrev2(rows, block) {
  const out = { full: 0, partial: 0 };
  if (block !== 'A1') return out;
  for (const r of rows || []) {
    if (r.mode != null || r.exercise !== 'missing') continue;
    const f = formOfRow(r);
    if (f === 'G5') out.full += 1;
    else if (f === 'G3') out.partial += 1;
  }
  return out;
}

/**
 * 1 + the child's rows that served this anchor block in ANY mode and status (beside anchor_exposure_no, ITEMS item 13),
 * a pre-v2 missing row counting as one A1 serve, full or partial (anchorPrev2).
 */
const anchorServesAny = (rows, block) => {
  const p = anchorPrev2(rows, block);
  return 1 + (rows || []).filter((r) => r.anchor_block === block).length + p.full + p.partial;
};

/**
 * A record row of this stop in this period exists that was played (scoring, scored or failed; a row served and left,
 * status served or abandoned, leaves the month's record open). The record
 * key is (stop, language) for read and listen, the stop alone for the maths stops (ITEMS §5.6, item 14).
 */
const countedThisPeriod = (rows, stop, periodId, lang = null) => (rows || []).some((r) => r.exercise === stop && r.period_id === periodId && r.record === true
  && r.status !== 'served' && r.status !== 'abandoned'   // seenIdsOf still keeps its passage: the re-serve draws another
  && (!lang || (stop !== 'read' && stop !== 'listen') || r.lang === lang));

/**
 * ITEMS §5.6: record = check, something served, no record of this stop yet in this period, and (M7) a first exposure to
 * the passage or set; an anchor block is a record at any exposure (its repeat is the design).
 */
const recordAtServe = ({ mode, outcome, countedThisPeriod: counted, exposureNo = null, anchor = false } = {}) => mode === 'check' && outcome !== 'on_its_way' && !counted
  && (!!anchor || exposureNo == null || Number(exposureNo) === 1);

/** The academic year of a time: the binder's own helper when present, else PKT 1 April – 31 March: '2026-27'. */
function yearCode(now = new Date()) {
  try {
    const repo = require('./child-phone-bindings.repo');
    if (repo && typeof repo.yearCode === 'function') return repo.yearCode(new Date(now));
  } catch (_) { /* absent: computed here */ }
  return ownYearCode(now);
}
function ownYearCode(now = new Date()) {
  const pkt = new Date(new Date(now).getTime() + 5 * 3600 * 1000);
  const y = pkt.getUTCMonth() >= 3 ? pkt.getUTCFullYear() : pkt.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

// ── pure: the eligible set, the weights, the pick ───────────────────────────────────────────────────────

const ms = (t) => (t == null ? NaN : new Date(t).getTime());

/** ITEMS §5.2, ordered: the reference first, then by id. */
// `counted` (the CHECK draw under web_quiz_challenge_sourced_only): only sourced passages (isCountedSource)
function eligible({ rows, seenIds, kind, lang, band, now = new Date(), counted = false } = {}) {
  const seen = seenIds instanceof Set ? seenIds : new Set(seenIds || []);
  const all = rows || [];
  // twins leave together: a seen passage removes the passage it is a twin of, and every passage that is its twin
  const out = new Set(seen);
  for (const r of all) {
    if (seen.has(r.passage_id) && r.twin_of) out.add(r.twin_of);
    if (r.twin_of && seen.has(r.twin_of)) out.add(r.passage_id);
  }
  const t = ms(now);
  return all
    .filter((r) => r.pool === 'check' && r.kind === kind && r.lang === lang && Number(r.band) === Number(band)
      && DRAWABLE.has(r.status) && ms(r.released_at) <= t && r.withdrawn_at == null && !out.has(r.passage_id)
      && (!counted || isCountedSource(r)))
    .sort((a, b) => (Number(!!b.is_reference) - Number(!!a.is_reference)) || String(a.passage_id).localeCompare(String(b.passage_id)));
}

function weightsOf(version) {
  const w = Object.prototype.hasOwnProperty.call(WEIGHTS, version) ? WEIGHTS[version] : null;
  if (!w) throw new Error(`challenge draw: unknown weights version "${version}"`);
  return w;
}

/**
 * ITEMS §5.3 → [{id, w}] summing to 1. The reference 0.35; each provisional 0.15 (at most two: a third is dropped and
 * logged); calibrated non-reference passages share the rest equally; no calibrated → the rest to the reference;
 * the reference ineligible → everything renormalised pro rata.
 */
function weigh(E, weightsV = 'w1') {
  const W = weightsOf(weightsV);
  const list = E || [];
  const ref = list.find((r) => r.is_reference) || null;
  const provAll = list.filter((r) => !r.is_reference && r.status === 'provisional');
  const prov = provAll.slice(0, W.provisional_max);
  if (provAll.length > prov.length) {
    logError('web_quiz.ch_pool_overfull', { dropped: provAll.slice(W.provisional_max).map((r) => r.passage_id), max: W.provisional_max, lang: list[0] && list[0].lang, band: list[0] && list[0].band });
  }
  const cal = list.filter((r) => !r.is_reference && r.status === 'calibrated');
  const rest = Math.max(0, 1 - W.reference - W.provisional_each * prov.length);
  const mass = new Map();
  if (ref) mass.set(ref.passage_id, W.reference + (cal.length ? 0 : rest));
  prov.forEach((r) => mass.set(r.passage_id, W.provisional_each));
  cal.forEach((r) => mass.set(r.passage_id, rest / cal.length));
  const kept = list.filter((r) => mass.has(r.passage_id));
  const total = kept.reduce((a, r) => a + mass.get(r.passage_id), 0);
  if (!(total > 0)) return kept.map((r) => ({ id: r.passage_id, w: 1 / kept.length }));
  return kept.map((r) => ({ id: r.passage_id, w: mass.get(r.passage_id) / total }));
}

/** mulberry32 seeded by 8 hex characters. */
function mulberry32(hex8) {
  let s = parseInt(String(hex8 || '0').slice(0, 8), 16) >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** One id from the weighted list, by the seed's first 8 hex; p = its weight. */
function pick(weighted, seedHex) {
  if (!weighted || !weighted.length) return null;
  const r = mulberry32(String(seedHex).slice(0, 8))();
  let acc = 0;
  for (const x of weighted) {
    acc += x.w;
    if (r < acc) return { id: x.id, p: x.w };
  }
  const last = weighted[weighted.length - 1];
  return { id: last.id, p: last.w };
}

/** The draw at a band, one band lower when exhausted, then on its way (ITEMS §5.4–5.5). */
function drawPassage({ rows, seenIds, kind, lang, band, band_reason: reason, now, seed, weightsV = 'w1', counted = false } = {}) {
  const tryBand = (b, why, outcome) => {
    const E = eligible({ rows, seenIds, kind, lang, band: b, now, counted });
    if (!E.length) return null;
    const weighted = weigh(E, weightsV);
    const got = pick(weighted, seed);
    const refId = (E.find((r) => r.is_reference) || {}).passage_id;
    return { outcome, band: b, band_reason: why, id: got.id, served_id: got.id, p: got.p, eligible: weighted, eligible_n: weighted.length,
      ref_eligible: !!refId && weighted.some((x) => x.id === refId), weights_v: weightsV, seed };
  };
  const first = tryBand(band, reason, 'served');
  if (first) return first;
  const lower = band > 1 ? tryBand(band - 1, 'fallback_exhausted', 'lower_band') : null;
  if (lower) return lower;
  return { outcome: 'on_its_way', band: band > 1 ? band - 1 : band, band_reason: band > 1 ? 'fallback_exhausted' : reason, id: null, served_id: null, p: null,
    eligible: [], eligible_n: 0, ref_eligible: false, weights_v: weightsV, seed: null };
}

// ── pure: the period, the bigger set, the try-out ───────────────────────────────────────────────────────

/** The period whose [starts_at, ends_at) holds now, from challenge_periods rows; null when none does. */
function periodIdFor(now, periods) {
  const t = ms(now);
  const p = (periods || []).find((x) => ms(x.starts_at) <= t && t < ms(x.ends_at));
  return p ? p.period_id : null;
}

/**
 * The period's bigger set for a form. Until clones exist every period maps to the launch set (<form>.A); a set the
 * child has an exposure for is skipped to the next operational set, and with none left it is served as practice.
 */
function biggerSetFor(form, periodId, exposures) {
  const seen = exposures instanceof Set ? exposures : new Set(exposures || []);
  const candidates = [`bigger.${form}.${LAUNCH_SET}`];
  const fresh = candidates.find((id) => !seen.has(id));
  return { item_set_id: fresh || candidates[0], period_set: `bigger.${form}.${periodId}`, practice: !fresh };
}

/** One provisional item, uniformly by the seed (its second 8 hex), A2 candidates first (ITEMS §5.7); null when none. */
function tryoutItem(items, seedHex) {
  const prov = (items || []).filter((i) => i.status === 'provisional');
  const a2 = prov.filter((i) => i.anchor_block_candidate === 'A2' || /^anchor\.A2\./.test(String(i.item_id)));
  const from = a2.length ? a2 : prov;
  if (!from.length) return null;
  return from[Math.floor(mulberry32(String(seedHex).slice(8, 16) || '0')() * from.length)];
}

/** Per stop in Trail order: whether this period's record row exists and whether it is final. */
function trailState(rows, periodId) {
  return STOPS.map((stop) => {
    const recs = (rows || []).filter((r) => r.exercise === stop && r.period_id === periodId && r.record === true);
    return { stop, served: recs.length > 0, record_row_final: recs.some((r) => FINAL.has(r.status)) };
  });
}

// ── DB layer (thin; every read fails soft) ──────────────────────────────────────────────────────────────

const TTL_MS = 30 * 1000;
const cache = new Map();
let periodMissingDay = null;
const isMissingTable = (e) => !!e && (e.code === '42P01' || /does not exist|schema cache/i.test(String(e.message || '')));
const isMissingColumn = (e) => !!e && e.code === '42703';

async function cached(key, read) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < TTL_MS) return c.v;
  const v = await read();
  cache.set(key, { v, at: Date.now() });
  return v;
}

const PASSAGE_COLS = 'passage_id, lang, kind, band, pool, status, is_reference, released_at, withdrawn_at, twin_of';

/**
 * The passage registry rows the draw needs (30-s cache); [] when the table is absent or unreadable. On a tier without
 * the provenance column (42703: web_quiz_challenge_passages_provenance.sql not applied) the rows are read without it and
 * marked `provenanceMissing`: the counted-pool filter then fails closed (serveV2), every other reader is as before.
 */
function registryPassages() {
  return cached('passages', async () => {
    const { data, error } = await supabase.from('challenge_passages').select(`${PASSAGE_COLS}, provenance`);
    if (!error) return data || [];
    logError('web_quiz.ch_registry_read_failed', { table: 'challenge_passages', missing: !isMissingColumn(error) && isMissingTable(error), code: error.code || null });
    if (!isMissingColumn(error)) return [];
    const again = await supabase.from('challenge_passages').select(PASSAGE_COLS);
    if (again.error) { logError('web_quiz.ch_registry_read_failed', { table: 'challenge_passages', missing: isMissingTable(again.error), code: again.error.code || null }); return []; }
    return Object.assign((again.data || []).map(({ provenance, ...r }) => r), { provenanceMissing: true });
  });
}

/** The challenge_periods rows (30-s cache); [] when absent. */
function periods() {
  return cached('periods', async () => {
    const { data, error } = await supabase.from('challenge_periods').select('period_id, starts_at, ends_at, anchor_block_version, weights_v, bank_version');
    if (error) { logError('web_quiz.ch_registry_read_failed', { table: 'challenge_periods', missing: isMissingTable(error), code: error.code || null }); return []; }
    return data || [];
  });
}

/** No period holds now: the serve takes the OFF path for the period rule; said once per process per PKT day. */
function notePeriodMissing(now = Date.now()) {
  const day = new Date(now + 5 * 3600 * 1000).toISOString().slice(0, 10);
  if (periodMissingDay === day) return;
  periodMissingDay = day;
  logError('web_quiz.ch_period_missing', { day });
}

/** The child's latest rung on each ladder (child_rungs); missing table or no rows → nulls, and the source says so. */
async function rungsOf(canonicalId) {
  const { data, error } = await supabase.from('child_rungs').select('ladder, rung, set_at')
    .eq('canonical_id', canonicalId).order('set_at', { ascending: false }).limit(50);
  if (error) return { reading: null, numbers: null, src: isMissingTable(error) ? 'no_table' : 'read_failed' };
  const best = (l) => (data || []).filter((r) => r.ladder === l).reduce((a, r) => Math.max(a, Number(r.rung) || 0), 0) || null;
  return { reading: best('reading'), numbers: best('numbers'), src: (data || []).length ? 'child_rungs' : 'none' };
}

/** BADGES §2.5: the entry band (L) until the reading rung R3 is lit, then the upper band (U). */
async function openBand(canonicalId, fixedGrade) {
  const r = await rungsOf(canonicalId);
  const entry = entryBand(fixedGrade);
  return { band: r.reading >= 3 ? ceilingBand(fixedGrade) : entry, src: r.src === 'child_rungs' ? 'child_rungs' : `entry_${r.src}`, rungs: r };
}

/** The FIXED grade (child_identity) when that table has the child, else the visit's grade; the source says which. */
async function fixedGradeOf(canonicalId, visitGrade) {
  const { data, error } = await supabase.from('child_identity').select('canonical_id, year_code, fixed_grade').eq('canonical_id', canonicalId).eq('year_code', yearCode()).maybeSingle();
  const g = !error && data ? Number(data.fixed_grade) : null;
  if (entryBand(g)) return { grade: g, src: 'child_identity' };
  return { grade: visitGrade, src: error && isMissingTable(error) ? 'visit_grade_no_table' : 'visit_grade' };
}

const ROW_COLS = 'id, student_id, exercise, grade, form, lang, status, score, meta, mode, via, period_id, passage_id, item_set_id, anchor_block, record, created_at';

/** The canonical child's run rows (by canonical_id, and by the raw ids for rows written before it), oldest first. */
async function childRows(canonicalId, studentIds = [], { step = 's' } = {}) {
  const ids = [...new Set([canonicalId, ...studentIds].filter(Boolean).map(String))];
  const [a, b] = await Promise.all([
    supabase.from('web_quiz_challenge_runs').select(ROW_COLS).eq('canonical_id', canonicalId).limit(5000),
    supabase.from('web_quiz_challenge_runs').select(ROW_COLS).in('student_id', ids).limit(5000),
  ]);
  const err = a.error || b.error;
  // a provenance column missing on this tier (42703): fail closed, the caller serves nothing (readFailed)
  if (err && err.code === '42703') {
    logError('web_quiz.ch_runs_read_failed', { code: err.code, step, w: 's' });
    return Object.assign([], { readFailed: true });
  }
  if (err) logError('web_quiz.ch_rows_read_failed', { missing: isMissingTable(err), code: err.code || null });
  const byId = new Map();
  for (const r of [...((a && a.data) || []), ...((b && b.data) || [])]) byId.set(r.id, r);
  return [...byId.values()].sort((x, y) => String(x.created_at || '').localeCompare(String(y.created_at || '')));
}

// The failed draw-log write's log fields, built apart from logDraw's insert (an object literal after that insert reads
// to the column gate as challenge_draws columns).
const drawLogFailure = (code, message) => ({ code: code || null, error: String(message || '').slice(0, 160) });

// An "on its way" outcome is logged once per child × stop × period an hour (a child reopening the stop is not news).
const ON_ITS_WAY_LOG_MS = 60 * 60 * 1000;
async function onItsWayLoggedRecently(row) {
  const since = new Date((Date.parse(row.drawn_at || '') || Date.now()) - ON_ITS_WAY_LOG_MS).toISOString();
  const { data, error } = await supabase.from('challenge_draws').select('draw_id').eq('canonical_id', row.canonical_id).eq('stop', row.stop)
    .eq('period_id', row.period_id).eq('outcome', 'on_its_way').gte('drawn_at', since).limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}

/** One challenge_draws row; never throws (the run row's meta.draw is the second copy). */
async function logDraw(row) {
  try {
    if (row && row.outcome === 'on_its_way' && row.canonical_id && row.period_id && (await onItsWayLoggedRecently(row))) return false;
    const { error } = await supabase.from('challenge_draws').insert(row);
    if (!error) return true;
    // an on-its-way row already there (the partial unique index on it answers 23505): already logged, not a failure
    if (error.code === '23505' && row.outcome === 'on_its_way') return false;
    logError('web_quiz.ch_draw_log_failed', drawLogFailure(error.code, error.message));
  } catch (e) {
    logError('web_quiz.ch_draw_log_failed', drawLogFailure(null, e && e.message || e));
  }
  return false;
}

/** trailState from the canonical child's rows (the menu's `done` under web_quiz_challenge_period uses this). */
async function trailStateFor(canonicalId, periodId, studentIds = []) {
  return trailState(await childRows(canonicalId, studentIds, { step: 'm' }), periodId);
}

/**
 * The identity pick (web-quiz-bind-page.pickFor({sessionId, canonicalId, device}): the session's pick, else the hub's,
 * else null). Absent module or no pick → nulls with pick_src 'absent'; never derived here.
 */
async function pickOf({ sessionId = null, canonicalId = null, device = null } = {}) {
  const none = { id_src: null, id_confidence: null, homonym_in_list: null, pick_src: 'absent' };
  let mod = null;
  try { mod = require('./web-quiz-bind-page'); } catch (_) { mod = null; }
  if (!mod || typeof mod.pickFor !== 'function') return none;
  try {
    const p = await mod.pickFor({ sessionId, canonicalId, device });
    if (!p || typeof p !== 'object') return none;
    return { id_src: p.id_src == null ? null : p.id_src, id_confidence: p.id_confidence == null ? null : p.id_confidence,
      homonym_in_list: typeof p.homonym_in_list === 'boolean' ? p.homonym_in_list : null, pick_src: 'pick' };
  } catch (e) {
    logError('web_quiz.ch_pick_read_failed', { error: String(e && e.message || e).slice(0, 120) });
    return { ...none, pick_src: 'failed' };
  }
}

/**
 * How the run was administered and which sample it belongs to (the sampling ruling): every turn of a class round is
 * 'teacher_present', keyed on the round (via 'class_round', the round token's entry) as well as the mode, because
 * positions 11+ of a round are served mode 'practice' with the teacher still there; only the round's own
 * mode='class_round' turns are the 'class_round' sample arm. A run that came by the class link inside an OPEN class-week window of the child's class is the
 * 'class_week' arm (web-quiz-class-week, required lazily under web_quiz_class_week: absent → no arm); every other
 * run is 'self_run' with no arm.
 */
async function adminFields({ mode, via, canonicalId, at = new Date(), classWeekOn = false } = {}) {
  if (via === 'class_round' || mode === 'class_round') return { admin_mode: 'teacher_present', sample_arm: mode === 'class_round' ? 'class_round' : null };
  if (via === 'class_link' && classWeekOn) {
    let mod = null;
    try { mod = require('./web-quiz-class-week'); } catch (_) { mod = null; }
    if (mod && typeof mod.openWindowFor === 'function') {
      try {
        if (await mod.openWindowFor({ canonicalId, at })) return { admin_mode: 'self_run', sample_arm: 'class_week' };
      } catch (e) {
        logError('web_quiz.ch_class_week_read_failed', { error: String(e && e.message || e).slice(0, 120) });
      }
    }
  }
  return { admin_mode: 'self_run', sample_arm: null };
}

// today's grade sources → child_identity.grade_source
// (lead ruling #31 order roster → share_code → tapped, in the values child_identity's CHECK admits)
const GRADE_SOURCE = { enrolment: 'roster_class', list: 'roster_class', session: 'share_code_class', quiz: 'share_code_class', self: 'tapped' };

/**
 * IDENTITY §16: the fixed grade, written at the child's first COUNTED play of the academic year, under
 * web_quiz_identity_canon (the identity change's switch reader, required lazily: absent → nothing; table missing →
 * nothing). One row per canonical child × year; an existing row is never changed. Never throws.
 */
async function writeChildIdentity({ canonicalId, grade, gradeSource, now = new Date() } = {}) {
  try {
    let IdFlags = null;
    try { IdFlags = require('./web-quiz-identity-flags'); } catch (_) { return false; }
    if (!IdFlags || typeof IdFlags.flags !== 'function' || !(await IdFlags.flags()).canon) return false;
    const src = GRADE_SOURCE[gradeSource];
    if (!canonicalId || !src || !(Number(grade) >= 1 && Number(grade) <= 5)) return false;
    const year = yearCode(now);
    const { data, error } = await supabase.from('child_identity').select('canonical_id').eq('canonical_id', canonicalId).eq('year_code', year).limit(1);
    if (error) { if (!isMissingTable(error)) logError('web_quiz.ch_identity_write_failed', { code: error.code || null }); return false; }
    if (data && data.length) return false;
    const { error: e2 } = await supabase.from('child_identity').insert({ canonical_id: canonicalId, year_code: year, fixed_grade: Number(grade), grade_source: src, fixed_at: new Date(now).toISOString() });
    if (e2 && e2.code !== '23505' && !isMissingTable(e2)) logError('web_quiz.ch_identity_write_failed', { code: e2.code || null });
    return !e2;
  } catch (e) {
    logError('web_quiz.ch_identity_write_failed', { error: String(e && e.message || e).slice(0, 120) });
    return false;
  }
}

/** ISO week in PKT: '2026-W45'. */
function isoWeekPkt(now = new Date()) {
  const d = new Date(new Date(now).getTime() + 5 * 3600 * 1000);
  const day = d.getUTCDay() || 7;
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - day));
  const wk = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

/** The child's active class (class_enrollments, the canonical id and the raw ids), never from a share code; null otherwise. */
async function activeClassOf(ids) {
  const list = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!list.length) return null;
  const { data, error } = await supabase.from('class_enrollments').select('class_id').in('student_id', list).eq('is_active', true).limit(1);
  return !error && data && data[0] && data[0].class_id ? data[0].class_id : null;
}

/** web_quiz.light_lit for a first finished exposure in a class: hashed class and kid through the envelope when present. */
function lightLit(row, now = new Date()) {
  if (!row || !row.class_id || Number(row.exposure_no) !== 1 || row.mode !== 'check' || !FINAL.has(row.status)) return null;
  const keyKind = row.anchor_block ? 'stop' : (row.exercise === 'read' || row.exercise === 'listen' ? 'passage' : 'item_set');
  const base = { key_kind: keyKind, week: isoWeekPkt(now) };
  let K = null;
  try { K = require('./web-quiz-kid'); } catch (_) { K = null; }
  const ev = K && typeof K.envelope === 'function' ? K.envelope({ kid: K.kid(row.canonical_id), cls: K.cls(row.class_id), ...base }) : base;
  require('../../utils/structured-logger').logEvent('web_quiz.light_lit', ev);
  return ev;
}

function __reset() { cache.clear(); periodMissingDay = null; }

module.exports = {
  STOPS, WEIGHTS, ON_ITS_WAY_COPY,
  entryBand, ceilingBand, gradeBand, formOfGrade, isLine1OrZero, lastCountedRead, drawBand,
  rowServedId, seenIdsOf, exposureNo, anchorExposureNo, anchorServesAny, anchorPrev2, countedThisPeriod, recordAtServe,
  eligible, weigh, mulberry32, pick, drawPassage, periodIdFor, biggerSetFor, tryoutItem, trailState,
  registryPassages, periods, notePeriodMissing, adminFields, yearCode, writeChildIdentity, isoWeekPkt, activeClassOf, lightLit, rungsOf, openBand, fixedGradeOf, childRows, logDraw, trailStateFor, pickOf,
  isCountedSource,
  __reset,
};
