#!/usr/bin/env node
/**
 * child-test-sim driver — a coach's five-child visit, end to end, timed.
 *
 *   node bot/scripts/e2e/child-test-sim/driver.js --mode fake    --fixtures <dir> --strips <dir> --run <runDir>
 *   node bot/scripts/e2e/child-test-sim/driver.js --mode mock    --mock-url http://127.0.0.1:4010 --driver 9230000000NN ...
 *   node bot/scripts/e2e/child-test-sim/driver.js --mode sandbox --sandbox-config <GO_PHASE2 json> ...
 *
 * Modes
 *   fake     self-contained dry run: starts mock-graph-api + the fake peer bot in this process.
 *   mock     a LOCAL bot (bot/scripts/e2e/local-stack.sh up <sha> <run_dir>) behind its mock-graph-api.
 *   sandbox  the deployed NIETE sandbox bot (phase 2). Config JSON: { botUrl, phoneNumberId, wabaTokenEnv,
 *            appSecretEnv, driver, allowHosts:[...], replies:{ module:"<path exporting poll(after)>" } }.
 *            Tokens are read from the env vars it names — never from the file, never printed.
 *
 * Fixture choice: --ids a,b,c,d,e, or --pick N (default 5) takes usable_for_accuracy fixtures from
 * <fixtures>/_manifest.json spread across reading bands. Each child gets a strip photo from --strips
 * (matched by grade, round-robin).
 * Output in --run: timeline.jsonl, summary.json (rtt_samples for sim/timing_model.py --measured), run.json.
 *
 * The check's coach: --coach-catch P (L14: corrects a disagreement with probability P), or the rubber-stamp
 * model --coach-catch-prefilled <marked>,<unmarked> (bd-s1oo0.21, e.g. 0.8,0.4: a wrong PRE-FILLED field is
 * caught at <marked> when the screen says "unsure, please check", else <unmarked>), plus
 * --coach-blind-accuracy A (an EMPTY field filled right with probability A; default 1). The bot's
 * pre-fill mode is the stack's CHILD_TEST_PREFILL_MODE (sim-stack.sh passes it through).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createTimeline, summarise } = require('./timeline');
const { mockTransport, sandboxTransport } = require('./transports');
const { runVisit } = require('./coach');

function args(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    a[k.slice(2)] = v;
  }
  return a;
}

function pickFixtures(dir, n, ids, grade) {
  if (ids) return ids.split(',').map((id) => ({ id, dir: path.join(dir, id) }));
  // --grade: the visit's grade decides the passage the bot scores against, so a fixture of the other
  // grade would be marked against the wrong text (score_run keeps such a session out of accuracy)
  const man = JSON.parse(fs.readFileSync(path.join(dir, '_manifest.json'), 'utf8'))
    .filter((m) => !m.skipped && m.usable_for_accuracy !== false && (grade == null || Number(m.grade) === Number(grade)));
  const bands = {};
  for (const m of man) (bands[m.band || 'synthetic'] = bands[m.band || 'synthetic'] || []).push(m);
  const order = Object.keys(bands).sort();
  const out = [];
  for (let i = 0; out.length < n && i < man.length; i++) {
    const b = bands[order[i % order.length]];
    if (b && b.length) out.push(b.shift());
  }
  return out.map((m) => ({ id: m.fixture_id, dir: path.join(dir, m.fixture_id), grade: m.grade }));
}

/** The replies module named in sandbox.json: beside the config if it is there, else beside this driver. */
/** --checks batch | inline | none ("inline" = check each child as soon as its card is in). */
function checksMode(v) {
  const m = { batch: 'batch', inline: 'interleaved', interleaved: 'interleaved', none: 'none' }[String(v || 'batch')];
  if (!m) throw new Error(`--checks must be batch, inline or none (got ${v})`);
  return m;
}

/**
 * The real check: check-play.js plays each card's Flow against the bot's endpoint with a seeded coach.
 * mock: the local bot (stack.json gives its url and the Flow public key); sandbox: the sandbox endpoint,
 * public key from FLOW_PUBLIC_KEY_B64 / FLOW_PRIVATE_KEY_B64 in the env (~/.childtest-golive/sandbox.env).
 */
