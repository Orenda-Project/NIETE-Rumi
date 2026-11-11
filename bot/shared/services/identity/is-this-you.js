'use strict';
/**
 * "Is this you?" at sign-up. After "Pick your school", a v6 form asks a first-time registrant about ONE other live
 * account at that school with her normalised name, when that account is unused or silent. Her answer is acted on at
 * Finish (settle), in the request that completes her sign-up:
 *   yes, every claim condition holds  -> claim: her number moves onto that account (teacher-edit-commit moveNumber,
 *                                        actor 'registration_claim'); the account her phone made is retired
 *   any other yes, or not sure        -> review: nothing moves; the coach edit's escalation row
 *   no                                -> nothing
 * Never throws. Logs registration.is_this_you with keyed references (tk), never a phone number, a name or a raw id.
 */
const StructuredLogger = require('../../utils/structured-logger');
const { logToFile } = require('../../utils/logger');
const { runAsActor } = require('../../utils/actor-context');
const IdentityEvents = require('./identity-events');
const { utcMs } = require('./number-change');
const { isAdminRole } = require('../../config/registration-roles');

const VIA = 'registration_claim';
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_DAYS = 30;            // the cleanup's own line for "chatted recently"
const ASKS_PER_DAY = 3;
const NEW_ACCOUNT_MS = 10 * 60 * 1000;
const WRITE_BUDGET_MS = 4000;      // Meta gives the endpoint about 10 s
const REVIEW_REPEAT_DAYS = 7;
const CANDIDATE_COLS = 'id, name, phone_number, role, school_id, is_test_user, deleted_at, registration_completed, '
  + 'first_message_at, last_message_at, portal_last_login';
const ME_COLS = 'id, phone_number, is_test_user, deleted_at, deleted_by, registration_completed, created_at, first_message_at';

const _db = () => require('../../config/supabase');
const _C = () => require('../observe/teacher-edit-commit.service');
const _E = () => require('../observe/teacher-edit.service');
const _redis = () => require('../cache/railway-redis.service');
const _flags = () => require('../../config/feature-flags');

const lastTwo = (phone) => { const d = String(phone || '').replace(/\D+/g, ''); return d.length >= 10 ? d.slice(-2) : null; };
const isActive = (c) => [c.last_message_at, c.portal_last_login]
  .some((t) => t && Date.now() - utcMs(t) < ACTIVE_DAYS * DAY_MS);
const madeByFirstMessage = (me) => Boolean(me.first_message_at)
  && Math.abs(utcMs(me.first_message_at) - utcMs(me.created_at)) <= NEW_ACCOUNT_MS;

function log(fields) { try { StructuredLogger.logEvent('registration.is_this_you', fields); } catch (_) { /* never */ } }
function swallow(where, err) {
  try { logToFile('⚠️ is-this-you skipped', { where, error: (err && err.message) || String(err) }, 'warn'); } catch (_) { /* never */ }
}

async function row(db, id, cols) {
  const { data, error } = await db.from('users').select(cols).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message || 'users read refused');
  return data || null;
}
async function count(db, table, userId) {
  const { count: n, error } = await db.from(table).select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (error) throw new Error(error.message || `${table} read refused`);
  return n || 0;
}
async function isUnused(db, c) {
  if (c.registration_completed === true || c.first_message_at || c.last_message_at || c.portal_last_login) return false;
  try {
    const [chats, plans] = await Promise.all([count(db, 'chat_sessions', c.id), count(db, 'lesson_plans', c.id)]);
    return chats === 0 && plans === 0;
  } catch (_) { return false; }   // unknown is not unused
}

