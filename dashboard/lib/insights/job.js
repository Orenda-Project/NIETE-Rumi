'use strict';
/**
 * The COACHIP nightly run (NIGHTLY_JOB.md v1), stage by stage. Called by dashboard/jobs/coachip-nightly.js after the
 * environment assertion. Write mode goes through a SupabaseStore on the asserted tier; a dry run goes through a
 * MemoryStore and writes only codes and counts to --out (counts.json, excluded.json, costs.json).
 *
 * Order: facts → signals → moments + steps → code legs → rollups → ranking → circle → models (glosses for what will be
 * shown, phonics) → clips → close. Rollups and ranking run before the model calls because "what will be shown" (the
 * S1/S2 moment per ranked W, the circle) is decided by them (NIGHTLY_JOB §4 stage 5). Logs carry counts and W ids only.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const C = require('./constants');
const { readAllowed } = require('./allowlist');
const facts = require('./facts');
const src = require('./source');
const { buildSignals, countable } = require('./signals');
const { buildSessionSteps, buildMomentsWithStats } = require('./moments');
const legs = require('./legs');
const win = require('./windows');
const { computeRollups } = require('./rollups');
const { rankScope } = require('./ranking');
const { pickCircle } = require('./circle');
const { reconcile } = require('./reconcile');
const { buildSeedRows, applySeed } = require('./seed');
const ms = require('./model-stage');

const LIBRARY = require('../../data/coachip/INTERVENTIONS.json');
const CROSSWALK = require('../../data/coachip/crosswalk.json');

const FACT_COLUMNS = ['id', 'session_id', 'teacher_key', 'school_id', 'sector', 'recorded_at', 'is_observed', 'job_run_id',
  'grader_model', 'framework_version', 'pipeline_version', 'input_hash', 'status', 'failure_class', 'is_mismatch', 'is_unusable',
  'is_duplicate', 'duplicate_of_session_id', 'is_lp_linked', 'subject', 'grade', 'lesson_type', 'audio_s', 'ends_at_s',
  'last_stamp_s', 'last_done_s', 'is_short_of_audio', 'is_ran_out_of_time', 'is_time_remained', 'is_sent_home', 'is_stamped',
  'computed_at'];
const ROLLUP_KEY = 'scope_kind,scope_id,w_id,window_start,window_end,grader_model,framework_version,pipeline_version';
const LISTEN_PER_COACH = 50;

const pick = (o, cols) => Object.fromEntries(cols.filter((c) => o[c] !== undefined).map((c) => [c, o[c]]));
const factKey = (f) => `${f.session_id}|${f.grader_model}|${f.framework_version}`;
const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };

/** Stage 1: the in-memory FACTs (briefs/INTERFACES.md) for the window's in-population sessions. */
async function buildFacts({ readClient, scope, fromDate, toDate, secret, keepGloss, scopeFilter, computedAt }) {
  const out = [];
  const audioOf = new Map();
  const stats = await src.forEachSession(readClient, { fromDate, toDate, scope }, async (row) => {
    const schoolId = scope.teachers.get(row.user_id);
    const sector = scope.schools.get(schoolId);
    const holders = scope.holders.get(schoolId);
    const coachIds = holders ? [...holders] : [];
    if (scopeFilter && !scopeFilter({ schoolId, sector, coachIds })) return;
    const allowed = readAllowed(src.analysisOf(row));
    if (!keepGloss) allowed.gloss = { narrative: null, moves: {} };
    const base = {
      teacher_key: src.teacherKey(secret, row.user_id), school_id: schoolId, sector, coach_user_ids: coachIds,
      recorded_at: new Date(row.created_at).toISOString(), karachi_date: facts.karachiDay(row.created_at),
      is_observed: row.observation_type === 'leader_observation', job_run_id: null, computed_at: computedAt,
      is_duplicate: false, duplicate_of_session_id: null, allowed,
      _dedup: { id: row.id, user_id: row.user_id, observation_type: row.observation_type, created_at: row.created_at,
        audio_hash: row.audio_hash, audio_duration_seconds: row.audio_duration_seconds },
    };
    const lp = facts.buildLpFact(row, allowed);
    if (lp) out.push({ ...lp, ...base, instrument: 'lp_fidelity' });
    const fico = facts.buildFicoFact(row, allowed);
    if (fico) out.push({ ...fico, ...base, is_lp_linked: !!lp });
    if (row.audio_url) audioOf.set(row.id, row.audio_url);
  });
  // De-duplication per instrument among the rows the governed query counts (Q8: ok, usable, not a mismatch).
  for (const lpOnly of [true, false]) {
    const group = out.filter((f) => (f.instrument === 'lp_fidelity') === lpOnly && f.status === 'ok' && !f.is_unusable && !f.is_mismatch);
    const dup = facts.dedupe(group.map((f) => f._dedup));
    for (const f of group) if (dup.has(f.session_id)) { f.is_duplicate = true; f.duplicate_of_session_id = dup.get(f.session_id); }
  }
  for (const f of out) { f.id = crypto.randomUUID(); delete f._dedup; }
  return { facts: out, audioOf, stats };
}

