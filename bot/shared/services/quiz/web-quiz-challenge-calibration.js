'use strict';
/**
 * The Challenge's monthly calibration job. It PROPOSES; a named human decides.
 *
 * What it proposes (contract: ITEMS.md §1.4, §1.6, §6, §7, §8.5):
 *   - a passage equating link to its band × language reference: one `challenge_links` row with `signed_at` NULL
 *     (`proposed_by = 'calibration-job'`, `ref_eligible_only = true`). An unsigned row changes nothing a child or
 *     the statement sees.
 *   - maths item estimates: the estimate columns of `challenge_items` (difficulty, se, n, n_right, n_wrong, infit,
 *     outfit, dif_lang) for items already `operational` or `provisional`. Never `status`, never an anchor's fixed
 *     difficulty.
 *   - withdrawals of stuck passages, operational / retire moves for items, reference drift and stuck references:
 *     returned in the run's result and counted in the `web_quiz.ch_calibration_run` summary event. Nothing here
 *     writes `challenge_passages` at all: no status, `released_at`, `withdrawn_at`, `signed_by` or `adjustment` moves.
 *
 * Behind app_settings `web_quiz_challenge_calibration` (read side, under `web_quiz_challenge_v2`, itself under
 * `web_quiz_challenge`); every one fails closed and is off by default. Off → the job reads its own switch and stops.
 *
 * `runMonthly({ period_id, now })` is the entry point for whichever daily/monthly job calls it after a period
 * closes. No scheduler is wired here.
 *
 * The pure core (no I/O) is exported for tests: calibrationSample, proposeLink, entryVsPromoted, referenceDrift,
 * stuckShare, itemResponses, raschFloors (a small anchored one-parameter JMLE, no library).
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logError } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const SWITCH = 'web_quiz_challenge_calibration';
const PARENTS = ['web_quiz_challenge_v2', 'web_quiz_challenge'];
const PROPOSED_BY = 'calibration-job';
const PAGE = 1000;

// ITEMS §6.4, §6.7, §8.5, §7
const N_FLOOR = 100;
const LINEAR_FLOOR = 400;
const MIN_GAP_SD = 0.1;
const EVP_MIN = 30;
const EVP_MAX_SD = 0.1;
const REF_DRIFT_SD = 0.3;
const STUCK_N = 20;
const STUCK_SHARE = 0.25;
const STUCK_MEDIAN_FROM = 3;
const R = {
  estN: 30, estEach: 8, estSe: 1.0,
  opN: 100, opNA2: 150, opSe: 0.5, fitLo: 0.7, fitHi: 1.3, ptm: 0.2, difN: 30, difOp: 0.5,
  retireFit: 1.5, retireDif: 1.0, drift: 0.5, relinkShare: 0.25,
};

// ---------------------------------------------------------------- small numbers
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const variance = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
};
const pooledSd = (a, b) => Math.sqrt((variance(a) + variance(b)) / 2);
const gapSd = (a, b) => { const s = pooledSd(a, b); return s > 0 ? (mean(a) - mean(b)) / s : 0; };
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const inWindow = (p, from, to) => typeof p === 'string' && p >= from && p <= to;
const pad2 = (i) => String(i).padStart(2, '0');
const counted = (r) => r && r.mode === 'check' && r.record === true;
const selfHigh = (r) => r.helped === 'self' && r.id_confidence === 'high';

// ---------------------------------------------------------------- passages: the sample
/**
 * Not a reading a scale can use (ITEMS §6.2): over 250 words a minute, the whole passage inside 15 seconds, or the
 * row's own too-fast mark. Only read-aloud rows have a words-per-minute.
 */
function isImplausible(row) {
  if (row.exercise !== 'read') return !!(row.meta && row.meta.too_fast);
  const s = row.score || {};
  if (row.wcpm != null && Number(row.wcpm) > 250) return true;
  if (row.meta && row.meta.too_fast) return true;
  if (s.finished_early && Number.isFinite(Number(s.time_left)) && 60 - Number(s.time_left) < 15) return true;
  return false;
}

/** The value a reading is calibrated on: words correct a minute when read aloud, the question score when listened to. */
const valueOf = (row) => (row.exercise === 'listen'
  ? (row.score && Number.isFinite(Number(row.score.correct)) ? Number(row.score.correct) : null)
  : (row.wcpm == null ? null : Number(row.wcpm)));

/** The comprehension proportion the row carries (m_result's comp_ok / comp_n), or null. */
const compOf = (row) => {
  const m = row.meta || {};
  return Number(m.comp_n) > 0 && Number.isFinite(Number(m.comp_ok)) ? Number(m.comp_ok) / Number(m.comp_n) : null;
};

