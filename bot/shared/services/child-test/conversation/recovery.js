'use strict';

/**
 * Child test — scoring that survives a restart.
 *
 * The coach's voice note is stored, then scored off the critical path. That job used to be only an
 * in-memory promise: a deploy that removed the container in between (NIETE sandbox, 2 Oct 2026, one
 * second after `audio_saved`) left the block `pending` for ever, and the check — opened when an
 * in-memory counter of scoreBlock calls reached three — was never sent. Now:
 *
 *   runScoring(ref, block)   every scoring, live or recovered, goes through here:
 *                            1. claim the block in the DATABASE (compare-and-set on ai_status +
 *                               updated_at, store.claimBlockStatus) — two replicas, or a sweep racing
 *                               the live job, never score one block twice;
 *                            2. count the attempt (session timing `<block>.score_attempt.<n>`);
 *                            3. score (L5 scoreBlock); a failure is retried by the sweep, up to
 *                               MAX_ATTEMPTS, then written terminal: ai_status 'failed',
 *                               ai_reason 'final:<reason>';
 *                            4. open the check if the STORE says the child is complete.
 *   checkReady / maybeOpenCheck  the check opens when all three blocks have ai_marks or a terminal
 *                            failure — read from child_test_blocks, never from a counter.
 *                            S.claimCheck stays the once-only guard.
 *   sweepOnce()              finds blocks with media and no marks whose job is gone: `pending` past a
 *                            grace period, `scoring` past the longest real score, `failed` and not
 *                            terminal past a back-off. Maths only once the strip is in, or the coach
 *                            declined it (then with force — CONTRACT §10 CR-1, §12 CR-2). Also
 *                            re-sends a check whose sender died between the claim and the send.
 *   start() / stop()         the sweep in the bot process: once soon after boot, then every 30 s
 *                            (pre-merge Class P: this service redeploys far more often than any
 *                            long interval would fire). CHILD_TEST_SCORE_RECOVERY_OFF=1 turns it off;
 *                            inert unless CHILD_TEST_ENABLED=true.
 *
 * Load (Class R): two indexed-by-nothing reads of ≤ 50 / ≤ 100 narrow rows (no transcript, no marks)
 * per tick on a table that grows by 3 rows per child tested; one getSession per touched session.
 */

const WhatsAppService = require('../../whatsapp.service');
const { logToFile, logError } = require('../../../utils/logger');
const { logEvent } = require('../../../utils/structured-logger');
const ports = require('./ports');
const S = require('./state');
const { langOf, t } = require('./copy');
const { isEnabled } = require('./gate');

const BLOCKS = ['urdu', 'english', 'maths'];
const MAX_ATTEMPTS = 3;
const FINAL = 'final:';
// Reasons a retry cannot change (L5 scoring/index.js): written terminal on the first attempt.
const NON_RETRYABLE = new Set(['bad_block', 'block_not_found', 'form_not_found', 'no_media']);

const PENDING_GRACE_MS = 45 * 1000;          // the live job claims within milliseconds of the save
const SCORING_STALE_MS = 3 * 60 * 1000;      // the longest real score is about 60 s
const RETRY_AFTER_MS = 30 * 1000;            // back-off between failed attempts
const AGE_CEILING_MS = 24 * 3600 * 1000;     // older than a school day: left alone (J6)
const CHECK_LOOKBACK_MS = 15 * 60 * 1000;    // blocks marked this recently may still owe a check
const CHECK_STALE_MS = 2 * 60 * 1000;        // a check claimed this long ago and never sent: its sender died
const SCAN_LIMIT = 50;
const PER_TICK = 6;                          // scorings started per tick, oldest first (J2)
const BOOT_DELAY_MS = 20 * 1000;
const INTERVAL_MS = 30 * 1000;