/** Write mode: reuse unchanged facts (same input hash), replace changed ones' derived rows, insert new ones (§8). */
async function reconcileStored(store, list) {
  const sessionIds = [...new Set(list.map((f) => f.session_id))];
  const stored = new Map();
  for (let i = 0; i < sessionIds.length; i += 200) {
    const rows = await store.select('coachip_session_facts', (q) => q.in('session_id', sessionIds.slice(i, i + 200))
      .eq('pipeline_version', C.PIPELINE_VERSION), 'id,session_id,grader_model,framework_version,input_hash');
    for (const r of rows) stored.set(factKey(r), r);
  }
  const plan = { unchanged: [], changed: [], fresh: [] };
  for (const f of list) {
    const s = stored.get(factKey(f));
    if (!s) plan.fresh.push(f);
    else { f.id = s.id; (s.input_hash === f.input_hash ? plan.unchanged : plan.changed).push(f); }
  }
  return plan;
}

function scopeFilterOf(spec) {
  if (!spec) return null;
  const i = spec.indexOf(':');
  const kind = spec.slice(0, i); const value = spec.slice(i + 1);
  if (kind === 'coach') return (x) => x.coachIds.includes(value);
  if (kind === 'school') return (x) => x.schoolId === value;
  return (x) => x.sector === value;
}

/** Codes and counts only: the dry run's coach C-codes are its own ordinals, discarded after. */
function countsOutput({ rollups, signals, factsList, w4 }) {
  const coachCode = new Map();
  const code = (id) => { if (!coachCode.has(id)) coachCode.set(id, `C-${String(coachCode.size + 1).padStart(2, '0')}`); return coachCode.get(id); };
  const byFact = new Map(factsList.map((f) => [f.id, f]));
  const ict = {};
  for (const s of signals) {
    const f = byFact.get(s.fact_id);
    if (!f || !win.inWindow(f.karachi_date, w4)) continue;
    const k = `${s.w_id}|${s.source}`;
    ict[k] = ict[k] || { w_id: s.w_id, source: s.source, n: 0, d: 0, n_self: 0, d_self: 0 };
    if (s.is_in_denominator) { ict[k].d += 1; if (!f.is_observed) ict[k].d_self += 1; }
    if (s.is_hit) { ict[k].n += 1; if (!f.is_observed) ict[k].n_self += 1; }
  }
  const row = (r) => ({ w_id: r.w_id, n: r.numerator, d: r.denominator, window: `${r.window_start}..${r.window_end}`, weeks: r.window_weeks,
    status: r.status, framework: r.framework_version, teacher_count: r.teacher_count, rank: r.rank, product: r.product,
    hysteresis: r.is_hysteresis_applied,
    ...(r.scope_kind === 'sector' ? { coach_count: r.coach_count, coaches_with_5plus: r.coaches_with_5plus } : {}),
    excluded: { mismatch: r.excluded_mismatch, unusable: r.excluded_unusable, duplicate: r.excluded_duplicate, failed: r.excluded_failed },
    ...(r.stat_kind ? { stat: { kind: r.stat_kind, unit: r.stat_unit, value: Number(r.stat_value), base: r.stat_base } } : {}) });
  const sectors = {}; const coaches = {};
  for (const r of rollups) {
    if (r.scope_kind === 'sector') (sectors[r.sector] = sectors[r.sector] || []).push(row(r));
    if (r.scope_kind === 'coach') (coaches[code(r.coach_user_id)] = coaches[code(r.coach_user_id)] || []).push(row(r));
  }
  return { ict_w4: Object.values(ict).sort((a, b) => a.w_id.localeCompare(b.w_id)), sectors, coaches };
}