/**
 * The first-exposure readings of one passage (ITEMS §6.2): `mode='check'`, `record=true`, `exposure_no=1`,
 * `helped='self'`, `id_confidence='high'`, the period in the window, and the draw that served it had the reference
 * eligible (`challenge_draws.ref_eligible`, condition 2). Scored readings carry a value (line-1 stops and 0-word reads
 * at 0: they are the bottom of the distribution); failed ones count as attempted only.
 */
function calibrationSample(rows, draws, { passageId, lang, band, windowFrom, windowTo }) {
  const eligibleRuns = new Set();
  const seenRuns = new Set();
  for (const d of draws || []) {
    if (!d || !d.run_id) continue;
    seenRuns.add(d.run_id);
    if (d.ref_eligible === true) eligibleRuns.add(d.run_id);
  }
  const readings = [];
  const excluded = { implausible: 0, ref_ineligible: 0, no_draw: 0 };
  let attempted = 0;
  for (const r of rows || []) {
    if (!r || r.passage_id !== passageId || r.lang !== lang || Number(r.band) !== Number(band)) continue;
    if (!counted(r) || Number(r.exposure_no) !== 1 || !selfHigh(r)) continue;
    if (!inWindow(r.period_id, windowFrom, windowTo)) continue;
    if (r.status !== 'scored' && r.status !== 'failed') continue;
    if (!eligibleRuns.has(r.id)) { excluded[seenRuns.has(r.id) ? 'ref_ineligible' : 'no_draw'] += 1; continue; }
    if (r.status === 'failed') { attempted += 1; continue; }
    if (isImplausible(r)) { excluded.implausible += 1; continue; }
    const value = valueOf(r);
    if (value == null) continue;
    attempted += 1;
    readings.push({ value, band_reason: (r.meta && r.meta.draw && r.meta.draw.band_reason) || null, comp: compOf(r) });
  }
  return { passage_id: passageId, lang, band, window_from: windowFrom, window_to: windowTo, readings, attempted, excluded };
}

/**
 * A link proposal from a passage's sample to its reference's sample in the same window and cell (ITEMS §6.4):
 * under 100 on either side nothing; a standardised gap under 0.1 SD → `mean` with adjustment 0 ("report raw");
 * 400+ on both → `linear` (mean and SD); else `mean`. Comprehension proportions get a ratio. Never equipercentile.
 * `adjustment` is what is added to the passage's score to put it on the reference (the shift at the mean); a
 * linear link also returns its `slope` and `intercept` (reference = slope × passage + intercept).
 */
function proposeLink(sampleFrom, sampleRef, { n_floor = N_FLOOR, linear_floor = LINEAR_FLOOR, min_gap_sd = MIN_GAP_SD } = {}) {
  const p = ((sampleFrom && sampleFrom.readings) || []).map((r) => r.value);
  const r = ((sampleRef && sampleRef.readings) || []).map((x) => x.value);
  const n_from = p.length; const n_to = r.length;
  if (n_from < n_floor || n_to < n_floor) return { method: null, reason: 'n_floor', n_from, n_to };
  const gap_sd = gapSd(p, r);
  const se = Math.sqrt(variance(p) / n_from + variance(r) / n_to);
  const cp = ((sampleFrom && sampleFrom.readings) || []).map((x) => x.comp).filter((v) => v != null);
  const cr = ((sampleRef && sampleRef.readings) || []).map((x) => x.comp).filter((v) => v != null);
  const comp_adjustment = cp.length && cr.length && mean(cp) > 0 ? mean(cr) / mean(cp) : null;
  if (Math.abs(gap_sd) < min_gap_sd) return { method: 'mean', gap_sd, adjustment: 0, se, comp_adjustment, n_from, n_to, note: 'report raw' };
  const shift = mean(r) - mean(p);
  if (n_from >= linear_floor && n_to >= linear_floor) {
    const sp = Math.sqrt(variance(p)); const sr = Math.sqrt(variance(r));
    const slope = sp > 0 ? sr / sp : 1;
    return { method: 'linear', gap_sd, adjustment: shift, slope, intercept: mean(r) - slope * mean(p), se, comp_adjustment, n_from, n_to };
  }
  return { method: 'mean', gap_sd, adjustment: shift, se, comp_adjustment, n_from, n_to };
}

