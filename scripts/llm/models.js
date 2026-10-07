#!/usr/bin/env node
/**
 * Which model runs each job, and how to move one without a deploy. The guide: docs/model-switching.md.
 *
 *   npm run models -- list                          every routed job: its model, its env var, its call site
 *   npm run models -- status                        the llm_* settings rows, and what each job runs now
 *   npm run models -- apply <map.json>              dry run: what would change in the per-job row
 *   npm run models -- apply <map.json> --confirm    WRITE: the per-job row becomes exactly this map
 *   npm run models -- kill --confirm                WRITE: every job back on its own model within a minute
 *   npm run models -- unkill --confirm              WRITE: overrides allowed again
 *
 * The database is the one SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY point at, so load the env file of the
 * environment you mean first. Every command that touches it prints which project it is, never the key.
 *
 * A map is checked against THIS checkout's registry: run it from the code the target environment deploys
 * (origin/main for production). A job that code does not know would be ignored there, and a model id that
 * does not parse is refused here before anything is sent.
 */
const fs = require('fs');
const registry = require('../../bot/shared/config/model-registry');

const PER_JOB = 'llm_per_job';
const KILL = 'llm_kill_switch';
const DESCRIPTIONS = {
  [PER_JOB]: 'per-job model overrides; each job falls back to its own model on any failure',
  [KILL]: 'true puts every job back on its own model',
};

/** Exit codes: what a calling script can tell apart. */
const OK = 0;
const FAILED = 1; // the database answered with an error
const USAGE = 2; // bad arguments, or no database configured
const NEEDS_CONFIRM = 3;
const REFUSED = 4; // the map would not do what it says

const USAGE_TEXT = fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 10).map((l) => l.replace(/^ \* ?/, '')).join('\n');

/** The project a Supabase URL names (its first host label), so a write says where it is going. */
function projectOf(url) {
  try { return new URL(url).hostname.split('.')[0]; } catch (_) { return String(url); }
}