const off = () => process.env.CHILD_TEST_SCORE_RECOVERY_OFF === '1';
const nowIso = () => new Date().toISOString();
const isFinalFailure = (row) => !!row && row.ai_status === 'failed' && String(row.ai_reason || '').startsWith(FINAL);
const isDone = (row) => !!row && (row.ai_marks != null || row.ai_status === 'scored' || row.ai_status === 'partial' || isFinalFailure(row));
const attemptsOf = (session, block) => Object.keys((session && session.timings) || {})
  .filter((k) => new RegExp(`^${block}\\.score_attempt\\.\\d+$`).test(k)).length;
// What the last attempt died of: L5's failure reason, or — for a row left 'scoring' — the process.
const lastReason = (row) => (row.ai_status === 'failed' && row.ai_reason ? row.ai_reason : 'died_while_scoring');

// ------------------------------------------------------------------ small helpers

async function timing(sessionId, key, at = new Date()) {
  if (!sessionId) return;
  try {
    const r = await ports.store.recordTiming(sessionId, key, at);
    if (!r || !r.ok) logError('child_test.timing_failed', { sessionId, key, error: r && r.error });
  } catch (err) {
    logError('child_test.timing_failed', { sessionId, key, error: err.message });
  }
}

async function say(to, text) {
  const ok = await WhatsAppService.sendMessage(to, text);
  if (ok === false) logError('child_test.send_failed', { kind: 'text' });
  return ok;
}

async function getSession(sessionId) {
  const r = await ports.store.getSession(sessionId);
  if (!r || !r.ok) {
    logError('child_test.score_session_read_failed', { sessionId, error: r && r.error });
    return null;
  }
  return r.session || null;
}

/** Who gets a recovered check: the session's coach, on WhatsApp sessions only. → notify | null */
async function coachOf(session) {
  if (!session || session.channel !== 'whatsapp') return null;
  const CS = require('../check-flow/check-store');
  const [coach, roll] = await Promise.all([CS.getCoach(session.coach_user_id), CS.getRollNumber(session.draw_id)]);
  if (!coach || !coach.phone_number) {
    logError('child_test.score_recovery_no_coach', { sessionId: session.id });
    return null;
  }
  return { from: coach.phone_number, lang: langOf(coach), rollNumber: roll != null ? roll : '—' };
}

// ------------------------------------------------------------------ the check

async function openCheck(sessionId, from, lang, rollNumber) {
  let ok;
  try {
    ok = await ports.checkFlow.sendCheck(sessionId);
  } catch (err) {
    ok = false;
    logError('child_test.check_send_failed', { sessionId, error: err.message });
  }
  if (!ok || ok.ok === false) {
    logError('child_test.check_send_failed', { sessionId });
    await timing(sessionId, 'check.send_failed');
    return say(from, t(lang, 'childTestCheckFailed', { roll: rollNumber }));
  }
  await timing(sessionId, 'check.sent');
  logToFile('child_test.check_sent', { sessionId });
  return true;
}

/** The store says the child is complete: every block has AI marks or a terminal failure. → bool */
async function checkReady(sessionId) {
  const b = await ports.store.listBlocks(sessionId);
  if (!b || !b.ok) {
    logError('child_test.check_gate_read_failed', { sessionId, error: b && b.error });
    return false;
  }
  const byBlock = new Map((b.blocks || []).map((x) => [x.block, x]));
  return BLOCKS.every((x) => isDone(byBlock.get(x)));
}

/** Open the check once, when the store says so. `notify` = { from, lang, rollNumber } (live path). */
async function maybeOpenCheck(sessionId, notify = null, session = null) {
  if (!(await checkReady(sessionId))) return false;
  const to = notify || await coachOf(session || await getSession(sessionId));
  if (!to) return false;
  if (!(await S.claimCheck(sessionId))) return false;
  await openCheck(sessionId, to.from, to.lang, to.rollNumber);
  return true;
}

// ------------------------------------------------------------------ one block, under a claim

/**
 * @param {{sessionId, grade, form, session?}} ref
 * @param {'urdu'|'english'|'maths'} block
 * @param {{force?, snapshot?, recovered?, notify?}} opts  snapshot = the row the sweep read (its claim
 *   is taken on exactly that status + updated_at); without one the live block row is read.
 * @returns {Promise<{outcome: 'scored'|'partial'|'failed'|'final'|'pending'|'lost_claim'|'skipped', reason?}>}
 */
