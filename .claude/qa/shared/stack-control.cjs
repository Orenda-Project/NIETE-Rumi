'use strict';
/**
 * stack-control — the mock lane's levers on the LOCAL STACK a run is driving, for a feature driver:
 *
 *   restart('worker'|'bot', { KEY: 'val' })   the same process again with env overrides (a switch
 *                                             flipped on one service and not another: training T72/T73)
 *   redis(['SADD', key, ...])                  one command against the run's private Redis (a daily-cap
 *                                             set filled to the cap, an offer key removed to lapse it)
 *   job('enqueue'|'run', type, groupId, payload, delaySeconds)  bot/scripts/e2e/quiz-job.js
 *   faults(rules) / clearFaults()              the scripted vendor answers e2e-cassette reads
 *
 * Everything keys on RUN_DIR (exported by run-suite.sh): <RUN_DIR>/ports, <RUN_DIR>/src (the detached
 * checkout the bot runs from), <RUN_DIR>/cassette-faults.json. Absent RUN_DIR → every lever reports
 * { ok:false } and the driver records BLOCKED with that reason, never a false PASS.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const runDir = () => process.env.RUN_DIR || '';
const repo = () => path.resolve(__dirname, '..', '..', '..');

function ports() {
  try {
    const [mock, bot, redis, worker] = fs.readFileSync(path.join(runDir(), 'ports'), 'utf8').trim().split(/\s+/).map(Number);
    return { mock, bot, redis, worker };
  } catch (_) { return null; }
}

function restart(proc, env = {}) {
  if (!runDir()) return { ok: false, err: 'NO_RUN_DIR' };
  const kv = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  try {
    const out = execFileSync('bash', [path.join(repo(), 'bot/scripts/e2e/local-stack.sh'), 'restart', proc, runDir(), ...kv], { encoding: 'utf8', timeout: 120000 });
    return { ok: true, proc, env, out: out.trim().slice(-200) };
  } catch (e) { return { ok: false, err: String((e.stdout || '') + (e.stderr || '') + e.message).slice(-300) }; }
}

function redis(args) {
  const p = ports(); if (!p) return { ok: false, err: 'NO_PORTS' };
  try { return { ok: true, out: execFileSync('redis-cli', ['-p', String(p.redis), ...args.map(String)], { encoding: 'utf8', timeout: 15000 }).trim() }; }
  catch (e) { return { ok: false, err: String(e.message).slice(0, 200) }; }
}

function job(mode, type, groupId, payload = {}, delaySeconds = 0) {
  const src = path.join(runDir(), 'src');
  if (!runDir() || !fs.existsSync(src)) return { ok: false, err: 'NO_STACK_SRC' };
  try {
    const out = execFileSync('node', [path.join(src, 'bot/scripts/e2e/quiz-job.js'), mode, type, String(groupId), JSON.stringify(payload), String(delaySeconds || 0)], { cwd: src, encoding: 'utf8', timeout: 180000 });
    const line = out.trim().split('\n').pop();
    try { return JSON.parse(line); } catch (_) { return { ok: true, out: out.slice(-300) }; }
  } catch (e) { return { ok: false, err: String((e.stdout || '') + (e.stderr || '') + e.message).slice(-400) }; }
}

const faultsFile = () => path.join(runDir(), 'cassette-faults.json');
function faults(rules) {
  if (!runDir()) return { ok: false, err: 'NO_RUN_DIR' };
  fs.writeFileSync(faultsFile(), JSON.stringify(rules || []));
  return { ok: true, file: faultsFile(), rules: (rules || []).length };
}
function clearFaults() { try { fs.rmSync(faultsFile(), { force: true }); } catch (_) {} return { ok: true }; }
function faultsLeft() { try { return JSON.parse(fs.readFileSync(faultsFile(), 'utf8')); } catch (_) { return []; } }

module.exports = { runDir, ports, restart, redis, job, faults, clearFaults, faultsLeft };
