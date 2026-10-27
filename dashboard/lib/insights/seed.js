'use strict';
/**
 * Seeds the three COACHIP lookups from the frozen library (library/INTERVENTIONS.json, c-library v1.0, sha256 e9acc748…)
 * and the crosswalk (library/crosswalk.json, c-insights xw-1.x). Public lookup rows only. Weaknesses go in parent-first
 * order at any depth (W-IP-HOME's parent W-IP-NOPLAN has a parent of its own); crosswalk rows for deferred Ws are skipped
 * because they have no coachip_weaknesses row (FICO_CROSSWALK §3).
 */

function buildSeedRows(library, crosswalk) {
  const version = String(library.library_version || library.version);
  const ws = library.weaknesses;
  const parent = new Map(ws.map((w) => [w.id, w.parent_w_id || null]));
  const depth = (id) => { let n = 0; let p = parent.get(id); while (p) { n += 1; p = parent.get(p); } return n; };
  const weaknesses = [...ws]
    .sort((a, b) => depth(a.id) - depth(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((w) => ({
      w_id: w.id,
      parent_w_id: w.parent_w_id || null,
      primary_source: w.stream,
      pedagogical_weight: w.pedagogical_weight,
      is_s1_eligible: !!w.s1_eligible,
      is_s7: !!w.is_s7,
      is_cause_line: !!w.is_cause_line,
      short_name_en: w.short_name_en,
      short_name_ur: w.short_name_ur,
      library_version: version,
    }));
  const seeded = new Set(weaknesses.map((w) => w.w_id));
  const interventions = library.interventions.map((i) => ({
    i_id: i.id, w_id: i.weakness_id, level: i.level, rank_in_w: i.rank_in_w, library_version: version,
  }));
  const signals = crosswalk.rows.filter((r) => seeded.has(r.w_id)).map((r) => ({
    w_id: r.w_id, source: r.source, indicator_id: r.indicator_id, scale_min: r.scale_min, scale_max: r.scale_max,
    hit_rule: r.hit_rule, role: r.role, crosswalk_version: r.crosswalk_version,
  }));
  return { weaknesses, interventions, signals };
}

/** store.upsert(table, rows, onConflict): the job's store, already past the environment assertion. */
async function applySeed(store, rows) {
  await store.upsert('coachip_weaknesses', rows.weaknesses, 'w_id');
  await store.upsert('coachip_interventions', rows.interventions, 'i_id');
  await store.upsert('coachip_weakness_signals', rows.signals, 'w_id,source,indicator_id');
  return { weaknesses: rows.weaknesses.length, interventions: rows.interventions.length, signals: rows.signals.length };
}

module.exports = { buildSeedRows, applySeed };