async function runScoring(ref, block, { force = false, snapshot = null, recovered = false, notify = null } = {}) {
  const sid = ref.sessionId;
  let row = snapshot;
  if (!row) {
    const g = await ports.store.getBlock(sid, block);
    if (!g || !g.ok) {
      logError('child_test.score_block_read_failed', { sessionId: sid, block, error: g && g.error });
      return { outcome: 'skipped', reason: 'block_read_failed' };
    }
    row = g.block;
  }
  if (!row) return { outcome: 'skipped', reason: 'no_block' };
  if (isDone(row)) {
    await maybeOpenCheck(sid, notify, ref.session);
    return { outcome: 'skipped', reason: 'already_done' };
  }
  // Live path: a block already being scored is someone else's (the sweep reclaims it if they died).
  if (!snapshot && row.ai_status === 'scoring') {
    logToFile('child_test.score_claimed_elsewhere', { sessionId: sid, block });
    return { outcome: 'skipped', reason: 'claimed_elsewhere' };
  }
  const session = ref.session || await getSession(sid);
  if (!session) return { outcome: 'skipped', reason: 'no_session' };
  const attempt = attemptsOf(session, block) + 1;
  const giveUp = attempt > MAX_ATTEMPTS;

  const claim = await ports.store.claimBlockStatus({
    blockId: row.id, fromStatus: row.ai_status, fromUpdatedAt: row.updated_at,
    toStatus: giveUp ? 'failed' : 'scoring', reason: giveUp ? `${FINAL}${lastReason(row)}` : `attempt:${attempt}`,
  });
  if (!claim || !claim.ok) {
    logError('child_test.score_claim_failed', { sessionId: sid, block, error: claim && (claim.error || claim.reason) });
    return { outcome: 'skipped', reason: 'claim_failed' };
  }
  if (!claim.claimed) {
    logToFile('child_test.score_claim_lost', { sessionId: sid, block, recovered });
    return { outcome: 'lost_claim' };
  }
  if (giveUp) {
    // The last attempt's process died mid-score: no attempt is left, so this is the terminal answer.
    logError('child_test.score_gave_up', { sessionId: sid, block, attempts: attempt - 1, reason: lastReason(row) });
    await timing(sid, `${block}.scored`);
    await maybeOpenCheck(sid, notify, session);
    return { outcome: 'final', reason: lastReason(row) };
  }
  await timing(sid, `${block}.score_attempt.${attempt}`);

  let r;
  try {
    const args = { sessionId: sid, block, grade: ref.grade != null ? ref.grade : session.grade, form: ref.form || session.form };
    if (block === 'maths' && force) args.force = true;
    r = await ports.scoring.scoreBlock(args);
  } catch (err) {
    r = { ok: false, aiStatus: 'failed', reason: err.message };
  }

  let outcome;
  let reason = r && r.reason;
  if (r && r.ok && (r.aiStatus === 'scored' || r.aiStatus === 'partial')) {
    outcome = r.aiStatus;
  } else if (r && r.ok && r.aiStatus === 'pending') {
    // Maths without its strip (should not reach here: callers wait for it): give the claim back.
    await ports.store.setAiStatus({ sessionId: sid, block, aiStatus: 'pending', reason: reason || null });
    return { outcome: 'pending', reason };
  } else {
    reason = reason || 'unknown';
    const final = NON_RETRYABLE.has(reason) || attempt >= MAX_ATTEMPTS;
    const w = await ports.store.setAiStatus({ sessionId: sid, block, aiStatus: 'failed', reason: final ? `${FINAL}${reason}` : reason });
    if (w && w.alreadyScored) outcome = 'scored';   // another scorer's marks landed meanwhile
    else {
      if (!w || !w.ok) logError('child_test.score_status_write_failed', { sessionId: sid, block, error: w && (w.error || w.reason) });
      outcome = final ? 'final' : 'failed';
      logError('child_test.score_failed', { sessionId: sid, block, reason, attempt, final });
    }
  }
  if (outcome !== 'failed') await timing(sid, `${block}.scored`);
  if (recovered) {
    logEvent('child_test.score_recovered', {
      sessionId: sid, block, aiStatus: outcome === 'final' ? 'failed' : (outcome === 'failed' ? 'failed_retrying' : outcome),
      attempt, prior: snapshot ? snapshot.ai_status : null, reason: outcome === 'scored' || outcome === 'partial' ? null : reason,
    });
  }
  if (outcome !== 'failed') await maybeOpenCheck(sid, notify, session);
  return { outcome, reason };
}