/** The moments that will be shown: per coach the best missing moment on each ranked W (S1/S2), the circle, and the
 * Listen feed's newest 50 per coach. Returns moment ids. */
function shownMoments({ moments, rollups, circle, facts: list, w4 }) {
  const factById = new Map(list.map((f) => [f.id, f]));
  const ids = new Set(circle.map((c) => c.moment_id));
  const conf = { high: 2, medium: 1, none: 0 };
  const byCoach = new Map();
  for (const m of moments) {
    const f = factById.get(m.fact_id);
    if (f) for (const c of f.coach_user_ids) push(byCoach, c, { m, f });
  }
  for (const r of rollups) {
    if (r.scope_kind !== 'coach' || !r.rank) continue;
    const cand = (byCoach.get(r.coach_user_id) || [])
      .filter(({ m, f }) => m.w_id === r.w_id && m.kind === 'missing' && win.inWindow(f.karachi_date, w4))
      .sort((a, b) => (conf[b.m.confidence] - conf[a.m.confidence]) || String(b.f.recorded_at).localeCompare(String(a.f.recorded_at)));
    if (cand[0]) ids.add(cand[0].m.id);
  }
  for (const entries of byCoach.values()) {
    entries.filter(({ m }) => m.kind === 'missing').sort((a, b) => String(b.f.recorded_at).localeCompare(String(a.f.recorded_at)))
      .slice(0, LISTEN_PER_COACH).forEach(({ m }) => ids.add(m.id));
  }
  return [...ids];
}

function rankAll({ raw, scope, previous, weaknesses, log }) {
  const byScope = new Map();
  for (const r of raw) push(byScope, `${r.scope_kind}|${r.coach_user_id || r.school_id || r.sector}|${r.window_weeks}`, r);
  const sectorShare = new Map();
  for (const r of raw) {
    if (r.scope_kind !== 'sector' || r.status !== 'ok') continue;
    if (!sectorShare.has(r.sector)) sectorShare.set(r.sector, {});
    sectorShare.get(r.sector)[r.w_id] = r.denominator ? r.numerator / r.denominator : 0;
  }
  const prevOrder = new Map();
  for (const p of previous) {
    const k = `${p.scope_kind}|${p.scope_id}`;
    if (!prevOrder.has(k)) prevOrder.set(k, []);
    prevOrder.get(k)[p.rank - 1] = p.w_id;
  }
  const out = [];
  for (const list of byScope.values()) {
    const r0 = list[0];
    const id = r0.coach_user_id || r0.school_id || r0.sector;
    const sector = r0.scope_kind === 'sector' ? r0.sector
      : r0.scope_kind === 'coach' ? (scope.coaches.get(id) || {}).sector : scope.schools.get(id);
    const res = rankScope(list, { weaknesses, sectorShareByW: r0.scope_kind === 'sector' ? null : sectorShare.get(sector) || null,
      previousOrder: (prevOrder.get(`${r0.scope_kind}|${id}`) || []).filter(Boolean) });
    for (const line of res.log) log(line);
    out.push(...res.rows);
  }
  return out;
}

/**
 * The run. opts = parseArgs output with `date`; deps = { mode: 'write'|'read_only', envName, ref, readClient, store, secret,
 * out, log, apiKey, now?, fetch?, clipper?, rethrow? }. Returns the exit code.
 */
