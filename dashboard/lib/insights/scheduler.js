'use strict';
/**
 * Runs the COACHIP nightly job once a night at 02:00 Asia/Karachi inside the portal service (NIGHTLY_JOB §0), as a
 * child process so a crash or a long night never touches the web server. Off unless COACHIP_NIGHTLY=on (B8: nothing
 * new runs by default). Two replicas may both schedule it: the job's advisory lock lets one run and the other exit 4.
 * The caller (dashboard/index.js, owned by the router lane) does: require('./lib/insights/scheduler').start().
 */
const path = require('path');
const { spawn: nodeSpawn } = require('child_process');

const RUN_HOUR_PKT = 2;
const PKT_OFFSET_MS = 5 * 3600 * 1000;

/** Milliseconds from `now` to the next 02:00 PKT (strictly in the future). */
function msUntilNextRun(now = new Date()) {
  const k = new Date(now.getTime() + PKT_OFFSET_MS);
  const next = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), RUN_HOUR_PKT, 0, 0) - PKT_OFFSET_MS);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

function start({ env = process.env, spawn = nodeSpawn, setTimer = setTimeout, now = () => new Date(), log = (m) => console.log(`[coachip-scheduler] ${m}`) } = {}) {
  if (env.COACHIP_NIGHTLY !== 'on') return null;
  const script = path.join(__dirname, '..', '..', 'jobs', 'coachip-nightly.js');
  const state = { timer: null, runs: 0 };
  const schedule = () => {
    const wait = msUntilNextRun(now());
    state.timer = setTimer(() => {
      state.runs += 1;
      const child = spawn(process.execPath, [script], { stdio: 'inherit', env });
      child.on('exit', (code) => { log(`exit=${code}`); schedule(); });
      child.on('error', () => { log('spawn_failed'); schedule(); });
    }, wait);
    if (state.timer && typeof state.timer.unref === 'function') state.timer.unref();
    log(`next_in_min=${Math.round(wait / 60000)}`);
  };
  schedule();
  return state;
}

module.exports = { start, msUntilNextRun };