// ------------------------------------------------------------------ the sweep

/** Why the sweep leaves a scanned row alone now, or null when it should be scored (+ force for maths). */
function verdict(row, session, nowMs) {
  const age = nowMs - Date.parse(row.updated_at || 0);
  if (row.ai_status === 'pending' && age < PENDING_GRACE_MS) return { skip: 'fresh' };
  if (row.ai_status === 'scoring' && age < SCORING_STALE_MS) return { skip: 'in_flight' };
  if (row.ai_status === 'failed') {
    if (isFinalFailure(row)) return { skip: 'final' };
    if (age < RETRY_AFTER_MS) return { skip: 'backoff' };
  }
  if (!session) return { skip: 'no_session' };
  if (session.status === 'abandoned') return { skip: 'abandoned' };
  if (row.block !== 'maths') return row.audio_r2_key ? { force: false } : { skip: 'no_media' };
  if (!row.audio_r2_key) return { skip: 'no_media' };
  if (row.photo_r2_key) return { force: false };
  // No strip: only once the coach's work for the child is done (strip declined, or the child closed).
  const declined = session.status === 'completed' || !!(session.timings || {})['maths.photo_declined'];
  return declined ? { force: true } : { skip: 'awaiting_strip' };
}

/** A check whose sender died after S.claimCheck and before the send is re-sent, once. */
async function recoverCheck(session, nowMs) {
  const tm = session.timings || {};
  if (session.channel !== 'whatsapp' || session.status === 'abandoned') return false;
  if (tm['check.sent'] || tm['check.send_failed']) return false;
  if (!(await checkReady(session.id))) return false;
  if (!(await S.checkSent(session.id))) return maybeOpenCheck(session.id, null, session);
  const claimedAt = Date.parse(await S.checkClaimedAt(session.id));
  if (Number.isFinite(claimedAt) && nowMs - claimedAt < CHECK_STALE_MS) return false;
  if (!(await S.claimCheckRetry(session.id))) return false;
  const to = await coachOf(session);
  if (!to) return false;
  logEvent('child_test.check_recovered', { sessionId: session.id });
  await openCheck(session.id, to.from, to.lang, to.rollNumber);
  return true;
}

let running = false;

/**
 * One pass. Never throws. → counts { found, recovered, failed, gaveUp, lostClaim, skipped, checks }
 * or { skipped: 'disabled' | 'off' | 'running' }.
 */