async function runJob(opts, deps) {
  const log = deps.log || (() => {});
  const now = deps.now ? deps.now() : new Date();
  const computedAt = now.toISOString();
  const write = deps.mode === 'write';
  const store = deps.store;
  const anchor = win.addDays(opts.date, 1); // the night of --date is processed the next morning
  const w4 = win.windowFor(anchor, 4);
  const w8 = win.windowFor(anchor, 8);
  const want = (s) => !opts.stages || opts.stages.includes(s);
  const done = [];
  const counts = { sessions_seen: 0, sessions_ok: 0, sessions_failed: 0, model_calls: 0, cost_usd: 0 };
  const weaknesses = LIBRARY.weaknesses;

  // The job run row: write mode only (a dry run never writes a DB row). A re-run of a date upserts it, attempt + 1.
  let jobRunId = crypto.randomUUID();
  if (write) {
    const prev = await store.select('coachip_job_runs', (q) => q.eq('run_date', opts.date).eq('pipeline_version', C.PIPELINE_VERSION), 'id,attempt');
    if (prev.length) jobRunId = prev[0].id;
    await store.upsert('coachip_job_runs', [{ id: jobRunId, run_date: opts.date, pipeline_version: C.PIPELINE_VERSION, env_ref: deps.ref,
      started_at: computedAt, finished_at: null, attempt: prev.length ? prev[0].attempt + 1 : 1, status: 'running', failure_class: null,
      stages_done: [] }], 'run_date,pipeline_version');
    await applySeed(store, buildSeedRows(LIBRARY, CROSSWALK));
  }
  const mark = async (stage) => { done.push(stage); if (write) await store.update('coachip_job_runs', jobRunId, { stages_done: done }); };

  let rollupsDone = false;
  try {
    // ── stage 1: facts
    const scope = await src.loadScope(deps.readClient);
    const keepGloss = !opts.noModels && (write || opts.dryRunModelsUsd > 0);
    const built = await buildFacts({ readClient: deps.readClient, scope, fromDate: w8.window_start, toDate: opts.date,
      secret: deps.secret, keepGloss, scopeFilter: scopeFilterOf(opts.scope), computedAt });
    const all = built.facts;
    for (const f of all) f.job_run_id = jobRunId;
    counts.sessions_seen = built.stats.kept;
    counts.sessions_failed = new Set(all.filter((f) => f.status === 'failed').map((f) => f.session_id)).size;
    counts.sessions_ok = new Set(all.filter((f) => f.status !== 'failed').map((f) => f.session_id)).size;
    log(`facts sessions=${built.stats.kept} facts=${all.length} failed=${counts.sessions_failed} duplicates=${all.filter((f) => f.is_duplicate).length}`);

    let plan = { unchanged: [], changed: [], fresh: all };
    if (write) {
      plan = await reconcileStored(store, all);
      if (plan.changed.length) {
        const ids = plan.changed.map((f) => f.id);
        for (const t of ['coachip_session_signals', 'coachip_session_steps', 'coachip_moments']) await store.deleteWhere(t, 'fact_id', ids);
      }
      await store.upsert('coachip_session_facts', [...plan.changed, ...plan.fresh].map((f) => pick(f, FACT_COLUMNS)),
        'session_id,grader_model,framework_version,pipeline_version');
      log(`facts unchanged=${plan.unchanged.length} changed=${plan.changed.length} new=${plan.fresh.length}`);
    }
    await mark('facts');
    const rewrite = new Set([...plan.changed, ...plan.fresh].map((f) => f.id));

    // ── stage 2: signals (every fact in memory; written for new or changed facts only)
    const signals = [];
    for (const f of all) signals.push(...buildSignals(f, { weaknesses, crosswalk: CROSSWALK }));
    if (write) await store.upsert('coachip_session_signals', signals.filter((s) => rewrite.has(s.fact_id)), 'fact_id,w_id');
    await mark('signals');

    // ── stage 3: session steps and moments
    let moments = [];
    let skippedNoDetector = 0;
    const storedMoments = new Map(); // `${fact_id}|${w_id}|${kind}` → the stored row, for unchanged facts
    if (want('moments')) {
      const sigByFact = new Map();
      for (const s of signals) push(sigByFact, s.fact_id, s);
      const steps = [];
      for (const f of all) {
        if (!countable(f)) continue;
        if (f.instrument === 'lp_fidelity') steps.push(...buildSessionSteps(f));
        const r = buildMomentsWithStats(f, sigByFact.get(f.id) || []);
        skippedNoDetector += r.skippedNoDetector || 0;
        for (const m of r.rows) moments.push({ id: crypto.randomUUID(), ...m });
      }
      if (write) {
        await store.upsert('coachip_session_steps', steps.filter((s) => rewrite.has(s.fact_id)), 'fact_id,move_id');
        // Unchanged facts keep their stored moment ids, so circle rows and clips keep pointing at the same row.
        const stored = storedMoments;
        const ids = plan.unchanged.map((f) => f.id);
        for (let i = 0; i < ids.length; i += 200) {
          const rows = await store.select('coachip_moments', (q) => q.in('fact_id', ids.slice(i, i + 200)), 'id,fact_id,w_id,kind,gloss_status,clip_status');
          for (const r of rows) stored.set(`${r.fact_id}|${r.w_id}|${r.kind}`, r);
        }
        moments = moments.map((m) => {
          const s = stored.get(`${m.fact_id}|${m.w_id}|${m.kind}`);
          return s ? { ...m, id: s.id, gloss_status: s.gloss_status, clip_status: s.clip_status, _stored: true } : m;
        });
        await store.upsert('coachip_moments', moments.filter((m) => !m._stored && rewrite.has(m.fact_id)).map(({ _stored, ...m }) => m), 'fact_id,w_id,kind');
      }
      log(`moments rows=${moments.length} steps=${steps.length} phonics_without_detector=${skippedNoDetector}`);
      await mark('moments');
    }

    // ── stage 5a: phonics (before the rollups: W-PHON is counted), leaving the glosses' reserve inside the cap
    const capUsd = write ? C.NIGHTLY_CAP_USD + (opts.backfillBudgetUsd || 0) : opts.dryRunModelsUsd;
    const modelsOn = want('models') && !opts.noModels && capUsd > 0 && !!deps.apiKey;
    const ctx = modelsOn ? ms.createModelContext({ capUsd, write, store, jobRunId, deps, log }) : null;
    // Never a silent skip (rule 24): say why the model stage did not run.
    if (!modelsOn && want('models') && !opts.noModels) log(`models_skipped reason=${capUsd > 0 ? 'no_api_key' : 'no_budget'}`);
    if (ctx) {
      const coachCount = scope.coaches.size;
      const reserve = Math.min(capUsd / 2, coachCount * (LISTEN_PER_COACH + 3) * 0.00026 + 0.1);
      await ms.runPhonics(ctx, { facts: all, inWindow: (f) => win.inWindow(f.karachi_date, w4), reserveUsd: reserve });
      const phon = [];
      for (const f of all) phon.push(...ms.detectorSignals(f));
      signals.push(...phon);
      const phonMoments = [];
      for (const f of all.filter((x) => x.detector)) {
        const rows = buildMomentsWithStats(f, phon.filter((s) => s.fact_id === f.id)).rows.filter((m) => m.kind === 'phonics');
        for (const m of rows) {
          const kept = storedMoments.get(`${m.fact_id}|${m.w_id}|${m.kind}`);
          phonMoments.push(kept ? { ...m, id: kept.id, gloss_status: kept.gloss_status, clip_status: kept.clip_status } : { id: crypto.randomUUID(), ...m });
        }
      }
      moments.push(...phonMoments);
      if (write) {
        await store.upsert('coachip_session_signals', phon, 'fact_id,w_id');
        await store.upsert('coachip_moments', phonMoments, 'fact_id,w_id,kind');
      }
      log(`phonics read=${ctx.summary.phonics_read || 0} signals=${phon.length} moments=${phonMoments.length}`);
    }

    // ── stage 4: code legs. W-IP-HOME is a signal (stage 2); minutes over plan is the rollup stat; check strips here.
    if (want('legs') && write) {
      const open = await store.select('coachip_steps', (q) => q.eq('status', 'open'), 'id,coach_user_id,code_id,w_id,i_id,set_at,status');
      if (open.length) {
        const codes = await store.select('coachip_teacher_codes', (q) => q.in('id', open.map((s) => s.code_id).filter(Boolean)), 'id,teacher_key');
        const keyOf = new Map(codes.map((c) => [c.id, c.teacher_key]));
        const byKey = new Map();
        for (const f of all) push(byKey, f.teacher_key, f);
        const evalW = (wId, fact) => {
          const s = buildSignals(fact, { weaknesses, crosswalk: CROSSWALK }).find((x) => x.w_id === wId);
          return s ? { in_denominator: s.is_in_denominator, hit: s.is_hit } : null;
        };
        const res = legs.checkStrips({ openSteps: open.map((s) => ({ ...s, teacher_key: keyOf.get(s.code_id) || null })),
          factsByTeacherKey: byKey, interventions: LIBRARY.interventions, evalW, jobRunId });
        const existing = await store.select('coachip_step_checks', (q) => q.in('step_id', open.map((s) => s.id)), 'step_id,session_id');
        const have = new Set(existing.map((e) => `${e.step_id}|${e.session_id}`));
        const fresh = res.rows.filter((r) => !have.has(`${r.step_id}|${r.session_id}`)).map(({ recorded_at, ...r }) => r);
        if (fresh.length) await store.insert('coachip_step_checks', fresh); // insert if absent (§8)
        log(`legs open_steps=${open.length} checks_new=${fresh.length}`);
      }
      await mark('legs');
    }

    // ── stages 6-7: rollups and ranking, held for the week after the Monday run (NIGHTLY_JOB §5)
    let rollups = [];
    let held = false;
    if (write) {
      const prev = await store.select('coachip_rollups', (q) => q.eq('window_end', w4.window_end).eq('pipeline_version', C.PIPELINE_VERSION).limit(1), 'job_run_id');
      held = prev.length > 0 && prev[0].job_run_id !== jobRunId;
    }
    if (want('rollups') && !held) {
      const statFor = (wId, hitFacts) => (wId === 'W-IP-TIME' ? legs.statForIpTime(hitFacts) : null);
      const raw = computeRollups({ facts: all, signals, scopes: { coaches: scope.coaches, schools: scope.schools, sectors: C.SECTORS },
        runDate: anchor, jobRunId, statFor, computedAt });
      const previous = write ? await store.select('coachip_rollups', (q) => q.eq('window_end', win.addDays(w4.window_end, -7))
        .eq('pipeline_version', C.PIPELINE_VERSION).not('rank', 'is', null), 'scope_kind,scope_id,w_id,rank') : [];
      rollups = rankAll({ raw, scope, previous, weaknesses, log });
      if (write) {
        // A re-run writes only rows whose numbers changed (§8): computed_at alone is not a change.
        const stored = await store.select('coachip_rollups', (q) => q.in('window_end', [w4.window_end]).eq('pipeline_version', C.PIPELINE_VERSION));
        const keyOf = (r) => ROLLUP_KEY.split(',').map((k) => (k === 'scope_id' ? r.coach_user_id || r.school_id || r.sector : r[k])).join('|');
        const sig = (r) => JSON.stringify(Object.keys(r).filter((k) => !['id', 'scope_id', 'meta', 'computed_at', 'created_at', 'updated_at'].includes(k))
          .sort().map((k) => [k, r[k] == null ? null : typeof r[k] === 'number' || /^-?\d+(\.\d+)?$/.test(String(r[k])) ? Number(r[k]) : r[k]]));
        const have = new Map(stored.map((r) => [keyOf(r), sig(r)]));
        const changed = rollups.map(({ meta, scope_id, ...r }) => r).filter((r) => have.get(keyOf(r)) !== sig(r));
        if (changed.length) await store.upsert('coachip_rollups', changed, ROLLUP_KEY);
      }
      rollupsDone = true;
      log(`rollups rows=${rollups.length} ok=${rollups.filter((r) => r.status === 'ok').length} ranked=${rollups.filter((r) => r.rank).length}`);
      await mark('rollups');
      await mark('ranking');
    } else if (held) log('rollups held for the week');

    // ── stage 8: the circle, one moment per coach per sector per week on the sector's rank-1 W
    let circle = [];
    if (want('circle') && rollupsDone) {
      const weekStart = win.mondayOf(anchor);
      const factById = new Map(all.map((f) => [f.id, f]));
      const momentsByCoach = new Map();
      for (const m of moments) {
        const f = factById.get(m.fact_id);
        if (f && win.inWindow(f.karachi_date, w4)) for (const c of f.coach_user_ids) push(momentsByCoach, c, { ...m, recorded_at: f.recorded_at });
      }
      for (const sector of C.SECTORS) {
        const top = rollups.find((r) => r.scope_kind === 'sector' && r.sector === sector && r.rank === 1);
        const coachIds = [...scope.coaches].filter(([, c]) => c.sector === sector).map(([id]) => id);
        circle.push(...pickCircle({ sector, weekStart, coachIds, rank1W: top && top.w_id, momentsByCoach, jobRunId }));
      }
      if (write) {
        const existing = await store.select('coachip_circle_items', (q) => q.eq('week_start', weekStart), 'sector,coach_user_id');
        const have = new Set(existing.map((e) => `${e.sector}|${e.coach_user_id}`));
        circle = circle.filter((c) => !have.has(`${c.sector}|${c.coach_user_id}`)); // the first choice in the week stands
        if (circle.length) await store.insert('coachip_circle_items', circle);
      }
      log(`circle items=${circle.length}`);
      await mark('circle');
    }

    // ── stages 5, 9, 10: the model stage, inside the cap, only for what will be shown
    const shown = shownMoments({ moments, rollups, circle, facts: all, w4 });
    let modelSummary = { calls: 0, cost_usd: 0, cap_usd: 0, cap_hit: false, pending: 0, by_analysis: {} };
    if (ctx) {
      await ms.runGlosses(ctx, { shown, moments, facts: all, homeworkFacts: ms.homeworkCandidates(all, (f) => win.inWindow(f.karachi_date, w4)) });
      modelSummary = ctx.finish();
      counts.model_calls = modelSummary.calls;
      counts.cost_usd = modelSummary.cost_usd;
      await mark('models');
    }

    // ── stage 11: clips (write mode on the asserted tier only)
    if (want('clips') && write && deps.clipper) {
      const n = await deps.clipper({ momentIds: shown, moments, facts: all, audioOf: built.audioOf, store, log });
      log(`clips ready=${n}`);
      await mark('clips');
    }

    // ── stage 12: close
    if (write) {
      await store.update('coachip_job_runs', jobRunId, { finished_at: new Date().toISOString(), status: 'ok', failure_class: null,
        sessions_seen: counts.sessions_seen, sessions_ok: counts.sessions_ok, sessions_failed: counts.sessions_failed,
        model_calls: counts.model_calls, cost_usd: counts.cost_usd, is_cap_hit: !!modelSummary.cap_hit });
    } else {
      writeDryRun(deps.out, { rollups, signals, all, w4, w8, opts, built, modelSummary, moments, shown, circle, skippedNoDetector });
    }
    log(`done status=ok stages=${done.join(',')}`);
    return 0;
  } catch (err) {
    // Class and place only: never a value from a row (our read errors start `read <table>`).
    const where = ((err && err.message) || '').match(/^(read|select|upsert|insert|update|delete) [a-z_]+/);
    log(`failed after=${done[done.length - 1] || 'start'} error=${err && err.name} code=${(err && err.code) || '-'} where=${where ? where[0].replace(' ', ':') : '-'}`);
    if (write) {
      // A failure before the rollups leaves yesterday's rollups untouched (the home route reads the stale signal).
      await store.update('coachip_job_runs', jobRunId, { finished_at: new Date().toISOString(), status: rollupsDone ? 'partial' : 'failed',
        failure_class: rollupsDone ? null : 'upstream' }).catch(() => {});
    }
    if (deps.rethrow) throw err;
    return rollupsDone ? 0 : 2;
  }
}