function makeCheckPlayer(a, mode, fixtures) {
  const P = require('./check-play');
  const { FlowTransport } = require('../flow-emulator');
  const { formItems } = require('../../../shared/services/child-test/check-flow/items');
  let botUrl = a['bot-url']; let publicKeyPem = null;
  if (mode === 'mock' && a.stack) {
    const stack = JSON.parse(fs.readFileSync(a.stack, 'utf8'));
    botUrl = botUrl || stack.bot_url;
    if (stack.flow_public_key_file) publicKeyPem = Buffer.from(fs.readFileSync(stack.flow_public_key_file, 'utf8').trim(), 'base64').toString('utf8');
  }
  if (!publicKeyPem) publicKeyPem = P.publicKeyFrom(process.env);
  const url = P.endpointFor({ mode, botUrl, flowEndpoint: a['flow-endpoint'] });
  const transport = new FlowTransport({ publicKeyPem });
  const costs = P.loadActionCosts(a['coach-actions'] || undefined);
  const catchP = a['coach-catch'] != null ? Number(a['coach-catch']) : 0.9;
  // bd-s1oo0.21: the rubber-stamping coach — catch rates for a wrong PRE-FILLED field, unsure-marked vs not
  const catchPrefilled = P.parseCatchPrefilled(a['coach-catch-prefilled']);
  const blindAccuracy = a['coach-blind-accuracy'] != null ? Number(a['coach-blind-accuracy']) : 1;
  const rng = P.makeRng(a['coach-seed'] != null ? Number(a['coach-seed']) : 1);
  const byId = Object.fromEntries(fixtures.map((f) => [f.id, f]));
  const player = async (card, { child }) => {
    const fx = byId[child];
    if (!fx) return { ok: false, reason: `no fixture for ${child}`, actions: [], rtts: [], check_s: 0 };
    const key = JSON.parse(fs.readFileSync(path.join(fx.dir, 'key.json'), 'utf8'));
    if (fx.strip) {
      const sk = fx.strip.replace(/\.jpg$/, '.key.json');
      if (fs.existsSync(sk)) {
        const strip = JSON.parse(fs.readFileSync(sk, 'utf8'));
        key.blocks.maths = key.blocks.maths || { maths: {} };
        key.blocks.maths.maths = { ...(key.blocks.maths.maths || {}), written: strip.written, word_problem: strip.word_problem };
      }
    }
    try {
      return await P.playCheck({ token: card.flow.token, url, transport, key, items: formItems(key.grade, key.form || 'A'), rng, catchP, costs, catchPrefilled, blindAccuracy });
    } catch (e) {
      return { ok: false, reason: e.message, actions: [], rtts: [], check_s: 0 };
    }
  };
  player.info = { url, catchP, catchPrefilled, blindAccuracy, prefillMode: process.env.CHILD_TEST_PREFILL_MODE || 'strict', seed: a['coach-seed'] != null ? Number(a['coach-seed']) : 1 };
  return player;
}

function resolveReplies(configPath, mod) {
  const nearConfig = path.resolve(path.dirname(configPath), mod);
  return fs.existsSync(nearConfig) ? nearConfig : path.resolve(__dirname, mod);
}

function attachStrips(fixtures, stripsDir) {
  if (!stripsDir) return fixtures;
  const all = fs.readdirSync(stripsDir).filter((f) => /^strip-g\d-\d+-d\d\.jpg$/.test(f)).sort();
  const used = {};
  return fixtures.map((fx) => {
    const g = fx.grade || (JSON.parse(fs.readFileSync(path.join(fx.dir, 'key.json'), 'utf8')).grade);
    const pool = all.filter((f) => f.startsWith(`strip-g${g}-`));
    const k = used[g] = (used[g] || 0); used[g] += 1;
    return { ...fx, grade: g, strip: pool.length ? path.join(stripsDir, pool[k % pool.length]) : null };
  });
}

