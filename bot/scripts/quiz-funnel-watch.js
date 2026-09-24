#!/usr/bin/env node
'use strict';
/**
 * Dry-run the quiz funnel watcher: print the exact DM text it would post —
 * the summary for a window ending now, and any alerts that are due — without
 * posting, locking or de-duplicating anything.
 *
 *   node bot/scripts/quiz-funnel-watch.js --env staging|production --window 2h --dry-run
 *        [--dataset niete-logs] [--now 2026-09-24T09:00:00Z] [--envfile <path>]
 *
 * Reads Axiom only (AXIOM_TOKEN or AXIOM_API_TOKEN, and AXIOM_ORG_ID, from the
 * environment or --envfile — values are never printed). A dry run has no database
 * to confirm stalls against, so stall alerts print as "not confirmed". There is
 * deliberately no way to post from here: the worker is the one sender.
 */
const fs = require('fs');

const USAGE = 'usage: node bot/scripts/quiz-funnel-watch.js --env staging|production --window 2h --dry-run '
  + '[--dataset niete-logs] [--now <ISO time>] [--envfile <path>]';

function parseArgs(argv) {
  const a = { dryRun: false, window: '2h', dataset: null, env: null, now: null, envfile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--dry-run') a.dryRun = true;
    else if (k === '--env') a.env = argv[++i];
    else if (k === '--window') a.window = argv[++i];
    else if (k === '--dataset') a.dataset = argv[++i];
    else if (k === '--now') a.now = argv[++i];
    else if (k === '--envfile') a.envfile = argv[++i];
  }
  return a;
}

/** '2h' | '90m' | '1d' → milliseconds, or null. */
function windowMs(s) {
  const m = /^(\d+(?:\.\d+)?)([mhd])$/.exec(String(s || ''));
  if (!m) return null;
  return Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2]];
}

/** KEY=VALUE lines into process.env for keys not already set. Never prints a value. */
function loadEnvFile(path) {
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

async function main(argv = process.argv.slice(2), { out = (s) => process.stdout.write(`${s}\n`), query } = {}) {
  const a = parseArgs(argv);
  const span = windowMs(a.window);
  if (!a.dryRun || !a.env || !span) {
    out(USAGE);
    out('(--dry-run is required: this tool only ever prints; the worker is the one sender)');
    return 2;
  }
  if (a.envfile) loadEnvFile(a.envfile);
  const W = require('../shared/services/monitoring/quiz-funnel-watch.service');
  const now = a.now ? new Date(a.now) : new Date();
  const cfg = W.config(process.env);
  const window = {
    start: new Date(now.getTime() - span),
    end: now,
    label: `last ${a.window} to ${new Date(now.getTime() + 5 * 3600e3).toISOString().slice(11, 16)} PKT (dry run, ${a.env})`,
  };
  const report = await W.buildReport({
    now,
    env: a.env,
    dataset: a.dataset || process.env.AXIOM_DATASET || 'niete-logs',
    query: query || ((name, apl, s, e) => W.axiomQuery(name, apl, s, e, process.env)),
    confirm: null,
    cfg,
    window,
  });
  out('── the 2-hourly summary, as it would be posted ─────────────────────');
  out(W.buildSummary({ ...report.summary, incidents: report.incidents, failedQueries: report.failedQueries, cfg }));
  out('');
  out('── an alert posted outside a summary slot (before de-duplication) ──');
  out(report.incidents.length ? W.buildAlert(report.incidents, now, cfg) : '(none — nothing is wrong right now)');
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (err) => {
    process.stderr.write(`quiz-funnel-watch: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { main, parseArgs, windowMs };
