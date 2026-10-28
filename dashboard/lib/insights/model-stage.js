'use strict';
/**
 * Stages 5, 9 and 10 wired together (NIGHTLY_JOB §4, §6, §7): one ledger under the night's cap, one
 * coachip_model_runs row per call. Two entry points share the ledger:
 *   runPhonics  before the rollups (W-PHON is counted), spending only what the glosses' reserve leaves;
 *   runGlosses  after ranking and the circle (what will be shown is known): S1/S2 and circle glosses, the Listen feed,
 *               the 5% re-check, then homework glosses.
 * The name lexicon (the teacher's users.name tokens and the names on their class rosters) and transcripts are read into
 * memory for this stage only: never stored, logged or returned. In a dry run gloss text is gated and counted, never kept.
 */
const fs = require('fs');
const path = require('path');
const M = require('./model');
const G = require('./gloss');
const Ph = require('./phonics');
const { phaseOutcome } = require('./predicates');
const { HealthAbort } = require('./safety');

const BATCH = 50;

async function selectIn(client, table, columns, column, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const { data, error } = await client.from(table).select(columns).in(column, ids.slice(i, i + BATCH));
    if (error) throw new Error(`read ${table}: ${error.message}`);
    out.push(...data);
  }
  return out;
}

/** session id → name tokens of its teacher and the teacher's class rosters (in memory only). */
async function loadLexicons(client, sessionIds) {
  const sessions = await selectIn(client, 'coaching_sessions', 'id,user_id', 'id', sessionIds);
  const teacherIds = [...new Set(sessions.map((s) => s.user_id))];
  const users = await selectIn(client, 'users', 'id,name', 'id', teacherIds);
  const lists = await selectIn(client, 'student_lists', 'id,user_id', 'user_id', teacherIds);
  const students = await selectIn(client, 'students', 'list_id,student_name,student_name_urdu', 'list_id', lists.map((l) => l.id));
  const tokens = (s) => String(s || '').split(/[\s.,'’\-]+/u).filter((t) => t.length >= 3);
  const byTeacher = new Map(teacherIds.map((id) => [id, new Set()]));
  for (const u of users) for (const t of tokens(u.name)) byTeacher.get(u.id).add(t);
  const listOwner = new Map(lists.map((l) => [l.id, l.user_id]));
  for (const s of students) {
    const set = byTeacher.get(listOwner.get(s.list_id));
    if (set) for (const t of [...tokens(s.student_name), ...tokens(s.student_name_urdu)]) set.add(t);
  }
  return new Map(sessions.map((s) => [s.id, [...(byTeacher.get(s.user_id) || [])]]));
}

function createModelContext({ capUsd, write, store, jobRunId, deps, log }) {
  const ledger = M.createLedger({ capUsd });
  const summary = { calls: 0, cost_usd: 0, cap_usd: capUsd, cap_hit: false, pending: 0, by_analysis: {}, calls_log: [] };
  const findRun = write ? async (key) => {
    const rows = await store.select('coachip_model_runs', (q) => q.eq('session_id', key.session_id).eq('analysis', key.analysis)
      .eq('target', key.target).eq('model', key.model).eq('prompt_version', key.prompt_version).eq('input_hash', key.input_hash)
      .eq('purpose', key.purpose).in('status', ['ok', 'blocked', 'not_applicable']), 'id,status,output');
    return rows[0] || null;
  } : null;
  return {
    ledger, summary, write, store, jobRunId, deps, log: log || (() => {}),
    tally(analysis, status) {
      const a = summary.by_analysis[analysis] = summary.by_analysis[analysis] || {};
      a[status] = (a[status] || 0) + 1;
    },
    pending(analysis, n = 1) { summary.pending += n; this.tally(analysis, 'pending'); },
    /** Stores the rows (write mode) and logs model, tokens and cost per call. Returns the stored ids in order. */
    async record(rows) {
      for (const r of rows) {
        summary.calls += 1;
        summary.cost_usd = Math.round((summary.cost_usd + Number(r.cost_usd || 0)) * 1e5) / 1e5;
        const line = { analysis: r.analysis, purpose: r.purpose, model: r.model, status: r.status,
          tokens_in: r.tokens_in, tokens_out: r.tokens_out, cost_usd: Number(r.cost_usd || 0) };
        summary.calls_log.push(line);
        // A dry run streams each call to disk as it happens: a run that dies later still leaves its spend behind.
        if (!write && deps.out) {
          fs.mkdirSync(deps.out, { recursive: true });
          fs.appendFileSync(path.join(deps.out, 'calls.jsonl'), `${JSON.stringify(line)}\n`);
        }
      }
      if (write && rows.length) return store.insert('coachip_model_runs', rows.map((r) => ({ ...r, job_run_id: jobRunId })));
      return rows.map(() => ({ id: null }));
    },
    callDeps(sessionId, target) {
      return { fetch: deps.fetch || fetch, apiKey: deps.apiKey, findRun, jobRunId, sessionId, target, dryRun: !write };
    },
    /**
     * True once `stage` is past its cut-off (deps.deadlines[stage], epoch ms; the rest stays pending for the next night, said
     * once per stage); throws HealthAbort when deps.health reports the database unhealthy (bd-sex15q.41).
     */
    async halted(stage) {
      if (deps.health) {
        const h = await deps.health.check();
        if (!h.ok) throw new HealthAbort(stage, h.reason);
      }
      const cut = deps.deadlines && deps.deadlines[stage];
      return cut != null && Number(deps.now ? deps.now() : Date.now()) >= cut;
    },
    stopLine(stage, pending) {
      this.log(`deadline_reached stage=${stage} pending=${pending}`);
    },
    finish() {
      summary.cap_hit = ledger.isCapHit;
      if (ledger.isCapHit) this.log(ledger.capLine());
      this.log(`models calls=${summary.calls} cost_usd=${summary.cost_usd.toFixed(4)} pending=${summary.pending}`);
      return summary;
    },
  };
}

/** COACHIP_MODEL_CONCURRENCY: detector calls in flight at once (bd-sex15q.43; default 1, at most 3). */
const MODEL_CONCURRENCY_MAX = 3;
const modelConcurrency = (deps) => Math.min(MODEL_CONCURRENCY_MAX, Math.max(1, Math.floor(Number(deps && deps.modelConcurrency) || 1)));

/**
 * Phonics on literacy recordings in the window, newest first, leaving `reserveUsd` for tonight's glosses. Sets
 * fact.detector and fact.detector_run_id on each read. Up to deps.modelConcurrency calls run at once; each holds its p90
 * in the ledger from start to record, so N at once never buy past what one at a time would. The database stays bounded by
 * the clients' guardedFetch whatever N is. On a stop (cut-off, cap) or an error nothing new starts, the calls in flight
 * settle and are recorded, and the rest is pending once.
 */
async function runPhonics(ctx, { facts, inWindow, reserveUsd = 0 }) {
  const literacy = facts.filter((f) => f.instrument === 'lp_fidelity' && f.status === 'ok' && !f.is_duplicate && !f.is_mismatch
    && !f.is_unusable && (f.lesson_type === 'literacy_phonics' || f.lesson_type === 'literacy_text') && inWindow(f))
    .sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));
  const p90 = M.P90_USD.phonics;
  const affordable = () => ctx.ledger.spent + ctx.ledger.held + p90 <= ctx.summary.cap_usd - reserveUsd;
  const n = modelConcurrency(ctx.deps);
  ctx.log(`phonics_start candidates=${literacy.length} concurrency=${n}`);
  let read = 0;
  let started = 0;
  let stop = null; // 'deadline' | 'cap' | 'error'
  const failures = [];
  for (let i = 0; i < literacy.length && !stop; i += BATCH) {
    if (!affordable()) { stop = 'cap'; break; }
    if (await ctx.halted('phonics')) { stop = 'deadline'; break; }
    const batch = literacy.slice(i, i + BATCH);
    const texts = await selectIn(ctx.deps.readClient, 'coaching_sessions', 'id,transcript_text', 'id', batch.map((f) => f.session_id));
    const textOf = new Map(texts.map((t) => [t.id, t.transcript_text]));
    let next = 0;
    const worker = async () => {
      while (!stop && next < batch.length) {
        if (!affordable()) { stop = 'cap'; return; }
        if (await ctx.halted('phonics')) { stop = stop || 'deadline'; return; }
        // Re-checked after the await: another worker may have stopped the stage or taken the last of the budget.
        if (stop || next >= batch.length) return;
        if (!affordable()) { stop = 'cap'; return; }
        const f = batch[next];
        next += 1;
        started += 1;
        const release = ctx.ledger.hold(p90);
        try {
          const { row, result, reused } = await Ph.detectPhonics({ transcriptText: textOf.get(f.session_id) || '', meta: { grade: f.grade, subject: f.subject },
            ledger: ctx.ledger, deps: ctx.callDeps(f.session_id, '-') });
          textOf.delete(f.session_id);
          // A reused call is already stored (an earlier night): keep its id, insert nothing (as the homework glosses do).
          const [stored] = reused ? [row] : await ctx.record([row]);
          ctx.tally('phonics', row.status);
          if (result) { f.detector = result; f.detector_run_id = stored && stored.id; read += 1; }
        } finally {
          release();
        }
      }
    };
    const settled = await Promise.allSettled(Array.from({ length: Math.min(n, batch.length) }, () => worker().catch((err) => {
      stop = 'error';
      throw err;
    })));
    for (const s of settled) if (s.status === 'rejected') failures.push(s.reason);
  }
  ctx.summary.phonics_read = read;
  if (failures.length) throw failures[0];
  const left = literacy.length - started;
  if (stop && left > 0) {
    ctx.pending('phonics', left);
    if (stop === 'deadline') ctx.stopLine('phonics', left);
  }
  return read;
}

