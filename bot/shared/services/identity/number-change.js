'use strict';
/**
 * WhatsApp says a teacher changed her number: move her account to the new one, so her history follows her.
 *
 * Meta posts a `system` message when she uses WhatsApp's "Change number": the sender is her OLD number (so the
 * webhook's getOrCreateUser found her account) and `system.wa_id` the new one (identity-events.numberChangeOf).
 * identity-events.recordSystem logs it first; this runs after it and acts only when ALL of these hold:
 *   - the switch is on: app_settings `meta_number_change_enabled` (feature-flags, fail closed, off by default);
 *   - Meta's signature on this request verified (req.webhookSignatureOk, recorded by webhook-signature);
 *   - the notice carries the new number.
 *
 * It acts on the coach phone edit's own verdict for the new number (loadTargetWithHistory + classifyTarget, the steps
 * the recorder logs), through the coach edit's own move (teacher-edit-commit.moveNumber, actor 'meta_number_change'):
 *   free   her number moves                                                              → moved
 *   shell  the empty account her new phone made is retired (merged:<id>), its rows follow
 *          her, she moves                                                                → folded
 *   taken  nothing moves; the coach edit's escalation is raised for a person             → escalated
 *          (a leader_roster_audit edit_phone_escalated row, the queue a human works)
 * No person is in this loop, so it folds less than the coach screen does. A shell is folded only when it was created
 * at or after the change (the account her new phone made), never finished sign-up, and is not itself the sender of a
 * number change that waits on a person. Any other shell is escalated: destination_predates_change (it was there before
 * she changed number: a stranger's, or her own real account), destination_registered (someone signed up on it),
 * destination_changed_again (it has its own open change: a person settles both at once). The same reason stops any
 * move, free or fold, onto a number whose account left it by a Meta change made after this one (the two changes
 * crossed in delivery).
 *
 * Stale, repeated and out-of-order notices (Meta can resend, and deliveries can cross):
 *   - she is already on the new number                                         → already_done (already_on_number)
 *   - one of her Meta moves was for a change made after this one: a replay     → skipped_stale
 *     (CHANGE times are compared: each Meta edit_phone row keeps its notice's changed_at, so a late delivery is still
 *     in order; when a row was written never decides it)
 *   - a coach changed her number after this change was made                    → escalated (notice_predates_coach_edit)
 *   - the change is already on record: the account on the new number was moved there from the old one (an edit_phone
 *     row, by a coach or by this), or this change already waits on a person (its escalation, within the day the
 *     webhook still accepts a resend in)                                       → already_done (move_on_record, escalation_on_record)
 *   - the account on her old number was made by this notice (created after the change, with a minute's grace for the
 *     two clocks) and nothing is on record: it is not the account that changed number, so a person decides
 *                                                                               → escalated (sender_account_new)
 *
 * A move that stops half way is recorded, never left silent: when the shell was retired and her number write then
 * failed, or her booked visits or a shell table did not follow, an edit_phone_escalated row names the retired account
 * and the step that failed (reason move_incomplete), and a log line says so. A write that throws after her number
 * moved still writes the move's edit_phone row, and escalates the step that threw.
 *
 * Every move and escalation leaves the coach edit's audit row, written as her own change: she is the actor (she changed
 * her number), no coach's roster is affected, detail.via is 'meta_number_change'; its writes run as her too
 * (actor-context), so the history ledger names her. Sends nothing; adds no table or column. Never throws.
 *
 * Logs identity.number_change_applied { tk, verdict, action, reason }: tk is her keyed reference (identity-events.ref),
 * verdict the coach edit's for the new number (null when this did not classify it, 'unknown' when it could not be
 * read), action one of ACTIONS, reason a short machine token on every outcome that is not a clean move (null on a
 * clean one). An escalation whose row was refused is failed (escalation_unrecorded), never escalated. Never a phone
 * number, a name or a raw id.
 */
const StructuredLogger = require('../../utils/structured-logger');
const { logToFile } = require('../../utils/logger');
const { runAsActor } = require('../../utils/actor-context');
const IdentityEvents = require('./identity-events');

const VIA = 'meta_number_change';
const ACTIONS = Object.freeze([
  'moved', 'folded', 'escalated', 'skipped_flag_off', 'skipped_flag_unreadable', 'skipped_unverified', 'skipped_no_number',
  'skipped_stale', 'already_done', 'failed',
]);
const CLOCK_GRACE_MS = 60 * 1000;
// The webhook drops a message older than 24 hours (validators.isWithin24Hours), so no resend can come later than this.
const RESEND_WINDOW_MS = 24 * 60 * 60 * 1000;