function database(env, fetchImpl) {
  const url = (env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const base = `${url}/rest/v1/app_settings`;
  async function ask(method, query, body) {
    const res = await fetchImpl(`${base}${query}`, {
      method,
      headers: method === 'POST' ? { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' } : headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`database answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  return {
    project: projectOf(url),
    /** The llm_* rows, as { key: value }. */
    async rows() {
      const list = await ask('GET', '?select=key,value,updated_at&key=like.llm_*&order=key');
      return Object.fromEntries(list.map((r) => [r.key, r.value]));
    },
    async write(key, value) {
      await ask('POST', '?on_conflict=key', [{ key, value, description: DESCRIPTIONS[key] || '' }]);
    },
  };
}

/** A map file, checked against this checkout's registry before anything is sent. Returns { map } or { problems }. */
function readMap(file) {
  let map;
  try { map = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { problems: [`${file}: ${e.message}`] }; }
  if (!map || typeof map !== 'object' || Array.isArray(map)) return { problems: [`${file}: not a map of job -> model id`] };
  const problems = [];
  for (const [job, model] of Object.entries(map)) {
    if (!registry.JOBS[job]) {
      problems.push((registry.TELEMETRY_ONLY_JOBS || []).includes(job)
        ? `${job}: labelled but not routed by the registry, so an override would be ignored`
        : `${job}: not a job this registry knows (a name it does not know is ignored)`);
    } else if (!registry.isModel(model)) {
      problems.push(`${job}: ${JSON.stringify(model)} is not a model id`);
    }
  }
  return problems.length ? { problems } : { map };
}

/** What this checkout's registry gives a job: its env var if set here, else its default. */
function ownModel(job) {
  try { return registry.modelFor(job) || '(set at its call site)'; } catch (_) { return '(set at its call site)'; }
}

function table(rows) {
  const width = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((c, i) => String(c).padEnd(width[i])).join('  ').trimEnd()).join('\n');
}

function list(io) {
  const rows = [['job', 'model (here)', 'env var', 'call site']];
  for (const [job, spec] of Object.entries(registry.JOBS)) rows.push([job, ownModel(job), spec.env || '-', spec.site || '-']);
  io.out(table(rows));
  io.out('\nThe model is what this checkout resolves: a job\'s env var as set in THIS shell, else its default.');
  io.out('A deployed service resolves its own env. What runs now, with the settings rows: npm run models -- status');
  return OK;
}

async function status(db, io) {
  const rows = await db.rows();
  const kill = rows[KILL] === true || String(rows[KILL]).toLowerCase() === 'true';
  const perJob = rows[PER_JOB] && typeof rows[PER_JOB] === 'object' ? rows[PER_JOB] : {};
  io.out(`project ${db.project}`);
  for (const [key, value] of Object.entries(rows)) io.out(`  ${key} = ${JSON.stringify(value)}`);
  if (!Object.keys(rows).length) io.out('  (no llm_* rows: every job runs its own model)');
  if (kill) io.out('\nKILL SWITCH IS ON: every job runs its own model; the per-job row is ignored until unkill.');
  const out = [['job', 'runs now', 'from', 'behind it on a failure']];
  for (const job of Object.keys(registry.JOBS)) {
    const own = ownModel(job);
    const moved = !kill && registry.isModel(perJob[job]) ? perJob[job] : null;
    out.push(moved ? [job, moved, 'llm_per_job', own] : [job, own, 'registry', '-']);
  }
  io.out(`\n${table(out)}`);
  const unknown = Object.keys(perJob).filter((j) => !registry.JOBS[j]);
  if (unknown.length) io.out(`\nThe row names jobs this checkout does not route (ignored by this code): ${unknown.join(', ')}`);
  for (const key of ['llm_per_language', 'llm_per_region', 'llm_rollout']) {
    if (rows[key] !== undefined) io.out(`\n${key} is set: jobs that read their settings at the call site apply it there too.`);
  }
  io.out('\n"registry" is this checkout\'s model for the job; a deployed service applies its own env vars first.');
  return OK;
}

function diff(before, after) {
  const lines = [];
  for (const [job, model] of Object.entries(after)) {
    if (!(job in before)) lines.push(`  + ${job}  ${model}`);
    else if (before[job] !== model) lines.push(`  ~ ${job}  ${before[job]} -> ${model}`);
  }
  for (const job of Object.keys(before)) if (!(job in after)) lines.push(`  - ${job}  ${before[job]} (back on its own model)`);
  return lines.length ? lines.join('\n') : '  (no change)';
}

async function apply(db, file, confirm, io) {
  const before = (await db.rows())[PER_JOB] || {};
  io.out(`project ${db.project}: ${PER_JOB} has ${Object.keys(before).length} jobs`);
  io.out(diff(before, file.map));
  if (!confirm) {
    io.out(`\nDry run: nothing written. To make ${PER_JOB} exactly this map (${Object.keys(file.map).length} jobs), run again with --confirm.`);
    return OK;
  }
  await db.write(PER_JOB, file.map);
  const after = (await db.rows())[PER_JOB] || {};
  io.out(`\nwritten; read back: ${JSON.stringify(after)}`);
  io.out('Every process applies it within about a minute, no restart.');
  return OK;
}

async function setKill(db, on, io) {
  io.out(`project ${db.project}`);
  await db.write(KILL, on);
  const rows = await db.rows();
  io.out(`${KILL} = ${JSON.stringify(rows[KILL])} (read back)`);
  io.out(on ? 'Every job goes back on its own model within about a minute, no restart.'
    : 'Per-job overrides apply again within about a minute.');
  return OK;
}

/**
 * Run one command. `io` carries what the outside world provides, so a test can stand in for it:
 * fetch, env, and the two output streams. Returns the exit code.
 */
async function main(argv, io = {}) {
  const ctx = {
    fetch: io.fetch || globalThis.fetch,
    env: io.env || process.env,
    out: io.out || ((s) => process.stdout.write(`${s}\n`)),
    err: io.err || ((s) => process.stderr.write(`${s}\n`)),
  };
  const confirm = argv.includes('--confirm');
  const [cmd, ...args] = argv.filter((a) => a !== '--confirm');

  if (cmd === 'list') return list(ctx);
  if (!['status', 'apply', 'kill', 'unkill'].includes(cmd)) { ctx.err(USAGE_TEXT); return USAGE; }

  let file = null;
  if (cmd === 'apply') {
    if (!args[0]) { ctx.err('usage: npm run models -- apply <map.json> [--confirm]'); return USAGE; }
    file = readMap(args[0]);
    if (file.problems) {
      ctx.err(`refusing ${args[0]}:\n  ${file.problems.join('\n  ')}`);
      return REFUSED;
    }
  }
  if ((cmd === 'kill' || cmd === 'unkill') && !confirm) {
    ctx.err(`refusing to write ${KILL} without --confirm`);
    return NEEDS_CONFIRM;
  }
  const db = database(ctx.env, ctx.fetch);
  if (!db) {
    ctx.err('no database: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (load the env file of the environment you mean)');
    return USAGE;
  }
  try {
    if (cmd === 'status') return await status(db, ctx);
    if (cmd === 'apply') return await apply(db, file, confirm, ctx);
    return await setKill(db, cmd === 'kill', ctx);
  } catch (e) {
    ctx.err(e.message);
    return FAILED;
  }
}

module.exports = { main };

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code));
