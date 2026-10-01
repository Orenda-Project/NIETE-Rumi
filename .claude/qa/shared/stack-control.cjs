'use strict';
/**
 * stack-control — the mock lane's levers on the LOCAL STACK a run is driving, for a feature driver:
 *
 *   restart('worker'|'bot', { KEY: 'val' })   the same process again with env overrides (a switch
 *                                             flipped on one service and not another: training T72/T73)
 *   redis(['SADD', key, ...])                  one command against the run's private Redis (a daily-cap
 *                                             set filled to the cap, an offer key removed to lapse it)
 *   job('enqueue'|'run', type, groupId, payload, delaySeconds)  bot/scripts/e2e/quiz-job.js
 *   lp612Doc('put'|'rm', segment, lang, tv, file)              bot/scripts/e2e/lp612-doc.js
 *   faults(rules) / clearFaults() / faultsLeft()               the scripted vendor answers e2e-cassette reads
 *
 * Every lever that runs a child process is ASYNC and awaited: a driver blocked in execFileSync for a
 * restart never sees the mock close its idle keep-alive sockets, and its next request rides a dead one
 * ("fetch failed" right after the 6-12 restart, run 20260928-1831 T72). The mock now also keeps idle
 * sockets for a minute (mock-graph-api keepAliveTimeout), for the seed calls that are still synchronous.
 *
 * Everything keys on RUN_DIR (exported by run-suite.sh): <RUN_DIR>/ports, <RUN_DIR>/src (the detached
 * checkout the bot runs from), <RUN_DIR>/cassette-faults.json. Absent RUN_DIR → every lever reports
 * { ok:false } and the driver records BLOCKED with that reason, never a false PASS.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

const runDir = () => process.env.RUN_DIR || '';
const repo = () => path.resolve(__dirname, '..', '..', '..');
const jsonLine = (out) => { const line = String(out || '').trim().split('\n').reverse().find((l) => l.trim().startsWith('{')) || ''; try { return JSON.parse(line); } catch (_) { return null; } };
const errText = (e) => String((e && e.stdout || '') + (e && e.stderr || '') + (e && e.message || e)).slice(-300);

function ports() {
  try {
    const [mock, bot, redis, worker] = fs.readFileSync(path.join(runDir(), 'ports'), 'utf8').trim().split(/\s+/).map(Number);
    return { mock, bot, redis, worker };
  } catch (_) { return null; }
}

async function restart(proc, env = {}) {
  if (!runDir()) return { ok: false, err: 'NO_RUN_DIR' };
  const kv = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  try {
    const { stdout } = await run('bash', [path.join(repo(), 'bot/scripts/e2e/local-stack.sh'), 'restart', proc, runDir(), ...kv], { encoding: 'utf8', timeout: 120000 });
    await new Promise((r) => setTimeout(r, 1500));   // let the restarted process take its first webhook cleanly
    return { ok: true, proc, env, out: String(stdout || '').trim().slice(-200) };
  } catch (e) { return { ok: false, err: errText(e) }; }
}

async function redis(args) {
  const p = ports(); if (!p) return { ok: false, err: 'NO_PORTS' };
  try {
    const { stdout } = await run('redis-cli', ['-p', String(p.redis), ...args.map(String)], { encoding: 'utf8', timeout: 15000 });
    return { ok: true, out: String(stdout || '').trim() };
  } catch (e) { return { ok: false, err: errText(e) }; }
}

async function job(mode, type, groupId, payload = {}, delaySeconds = 0) {
  const src = path.join(runDir(), 'src');
  if (!runDir() || !fs.existsSync(src)) return { ok: false, err: 'NO_STACK_SRC' };
  try {
    const { stdout } = await run('node', [path.join(src, 'bot/scripts/e2e/quiz-job.js'), mode, type, String(groupId), JSON.stringify(payload), String(delaySeconds || 0)], { cwd: src, encoding: 'utf8', timeout: 180000 });
    const plain = String(stdout || '').replace(/\x1b\[[0-9;]*m/g, ''); const m = plain.match(/\{"ok":(?:true|false),"mode":.*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
    return jsonLine(stdout) || { ok: true, out: plain.slice(-300) };
  } catch (e) { return { ok: false, err: errText(e) }; }
}

async function lp612Doc(mode, segment, lang, tv, file) {
  const src = path.join(runDir(), 'src');
  if (!runDir() || !fs.existsSync(src)) return { ok: false, err: 'NO_STACK_SRC' };
  try {
    const { stdout } = await run('node', [path.join(src, 'bot/scripts/e2e/lp612-doc.js'), mode, segment, lang, tv, ...(file ? [file] : [])], { cwd: src, encoding: 'utf8', timeout: 120000 });
    return jsonLine(stdout) || { ok: true, out: String(stdout || '').slice(-200) };
  } catch (e) { return { ok: false, err: errText(e) }; }
}

// the script's one JSON line arrives wrapped by the bot's logger (timestamp, ANSI colour), so it is found by shape
const sweepJson = (out) => { const plain = String(out || '').replace(/\x1b\[[0-9;]*m/g, ''); const m = plain.match(/\{"ok":(?:true|false),"sweep":.*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch (_) { return null; } };
/** One of the worker's periodic sweeps, run NOW in a child process against the stack (bot/scripts/e2e/sweep.js):
 *  'teacher-nudges' | 'resume' | 'stale' | 'quiz-offer-prepare'. `env` = flags/thresholds read at call time. */
