#!/usr/bin/env node
'use strict';
/**
 * Replay the production incident watch over past logs and print exactly what it would have posted —
 * the same tick(), rules, thread and all-clear logic the worker runs, against Axiom history. Also reads
 * the OpenRouter key budget. Nothing here posts, except --send-test (one message labelled test).
 *
 *   node bot/scripts/prod-incident-watch.js --at 2026-11-25T05:10:00Z --dry-run [--back 60]
 *   node bot/scripts/prod-incident-watch.js --from 2026-10-25T00:00:00Z --to 2026-11-25T00:00:00Z --dry-run
 *        [--step 5] [--no-detail] [--quiet]
 *   node bot/scripts/prod-incident-watch.js --key-budget --dry-run
 *   node bot/scripts/prod-incident-watch.js --send-test
 *   common: [--env production] [--dataset niete-logs] [--envfile <path>] [--thresholds '<json>']
 *
 * Reads AXIOM_TOKEN or AXIOM_API_TOKEN (+ AXIOM_ORG_ID), OPENROUTER_API_KEY for --key-budget, and
 * PROD_ALERTS_SLACK_TOKEN / _CHANNEL for --send-test, from the environment or --envfile. Values are never
 * printed. A replay has no /health history, so the health rule cannot be replayed.
 */
const fs = require('fs');

const USAGE = [
  'usage: node bot/scripts/prod-incident-watch.js --at <UTC ISO> --dry-run [--back <min>]',
  '       node bot/scripts/prod-incident-watch.js --from <UTC ISO> --to <UTC ISO> --dry-run [--step <min>] [--no-detail] [--quiet]',
  '       node bot/scripts/prod-incident-watch.js --key-budget --dry-run',
  '       node bot/scripts/prod-incident-watch.js --send-test',
  '       common: [--env production] [--dataset niete-logs] [--envfile <path>] [--thresholds <json>]',
].join('\n');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const PKT = 5 * 60 * MIN;

function parseArgs(argv) {
  const a = {
    dryRun: false, at: null, from: null, to: null, back: 60, step: 5, detail: true, quiet: false,
    env: 'production', dataset: null, envfile: null, thresholds: null, keyBudget: false, sendTest: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--dry-run') a.dryRun = true;
    else if (k === '--at') a.at = argv[++i];
    else if (k === '--from') a.from = argv[++i];
    else if (k === '--to') a.to = argv[++i];
    else if (k === '--back') a.back = Number(argv[++i]);
    else if (k === '--step') a.step = Number(argv[++i]);
    else if (k === '--no-detail') a.detail = false;
    else if (k === '--quiet') a.quiet = true;
    else if (k === '--env') a.env = argv[++i];
    else if (k === '--dataset') a.dataset = argv[++i];
    else if (k === '--envfile') a.envfile = argv[++i];
    else if (k === '--thresholds') a.thresholds = argv[++i];
    else if (k === '--key-budget') a.keyBudget = true;
    else if (k === '--send-test') a.sendTest = true;
  }
  return a;
}