function writeDryRun(out, { rollups, signals, all, w4, w8, opts, built, modelSummary, moments, shown, circle, skippedNoDetector }) {
  fs.mkdirSync(out, { recursive: true });
  const reasons = (list) => ({
    facts: list.length,
    mismatch: list.filter((f) => f.is_mismatch).length,
    unusable: list.filter((f) => f.is_unusable).length,
    duplicate: list.filter((f) => f.is_duplicate).length,
    failed: list.filter((f) => f.status === 'failed').length,
    failed_by_class: list.filter((f) => f.status === 'failed').reduce((a, f) => ({ ...a, [f.failure_class]: (a[f.failure_class] || 0) + 1 }), {}),
  });
  const inW4 = all.filter((f) => win.inWindow(f.karachi_date, w4));
  const byInst = {};
  for (const f of inW4) byInst[f.instrument || 'none'] = (byInst[f.instrument || 'none'] || 0) + 1;
  const rec = opts.reconcile ? {
    dedup_off: reconcile(all, { from: w4.window_start, to: w4.window_end, dedup: false }),
    dedup_on: reconcile(all, { from: w4.window_start, to: w4.window_end, dedup: true }),
  } : null;
  fs.writeFileSync(path.join(out, 'counts.json'), JSON.stringify({ date: opts.date, window_4w: w4, window_8w: w8,
    sessions_in_population: built.stats.kept, facts_by_instrument_w4: byInst, moments: moments.length, moments_shown: shown.length,
    circle_items: circle.length, phonics_without_detector: skippedNoDetector, reconcile: rec,
    ...countsOutput({ rollups, signals, factsList: all, w4 }) }, null, 1));
  fs.writeFileSync(path.join(out, 'excluded.json'), JSON.stringify({ window_8w: reasons(all), window_4w: reasons(inW4) }, null, 1));
  fs.writeFileSync(path.join(out, 'costs.json'), JSON.stringify(modelSummary, null, 1));
}

module.exports = { runJob, buildFacts, reconcileStored, shownMoments, countsOutput, scopeFilterOf, rankAll, FACT_COLUMNS };
