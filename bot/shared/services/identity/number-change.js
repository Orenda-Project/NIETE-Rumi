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
 *   shell  the empty account there is retired (merged:<id>), its rows follow her, she moves → folded
 *   taken  nothing moves; the coach edit's escalation is raised for a person             → escalated
 *          (a leader_roster_audit edit_phone_escalated row, the queue a human works)
 * No person is in this loop, so it is stricter than the coach screen in one place: a "shell" OLDER than her own
 * account is not the account her new phone made (it was there before her), so it is escalated, never folded.
 *
 * IDEMPOTENT, because Meta can resend. A resend comes from the OLD number again, where (once she has moved)
 * getOrCreateUser finds nothing and makes a new, empty account; folding the real teacher into that would be the worst
 * outcome there is. So nothing is written, and the action is already_done, when:
 *   - she is already on the new number;
 *   - the account on her old number was made by this notice (created after the change, with a minute's grace for the
 *     two clocks): it is not the account that changed number;
 *   - the change is already on record: the account on the new number was moved there from the old one (an edit_phone
 *     audit row, by a coach or by this), or this change already waits on a person (its escalation, within the day the
 *     webhook still accepts a resend in).
 *
 * Every move and escalation leaves the coach edit's audit row, written as her own change: she is the actor (she changed
 * her number), no coach's roster is affected, detail.via is 'meta_number_change'; its writes run as her too
 * (actor-context), so the history ledger names her. Sends nothing; adds no table or column. Never throws.
 *
 * Logs identity.number_change_applied { tk, verdict, action }: tk is her keyed reference (identity-events.ref),
 * verdict the coach edit's for the new number (null when this did not classify it, 'unknown' when it could not be
 * read), action one of ACTIONS. Never a phone number, a name or a raw id.
 */
const StructuredLogger = require('../../utils/structured-logger');
const { logToFile } = require('../../utils/logger');
const { runAsActor } = require('../../utils/actor-context');
const IdentityEvents = require('./identity-events');

const VIA = 'meta_number_change';
const ACTIONS = Object.freeze([
  'moved', 'folded', 'escalated', 'skipped_flag_off', 'skipped_unverified', 'skipped_no_number', 'already_done', 'failed',
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

/** Her account was made at, or after, the change: the notice made it, so it is not the account that moved. */
function madeByTheNotice(user, message) {
  const made = utcMs(user.created_at);
  const changed = Number(message && message.timestamp) * 1000;
  return Number.isFinite(made) && Number.isFinite(changed) && changed > 0 && made >= changed - CLOCK_GRACE_MS;
}

/** The change is already on record in the coach edit's audit: moved there from her old number, or waiting on a person. */
async function alreadyOnRecord(supabase, { user, target, fromPhone, toPhone }) {
  const { data, error } = await supabase.from('leader_roster_audit')
    .select('action, teacher_ext_id, detail, created_at')
    .eq('teacher_phone_e164', fromPhone)
    .in('action', ['edit_phone', 'edit_phone_escalated']);
  if (error) throw new Error(error.message || 'audit read refused');
  const now = Date.now();
  return (data || []).some((r) => {
    const d = (r && r.detail) || {};
    if (d.to_phone !== toPhone) return false;
    if (r.action === 'edit_phone') return Boolean(target && target.id) && r.teacher_ext_id === target.id && d.from_phone === fromPhone;
    return r.teacher_ext_id === user.id && d.via === VIA && now - utcMs(r.created_at) < RESEND_WINDOW_MS;
  });
}

/** The account on the new number was there before hers. Unreadable dates cannot clear it (fail closed: escalate). */
async function olderThanHers(supabase, target, user) {
  const { data, error } = await supabase.from('users').select('created_at').eq('id', target.id).maybeSingle();
  if (error) throw new Error(error.message || 'users read refused');
  const theirs = utcMs(data && data.created_at);
  const hers = utcMs(user.created_at);
  return !Number.isFinite(theirs) || !Number.isFinite(hers) || theirs < hers;
}

/**
 * The coach edit's audit row, written as her own change. Never throws (writeRosterAudit). A rejected row is logged with
 * her keyed reference in place of the raw actor id the coach path logs.
 */
function audit(supabase, user, action, detail) {
  const C = _C();
  const person = { userId: user.id, phone: user.phone_number || null, name: user.name || null };
  const row = C.buildEditAuditRow(user.id, person, action, { via: VIA, ...detail });
  const log = (msg, data, level) => {
    const { actor_user_id: _raw, ...rest } = data || {};
    logToFile(msg, { ...rest, tk: IdentityEvents.ref(user.id) }, level);
  };
  return C.writeRosterAudit(supabase, { ...row, affected_leader_user_id: null }, log);
}

/** The gates, then the verdict. Fills `out` as it goes, so a failure part-way still reports what was known. */
async function decide(out, { message, user, signatureOk }, change) {
  const enabled = await require('../../config/feature-flags').isMetaNumberChangeEnabled();
  if (!enabled) { out.action = 'skipped_flag_off'; return; }
  if (signatureOk !== true) { out.action = 'skipped_unverified'; return; }
  const toPhone = change.newPhone;
  if (!toPhone) { out.action = 'skipped_no_number'; return; }
  if (!user || !user.id) return; // no account to move: failed

  const fromPhone = user.phone_number;
  if (digits(fromPhone) === toPhone || madeByTheNotice(user, message)) { out.action = 'already_done'; return; }

  const C = _C();
  const E = _E();
  const supabase = _db();
  let target;
  try {
    target = await C.loadTargetWithHistory(toPhone);
  } catch (err) {
    out.verdict = 'unknown';
    throw err;
  }
  out.verdict = E.classifyTarget(target);

  if (await alreadyOnRecord(supabase, { user, target, fromPhone, toPhone })) { out.action = 'already_done'; return; }

  const older = out.verdict === E.CASE_SHELL && await olderThanHers(supabase, target, user);
  if (out.verdict === E.CASE_TAKEN || older) {
    await audit(supabase, user, 'edit_phone_escalated', {
      to_phone: toPhone, reason: older ? 'destination_older_than_account' : 'destination_has_history',
    });
    out.action = 'escalated';
    return;
  }

  const move = await C.moveNumber({ userId: user.id, fromPhone, toPhone, target, actor: VIA });
  if (!move.ok) return; // failed: a refused write stops the move where it stood
  await audit(supabase, user, 'edit_phone', C.moveDetail(fromPhone, toPhone, move));
  out.action = move.verdict === E.CASE_SHELL ? 'folded' : 'moved';
}

/**
 * Runs after identity-events.recordSystem for a `system` message. Never throws; sends nothing.
 * @param {{message: object, user: ?object, signatureOk: boolean}} args signatureOk: req.webhookSignatureOk === true
 */
async function applyNumberChange({ message, user, signatureOk } = {}) {
  let change = null;
  try { change = IdentityEvents.numberChangeOf(message); } catch (_) { change = null; }
  if (!change) return; // not a number change: the recorder has it, nothing moves

  const out = { verdict: null, action: 'failed' };
  try {
    const id = user && user.id;
    await runAsActor(id, () => decide(out, { message, user, signatureOk }, change));
  } catch (err) {
    out.action = 'failed';
    swallow('identity.number_change_applied', err);
  }
  try {
    StructuredLogger.logEvent('identity.number_change_applied', {
      tk: IdentityEvents.ref(user && user.id), verdict: out.verdict, action: out.action,
    });
  } catch (err) {
    swallow('identity.number_change_applied: log', err);
  }
}

module.exports = { applyNumberChange, ACTIONS, VIA };
