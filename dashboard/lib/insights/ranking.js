'use strict';
/**
 * Stage 7, ranking (NIGHTLY_JOB §4 stage 7; WEAKNESS_MAP §0.4). Over one scope's rollups: ok, S1-eligible, not a cause
 * line, past the coaching-priority threshold; product = prevalence × weight; a sub-row takes its parent's headline when
 * it holds the majority of the parent's hits (sub-rows never rank on their own); within 10% the last window's order
 * stands. Ranks 1 and 2 only. Returns copies; the log carries the scope kind and W ids, nothing else.
 */
const C = require('./constants');

const share = (r) => (r.denominator > 0 ? r.numerator / r.denominator : 0);
const round4 = (x) => Math.round(x * 10000) / 10000;

function rankScope(rollupsForScope, { weaknesses, sectorShareByW, previousOrder } = {}) {
  const rows = (rollupsForScope || []).map((r) => ({ ...r, rank: null, product: null, is_hysteresis_applied: false }));
  const log = [];
  if (!rows.length) return { rows, log };
  const kind = rows[0].scope_kind;
  const wById = new Map((weaknesses || []).map((w) => [w.id, w]));
  const weightOf = (id) => { const w = wById.get(id); return w ? Number(w.pedagogical_weight != null ? w.pedagogical_weight : w.weight) || 0 : 0; };
  const rowOf = new Map(rows.map((r) => [r.w_id, r]));
  const eligible = (r) => {
    const w = wById.get(r.w_id);
    return !!w && r.status === 'ok' && w.s1_eligible === true && w.is_cause_line !== true && !w.is_s7;
  };
  const passes = (r) => {
    const s = share(r);
    const ref = sectorShareByW && sectorShareByW[r.w_id];
    return (s >= C.PRIORITY_MIN_SHARE && r.teacher_count >= C.PRIORITY_MIN_TEACHERS)
      || (ref != null && ref > 0 && s >= C.PRIORITY_SECTOR_MULTIPLE * ref);
  };
  const familyOf = (id) => { const w = wById.get(id); return w && w.parent_w_id && rowOf.has(w.parent_w_id) ? w.parent_w_id : id; };

  // Candidates are parents (top-level rows); a qualifying sub-row with the majority of the parent's hits headlines it.
  const candidates = [];
  for (const r of rows) {
    const w = wById.get(r.w_id);
    if (!w || (w.parent_w_id && rowOf.has(w.parent_w_id)) || !eligible(r) || !passes(r)) continue;
    const product = round4(share(r) * weightOf(r.w_id));
    let headline = r;
    const subs = rows.filter((s) => { const sw = wById.get(s.w_id); return sw && sw.parent_w_id === r.w_id && eligible(s) && s.numerator * 2 > r.numerator; });
    if (subs.length) headline = subs.reduce((a, b) => (b.numerator > a.numerator ? b : a));
    candidates.push({ headline, product, family: r.w_id });
  }
  candidates.sort((a, b) => b.product - a.product || a.family.localeCompare(b.family));

  const top = candidates.slice(0, 2);
  if (top.length === 2 && Array.isArray(previousOrder) && top[0].product > 0
      && top[0].product - top[1].product <= C.HYSTERESIS_BAND * top[0].product) {
    const prev = previousOrder.map(familyOf);
    const i0 = prev.indexOf(top[0].family); const i1 = prev.indexOf(top[1].family);
    if (i0 !== -1 && i1 !== -1) {
      if (i1 < i0) top.reverse();
      for (const c of top) c.headline.is_hysteresis_applied = true;
      log.push(`hysteresis scope=${kind} w1=${top[0].headline.w_id} w2=${top[1].headline.w_id}`);
    }
  }
  for (const c of candidates) c.headline.product = c.product;
  top.forEach((c, i) => { c.headline.rank = i + 1; });
  return { rows, log };
}

module.exports = { rankScope };