/**
 * Condition 3 (ITEMS §6.5): within a band-2 passage's sample, readers who entered the band vs readers promoted into
 * it. Null only when the band is not 2 (no entry / promotion split exists there). Band 2 with either side under 30:
 * `{ checked: false, reason: 'n_small' }` — the check cannot be made, and the caller must then fail closed (entrants
 * only), never pool unchecked. Both sides at 30 or more: over 0.1 SD → the link is on entrants only.
 */
function entryVsPromoted(sample) {
  if (!sample || Number(sample.band) !== 2) return null;
  const rs = sample.readings || [];
  const e = rs.filter((r) => r.band_reason === 'entry_grade').map((r) => r.value);
  const p = rs.filter((r) => r.band_reason === 'promoted').map((r) => r.value);
  if (e.length < EVP_MIN || p.length < EVP_MIN) return { checked: false, reason: 'n_small', n_entry: e.length, n_promoted: p.length };
  const sd = gapSd(e, p);
  return { checked: true, sd, n_entry: e.length, n_promoted: p.length, entrants_only: Math.abs(sd) > EVP_MAX_SD };
}

/**
 * How a passage's sample is split for its link: band 2 unchecked → entrants only ('unchecked'); band 2 over the
 * line → entrants only ('gap'); band 2 within it → pooled ('pooled'); any other band → pooled, no reason.
 */
function evpDecision(evp) {
  if (!evp) return { entrants_only: false, sd: null, evp_reason: null };
  if (!evp.checked) return { entrants_only: true, sd: null, evp_reason: 'unchecked' };
  return evp.entrants_only ? { entrants_only: true, sd: evp.sd, evp_reason: 'gap' } : { entrants_only: false, sd: evp.sd, evp_reason: 'pooled' };
}

/** ITEMS §6.7: the reference this period vs the prior quarter, same cell. Past 0.3 SD is a line for review, never a rule. */
function referenceDrift(refThisPeriod, refPriorQuarter) {
  const a = ((refThisPeriod && refThisPeriod.readings) || []).map((r) => r.value);
  const b = ((refPriorQuarter && refPriorQuarter.readings) || []).map((r) => r.value);
  if (a.length < 2 || b.length < 2) return null;
  const gap_sd = gapSd(a, b);
  return { gap_sd, n_this: a.length, n_prior: b.length, escalate: Math.abs(gap_sd) > REF_DRIFT_SD };
}

// ---------------------------------------------------------------- passages: stuck share
const isStuck = (r) => r.status === 'failed' || !!(r.score && r.score.stopped) || (r.wcpm != null && Number(r.wcpm) === 0);

/**
 * ITEMS §8.5, per check passage per (lang, band, kind): stuck share = (line-1 stops + 0-word reads + swept/failed)
 * / attempted counted first-exposure reads. At n ≥ 20, over 25% → a withdrawal PROPOSAL (`stuck`); once ≥ 3 passages
 * of the cell are measured (n ≥ 20) the rule is the passage's excess over the cell's median. A reference is never
 * proposed for withdrawal: it gets an escalation line instead.
 */
function stuckShare(attemptedRows, passages = []) {
  const reg = new Map((passages || []).map((p) => [p.passage_id, p]));
  const per = new Map();
  for (const r of attemptedRows || []) {
    if (!r || !r.passage_id || !counted(r) || Number(r.exposure_no) !== 1) continue;
    if (r.status !== 'scored' && r.status !== 'failed') continue;
    const p = reg.get(r.passage_id);
    if (p && (p.pool !== 'check' || p.withdrawn_at || p.status === 'retired')) continue;
    const kind = p ? p.kind : (r.exercise === 'listen' ? 'listen' : 'read');
    const lang = p ? p.lang : r.lang;
    const band = p ? Number(p.band) : Number(r.band);
    const cur = per.get(r.passage_id) || { passage_id: r.passage_id, lang, band, kind, is_reference: !!(p && p.is_reference), n: 0, stuck: 0 };
    cur.n += 1;
    if (isStuck(r)) cur.stuck += 1;
    per.set(r.passage_id, cur);
  }
  const out = [...per.values()].map((x) => ({ ...x, share: x.n ? x.stuck / x.n : null }));
  const cellOf = (x) => `${x.lang}|${x.band}|${x.kind}`;
  const medians = new Map();
  for (const x of out) {
    if (x.n < STUCK_N) continue;
    const k = cellOf(x);
    medians.set(k, [...(medians.get(k) || []), x.share]);
  }
  return out.map((x) => {
    const measured = medians.get(cellOf(x)) || [];
    const cell_median = measured.length >= STUCK_MEDIAN_FROM ? median(measured) : null;
    const excess = cell_median == null ? x.share : x.share - cell_median;
    const over = x.n >= STUCK_N && excess > STUCK_SHARE;
    const base = { ...x, cell_median, excess, propose: null };
    if (!over) return base;
    if (x.is_reference) return { ...base, escalation: 'reference over the stuck line: the band definition needs review, never an automatic withdrawal' };
    return { ...base, propose: 'withdraw', withdraw_reason: 'stuck' };
  });
}