/** At SCHOOL_PICK: { ask: true, state, candidate: { id, last2 } } or { ask: false, why }. Reads only. */
async function offer({ userId, schoolId, fullName }) {
  let out = { ask: false, why: 'unreadable' };
  let candidate = null;
  try {
    if (!(await _flags().isRegistrationIsThisYouEnabled(userId))) { out = { ask: false, why: 'flag_off' }; return out; }  // no event
    const db = _db();
    const me = await row(db, userId, ME_COLS);
    if (!me || me.deleted_at) return out;
    if (me.registration_completed === true) { out.why = 'already_registered'; return out; }
    const peers = await IdentityEvents.sameNameAtSchool(db, { userId, schoolId, name: fullName, cols: CANDIDATE_COLS });
    if (peers === null) return out;
    const same = peers.filter((p) => Boolean(p.is_test_user) === Boolean(me.is_test_user));
    if (same.length !== 1) { out.why = same.length ? 'several' : 'no_match'; return out; }
    [candidate] = same;
    if (isActive(candidate)) { out.why = 'active'; return out; }
    const redis = _redis();
    if (!redis.isAvailable()) return out;
    if (!(await redis.checkRateLimit(`reg_itu:${userId}`, ASKS_PER_DAY, DAY_MS / 1000)).allowed) {
      out.why = 'rate_limited';
      return out;
    }
    const state = (await isUnused(db, candidate)) ? 'unused' : 'silent';
    out = { ask: true, why: null, state, candidate: { id: candidate.id, last2: lastTwo(candidate.phone_number) } };
    return out;
  } catch (err) {
    swallow('offer', err);
    out = { ask: false, why: 'unreadable' };
    return out;
  } finally {
    if (out.why !== 'flag_off') {
      log({ tk: IdentityEvents.ref(userId), step: 'offer', outcome: out.ask ? 'asked' : 'not_asked', why: out.why,
        state: out.state || null, candidateTk: IdentityEvents.ref(candidate && candidate.id) });
    }
  }
}

/** At IS_THIS_YOU: the answer, counted. Nothing is written. */
function recordAnswer(userId, itu, answer) {
  log({ tk: IdentityEvents.ref(userId), step: 'answer', outcome: answer, candidateTk: IdentityEvents.ref(itu && itu.candidateId) });
}

function audit(db, me, c, action, detail) {
  const C = _C();
  const person = { userId: c.id, phone: c.phone_number || null, name: c.name || null };
  const r = C.buildEditAuditRow(me.id, person, action, { via: VIA, ...detail });
  return C.writeRosterAudit(db, { ...r, affected_leader_user_id: null });
}
async function onRecord(db, filters, sinceMs) {
  let q = db.from('leader_roster_audit').select('id').gte('created_at', new Date(Date.now() - sinceMs).toISOString());
  for (const [col, val] of filters) q = q.eq(col, val);
  const { data, error } = await q.limit(1);
  if (error) throw new Error(error.message || 'audit read refused');
  return Array.isArray(data) && data.length > 0;
}
async function review(out, db, { me, c, itu }, why) {
  const seen = await onRecord(db, [['action', 'edit_phone_escalated'], ['actor_user_id', me.id], ['teacher_ext_id', c.id],
    ['detail->>via', VIA]], REVIEW_REPEAT_DAYS * DAY_MS).catch(() => false);
  if (!seen) await audit(db, me, c, 'edit_phone_escalated', { to_phone: me.phone_number, reason: why, school_id: itu.schoolId });
  Object.assign(out, { identity: 'review', why });
}

/** A Finish that already claimed (a retry, or another request that held the lock) left her account retired by us. */
function claimedAlready(out, me, itu) {
  if (!me || me.deleted_by !== VIA) return false;
  Object.assign(out, { ownerId: itu.candidateId, identity: 'claimed', why: 'already_done' });
  return true;
}