async function sweep(name, env = {}) {
  const src = path.join(runDir(), 'src');
  if (!runDir() || !fs.existsSync(src)) return { ok: false, err: 'NO_STACK_SRC' };
  const kv = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  // the detached checkout the stack runs from is at a COMMIT; a lever not yet committed is taken from the working tree
  const inSrc = path.join(src, 'bot/scripts/e2e/sweep.js');
  const script = fs.existsSync(inSrc) ? inSrc : path.join(repo(), 'bot/scripts/e2e/sweep.js');
  try {
    const { stdout } = await run('node', [script, name, ...kv], { cwd: src, encoding: 'utf8', timeout: 180000 });
    return sweepJson(stdout) || { ok: true, out: String(stdout || '').slice(-300) };
  } catch (e) { return sweepJson(e && e.stdout) || { ok: false, err: errText(e) }; }
}

/** The words on a hero (image) coaching report, re-rendered from the session (bot/scripts/e2e/hero-text.js). */
async function heroText(sessionId) {
  const src = path.join(runDir(), 'src');
  if (!runDir() || !fs.existsSync(src)) return { ok: false, err: 'NO_STACK_SRC' };
  const inSrc = path.join(src, 'bot/scripts/e2e/hero-text.js');
  const script = fs.existsSync(inSrc) ? inSrc : path.join(repo(), 'bot/scripts/e2e/hero-text.js');
  const outFile = path.join(runDir(), `hero-text-${String(sessionId).slice(0, 8)}.json`);
  try {
    await run('node', [script, String(sessionId), outFile], { cwd: src, encoding: 'utf8', timeout: 180000 });
  } catch (e) { if (!fs.existsSync(outFile)) return { ok: false, err: errText(e) }; }
  try { return JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) { return { ok: false, err: 'unreadable hero-text output: ' + e.message }; }
}

const faultsFile = () => path.join(runDir(), 'cassette-faults.json');
function faults(rules) {
  if (!runDir()) return { ok: false, err: 'NO_RUN_DIR' };
  fs.writeFileSync(faultsFile(), JSON.stringify(rules || []));
  return { ok: true, file: faultsFile(), rules: (rules || []).length };
}
function clearFaults() { try { fs.rmSync(faultsFile(), { force: true }); } catch (_) {} return { ok: true }; }
function faultsLeft() { try { return JSON.parse(fs.readFileSync(faultsFile(), 'utf8')); } catch (_) { return []; } }

module.exports = { runDir, ports, restart, redis, job, faults, clearFaults, faultsLeft, lp612Doc, sweep, heroText };