// ---------------------------------------------------------------- items: responses and the Rasch floors
/**
 * Per-item responses from counted, first-exposure, self-run, high-confidence scored maths rows (ITEMS §7):
 * the A1 warm-up by position (`anchor.A1.NN`; a skip is wrong, an unreached item is no response), a bigger set by
 * position (`<item_set_id>.NN`), and the silent try-out (`meta.tryout`: its `ok`, else its `resp` against the item's
 * answer). One person = one canonical child in one period.
 */
function itemResponses(rows, items = []) {
  const byId = new Map((items || []).map((i) => [i.item_id, i]));
  const out = [];
  for (const r of rows || []) {
    if (!r || !counted(r) || !selfHigh(r) || r.status !== 'scored') continue;
    if (r.meta && r.meta.too_fast) continue;
    const person = `${r.canonical_id}|${r.period_id}`;
    let prefix = null;
    if (r.anchor_block) { if (Number(r.anchor_exposure_no) === 1) prefix = `anchor.${r.anchor_block}`; }
    else if (r.item_set_id) { if (Number(r.exposure_no) === 1) prefix = r.item_set_id; }
    if (!prefix) continue;
    for (const it of (r.meta && Array.isArray(r.meta.items) ? r.meta.items : [])) {
      if (!it || !Number.isInteger(Number(it.i)) || it.reached === false) continue;
      const x = it.verdict === 'correct' || it.ok === true ? 1 : 0;
      out.push({ person, item_id: `${prefix}.${pad2(Number(it.i))}`, x, lang: r.lang });
    }
    const t = r.meta && r.meta.tryout;
    if (t && t.item_id) {
      let x = null;
      if (typeof t.ok === 'boolean') x = t.ok ? 1 : 0;
      else {
        const item = byId.get(t.item_id);
        const ans = item && item.params ? item.params.ans : undefined;
        const resp = t.resp && typeof t.resp === 'object' ? (t.resp.value != null ? t.resp.value : t.resp.pick) : t.resp;
        if (ans != null && resp != null && resp !== '') x = Number(resp) === Number(ans) ? 1 : 0;
      }
      if (x != null) out.push({ person, item_id: t.item_id, x, lang: r.lang });
    }
  }
  return out;
}

/** The item's difficulty given fixed person measures (Newton on the item's score equation). */
function itemGivenThetas(obs) {
  let b = 0;
  for (let k = 0; k < 50; k++) {
    let f = 0; let v = 0;
    for (const { th, x } of obs) { const p = sigmoid(th - b); f += x - p; v += p * (1 - p); }
    if (v <= 0) return null;
    const step = Math.max(-1, Math.min(1, f / v));
    b -= step;
    if (Math.abs(step) < 1e-6) break;
  }
  return b;
}

/**
 * Joint maximum likelihood for the dichotomous Rasch model with some item difficulties fixed. Persons with a zero or
 * perfect score have no finite measure and are left out. With nothing fixed, the free items are centred on 0.
 */
function jmle(resp, fixed, freeIds, { maxIter = 200, tol = 1e-5 } = {}) {
  const use = resp.filter((r) => fixed.has(r.item_id) || freeIds.has(r.item_id));
  const persons = new Map();
  for (const r of use) {
    const p = persons.get(r.person) || { obs: [], score: 0 };
    p.obs.push(r); p.score += r.x;
    persons.set(r.person, p);
  }
  const theta = new Map();
  for (const [id, p] of persons) {
    if (p.score === 0 || p.score === p.obs.length) continue;
    const f = p.score / p.obs.length;
    theta.set(id, Math.log(f / (1 - f)));
  }
  const b = new Map(fixed);
  const itemObs = new Map();
  for (const r of use) if (theta.has(r.person)) itemObs.set(r.item_id, [...(itemObs.get(r.item_id) || []), r]);
  for (const id of freeIds) {
    const o = itemObs.get(id) || [];
    const f = o.length ? o.reduce((a, r) => a + r.x, 0) / o.length : 0.5;
    b.set(id, f > 0 && f < 1 ? -Math.log(f / (1 - f)) : 0);
  }
  for (let it = 0; it < maxIter; it++) {
    let delta = 0;
    for (const [id, th] of theta) {
      let f = 0; let v = 0;
      for (const r of persons.get(id).obs) { if (!b.has(r.item_id)) continue; const p = sigmoid(th - b.get(r.item_id)); f += r.x - p; v += p * (1 - p); }
      if (v <= 0) continue;
      const step = Math.max(-1, Math.min(1, f / v));
      theta.set(id, th + step);
      delta = Math.max(delta, Math.abs(step));
    }
    for (const id of freeIds) {
      const o = itemObs.get(id);
      if (!o || !o.length) { b.delete(id); continue; }
      let f = 0; let v = 0;
      for (const r of o) { const p = sigmoid(theta.get(r.person) - b.get(id)); f += r.x - p; v += p * (1 - p); }
      if (v <= 0) continue;
      const step = Math.max(-1, Math.min(1, f / v));
      b.set(id, b.get(id) - step);
      delta = Math.max(delta, Math.abs(step));
    }
    if (!fixed.size && freeIds.size) {
      const ids = [...freeIds].filter((id) => b.has(id));
      const c = mean(ids.map((id) => b.get(id))) || 0;
      for (const id of ids) b.set(id, b.get(id) - c);
    }
    if (delta < tol) break;
  }
  return { theta, b, itemObs };
}

