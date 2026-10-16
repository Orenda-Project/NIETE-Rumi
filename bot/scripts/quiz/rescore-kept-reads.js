#!/usr/bin/env node
'use strict';
/**
 * Re-score the Challenge's KEPT readings that were scored before the noise floor, so every kept read carries the
 * floor's marks (meta.quality / flags / raw / stt_words / align_correct) the way a read scored today does.
 *
 *   node scripts/quiz/rescore-kept-reads.js --env <env> --ref <supabase project ref> [--score | --write] [--max-usd N]
 *
 * - DRY RUN IS THE DEFAULT: it selects the rows and prints counts by language and the cost ceiling
 *   (rows × USD_PER_READ); nothing is scored, nothing is written. --score scores (paid) and prints every outcome by
 *   reason with the row's short id, writing nothing; --write scores and writes.
 * - Refuses unless --env equals this deployment's RAILWAY_ENVIRONMENT_NAME and --ref is the project ref inside
 *   SUPABASE_URL. Every AXIOM_* variable is dropped before the service loads: a re-score sends no events.
 * - The rows: exercise 'read', status 'scored', meta.audio_key set, no meta.stt_words. A key outside the kept
 *   prefix is counted and never scored (the scorer deletes a plain upload when it finishes).
 * - --write takes from the scorer ONLY quality, flags, raw, stt_words, align_correct, and stamps rescored_at, through
 *   the service's compare-and-set; score, wcpm, status, record, mode and the counted flag are never written. A row that
 *   changed since the read is left as it is. A re-score the live path would not keep (unheard, incomplete,
 *   abandoned) is not a reading: it is written as quality 'implausible' with its reason last in flags (the mark the
 *   strip and the statement already read), with the heard and aligned word counts; an internal error writes nothing.
 * - Stops before the next read once the scorer's own cost reaches --max-usd (default 1.00); refuses up front when
 *   the ceiling is already above it.
 * - Prints counts only, and a row id's first 8 characters at most — never a key, a transcript, a name or a phone.
 * - Production: --write only on the operator's go (the runbook says who runs it).
 */

const USD_PER_READ = 0.014;
const MAX_USD = 1;
const TAKEN = ['quality', 'flags', 'raw', 'stt_words', 'align_correct'];

function parseArgs(argv) {
  const out = { env: null, ref: null, score: false, write: false, maxUsd: MAX_USD };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') out.write = true;
    else if (a === '--score') out.score = true;
    else if (a === '--env' || a === '--ref') { out[a.slice(2)] = argv[i + 1] || null; i += 1; }
    else if (a === '--max-usd') { out.maxUsd = Number(argv[i + 1]); i += 1; }
    else throw new Error(`unknown argument: ${a}`);
  }
  if (out.score && out.write) throw new Error('either --score or --write, not both');
  return out;
}

/** Drops every AXIOM_* variable from `env` (in place); returns how many. */
function stripAxiom(env = process.env) {
  const keys = Object.keys(env).filter((k) => k.startsWith('AXIOM_'));
  for (const k of keys) delete env[k];
  return keys.length;
}

function guard(args, env) {
  if (!args.env || !/^[a-z0-9_-]+$/i.test(args.env)) throw new Error('--env is required');
  if (!args.ref || !/^[a-z0-9]{20}$/.test(args.ref)) throw new Error('--ref is required (the Supabase project ref)');
  const own = env.RAILWAY_ENVIRONMENT_NAME || '';
  if (!own || own !== args.env) throw new Error(`--env ${args.env} is not this deployment's env (${own || 'unset'})`);
  let host = '';
  try { host = new URL(String(env.SUPABASE_URL || '')).hostname; } catch (_) { host = ''; }
  if (host.split('.')[0] !== args.ref) throw new Error('--ref is not the project ref inside SUPABASE_URL');
  if (!(args.maxUsd > 0)) throw new Error('--max-usd must be a positive number');
}

const short = (id) => String(id || '').slice(0, 8);
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

/**
 * The re-score. deps = { list() → rows, isKeptKey(key), score(row) → scoreRead's result, write(id, build) →
 * the compare-and-set, now() → ISO }. Returns counts only. Throws on a refused guard or ceiling.
 */