const _db = () => require('../../config/supabase');
const _C = () => require('../observe/teacher-edit-commit.service');
const _E = () => require('../observe/teacher-edit.service');

const digits = (v) => String(v == null ? '' : v).replace(/\D+/g, '');

function swallow(where, err) {
  try {
    logToFile('⚠️ number change not applied', { where, error: (err && err.message) || String(err) }, 'warn');
  } catch (_) { /* a broken logger never reaches the teacher */ }
}

/** A timestamp as epoch ms. users.created_at is `timestamp` (no zone) holding UTC, so a bare value is read as UTC. */
function utcMs(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return NaN;
  return Date.parse(/(?:z|[+-]\d\d(?::?\d\d)?)$/i.test(s) ? s : `${s}Z`);
}

/** An outcome: what happened, and why (a machine token; null on a clean move). */
function settle(out, action, reason) {
  out.action = action;
  out.reason = reason;
}

/**
 * When the change a Meta edit_phone row records was made: its detail.changed_at, or, for a row an older build wrote
 * without one, when the row was written.
 */
function changeTimeOf(r) {
  const at = utcMs(r && r.detail && r.detail.changed_at);
  return Number.isFinite(at) ? at : utcMs(r && r.created_at);
}

/**
 * What her own edit_phone rows say about this notice. It compares CHANGE times, never when a row was written: a notice
 * delivered late is still in order with the changes around it.
 *   'stale'  one of her Meta moves was for a change made after this one (changeTimeOf): this is a replay;
 *   'coach'  a coach changed her number after this change was made (the coach row's created_at): a person reconciles;
 *   null     neither (or the notice has no time to compare). Throws on a refused read.
 */
async function laterMoves(supabase, userId, changedAt) {
  const { data, error } = await supabase.from('leader_roster_audit')
    .select('created_at, detail').eq('teacher_ext_id', userId).eq('action', 'edit_phone');
  if (error) throw new Error(error.message || 'audit read refused');
  let coach = false;
  for (const r of data || []) {
    const d = (r && r.detail) || {};
    if (d.via === VIA) {
      if (changeTimeOf(r) > changedAt) return 'stale';
    } else if (utcMs(r && r.created_at) > changedAt) {
      coach = true;
    }
  }
  return coach ? 'coach' : null;
}

/**
 * Did the account on the new number leave it by a Meta change made after this one? Then the two changes crossed in
 * delivery (B->C handled before A->B), and moving her onto B would put her history on a number she has already left: a
 * person settles it. One read, on the indexed teacher_phone_e164. Throws on a refused read.
 */
async function movedAwayLater(supabase, toPhone, changedAt) {
  const { data, error } = await supabase.from('leader_roster_audit')
    .select('created_at, detail').eq('teacher_phone_e164', toPhone).eq('action', 'edit_phone');
  if (error) throw new Error(error.message || 'audit read refused');
  return (data || []).some((r) => r && r.detail && r.detail.via === VIA && changeTimeOf(r) > changedAt);
}

/**
 * Is this exact change already on record in the coach edit's audit? 'move_on_record' when the account on the new number
 * was moved there from her old number, 'escalation_on_record' when this sender's change already waits on a person,
 * else null. Throws on a refused read.
 */
async function alreadyOnRecord(supabase, { user, target, fromPhone, toPhone }) {
  const { data, error } = await supabase.from('leader_roster_audit')
    .select('action, teacher_ext_id, detail, created_at')
    .eq('teacher_phone_e164', fromPhone)
    .in('action', ['edit_phone', 'edit_phone_escalated']);
  if (error) throw new Error(error.message || 'audit read refused');
  const now = Date.now();
  let found = null;
  for (const r of data || []) {
    const d = (r && r.detail) || {};
    if (d.to_phone !== toPhone) continue;
    if (r.action === 'edit_phone' && target && target.id && r.teacher_ext_id === target.id && d.from_phone === fromPhone) {
      return 'move_on_record';
    }
    if (r.action === 'edit_phone_escalated' && r.teacher_ext_id === user.id && d.via === VIA
        && now - utcMs(r.created_at) < RESEND_WINDOW_MS) found = 'escalation_on_record';
  }
  return found;
}

/**
 * Why this shell may NOT be folded, or null when it may: it must have been created at or after the change (the account
 * her new phone made), never have finished sign-up, and not itself be the sender of a number change that waits on a
 * person (folding it would retire the account that escalation names: a person settles both at once). A date that
 * cannot be read cannot clear it (fail closed).
 */
