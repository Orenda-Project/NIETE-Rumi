'use strict';
/**
 * The phone binder: a family's WhatsApp message carrying a `JUGNU-` code saves a child's place on that phone,
 * and a whole-message STOP erases every place saved on it. Behind web_quiz_phone_bind (every entry reads it;
 * off → null / false, and the caller's path is today's). Never throws.
 *
 * handleCode: refusals in this order, each tested on its own —
 *   teacher_phone · code_unknown · code_used · code_expired · child_unknown · max_phones · max_kids
 *   A teacher's phone gets ONE refusal line (ledger teacher_refusal); a full phone gets ONE line (ledger bind_reply);
 *   the other refusals have no bot copy, so the binder stays silent (the page shows the state).
 *   Every reply is counted on the ledger BEFORE it is sent, with the phone (the per-phone daily reply cap): a
 *   reply over the cap is not sent.
 * Bound (new, renewed or a re-bind): the code is spent, the door's cached verdict is dropped, and ONE reply is
 * sent: the saved line with a button to the phone's children's page.
 *
 * Every write or erase ends in forgetDoorVerdict(raw, phone_norm), never the bare cache forget.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const IdFlags = require('./web-quiz-identity-flags');
const BindRepo = require('./child-phone-bindings.repo');
const Codes = require('./child-bind-codes.repo');
const StudentIdentity = require('./student-identity.service');
const Ledger = require('./message-ledger');
const K = require('./web-quiz-kid');

const MAX_PHONES_PER_CHILD = 3;
const MAX_KIDS_PER_PHONE = require('./web-quiz-token').HUB_MAX_KIDS;
const STOP_WORDS = new Set(['stop', 'بند', 'سٹاپ', 'اسٹاپ']);

/** A whole message, trimmed and case-folded, that is exactly one of the four STOP spellings. */
function isStop(body) {
  return STOP_WORDS.has(String(body || '').trim().toLowerCase());
}

/** hex(HMAC-SHA256(WEB_QUIZ_KID_KEY, 'ukey|'+phone_norm))[0:16]; null without the key or a phone. */
/** The unknown phone's event key (the repo computes it, so the ledger can key its cap without requiring this module). */
const ukeyOf = (phoneNorm) => BindRepo.ukeyOf(phoneNorm);