function itemStats(obs, theta, bi) {
  let v = 0; let num = 0; let z2 = 0;
  const xs = []; const ts = [];
  for (const r of obs) {
    const th = theta.get(r.person);
    const p = sigmoid(th - bi);
    const w = p * (1 - p);
    v += w; num += (r.x - p) ** 2; z2 += (r.x - p) ** 2 / w;
    xs.push(r.x); ts.push(th);
  }
  const mx = mean(xs); const mt = mean(ts);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ts[k] - mt); sxx += (xs[k] - mx) ** 2; syy += (ts[k] - mt) ** 2; }
  return {
    se: v > 0 ? 1 / Math.sqrt(v) : null,
    infit: v > 0 ? num / v : null,
    outfit: obs.length ? z2 / obs.length : null,
    pt_measure: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null,
  };
}

/**
 * ITEMS §7 on the responses of `itemResponses`: a one-parameter Rasch run anchored on A1's fixed difficulties.
 * - an A1 item whose free estimate is more than 0.5 logit from its fixed value is `unanchored` (freed in the
 *   estimation, never removed from the screen); more than 25% of A1 drifting → `relink` (a review line).
 * - a provisional / operational non-anchor item with ≥ 30 responses, ≥ 8 right and ≥ 8 wrong (SE ≤ 1.0) gets an
 *   estimate; a provisional one past 100 (150 for an A2 candidate) with SE ≤ 0.5, infit and outfit 0.7–1.3,
 *   point-measure r > 0.2 and language DIF ≤ 0.5 (when both languages have ≥ 30) gets an `operational` proposal;
 *   misfit over 1.5 at n ≥ 100, or DIF over 1.0, a `retire` proposal. Nothing here moves a status.
 */