async function rescoreKept({ args, env = process.env, deps }) {
  guard(args, env);
  const rows = (await deps.list()) || [];
  const mode = args.write ? 'write' : (args.score ? 'score' : 'dry_run');
  const out = { env: args.env, mode, dry_run: mode === 'dry_run', selected: {}, not_kept: 0, cost_ceiling_usd: 0, ok: 0, implausible: {}, would_fail: {}, changed: 0, errors: 0, cost_usd: 0, stopped_at_cost: false, rows: [] };
  const picked = [];
  for (const r of rows) {
    const m = r && r.meta;
    if (!r || r.exercise !== 'read' || r.status !== 'scored' || !m || !m.audio_key || 'stt_words' in m) continue;
    if (!deps.isKeptKey(m.audio_key)) { out.not_kept += 1; continue; }
    bump(out.selected, r.lang || 'unknown');
    picked.push(r);
  }
  out.cost_ceiling_usd = Math.round(picked.length * USD_PER_READ * 1e6) / 1e6;
  if (mode === 'dry_run') return out;
  if (out.cost_ceiling_usd > args.maxUsd) throw new Error(`the cost ceiling US$${out.cost_ceiling_usd} is above --max-usd ${args.maxUsd}`);
  for (const r of picked) {
    if (out.cost_usd >= args.maxUsd) { out.stopped_at_cost = true; break; }
    const key = r.meta.audio_key;
    let res;
    try { res = await deps.score(r); } catch (_) { res = { failed: true, reason: 'internal_error', meta: {} }; }
    out.cost_usd = Math.round((out.cost_usd + (Number(res && res.meta && res.meta.cost_usd) || 0)) * 1e6) / 1e6;
    if (!res || (res.failed && (!res.reason || res.reason === 'internal_error'))) {
      out.errors += 1;
      out.rows.push({ id: short(r.id), outcome: 'internal_error' });
      continue;
    }
    const got = res.meta || {};
    const take = {};
    for (const k of TAKEN) if (got[k] !== undefined) take[k] = got[k];
    // not a reading by today's rules: the implausible mark, the reason last in flags
    if (res.failed) Object.assign(take, { quality: 'implausible', flags: [...(Array.isArray(got.flags) ? got.flags : []), res.reason] });
    const outcome = res.failed ? res.reason : (take.quality === 'implausible' ? `implausible:${res.implausible || (take.flags || []).slice(-1)[0] || 'unknown'}` : 'ok');
    const tally = () => {
      if (res.failed) bump(out.would_fail, res.reason);
      else if (take.quality === 'implausible') bump(out.implausible, outcome.slice('implausible:'.length));
      else out.ok += 1;
      out.rows.push({ id: short(r.id), outcome });
    };
    if (mode === 'score') { tally(); continue; }
    let wrote = false;
    await deps.write(r.id, (cur) => {
      const cm = cur.meta || {};
      if (cur.status !== 'scored' || cm.audio_key !== key || 'stt_words' in cm) return { meta: cm };   // changed since the read: as it is
      wrote = true;
      return { meta: { ...cm, ...take, rescored_at: deps.now() } };
    });
    if (!wrote) { out.changed += 1; out.rows.push({ id: short(r.id), outcome: 'changed' }); continue; }
    tally();
  }
  return out;
}

/** The service wired in: the rows, the kept-key rule, the scorer (rules.record on) and the compare-and-set. */
function serviceDeps() {
  const supabase = require('../../shared/config/supabase');
  const Ch = require('../../shared/services/quiz/web-quiz-challenge');
  const CT = Ch.childTest({ scorer: true });
  return {
    list: async () => {
      const { data, error } = await supabase.from('web_quiz_challenge_runs')
        .select('id, exercise, status, lang, grade, form, passage_id, meta')
        .eq('exercise', 'read').eq('status', 'scored').not('meta->>audio_key', 'is', null)
        .range(0, 999);
      if (error) throw new Error(`the rows could not be read: ${String(error.message || error).slice(0, 80)}`);
      if ((data || []).length >= 1000) throw new Error('1000 rows or more: narrow the selection first');
      return data || [];
    },
    isKeptKey: Ch.isKeptKey,
    score: async (r) => {
      const m = r.meta || {};
      const form = r.form || (await Ch.formForChild(Number(r.grade)));   // rows older than the form column carry the grade only
      if (!form) return { failed: true, reason: 'no_form', meta: {} };
      const run = { form, lang: r.lang, task: `${r.lang}.story`, passage: r.passage_id ? Ch.passageFor(r.passage_id, CT.Bank) : null };
      const key = m.audio_key;
      return Ch.scoreRead(run, key, key.split('.').pop(), m.ms, CT, { record: true }, { ended: m.ended || null, micCheck: m.mic_check || null, readS: m.read_s, runId: r.id });
    },
    write: (id, build) => Ch.updateRunMeta(id, build),
    now: () => new Date().toISOString(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dropped = stripAxiom(process.env);   // before any service module loads its logger
  const res = await rescoreKept({ args, env: process.env, deps: serviceDeps() });
  process.stdout.write(`${JSON.stringify({ ...res, axiom_vars_dropped: dropped })}\n`);
  if (res.dry_run) process.stdout.write(`dry run: ${Object.values(res.selected).reduce((a, b) => a + b, 0)} kept reading(s) would be re-scored (ceiling US$${res.cost_ceiling_usd}); --score names each outcome (paid, no write), --write writes\n`);
  if (res.errors) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => { process.stderr.write(`refused: ${String(e && e.message || e).slice(0, 200)}\n`); process.exitCode = 2; });
}

module.exports = { rescoreKept, parseArgs, stripAxiom, serviceDeps, USD_PER_READ };
