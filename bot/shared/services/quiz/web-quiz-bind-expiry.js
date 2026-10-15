'use strict';
/**
 * The end of a family phone binding (table child_phone_bindings).
 *
 * expireBindings(now) — the daily job's one call:
 *   (a) every active row with expires_at < now is ERASED: phone_norm = NULL, revoked_at = now, revoked_by = 'expiry'
 *       (the row keeps only phone_tomb; the phones are read first so their door verdicts can be dropped);
 *   (b) every erased row with revoked_at < now − 13 months is DELETED (a newer row's rebind_of pointing at it is
 *       cleared first: the column has no ON DELETE rule);
 *   (c) forgetDoorVerdict for each distinct phone of (a) + student_ingress.cache_forget{why:'expire', n};
 *   (d) web_quiz.bind_expired{n} and web_quiz.bind_rows_deleted{n}, once per run.
 *   → {expired, deleted, phones} (counts only). Never throws: a failed step counts 0 and logs a line.
 *   Retention holds whatever the switches say: a row written while web_quiz_phone_bind was on still expires
 *   and is still deleted after it is turned off.
 *
 * renewOnPlay({canonicalId, phoneNorm, playedAt}) — a stop finished as a bound child on that phone:
 *   the pair's active binding gets expires_at = expiresAtFor(playedAt) and last_played_at = playedAt.
 *   → the renewed row, or null (switch off, no such binding, a failed write).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const IdFlags = require('./web-quiz-identity-flags');
const BindRepo = require('./child-phone-bindings.repo');
const StudentIdentity = require('./student-identity.service');

const TABLE = BindRepo.TABLE;
const KEEP_ERASED_MONTHS = 13;
const CHUNK = 200;

const chunks = (xs) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));

async function must(label, build) {
  const { data, error } = await build();
  if (error) throw new Error(`${label}: ${error.message || 'failed'}`);
  return data || [];
}

/** (a) + (c): erase the bindings past their expiry → {expired, phones}. */
async function eraseExpired(nowIso) {
  const due = await must('expiry read', () => supabase.from(TABLE).select('id, phone_norm')
    .not('phone_norm', 'is', null).is('revoked_at', null).lt('expires_at', nowIso));
  if (!due.length) return { expired: 0, phones: 0 };
  const phoneOf = new Map(due.map((r) => [String(r.id), r.phone_norm]));
  const erased = [];
  for (const ids of chunks([...phoneOf.keys()])) {
    erased.push(...await must('expiry erase', () => supabase.from(TABLE)
      .update({ phone_norm: null, revoked_at: nowIso, revoked_by: 'expiry' })
      .in('id', ids).is('revoked_at', null).select('id')));
  }
  const phones = [...new Set(erased.map((r) => phoneOf.get(String(r.id))).filter(Boolean))];
  if (phones.length) {
    await StudentIdentity.forgetDoorVerdict(...phones);
    logEvent('student_ingress.cache_forget', { why: 'expire', n: phones.length, w: 's' });
  }
  return { expired: erased.length, phones: phones.length };
}

/** (b): delete erased rows kept past 13 months → the count deleted. */
async function deleteOldErased(now) {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - KEEP_ERASED_MONTHS);
  const old = await must('retention read', () => supabase.from(TABLE).select('id')
    .not('revoked_at', 'is', null).lt('revoked_at', cutoff.toISOString()));
  if (!old.length) return 0;
  let deleted = 0;
  for (const ids of chunks(old.map((r) => String(r.id)))) {
    await must('retention unlink', () => supabase.from(TABLE).update({ rebind_of: null }).in('rebind_of', ids).select('id'));
    deleted += (await must('retention delete', () => supabase.from(TABLE).delete()
      .in('id', ids).not('revoked_at', 'is', null).lt('revoked_at', cutoff.toISOString()).select('id'))).length;
  }
  return deleted;
}

async function expireBindings(now = new Date()) {
  const at = new Date(now);
  let expired = 0;
  let phones = 0;
  let deleted = 0;
  try {
    ({ expired, phones } = await eraseExpired(at.toISOString()));
  } catch (err) {
    logToFile('⚠️ binding expiry: erase failed — nothing expired this run', { error: err.message });
  }
  try {
    deleted = await deleteOldErased(at);
  } catch (err) {
    logToFile('⚠️ binding expiry: 13-month delete failed — nothing deleted this run', { error: err.message });
  }
  try {
    logEvent('web_quiz.bind_expired', { n: expired, w: 's' });
    logEvent('web_quiz.bind_rows_deleted', { n: deleted, w: 's' });
  } catch (_) { /* counts are still returned */ }
  return { expired, deleted, phones };
}

async function renewOnPlay({ canonicalId, phoneNorm, playedAt = new Date() } = {}) {
  try {
    if (!canonicalId || !phoneNorm || !(await IdFlags.flags()).phoneBind) return null;
    const at = new Date(playedAt);
    const b = (await BindRepo.activeForPhone(phoneNorm, at)).find((r) => String(r.canonical_id) === String(canonicalId));
    if (!b) return null;
    return await BindRepo.renew(b.id, BindRepo.expiresAtFor(at), at);
  } catch (err) {
    logToFile('⚠️ binding expiry: renew on play failed', { error: err.message });
    return null;
  }
}

module.exports = { expireBindings, renewOnPlay, KEEP_ERASED_MONTHS };