function raschFloors(responses, items = []) {
  const reg = new Map((items || []).map((i) => [i.item_id, i]));
  const anchors = new Map();
  for (const i of items || []) {
    if (i.anchor && i.anchor_block === 'A1' && i.difficulty != null && Number.isFinite(Number(i.difficulty))) anchors.set(i.item_id, Number(i.difficulty));
  }
  const resp = (responses || []).filter((r) => reg.has(r.item_id));
  const counts = new Map();
  for (const r of resp) {
    const c = counts.get(r.item_id) || { n: 0, n_right: 0, n_wrong: 0 };
    c.n += 1; if (r.x) c.n_right += 1; else c.n_wrong += 1;
    counts.set(r.item_id, c);
  }
  const live = (i) => i && !i.anchor && (i.status === 'provisional' || i.status === 'operational');
  const free = new Set([...counts].filter(([id, c]) => live(reg.get(id)) && c.n >= R.estN && c.n_right >= R.estEach && c.n_wrong >= R.estEach).map(([id]) => id));
  const reasons = {};
  const bump = (k) => { reasons[k] = (reasons[k] || 0) + 1; };
  if (!anchors.size) bump('anchor_unset');

  // anchor drift, then the run with drifting anchors freed
  let fit = jmle(resp, anchors, free);
  const unanchored = [];
  for (const [id, fixedB] of anchors) {
    const obs = (fit.itemObs.get(id) || []).map((r) => ({ th: fit.theta.get(r.person), x: r.x }));
    const est = obs.length ? itemGivenThetas(obs) : null;
    if (est != null && Math.abs(est - fixedB) > R.drift) unanchored.push({ item_id: id, fixed: fixedB, estimate: est, drift: est - fixedB });
  }
  const relink = anchors.size > 0 && unanchored.length / anchors.size > R.relinkShare;
  if (unanchored.length) {
    const kept = new Map([...anchors].filter(([id]) => !unanchored.some((u) => u.item_id === id)));
    const freed = new Set([...free, ...unanchored.map((u) => u.item_id)]);
    fit = jmle(resp, kept, freed);
  }

  const estimates = [];
  const proposals = [];
  for (const id of free) {
    const item = reg.get(id);
    const c = counts.get(id);
    const bi = fit.b.get(id);
    const obs = fit.itemObs.get(id) || [];
    if (bi == null || !obs.length) { bump('not_estimable'); continue; }
    const st = itemStats(obs, fit.theta, bi);
    if (st.se == null || st.se > R.estSe) { bump('se_wide'); continue; }
    const byLang = (l) => obs.filter((r) => r.lang === l).map((r) => ({ th: fit.theta.get(r.person), x: r.x }));
    const en = byLang('en'); const ur = byLang('ur');
    let dif_lang = null;
    if (en.length >= R.difN && ur.length >= R.difN) {
      const be = itemGivenThetas(en); const bu = itemGivenThetas(ur);
      if (be != null && bu != null) dif_lang = bu - be;
    }
    const e = { item_id: id, difficulty: bi, se: st.se, n: c.n, n_right: c.n_right, n_wrong: c.n_wrong, infit: st.infit, outfit: st.outfit, dif_lang, pt_measure: st.pt_measure };
    estimates.push(e);
    const misfit = c.n >= R.opN && (st.infit > R.retireFit || st.outfit > R.retireFit);
    const bigDif = dif_lang != null && Math.abs(dif_lang) > R.retireDif;
    if (bigDif || misfit) {
      proposals.push({ item_id: id, propose: 'retire', reason: bigDif ? 'dif' : 'misfit' });
      bump('retire');
      continue;
    }
    const floorN = id.startsWith('anchor.A2.') ? R.opNA2 : R.opN;
    if (item.status === 'provisional' && c.n >= floorN && st.se <= R.opSe
      && st.infit >= R.fitLo && st.infit <= R.fitHi && st.outfit >= R.fitLo && st.outfit <= R.fitHi
      && st.pt_measure != null && st.pt_measure > R.ptm && (dif_lang == null || Math.abs(dif_lang) <= R.difOp)) {
      proposals.push({ item_id: id, propose: 'operational', dif_checked: dif_lang != null });
      bump('operational');
    }
  }
  if (unanchored.length) reasons.unanchored = unanchored.length;
  if (relink) bump('relink');
  return { estimates, proposals, unanchored, relink, reasons };
}

// ---------------------------------------------------------------- the thin DB layer
const isMissingTable = (e) => !!e && (e.code === '42P01' || /does not exist|schema cache/i.test(String(e.message || '')));
function isTrue(v) {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { /* plain string */ } }
  return x === true || (typeof x === 'string' && x.trim().toLowerCase() === 'true');
}

/** One app_settings switch, true only when it reads true; any error reads off. */
async function switchOn(key) {
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', key);
    if (error) throw new Error(error.message || 'app_settings read failed');
    return !!(data && data[0] && isTrue(data[0].value));
  } catch (e) {
    logError('web_quiz.ch_calibration_setting_failed', { key, error: String((e && e.message) || e).slice(0, 120) });
    return false;
  }
}
/** The job's own switch first (off → nothing else is read), then its parents. */
async function enabled() {
  if (!(await switchOn(SWITCH))) return false;
  for (const k of PARENTS) if (!(await switchOn(k))) return false;
  return true;
}

class ReadFailed extends Error {
  constructor(table, error) { super(`${table}: ${(error && error.message) || error}`); this.table = table; this.missing = isMissingTable(error); }
}

/** Every row of a query, paged on its key (no silent 1,000-row cap). */
async function readAll(table, cols, key, apply = (q) => q) {
  const out = [];
  let last = null;
  for (;;) {
    let q = apply(supabase.from(table).select(cols));
    if (last != null) q = q.gt(key, last);
    const { data, error } = await q.order(key, { ascending: true }).limit(PAGE);
    if (error) throw new ReadFailed(table, error);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
    last = data[data.length - 1][key];
  }
}

const RUN_COLS = 'id, canonical_id, exercise, lang, status, score, wcpm, meta, mode, record, exposure_no, anchor_exposure_no, anchor_block, item_set_id, helped, id_confidence, period_id, passage_id, band';
const PASSAGE_COLS = 'passage_id, lang, kind, pool, band, status, is_reference, released_at, withdrawn_at';
const ITEM_COLS = 'item_id, task, form, pool, status, anchor, anchor_block, anchor_pos, difficulty, params';