async function sweepOnce({ now = new Date() } = {}) {
  if (!isEnabled()) return { skipped: 'disabled' };
  if (off()) return { skipped: 'off' };
  if (running) return { skipped: 'running' };
  running = true;
  const nowMs = now.getTime();
  const out = { found: 0, recovered: 0, failed: 0, gaveUp: 0, lostClaim: 0, skipped: 0, checks: 0 };
  try {
    const scan = await ports.store.listBlocksToRecover({ since: new Date(nowMs - AGE_CEILING_MS), limit: SCAN_LIMIT });
    if (!scan || !scan.ok) {
      logError('child_test.score_sweep_failed', { stage: 'scan', error: scan && scan.error });
      return out;
    }
    const rows = scan.blocks || [];
    out.found = rows.length;
    const sessions = new Map();
    const sessionOf = async (id) => {
      if (!sessions.has(id)) sessions.set(id, await getSession(id));
      return sessions.get(id);
    };
    const todo = [];
    for (const row of rows) {
      const session = await sessionOf(row.session_id);
      const v = verdict(row, session, nowMs);
      if (v.skip) { out.skipped += 1; continue; }
      if (todo.length < PER_TICK) todo.push({ row, session, force: v.force });
    }
    // One session's blocks one after another (each attempt is a write to the session's timings, a
    // read-modify-write); different sessions in parallel.
    const bySession = new Map();
    for (const job of todo) bySession.set(job.session.id, [...(bySession.get(job.session.id) || []), job]);
    const results = (await Promise.all([...bySession.values()].map(async (jobs) => {
      const done = [];
      for (const { row, session, force } of jobs) {
        try {
          // Fresh session each time: the previous block of this session has just written its timings.
          const fresh = (await getSession(session.id)) || session;
          done.push(await runScoring({ sessionId: fresh.id, grade: fresh.grade, form: fresh.form, session: fresh },
            row.block, { force, snapshot: row, recovered: true }));
        } catch (err) {
          logError('child_test.score_recovery_crashed', { sessionId: session.id, block: row.block, error: err.message });
          done.push({ outcome: 'skipped' });
        }
      }
      return done;
    }))).flat();
    for (const r of results) {
      if (r.outcome === 'scored' || r.outcome === 'partial') out.recovered += 1;
      else if (r.outcome === 'final') out.gaveUp += 1;
      else if (r.outcome === 'failed') out.failed += 1;
      else if (r.outcome === 'lost_claim') out.lostClaim += 1;
      else out.skipped += 1;
    }

    // Checks owed by sessions whose last block was marked recently (a sender that died mid-send).
    const recent = await ports.store.listRecentlyScoredBlocks({ since: new Date(nowMs - CHECK_LOOKBACK_MS), limit: 100 });
    if (!recent || !recent.ok) logError('child_test.score_sweep_failed', { stage: 'checks', error: recent && recent.error });
    else {
      sessions.clear();   // re-read: this pass may have just written timings
      for (const id of new Set((recent.blocks || []).map((b) => b.session_id))) {
        const session = await sessionOf(id);
        if (session && await recoverCheck(session, nowMs)) out.checks += 1;
      }
    }
    return out;
  } catch (err) {
    logError('child_test.score_sweep_failed', { error: err.message });
    return out;
  } finally {
    running = false;
    if (out.found || out.checks) logToFile('child_test.score_sweep', out);
  }
}

// ------------------------------------------------------------------ the timer (bot process)

const __internals = {
  async tick() {
    try {
      return await sweepOnce();
    } catch (err) {
      logError('child_test.score_sweep_failed', { error: err.message });
      return null;
    }
  },
};

let timers = null;

/** Once ~20 s after boot, then every 30 s. → true when it started now. */
function start({ bootDelayMs = BOOT_DELAY_MS, intervalMs = INTERVAL_MS } = {}) {
  if (!isEnabled() || off()) {
    logToFile('child_test.score_sweep_not_started', { reason: off() ? 'CHILD_TEST_SCORE_RECOVERY_OFF=1' : 'CHILD_TEST_ENABLED is not true' });
    return false;
  }
  if (timers) return false;
  const run = () => __internals.tick();
  timers = { boot: setTimeout(run, bootDelayMs), every: setInterval(run, intervalMs) };
  if (typeof timers.boot.unref === 'function') timers.boot.unref();
  if (typeof timers.every.unref === 'function') timers.every.unref();
  logToFile('child_test.score_sweep_started', { bootDelayMs, intervalMs, at: nowIso() });
  return true;
}

function stop() {
  if (!timers) return;
  clearTimeout(timers.boot);
  clearInterval(timers.every);
  timers = null;
}

module.exports = {
  runScoring, maybeOpenCheck, checkReady, openCheck, timing, sweepOnce, start, stop, __internals,
  MAX_ATTEMPTS, isDone,
};