async function on() {
  try { return Boolean((await IdFlags.flags()).phoneBind); } catch (_) { return false; }
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

async function forgetPhone(raw, norm, why) {
  await StudentIdentity.forgetDoorVerdict(raw, norm);
  logEvent('student_ingress.cache_forget', { why, n: 1, w: 's' });
}

async function sendText(to, key, language, params) {
  const WhatsAppService = require('../whatsapp.service');
  try {
    return Boolean(await WhatsAppService.sendMessage(to, resolveUx(key, { language, params })));
  } catch (err) {
    logToFile('⚠️ phone binder: reply failed', { error: err.message });
    return false;
  }
}

/**
 * Events v2 (web_quiz_events_v2, read fail-closed): the binder's events carry the envelope {w, ev_v, kid_v, kid}
 * with the child's keyed kid (null when no child is known), never a phone, a code or a session id (EVENTS §4).
 * With the switch off the event is today's, byte for byte.
 */
async function emit(name, fields, canonicalId = null) {
  let v2 = false;
  try { v2 = await require('./web-quiz-hub-flags').eventsV2On(); } catch (_) { v2 = false; }
  logEvent(name, v2 ? K.envelope({ kid: canonicalId ? K.kid(canonicalId) : null, ...fields }) : { ...fields, w: 's' });
}

async function refused(reason, extra = {}, canonicalId = null) {
  await emit('web_quiz.bind_refused', { reason, ...extra }, canonicalId);
  return { ok: false, outcome: 'refused', reason };
}

/** The candidate child after the one-hop fold, if that row is an active, unmerged student; else null. */
async function liveChild(canonicalId) {
  const canon = await require('./web-quiz-identity-roster').canonicalStudentIds([String(canonicalId)]);
  const id = canon.get(String(canonicalId)) || String(canonicalId);
  const { data, error } = await supabase.from('students').select('id, student_name, is_active, status').eq('id', id).maybeSingle();
  if (error || !data || data.is_active === false || data.status === 'merged') return null;
  return { id: String(data.id), name: data.student_name };
}

/**
 * The erased row a re-bind points at: the newest erased row of THIS child on the phone's tombstone; else the
 * newest erased row of any child on it; else null.
 */
async function priorOnPhone(norm, childId) {
  const tomb = BindRepo.tombOf(norm);
  if (!tomb) return null;
  try {
    const { data, error } = await supabase.from('child_phone_bindings').select('id, canonical_id, revoked_at, revoked_by')
      .eq('phone_tomb', tomb).eq('canonical_id', String(childId)).not('revoked_at', 'is', null)
      .order('revoked_at', { ascending: false }).limit(1);
    if (!error && data && data[0]) return data[0];
  } catch (_) { /* any child's */ }
  return BindRepo.findByTomb(tomb);
}

/** The child's language (their quizzes', skipping lesson codes), else the user's, else English. */
async function languageFor(child, user) {
  try {
    const SQ = require('./student-quiz.service');
    const lang = SQ.childLanguage(await SQ.quizzesForStudents([{ id: child.id, student_name: child.name }]));
    if (lang) return lang;
  } catch (_) { /* the user's */ }
  return clampLanguage((user && (user.personaLanguage || user.preferred_language)) || 'en');
}

/** The saved reply: ONE cta_url message to the phone's children's page; the plain line when no link or the send fails. */
async function sendSaved(phone, kids, child, language) {
  const WhatsAppService = require('../whatsapp.service');
  const body = resolveUx('jugnuBindSaved', { language, params: { name: firstName(child.name) } });
  const url = await require('./web-quiz-hub-flags').hubLink(kids.map((k) => k.id), 'bind');
  let sent = false;
  if (url) {
    try {
      // ≤ 20 code points
      sent = Boolean(await WhatsAppService.sendCtaUrl(phone, { body, buttonText: resolveUx('jugnuBindOpenBtn', { language }), url }));
    } catch (err) {
      logToFile('⚠️ phone binder: link send failed', { error: err.message });
    }
  }
  if (!sent) sent = await sendText(phone, 'jugnuBindSaved', language, { name: firstName(child.name) });
  return sent;
}

/**
 * A `JUGNU-` message. → null when the switch is off or the body holds no code (not handled); else the outcome
 * ({ok:true, outcome:'bound', ...} | {ok:false, outcome:'refused', reason} | {ok:false, outcome:'error'}) — the
 * message is handled either way (a reply was sent, or silence was chosen).
 * @param {{phone:string, body:string, user?:object, mode?:'teacher'|'student'|'unknown', now?:Date}} p
 */
async function handleCode({ phone, body, user = null, mode = 'unknown', now = new Date() } = {}) {
  try {
    if (!(await on())) return null;
    const code = Codes.parseCode(body);
    if (!code) return null;
    const norm = StudentIdentity.normalisePhone(phone);
    if (!norm) return null;

    if (mode === 'teacher') {
      await Codes.markUsed(code, 'teacher_phone', now);
      const out = await refused('teacher_phone');
      const lang = clampLanguage((user && user.preferred_language) || 'en');
      // counted first (the per-phone reply cap); sent only when the ledger says so
      if (await Ledger.record({ trigger: 'teacher_refusal', recipient: 'teacher', phone, reason: 'teacher_phone', now })) {
        await sendText(phone, 'jugnuBindTeacherRefused', lang);
      }
      return out;
    }

    const row = await Codes.get(code);
    if (!row) return refused('code_unknown');
    if (row.used_at) return refused('code_used', {}, row.canonical_id);
    if (!row.expires_at || new Date(row.expires_at).getTime() <= new Date(now).getTime()) {
      await Codes.markUsed(code, 'code_expired', now);
      return refused('code_expired', {}, row.canonical_id);
    }
    const child = await liveChild(row.canonical_id);
    if (!child) {
      await Codes.markUsed(code, 'child_unknown', now);
      return refused('child_unknown');
    }

    const phones = await BindRepo.activeForChild(child.id, now);
    if (phones.length >= MAX_PHONES_PER_CHILD && !phones.some((b) => b.phone_norm === norm)) {
      await Codes.markUsed(code, 'max_phones', now);
      return refused('max_phones', {}, child.id);
    }
    const set = await BindRepo.childrenForPhone(phone);
    const inSet = set.some((k) => String(k.id) === child.id);
    if (!inSet && set.length >= MAX_KIDS_PER_PHONE) {
      await Codes.markUsed(code, 'max_kids', now);
      const out = await refused('max_kids', { kids_n: set.length }, child.id);
      const lang = await languageFor(child, user);
      if (await Ledger.record({ trigger: 'bind_reply', phone, reason: 'max_kids', now })) await sendText(phone, 'jugnuBindFullRefused', lang);
      return out;
    }

    // Bind: renew this phone's binding of the child, else a new row (a re-bind when the phone's tombstone matches).
    const mine = (await BindRepo.activeForPhone(norm, now)).find((b) => String(b.canonical_id) === child.id);
    let binding = null;
    let renewed = false;
    let rebind = false;
    let rebindPrior = null;
    if (mine) {
      binding = await BindRepo.renew(mine.id, BindRepo.expiresAtFor(now), now, code);
      renewed = Boolean(binding);
    } else {
      const prior = await priorOnPhone(norm, child.id);
      binding = await BindRepo.insert({
        canonicalId: child.id, phoneNorm: norm, via: 'save', confirmedAt: now, codeId: code,
        expiresAt: BindRepo.expiresAtFor(now), rebindOf: prior ? prior.id : null,
      });
      if (binding && prior) { rebind = true; rebindPrior = prior.revoked_by || null; }
    }
    if (!binding) {
      // nothing happened, so nothing is promised: no reply, the code stays unspent for a retry
      const reason = BindRepo.tombOf(norm) ? 'db_error' : 'no_salt';
      logToFile('❌ phone binder: binding not written — the code stays unspent', { reason }, 'error');
      logEvent('web_quiz.bind_write_failed', { reason, w: 's' });
      return { ok: false, outcome: 'error', reason };
    }
    await Codes.markUsed(code, 'bound', now);
    await forgetPhone(phone, norm, 'bind');
    const kids = await BindRepo.childrenForPhone(phone);
    const ev = { via: 'save', kids_n: kids.length, renewed, rebind };
    if (rebind && rebindPrior) ev.rebind_prior = rebindPrior;
    await emit('web_quiz.bind_bound', ev, child.id);

    const lang = await languageFor(child, user);
    if (await Ledger.record({ trigger: 'bind_reply', phone, reason: renewed ? 'renew' : 'bind', now })) await sendSaved(phone, kids.length ? kids : [{ id: child.id }], child, lang);
    return { ok: true, outcome: 'bound', bindingId: binding.id, canonicalId: child.id, renewed, rebind };
  } catch (err) {
    logToFile('⚠️ phone binder: code handling threw (silent)', { error: err.message });
    return { ok: false, outcome: 'error' };
  }
}

/**
 * STOP: erase every binding on this phone, ask for the erased children's kept readings to be purged, drop the
 * door's cached verdict, and send ONE reply. → { n, children } or null when the switch is off.
 * There is no per-child kept-audio delete in the code today: the purge is requested in the log only (audio_n 0).
 */
async function handleStop({ phone, user = null, persona = null, now = new Date() } = {}) {
  try {
    if (!(await on())) return null;
    const norm = StudentIdentity.normalisePhone(phone);
    if (!norm) return null;
    const erased = await BindRepo.eraseAllForPhone(norm, 'stop', now);
    const perChild = new Map();
    erased.forEach((r) => perChild.set(String(r.canonical_id), (perChild.get(String(r.canonical_id)) || 0) + 1));
    if (perChild.size) logEvent('web_quiz.audio_purge_requested', { n: perChild.size, reason: 'stop', w: 's' });
    await forgetPhone(phone, norm, 'stop');
    for (const [childId, n] of perChild) await emit('web_quiz.bind_undo', { via: 'stop', n, audio_n: 0 }, childId);
    const lang = clampLanguage((user && (user.personaLanguage || user.preferred_language)) || 'en');
    const key = erased.length ? 'jugnuBindStopped' : 'jugnuBindStopNothing';
    if (await Ledger.record({ trigger: 'bind_reply', recipient: persona === 'teacher' ? 'teacher' : 'family', phone, reason: erased.length ? 'stop' : 'stop_nothing', now })) {
      await sendText(phone, key, lang);
    }
    return { n: erased.length, children: perChild.size };
  } catch (err) {
    logToFile('⚠️ phone binder: STOP threw', { error: err.message });
    return { n: 0, children: 0 };
  }
}

/** Does this phone hold any binding row (kept on the phone, or erased with its tombstone)? */
async function hasAnyBinding(norm) {
  try {
    const { data, error } = await supabase.from('child_phone_bindings').select('id').eq('phone_norm', norm).is('revoked_at', null).limit(1);
    if (!error && data && data.length) return true;
  } catch (_) { /* towards "none" */ }
  return Boolean(await BindRepo.findByTomb(BindRepo.tombOf(norm)));
}

/**
 * A STOP from a phone that is not a child persona (a teacher, an unknown phone): handled only when the switch is
 * on AND the phone holds at least one binding row; otherwise false and the message goes on untouched.
 */
async function stopForBoundNonChild({ from, body, user = null, persona = null } = {}) {
  try {
    if (!isStop(body) || !(await on())) return false;
    const norm = StudentIdentity.normalisePhone(from);
    if (!norm || !(await hasAnyBinding(norm))) return false;
    // a quiz, a join or a post-quiz chat in flight keeps its own "stop"
    if (await require('../student-ingress').quizInFlight(from)) return false;
    await handleStop({ phone: from, user, persona });
    return true;
  } catch (err) {
    logToFile('⚠️ phone binder: non-child STOP check threw (untouched)', { error: err.message });
    return false;
  }
}

module.exports = {
  handleCode, handleStop, stopForBoundNonChild, isStop, ukeyOf,
  STOP_WORDS, MAX_PHONES_PER_CHILD, MAX_KIDS_PER_PHONE,
};