function periodOf(ts, periods) {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  const hit = periods.find((p) => new Date(p.starts_at).getTime() <= t && t < new Date(p.ends_at).getTime());
  return hit ? hit.period_id : null;
}

function summaryEvent(s) {
  logEvent('web_quiz.ch_calibration_run', {
    w: 's',
    period_id: s.period_id, cells: s.cells, proposals: s.proposals, withdrawals_proposed: s.withdrawals_proposed,
    items_estimated: s.items_estimated, drift_flags: s.drift_flags, reasons: s.reasons,
  });
}

/**
 * The monthly run for a closed period: reads the registry and the counted rows up to `period_id`, writes link
 * proposals and item estimates, logs one summary event, and returns everything it found (the caller may print or
 * store it; the withdrawal, operational and retire proposals live only there and in the event's counts).
 */
async function runMonthly({ period_id, now = new Date() } = {}) {
  if (!(await enabled())) return { ran: false, reason: 'switch_off' };
  const s = { period_id, cells: 0, proposals: 0, withdrawals_proposed: 0, items_estimated: 0, drift_flags: 0, reasons: {} };
  const bump = (k, n = 1) => { s.reasons[k] = (s.reasons[k] || 0) + n; };
  const result = { ran: true, period_id, links: [], withdrawals: [], escalations: [], item_estimates: [], item_proposals: [], unanchored: [] };

  let periods; let passages; let items; let open; let rows; let draws;
  try {
    periods = (await readAll('challenge_periods', 'period_id, starts_at, ends_at', 'period_id'));
    if (!periods.some((p) => p.period_id === period_id)) {
      bump('period_unknown');
      summaryEvent(s);
      return { ran: false, reason: 'period_unknown', summary: s };
    }
    const upTo = periods.filter((p) => p.period_id <= period_id).map((p) => p.period_id);
    passages = await readAll('challenge_passages', PASSAGE_COLS, 'passage_id', (q) => q.eq('pool', 'check'));
    items = await readAll('challenge_items', ITEM_COLS, 'item_id');
    open = await readAll('challenge_links', 'id, from_passage, window_to, signed_at, proposed_by', 'id', (q) => q.eq('proposed_by', PROPOSED_BY).is('signed_at', null));
    draws = await readAll('challenge_draws', 'draw_id, run_id, ref_eligible, period_id', 'draw_id', (q) => q.eq('ref_eligible', true).in('period_id', upTo));
    rows = await readAll('web_quiz_challenge_runs', RUN_COLS, 'id', (q) => q.eq('mode', 'check').eq('record', true).in('period_id', upTo));
  } catch (e) {
    bump(e && e.missing ? 'registry_missing' : 'read_failed');
    logError('web_quiz.ch_calibration_read_failed', { table: e && e.table, error: String((e && e.message) || e).slice(0, 160) });
    summaryEvent(s);
    return { ran: false, reason: e && e.missing ? 'registry_missing' : 'read_failed', summary: s };
  }
  const order = periods.map((p) => p.period_id).sort();
  const first = order[0];
  const prior = order.filter((p) => p < period_id).slice(-3);
  const computedAt = new Date(now).toISOString();

  // ---- passage links, one cell (lang, band, kind) at a time, against the cell's reference
  const live = (p) => p.pool === 'check' && !p.withdrawn_at && p.status !== 'retired';
  const cells = new Map();
  for (const p of passages.filter(live)) {
    const k = `${p.lang}|${p.band}|${p.kind}`;
    const c = cells.get(k) || { ref: null, others: [] };
    if (p.is_reference) c.ref = p; else if ((p.status === 'provisional' || p.status === 'calibrated') && p.released_at) c.others.push(p);
    cells.set(k, c);
  }
  const sampleOf = (p, from, to) => calibrationSample(rows, draws, { passageId: p.passage_id, lang: p.lang, band: Number(p.band), windowFrom: from, windowTo: to });
  for (const { ref, others } of cells.values()) {
    if (!ref) { bump('no_reference', others.length); continue; }
    s.cells += 1;
    for (const p of others) {
      let windowFrom = periodOf(p.released_at, periods) || first;
      if (windowFrom > period_id) continue;
      if (windowFrom < first) windowFrom = first;
      let sFrom = sampleOf(p, windowFrom, period_id);
      let sRef = sampleOf(ref, windowFrom, period_id);
      const evp = evpDecision(entryVsPromoted({ band: Number(p.band), readings: sFrom.readings }));
      if (evp.entrants_only) {
        const entrants = (x) => ({ ...x, readings: x.readings.filter((r) => r.band_reason === 'entry_grade') });
        sFrom = entrants(sFrom); sRef = entrants(sRef);
        bump(evp.evp_reason === 'unchecked' ? 'entrants_only_unchecked' : 'entrants_only');
      }
      const link = proposeLink(sFrom, sRef);
      const entry = { passage_id: p.passage_id, reference: ref.passage_id, lang: p.lang, band: Number(p.band), kind: p.kind, window_from: windowFrom, window_to: period_id, ...link, entrants_only: evp.entrants_only, entry_vs_promoted_sd: evp.sd, evp_reason: evp.evp_reason };
      result.links.push(entry);
      if (!link.method) { bump(link.reason); continue; }
      if (link.note === 'report raw') bump('report_raw');
      if (open.some((o) => o.from_passage === p.passage_id && o.window_to === period_id)) { bump('already_proposed'); continue; }
      const row = {
        id: crypto.randomUUID(), from_passage: p.passage_id, to_passage: ref.passage_id, lang: p.lang, band: Number(p.band), design: 'random_groups',
        window_from: windowFrom, window_to: period_id, n_from: link.n_from, n_to: link.n_to, ref_eligible_only: true, method: link.method,
        gap_sd: link.gap_sd, adjustment: link.adjustment, se: link.se, comp_adjustment: link.comp_adjustment,
        entry_vs_promoted_sd: evp.sd, computed_at: computedAt, proposed_by: PROPOSED_BY, signed_by: null, signed_at: null,
      };
      const { error } = await supabase.from('challenge_links').insert(row);
      if (error) { bump('link_insert_failed'); logError('web_quiz.ch_calibration_write_failed', { table: 'challenge_links', error: String(error.message || error).slice(0, 160) }); continue; }
      s.proposals += 1;
    }
    // the reference this period vs the prior quarter
    if (prior.length) {
      const drift = referenceDrift(sampleOf(ref, period_id, period_id), sampleOf(ref, prior[0], prior[prior.length - 1]));
      if (drift && drift.escalate) {
        result.escalations.push({ kind: 'reference_drift', passage_id: ref.passage_id, lang: ref.lang, band: Number(ref.band), gap_sd: drift.gap_sd, n_this: drift.n_this, n_prior: drift.n_prior });
        s.drift_flags += 1;
        bump('reference_drift');
      }
    }
  }

  // ---- stuck passages: proposals only
  const stuck = stuckShare(rows.filter((r) => (r.exercise === 'read' || r.exercise === 'listen') && r.passage_id), passages);
  for (const x of stuck) {
    if (x.propose === 'withdraw') { result.withdrawals.push(x); s.withdrawals_proposed += 1; bump('stuck'); }
    if (x.escalation) { result.escalations.push({ kind: 'reference_stuck', passage_id: x.passage_id, lang: x.lang, band: x.band, share: x.share, n: x.n }); bump('reference_stuck'); }
  }

  // ---- maths items: estimates written (never status), proposals returned
  const rasch = raschFloors(itemResponses(rows, items), items);
  for (const [k, v] of Object.entries(rasch.reasons)) bump(k, v);
  result.unanchored = rasch.unanchored;
  result.item_proposals = rasch.proposals;
  s.drift_flags += rasch.unanchored.length;
  if (rasch.relink) result.escalations.push({ kind: 'anchor_relink', unanchored: rasch.unanchored.length });
  for (const e of rasch.estimates) {
    const patch = { difficulty: e.difficulty, se: e.se, n: e.n, n_right: e.n_right, n_wrong: e.n_wrong, infit: e.infit, outfit: e.outfit, dif_lang: e.dif_lang, updated_at: computedAt };
    const { data, error } = await supabase.from('challenge_items').update(patch).eq('item_id', e.item_id).in('status', ['operational', 'provisional']);
    if (error) { bump('item_write_failed'); logError('web_quiz.ch_calibration_write_failed', { table: 'challenge_items', error: String(error.message || error).slice(0, 160) }); continue; }
    if (Array.isArray(data) && !data.length) continue;
    s.items_estimated += 1;
    result.item_estimates.push(e);
  }

  summaryEvent(s);
  return { ...result, summary: s };
}

module.exports = {
  SWITCH, PROPOSED_BY,
  calibrationSample, proposeLink, entryVsPromoted, referenceDrift, stuckShare, itemResponses, raschFloors,
  isImplausible, runMonthly,
};