async function whyNotFold(supabase, target, changedAt) {
  const { data, error } = await supabase.from('users')
    .select('created_at, registration_completed').eq('id', target.id).maybeSingle();
  if (error) throw new Error(error.message || 'users read refused');
  const made = utcMs(data && data.created_at);
  if (!Number.isFinite(made) || !Number.isFinite(changedAt) || made < changedAt - CLOCK_GRACE_MS) return 'destination_predates_change';
  if (data.registration_completed === true) return 'destination_registered';
  const { data: open, error: openError } = await supabase.from('leader_roster_audit')
    .select('detail, created_at').eq('teacher_ext_id', target.id).eq('action', 'edit_phone_escalated');
  if (openError) throw new Error(openError.message || 'audit read refused');
  const now = Date.now();
  if ((open || []).some((r) => r && r.detail && r.detail.via === VIA && now - utcMs(r.created_at) < RESEND_WINDOW_MS)) {
    return 'destination_changed_again';
  }
  return null;
}

/**
 * The coach edit's audit row, written as her own change. Resolves true when the row was written (writeRosterAudit never
 * throws). A rejected row is logged with her keyed reference in place of the raw actor id the coach path logs.
 */
function audit(supabase, user, action, detail) {
  const C = _C();
  const person = { userId: user.id, phone: user.phone_number || null, name: user.name || null };
  const row = C.buildEditAuditRow(user.id, person, action, { via: VIA, ...detail });
  const log = (msg, data, level) => {
    const { actor_user_id: _raw, ...rest } = data || {};
    logToFile(msg, { ...rest, reason: (detail && detail.reason) || null, tk: IdentityEvents.ref(user.id) }, level);
  };
  return C.writeRosterAudit(supabase, { ...row, affected_leader_user_id: null }, log);
}

/** A person must finish a move that stopped half way: say so on the log (keyed references only). */
function logHalfFinished(user, step, retiredId, recorded) {
  try {
    logToFile('⚠️ number change half-finished - a person must finish it', {
      tk: IdentityEvents.ref(user.id), retiredTk: IdentityEvents.ref(retiredId), failedStep: step, recorded,
    }, 'error');
  } catch (_) { /* a broken logger never reaches the teacher */ }
}

/** Raise the coach edit's escalation; an escalation whose row was refused is failed, never escalated. */
async function escalate(out, supabase, user, toPhone, reason, extra = {}) {
  const recorded = await audit(supabase, user, 'edit_phone_escalated', { to_phone: toPhone, reason, ...extra });
  if (reason === 'move_incomplete') logHalfFinished(user, extra.failed_step, extra.retired_user_id, recorded);
  if (recorded) settle(out, 'escalated', reason);
  else settle(out, 'failed', 'escalation_unrecorded');
}

/**
 * Her number has moved: write the move's edit_phone row (with the change's own time, changed_at, which a later notice
 * is compared with), then escalate any step left behind (`left`: { failed_step, ... }) for a person. The outcome is the
 * move; the reason says what is left (move_incomplete), or that a row could not be written.
 */
async function recordMove(out, supabase, user, { fromPhone, toPhone, changedIso }, move, left) {
  const action = move.verdict === _E().CASE_SHELL ? 'folded' : 'moved';
  const detail = { ..._C().moveDetail(fromPhone, toPhone, move), changed_at: changedIso };
  const recorded = await audit(supabase, user, 'edit_phone', detail);
  if (left) {
    await escalate(out, supabase, user, toPhone, 'move_incomplete', { retired_user_id: move.retiredId || null, ...left });
    return settle(out, action, out.action === 'escalated' ? 'move_incomplete' : 'escalation_unrecorded');
  }
  return settle(out, action, recorded ? null : 'audit_unrecorded');
}