async function decide(out, { userId, stored, itu, signatureOk, startedAt }) {
  const db = _db();
  const C = _C();
  const E = _E();
  const me = await row(db, userId, ME_COLS);
  if (!me) throw new Error('her row is unreadable');                      // settle reports it as failed
  if (claimedAlready(out, me, itu)) return;
  if (me.deleted_at || me.registration_completed === true) { out.why = 'already_done'; return; }
  if (!(await _flags().isRegistrationIsThisYouEnabled(userId))) { out.why = 'flag_off'; return; }

  // The account she answered about, re-read: the world can move between the question and Finish.
  const c = await row(db, itu.candidateId, CANDIDATE_COLS);
  const same = c && !c.deleted_at && IdentityEvents.isLiveNumber(c.phone_number) && c.school_id === itu.schoolId
    && IdentityEvents.normaliseName(c.name) === IdentityEvents.normaliseName(stored.full_name)
    && Boolean(c.is_test_user) === Boolean(me.is_test_user);
  if (!same) { out.why = 'changed'; return; }
  const ctx = { me, c, itu };
  if (itu.answer === 'not_sure') return review(out, db, ctx, 'not_sure');
  if (signatureOk !== true) return review(out, db, ctx, 'unverified');
  if (isActive(c)) return review(out, db, ctx, 'record_active');
  if (isAdminRole(c.role)) return review(out, db, ctx, 'record_admin_role');
  if (!(await isUnused(db, c))) return review(out, db, ctx, 'record_used');
  if (E.classifyTarget(await C.loadTargetWithHistory(c.phone_number)) !== E.CASE_SHELL) return review(out, db, ctx, 'record_has_history');
  if (!madeByFirstMessage(me)) return review(out, db, ctx, 'account_not_new');
  const n2 = await onRecord(db, [['detail->>via', 'meta_number_change'], ['detail->>to_phone', me.phone_number]], DAY_MS)
    .catch(() => true);   // unreadable counts as on record
  if (n2) return review(out, db, ctx, 'number_change_pending');
  if (Date.now() - startedAt > WRITE_BUDGET_MS) return review(out, db, ctx, 'slow');

  const target = await C.loadTargetWithHistory(me.phone_number);           // her own account, with its history counts
  if (!target || target.id !== me.id) { out.why = 'changed'; return; }
  const move = await C.moveNumber({ userId: c.id, fromPhone: c.phone_number, toPhone: me.phone_number, target, actor: VIA });
  if (!move.ok) {
    if (move.reason === 'taken') return review(out, db, ctx, 'account_has_history');
    out.why = 'move_failed';
    return;
  }
  await audit(db, me, c, 'edit_phone', { ...C.moveDetail(c.phone_number, me.phone_number, move), school_id: itu.schoolId });
  // The retired account keeps its school otherwise, and the coach's picker (patch-resolver) does not skip retired rows.
  await db.from('users').update({ school_id: null }).eq('id', me.id).eq('deleted_by', VIA);
  Object.assign(out, { ownerId: c.id, identity: 'claimed', why: null });
}

/**
 * At Finish. { ownerId, identity: 'claimed' | 'review' | 'none', why }. ownerId is the account the rest of the sign-up
 * writes to: the claimed account after a claim, else hers. A second Finish while one settles waits for the lock once;
 * whether it then gets the lock or not, it re-reads her row, and if the first one claimed it hands back the claimed
 * account, so nothing is ever written to the retired one. Never throws.
 */
async function settle({ userId, stored, signatureOk, startedAt = Date.now() }) {
  const itu = stored && stored.itu;
  const out = { ownerId: userId, identity: 'none', why: null };
  if (!itu || !itu.candidateId) return out;                             // never asked: no event
  const redis = _redis();
  const lockId = `${userId}:${startedAt}`;
  let locked = false;
  try {
    if (itu.answer !== 'yes' && itu.answer !== 'not_sure') { out.why = itu.answer ? 'declined' : 'unanswered'; return out; }
    locked = await redis.acquireLock(`reg_itu:${userId}`, lockId, 60);
    if (!locked) {
      await new Promise((r) => setTimeout(r, 1500));
      locked = await redis.acquireLock(`reg_itu:${userId}`, lockId, 60);
      if (!locked) {
        if (!claimedAlready(out, await row(_db(), userId, ME_COLS), itu)) out.why = 'busy';
        return out;
      }
    }
    await runAsActor(userId, () => decide(out, { userId, stored, itu, signatureOk, startedAt }));
    return out;
  } catch (err) {
    swallow('settle', err);
    if (out.identity !== 'claimed') Object.assign(out, { identity: 'none', why: out.why || 'failed' });
    return out;
  } finally {
    if (locked) await redis.releaseLock(`reg_itu:${userId}`, lockId).catch(() => {});
    log({ tk: IdentityEvents.ref(userId), step: 'settle', outcome: out.identity, why: out.why,
      candidateTk: IdentityEvents.ref(itu.candidateId), durationMs: Date.now() - startedAt });
  }
}

module.exports = { offer, recordAnswer, settle, VIA, ACTIVE_DAYS, ASKS_PER_DAY };