async function main() {
  const a = args(process.argv);
  const mode = a.mode || 'fake';
  const runDir = path.resolve(a.run || path.join('sim-runs', new Date().toISOString().replace(/[:.]/g, '-')));
  fs.mkdirSync(runDir, { recursive: true });
  const fixtures = attachStrips(pickFixtures(a.fixtures, Number(a.pick || 5), a.ids, a.grade != null ? Number(a.grade) : null), a.strips);
  const driver = String(a.driver || '923000000077');
  const absentRolls = a.absent ? String(a.absent).split(',').map(Number) : [];
  let transport; let teardown = async () => {};

  if (mode === 'fake') {
    const { createMockGraphApi } = require('../mock-graph-api');
    const { createFakeBot } = require('./fake-bot');
    const bot = createFakeBot({ phoneNumberId: 'sim-fake' });
    const botPort = await bot.listen(0);
    const api = createMockGraphApi({ phoneNumberId: 'sim-fake', botUrl: `http://127.0.0.1:${botPort}`, quiet: true });
    const port = await api.listen(0);
    bot.setGraphBase(`http://127.0.0.1:${port}`);
    transport = mockTransport({ baseUrl: `http://127.0.0.1:${port}`, driver, pollMs: 50 });
    teardown = async () => { await api.close(); await bot.close(); };
  } else if (mode === 'mock') {
    transport = mockTransport({ baseUrl: a['mock-url'] || process.env.E2E_MOCK_URL || 'http://127.0.0.1:4010', driver });
  } else if (mode === 'sandbox') {
    const cfg = JSON.parse(fs.readFileSync(a['sandbox-config'], 'utf8'));
    const replies = require(resolveReplies(a['sandbox-config'], cfg.replies.module));
    transport = sandboxTransport({ ...cfg, wabaToken: process.env[cfg.wabaTokenEnv], appSecret: cfg.appSecretEnv ? process.env[cfg.appSecretEnv] : undefined,
      driver: cfg.driver || driver, replies: typeof replies.create === 'function' ? replies.create(cfg) : replies });
  } else {
    throw new Error('unknown --mode ' + mode);
  }

  let sha = null; try { sha = execSync('git rev-parse HEAD', { cwd: __dirname }).toString().trim(); } catch (e) { /* not a checkout */ }
  const run = { mode, started: new Date().toISOString(), driver_sha: sha, fixtures: fixtures.map((f) => ({ id: f.id, grade: f.grade, strip: f.strip && path.basename(f.strip) })),
    absentRolls, checks: a.checks || 'batch', realtime: !!a.realtime };
  const checks = checksMode(run.checks);
  const checkPlayer = checks !== 'none' && !a['placeholder-checks'] && mode !== 'fake' ? makeCheckPlayer(a, mode, fixtures) : null;
  if (checkPlayer) run.check_player = checkPlayer.info;
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run, null, 1));
  const tl = createTimeline(path.join(runDir, 'timeline.jsonl'));
  const res = await runVisit({ transport, timeline: tl, fixtures, absentRolls, checks, checkPlayer, realtime: run.realtime,
    timeoutMs: Number(a.timeout || (mode === 'sandbox' ? 180000 : 30000)) });
  await teardown();
  const summary = { ...summarise(tl.events), result: res,
    ...(typeof transport.signals === 'function' && transport.signals() ? { signals: transport.signals() } : {}) };
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ ok: res.ok, error: res.error, children: res.children.length, checks: res.checksSubmitted, checks_failed: res.checksFailed,
    check_s: summary.checks,
    total_s: summary.total_s, rtt: summary.rtt_stats, ...(summary.signals ? { signals: summary.signals } : {}), run: runDir }, null, 1));
  process.exit(res.ok ? 0 : 1);
}

if (require.main === module) main().catch((e) => { console.error('driver failed: ' + e.message); process.exit(2); });

module.exports = { pickFixtures, attachStrips, resolveReplies, checksMode, makeCheckPlayer };