/** KEY=VALUE lines into process.env for keys not already set. Never prints a value. */
function loadEnvFile(path) {
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

const pkt = (ms) => new Date(ms + PKT).toISOString().slice(0, 16).replace('T', ' ');
const pktDay = (ms) => new Date(ms + PKT).toISOString().slice(0, 10);

function memStore() {
  const m = new Map();
  return {
    isAvailable: () => true,
    get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
    set: async (k, v) => { m.set(k, JSON.stringify(v)); return true; },
    setNX: async (k, v) => { if (m.has(k)) return false; m.set(k, JSON.stringify(v)); return true; },
  };
}

/**
 * The history, fetched once: 1-minute rule bins (a day per query), the boot lines, and the 15-minute
 * baseline bins. The replay's query() serves the watcher's own queries from these, by time range.
 */
async function prefetch({ W, live, apl, from, to, cfg }) {
  const binsFrom = from - cfg.binsLookbackMin * MIN;
  const bins = [];
  for (let s = binsFrom; s < to; s += DAY) {
    // eslint-disable-next-line no-await-in-loop
    bins.push(...await live('bins', apl.bins, new Date(s).toISOString(), new Date(Math.min(to, s + DAY)).toISOString()));
  }
  const boots = await live('boots', apl.boots.replace('take 5000', 'take 100000'),
    new Date(from - cfg.crashWindowMin * MIN).toISOString(), new Date(to).toISOString());
  const baseline = await live('baseline', apl.baseline, new Date(from - cfg.baselineDays * DAY).toISOString(), new Date(to).toISOString());
  return { bins, boots, baseline };
}

function servedQuery({ cache, live, detail }) {
  const inRange = (rows, s, e) => {
    const a = Date.parse(s);
    const b = Date.parse(e);
    return rows.filter((r) => { const t = Date.parse(r._time); return t >= a && t < b; });
  };
  return async (name, apl, s, e) => {
    if (name === 'bins' || name === 'boots' || name === 'baseline') return inRange(cache[name], s, e);
    return detail ? live(name, apl, s, e) : [];
  };
}

/** Replay [from, to] one check every `step` minutes; return the posts and a summary. */
async function replay({ W, from, to, step, cfg, env, dataset, live, detail, axiomOrg, out = () => {}, quiet = false }) {
  const apl = W.aplFor({ env, dataset });
  const cache = await prefetch({ W, live, apl, from, to, cfg });
  const query = servedQuery({ cache, live, detail });
  const store = memStore();
  const posts = [];
  const post = async (m) => {
    const ts = `${posts.length + 1}.0`;
    posts.push({ ...m, ts });
    return ts;
  };
  for (let t = from; t <= to; t += step * MIN) {
    const before = posts.length;
    // eslint-disable-next-line no-await-in-loop
    await W.tick({ now: new Date(t), cfg, query, store, post, checkHealth: null, env, dataset, axiomOrg });
    for (let i = before; i < posts.length; i += 1) {
      posts[i].at = t;
      if (!quiet) {
        const where = posts[i].thread_ts ? `thread of #${posts[i].thread_ts.split('.')[0]}${posts[i].broadcast ? ' + channel' : ''}` : 'TOP-LEVEL';
        out(`── ${pkt(t)} PKT (${new Date(t).toISOString().slice(0, 16)}Z) · ${where} · #${posts[i].ts.split('.')[0]}`);
        out(posts[i].text);
        out('');
      }
    }
  }
  return { posts, summary: summarize(posts) };
}

function summarize(posts) {
  const top = posts.filter((p) => !p.thread_ts && p.type === 'open');
  const byRule = {};
  const firedDays = {};
  for (const p of posts) {
    if (p.type !== 'open' && p.type !== 'also' && p.type !== 'reopen') continue;
    byRule[p.rule] = byRule[p.rule] || { lead: 0, reopened: 0, joined: 0 };
    if (p.type === 'open') byRule[p.rule].lead += 1;
    else if (p.type === 'reopen') byRule[p.rule].reopened += 1;
    else byRule[p.rule].joined += 1;
    (firedDays[p.rule] = firedDays[p.rule] || new Set()).add(pktDay(p.at));
  }
  const incidents = top.map((p) => {
    const thread = posts.filter((x) => x.thread_ts === p.ts);
    const clears = thread.filter((x) => x.type === 'clear');
    const clear = clears[clears.length - 1];
    return {
      opened: pkt(p.at),
      lead: p.rule,
      also: thread.filter((x) => x.type === 'also').map((x) => x.rule),
      reopened: thread.filter((x) => x.type === 'reopen').map((x) => `${pkt(x.at)} ${x.rule}`),
      updates: thread.filter((x) => x.type === 'update').length, cleared: clear ? pkt(clear.at) : null,
      minutes: clear ? Math.round((clear.at - p.at) / MIN) : null,
    };
  });
  return {
    topLevel: top.length,
    threadReplies: posts.length - top.length,
    days: [...new Set(top.map((p) => pktDay(p.at)))].sort(),
    byRule,
    firedDays: Object.fromEntries(Object.entries(firedDays).map(([r, s]) => [r, [...s].sort()])),
    incidents,
  };
}

async function main(argv = process.argv.slice(2), { out = (s) => process.stdout.write(`${s}\n`), live: injectedLive } = {}) {
  const a = parseArgs(argv);
  if (a.envfile) loadEnvFile(a.envfile);
  if (a.thresholds) process.env.PROD_ALERTS_THRESHOLDS = a.thresholds;
  const W = require('../shared/services/monitoring/prod-incident-watch.service');
  const { axiomQuery, postToSlack } = require('../shared/services/monitoring/quiz-funnel-watch.service');
  const cfg = W.config(process.env);

  if (a.sendTest) {
    const slack = { token: process.env.PROD_ALERTS_SLACK_TOKEN || '', channel: process.env.PROD_ALERTS_SLACK_CHANNEL || '' };
    if (!slack.token || !slack.channel) { out('PROD_ALERTS_SLACK_TOKEN and PROD_ALERTS_SLACK_CHANNEL are needed for --send-test'); return 2; }
    const text = [
      '🧪 *test* · production alerts are wired to this channel',
      'Nothing is wrong. A real alert is one line per incident, updates in its thread, a one-line resolved at the end.',
      '_rule-based, no model in the path · sent once by hand from bot/scripts/prod-incident-watch.js --send-test_',
    ].join('\n');
    const ts = await postToSlack(text, slack);
    out(`posted the test message (ts ${ts})`);
    return 0;
  }

  if (!a.dryRun) { out(USAGE); out('(--dry-run is required: this tool only prints; the worker is the one sender)'); return 2; }

  if (a.keyBudget) {
    if (!process.env.OPENROUTER_API_KEY) { out('OPENROUTER_API_KEY is not set'); return 2; }
    const reading = await W.readKeyBudget({ key: process.env.OPENROUTER_API_KEY });
    const v = W.keyBudgetVerdict(reading, new Date(), cfg);
    out(`reading: ${JSON.stringify(reading)}`);
    out(v ? W.buildKeyBudget(reading, v, new Date(), cfg).text : '(no warning: plenty left, or no limit)');
    return 0;
  }

  const live = injectedLive || ((name, apl, s, e) => axiomQuery(name, apl, s, e, process.env));
  const env = a.env;
  // Not AXIOM_DATASET: a local env file's copy can name another deployment's dataset. Say it, every run.
  const dataset = a.dataset || process.env.PROD_ALERTS_DATASET || 'niete-logs';
  let from;
  let to;
  if (a.at) {
    to = Date.parse(a.at);
    from = to - a.back * MIN;
  } else if (a.from && a.to) {
    from = Date.parse(a.from);
    to = Date.parse(a.to);
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || !(a.step > 0)) { out(USAGE); return 2; }

  out(`replaying ['${dataset}'] env=${env} from ${new Date(from).toISOString()} to ${new Date(to).toISOString()}, a check every ${a.step} min`);
  const { summary } = await replay({
    W, from, to, step: a.step, cfg, env, dataset, live, detail: a.detail, axiomOrg: process.env.AXIOM_ORG_ID || null, out, quiet: a.quiet,
  });
  out('── summary ─────────────────────────────────────────────────────────');
  out(JSON.stringify(summary, null, 2));
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code || 0)).catch((err) => {
    process.stderr.write(`prod-incident-watch: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { main, parseArgs, replay, summarize };
