#!/usr/bin/env node
'use strict';
/**
 * sweep — run ONE of the worker's periodic sweeps now, in this process, against the local stack.
 *
 *   node bot/scripts/e2e/sweep.js teacher-nudges      teacher_nudges sweeper (the coaching ask, the quiz offer)
 *   node bot/scripts/e2e/sweep.js resume              conversation-resume: offer an expired wait back
 *   node bot/scripts/e2e/sweep.js stale               stale-session recovery (photo gate, reminders, auto-complete)
 *   node bot/scripts/e2e/sweep.js quiz-offer-prepare  build today's lp_quiz_offer cohort (needs LP_QUIZ_OFFER_ENABLED)
 *
 * The worker runs these on intervals a scenario cannot wait for (5–30 min, first tick 90 s after boot).
 * Same modules, same DB, same Redis, same mock Graph API — only the trigger is ours. Env overrides go
 * on the command line as KEY=VAL after the sweep name (a flag read at call time, a threshold in minutes).
 * Run from the stack's source checkout (RUN_DIR/src); refuses the production project. Mock lane only.
 */
const path = require('path');
const fs = require('fs');
const root = process.cwd();
const envFile = fs.existsSync(path.join(root, '.env')) ? path.join(root, '.env') : path.join(root, 'bot', '.env');
require(path.join(root, 'bot', 'node_modules', 'dotenv')).config({ path: envFile });
const [name, ...kv] = process.argv.slice(2);
for (const pair of kv) { const i = pair.indexOf('='); if (i > 0) process.env[pair.slice(0, i)] = pair.slice(i + 1); }
if (String(process.env.SUPABASE_URL || '').includes('ihzciabopbttygxxgrkm')) {
  console.error('sweep: refusing to touch the NIETE production project');
  process.exit(3);
}
if (!name) { console.error('usage: sweep.js teacher-nudges|resume|stale|quiz-offer-prepare [KEY=VAL ...]'); process.exit(2); }
const svc = (p) => require(path.join(root, 'bot', 'shared', 'services', p));
// E2E_SWEEP_NOW=<ISO>: the clock the sweep runs on — rows booked a few minutes ahead are due for THIS sweep only
const NOW = process.env.E2E_SWEEP_NOW ? new Date(process.env.E2E_SWEEP_NOW) : new Date();
(async () => {
  // the resume sweep takes a Redis lock and the nudge sweep reads the open-question windows: both fail CLOSED while the
  // client is still connecting (run 20260930-0921: skippedLocked on every try). Wait for it, briefly.
  try { const cache = svc('cache/railway-redis.service'); const t0 = Date.now(); while (!(cache.isAvailable && cache.isAvailable()) && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 300)); } catch (_) {}
  let result;
  if (name === 'teacher-nudges') {
    svc('nudges/lp-coaching-ask.service');       // registers its kind
    svc('nudges/lp-quiz-offer.service');
    result = await svc('nudges/teacher-nudges.sweeper').runSweep({ now: NOW });
  } else if (name === 'resume') {
    result = await svc('conversation-resume.service').sweepAndOffer();
  } else if (name === 'stale') {
    result = await require(path.join(root, 'bot', 'workers', 'stale-session.worker')).runRecovery();
  } else if (name === 'quiz-offer-prepare') {
    result = await svc('nudges/lp-quiz-offer.service').prepare({ now: NOW });
  } else { console.error('sweep: unknown sweep ' + name); process.exit(2); }
  console.log(JSON.stringify({ ok: true, sweep: name, result }));
  process.exit(0);
})().catch((e) => { console.log(JSON.stringify({ ok: false, sweep: name, err: String(e && e.message || e).slice(0, 400) })); process.exit(1); });