/** W-PHON / W-PHON-NAMES signal rows from the detector (source coachip_detector; NIGHTLY_JOB §6). */
function detectorSignals(f) {
  const d = f.detector;
  if (!d) return [];
  const first = (d.stages_heard || []).map((s) => s.at_s).filter((x) => x != null).sort((a, b) => a - b)[0];
  const base = { fact_id: f.id, session_id: f.session_id, source: 'coachip_detector', model_run_id: f.detector_run_id || null,
    value: d.score, stamp_s: first == null ? null : first, status: 'ok', is_in_denominator: d.applicable === true };
  return [
    { ...base, w_id: 'W-PHON', is_hit: d.applicable === true && (d.score === 0 || d.score === 1) },
    { ...base, w_id: 'W-PHON-NAMES', is_hit: d.applicable === true && d.letter_name_routine_only === true },
  ];
}

async function runGlosses(ctx, { shown, moments, facts, homeworkFacts = [] }) {
  const { write, store } = ctx;
  const factById = new Map(facts.map((f) => [f.id, f]));
  const momentById = new Map(moments.map((m) => [m.id, m]));
  const toGloss = shown.map((id) => momentById.get(id)).filter((m) => m && m.gloss_status === 'pending' && m.move_id);
  const lexicons = toGloss.length ? await loadLexicons(ctx.deps.readClient, [...new Set(toGloss.map((m) => m.session_id))]) : new Map();
  const okGlosses = [];
  let late = 0; // items left for the next night once the gloss cut-off has passed (said once, at the end)
  const pastCut = async () => { if (late || await ctx.halted('gloss')) { late += 1; return true; } return false; };
  for (const m of toGloss) {
    if (await pastCut()) { ctx.pending('gloss'); continue; }
    if (!ctx.ledger.canStart('gloss')) { ctx.ledger.markPending(); ctx.pending('gloss'); continue; }
    const f = factById.get(m.fact_id);
    const gm = f && f.allowed && f.allowed.gloss.moves[m.move_id];
    if (!gm) { ctx.tally('gloss', 'no_input'); continue; }
    const move = f.allowed.lp && f.allowed.lp.moves.find((x) => x.moveId === m.move_id);
    const lexicon = lexicons.get(m.session_id) || [];
    const input = G.buildGlossInput({ wId: m.w_id, phase: m.phase, glossMove: gm, verdict: move && move.verdict,
      narrative: f.allowed.gloss.narrative, lexicon });
    const res = await G.glossMoment({ moment: m, input, lexicon, ledger: ctx.ledger, deps: ctx.callDeps(m.session_id, m.move_id) });
    const stored = await ctx.record(res.runs);
    ctx.tally('gloss', res.patch.gloss_status);
    if (write) {
      const runId = res.runForPatch ? (stored[stored.length - 1] || {}).id : res.patch.gloss_model_run_id || null;
      await store.update('coachip_moments', m.id, { ...res.patch, gloss_model_run_id: runId || null });
    }
    if (write && res.patch.gloss_status === 'ok') okGlosses.push({ m, input, patch: res.patch });
  }

  // Stage 9: the 5% re-check (at least 5), on Opus, verdicts only. A dry run keeps no gloss text, so it has none to judge.
  for (const g of G.pickRecheck(okGlosses, Math.random)) {
    if (await pastCut()) { ctx.pending('recheck'); continue; }
    if (!ctx.ledger.canStart('gloss_recheck')) { ctx.ledger.markPending(); ctx.pending('recheck'); continue; }
    const res = await G.recheckGloss({ input: g.input, gloss: { gloss_en: g.patch.gloss_en, gloss_ur: g.patch.gloss_ur },
      ledger: ctx.ledger, deps: ctx.callDeps(g.m.session_id, g.m.move_id) });
    await ctx.record(res.reused ? [] : [res.row]);  // a reused verdict is already stored (as the homework glosses do)
    ctx.tally('recheck', res.verdict ? (res.verdict.faithful ? 'faithful' : 'unfaithful') : res.row.status);
  }

  // Homework glosses: W-IP lessons where the code leg did not fire (output {replaced_by_homework}; `why` dropped).
  for (const f of homeworkFacts) {
    if (await pastCut()) { ctx.pending('homework'); continue; }
    if (!ctx.ledger.canStart('homework')) { ctx.ledger.markPending(); ctx.pending('homework'); continue; }
    const lp = f.allowed.lp;
    const side = (phase) => lp.moves.filter((x) => x.phase === phase && x.counted).map((x) => {
      const g = f.allowed.gloss.moves[x.moveId] || {};
      return { plan_text: g.text, verdict: x.verdict, rationale: g.rationale, evidence_translation: phase === 'homework' ? g.evidenceTranslation : undefined,
        at_s: phase === 'homework' ? x.stampS : undefined };
    });
    const input = { independent: side('independent'), homework: side('homework'), last_stamp_s: f.last_stamp_s, narrative: f.allowed.gloss.narrative };
    const out = await M.callModel({ model: M.MODELS.gloss, prompt: M.loadPrompt('homework_v1'), input, analysis: 'homework', target: '-',
      sessionId: f.session_id, promptVersion: 'homework_v1', deps: { ...ctx.callDeps(f.session_id, '-'), ledger: ctx.ledger } });
    const row = { ...out.row, output: out.output && ['yes', 'no', 'unclear'].includes(out.output.replaced_by_homework)
      ? { replaced_by_homework: out.output.replaced_by_homework } : null };
    await ctx.record(out.reused ? [] : [row]);
    ctx.tally('homework', row.output ? row.output.replaced_by_homework : row.status);
  }
  if (late) ctx.stopLine('gloss', late);
}

/** Lessons for the homework gloss: W-IP skipped, a homework step graded, and the code leg (is_sent_home) did not fire. */
function homeworkCandidates(facts, inWindow) {
  return facts.filter((f) => f.instrument === 'lp_fidelity' && f.status === 'ok' && !f.is_duplicate && !f.is_mismatch && !f.is_unusable
    && inWindow(f) && f.is_sent_home !== true && f.allowed && f.allowed.lp
    && phaseOutcome(f.allowed.lp.moves, 'independent').skipped && phaseOutcome(f.allowed.lp.moves, 'homework').graded)
    .sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));
}

module.exports = { createModelContext, runPhonics, runGlosses, detectorSignals, homeworkCandidates, loadLexicons };