/** The gates, then the verdict. Fills `out` as it goes, so a failure part-way still reports what was known. */
async function decide(out, { message, user, signatureOk }, change) {
  const state = await require('../../config/feature-flags').metaNumberChangeState();
  if (state === 'off') return settle(out, 'skipped_flag_off', 'flag_off');
  if (state !== 'on') return settle(out, 'skipped_flag_unreadable', 'flag_unreadable');
  if (signatureOk !== true) return settle(out, 'skipped_unverified', 'signature_not_verified');
  const toPhone = change.newPhone;
  if (!toPhone) return settle(out, 'skipped_no_number', 'no_new_number');
  if (!user || !user.id) return settle(out, 'failed', 'no_account');

  const fromPhone = user.phone_number;
  if (digits(fromPhone) === toPhone) return settle(out, 'already_done', 'already_on_number');

  const supabase = _db();
  const changedAt = Number(message && message.timestamp) * 1000;
  const changedDate = new Date(changedAt);
  const changedIso = Number.isNaN(changedDate.getTime()) ? null : changedDate.toISOString();
  let later;
  try {
    later = await laterMoves(supabase, user.id, changedAt);
  } catch (err) {
    settle(out, 'failed', 'audit_unreadable');
    throw err;
  }
  if (later === 'stale') return settle(out, 'skipped_stale', 'notice_older_than_last_move');

  const C = _C();
  const E = _E();
  let target;
  try {
    target = await C.loadTargetWithHistory(toPhone);
  } catch (err) {
    out.verdict = 'unknown';
    settle(out, 'failed', 'lookup_failed');
    throw err;
  }
  out.verdict = E.classifyTarget(target);

  let onRecord;
  try {
    onRecord = await alreadyOnRecord(supabase, { user, target, fromPhone, toPhone });
  } catch (err) {
    settle(out, 'failed', 'audit_unreadable');
    throw err;
  }
  if (onRecord) return settle(out, 'already_done', onRecord);
  if (later === 'coach') return escalate(out, supabase, user, toPhone, 'notice_predates_coach_edit');

  const made = utcMs(user.created_at);
  if (Number.isFinite(made) && Number.isFinite(changedAt) && made >= changedAt - CLOCK_GRACE_MS) {
    return escalate(out, supabase, user, toPhone, 'sender_account_new');
  }
  if (out.verdict === E.CASE_TAKEN) return escalate(out, supabase, user, toPhone, 'destination_has_history');
  if (out.verdict === E.CASE_SHELL) {
    let why;
    try {
      why = await whyNotFold(supabase, target, changedAt);
    } catch (err) {
      settle(out, 'failed', 'lookup_failed');
      throw err;
    }
    if (why) return escalate(out, supabase, user, toPhone, why);
  }

  let awayLater;
  try {
    awayLater = await movedAwayLater(supabase, toPhone, changedAt);
  } catch (err) {
    settle(out, 'failed', 'audit_unreadable');
    throw err;
  }
  if (awayLater) return escalate(out, supabase, user, toPhone, 'destination_changed_again');

  const where = { fromPhone, toPhone, changedIso };
  let move;
  try {
    move = await C.moveNumber({ userId: user.id, fromPhone, toPhone, target, actor: VIA });
  } catch (err) {
    const at = (err && err.moveProgress) || {};
    if (at.step === 'visits' || at.step === 'reparent') {
      // Her number had already moved when this write threw: record the move, and the step that threw for a person.
      // A throw at the visits step means the shell's rows were never handed over either.
      swallow('identity.number_change_applied: move', err);
      return recordMove(out, supabase, user, where,
        { verdict: at.verdict, retiredId: at.retiredId, reparent: null, visitsFailed: at.step === 'visits' },
        { failed_step: at.step, ...(at.retiredId && at.step === 'visits' ? { not_run: ['reparent'] } : {}) });
    }
    if (at.retiredId) {
      swallow('identity.number_change_applied: move', err);
      return escalate(out, supabase, user, toPhone, 'move_incomplete', { retired_user_id: at.retiredId, failed_step: at.step });
    }
    settle(out, 'failed', 'error');
    throw err;
  }
  if (!move.ok) {
    if (move.retiredId) {
      return escalate(out, supabase, user, toPhone, 'move_incomplete', { retired_user_id: move.retiredId, failed_step: move.refused });
    }
    return settle(out, 'failed', `${move.refused || 'move'}_refused`);
  }

  const failedRows = (move.reparent && move.reparent.failed) || [];
  const left = [move.visitsFailed && 'visits', failedRows.length && 'reparent'].filter(Boolean);
  return recordMove(out, supabase, user, where, move, left.length
    ? { failed_step: left.join(','), ...(failedRows.length ? { reparent_failed: failedRows } : {}) }
    : null);
}

/**
 * Runs after identity-events.recordSystem for a `system` message. Never throws; sends nothing.
 * @param {{message: object, user: ?object, signatureOk: boolean}} args signatureOk: req.webhookSignatureOk === true
 */
async function applyNumberChange({ message, user, signatureOk } = {}) {
  let change = null;
  try { change = IdentityEvents.numberChangeOf(message); } catch (_) { change = null; }
  if (!change) return; // not a number change: the recorder has it, nothing moves

  const out = { verdict: null, action: 'failed', reason: 'error' };
  try {
    const id = user && user.id;
    await runAsActor(id, () => decide(out, { message, user, signatureOk }, change));
  } catch (err) {
    if (out.action !== 'failed') settle(out, 'failed', 'error');
    swallow('identity.number_change_applied', err);
  }
  try {
    StructuredLogger.logEvent('identity.number_change_applied', {
      tk: IdentityEvents.ref(user && user.id), verdict: out.verdict, action: out.action, reason: out.reason,
    });
  } catch (err) {
    swallow('identity.number_change_applied: log', err);
  }
}

module.exports = { applyNumberChange, ACTIONS, VIA };
