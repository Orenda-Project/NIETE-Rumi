'use strict';
/**
 * "Keep my place" — a way back from every outcome (app_settings web_quiz_bind_way_back, default OFF; effective only
 * with the phone-bind switch on). Off → every function answers null/false and the caller's path is today's.
 *
 * Today a family who sends the JUGNU- code from WhatsApp is left in the chat: only a saved place gets a reply with a
 * button back to the child's page; five refusals get no reply at all, and a teacher's phone or a full phone gets a
 * line with no button. And the page keeps what happened only in that one browser tab, so every other link the family
 * opens shows the card again, even for a child already saved, or on a phone already refused.
 *
 *   reply({phone, reason, code, row, user, asked, language, now})   the binder's ONE reply for an outcome it used to
 *                                leave silent (or line-only): its line, and, when the code was minted for a known child
 *                                in the last day, the button to that child's page (`row: null` → never a button). Counted
 *                                on the ledger before it is sent (the per-phone daily cap still applies). → true when
 *                                handled (sent or capped), false when the switch is off (the caller does today's thing).
 *   alreadySaved({phone, norm, row, resolveChild, ...})   a spent code that saved THIS phone's place, still active (the
 *                                family sent it twice) → the saved reply again (true); else false.
 *   cardState({canonicalId, device, now})   the card's `bind.state` for this child on this device, from the newest code
 *                                this device minted for the child (never from the browser tab): 'bound' — the place is
 *                                saved by that code and still active (no card) · 'refused' + reason — this phone was
 *                                refused (teacher's phone, four children, three phones) in the last 7 days (no card) ·
 *                                'pending' — a live code not sent yet (the card) · 'none' — anything else (the card).
 *                                null when the switch is off or the child/device is unknown (today's card, no state).
 *                                The device ref decides only whether a card is drawn, never who a child is.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');

const KEY = 'web_quiz_bind_way_back';
const TTL_MS = 30 * 1000;
const LINK_WINDOW_MS = 24 * 60 * 60 * 1000;      // a code minted in the last day carries the button to its child's page
const REFUSED_HIDE_MS = 7 * 24 * 60 * 60 * 1000; // a refused phone sees no card for a week (the same week as "Not now")
const PAGE_REFUSALS = new Set(['teacher_phone', 'max_kids', 'max_phones']);
// outcome → [line key, ledger trigger]
const LINES = Object.freeze({
  teacher_phone: ['jugnuBindTeacherRefused', 'teacher_refusal'],
  max_kids: ['jugnuBindFullRefused', 'bind_reply'],
  max_phones: ['jugnuBindPhonesRefused', 'bind_reply'],
  code_expired: ['jugnuBindCodeOld', 'bind_reply'],
  code_used: ['jugnuBindCodeOld', 'bind_reply'],
  code_unknown: ['jugnuBindCodeUnknown', 'bind_reply'],
  child_unknown: ['jugnuBindCodeUnknown', 'bind_reply'],
});

let cache = null; // { at, on }

function isTrue(v) {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { /* plain string */ } }
  return x === true || (typeof x === 'string' && x.trim().toLowerCase() === 'true');
}

/** The switch, with the phone-bind switch as its parent; 30 s cache; a failed read → off. Never throws. */
async function on(now = Date.now()) {
  try {
    if (!(await require('./web-quiz-identity-flags').flags()).phoneBind) return false;
    if (cache && now - cache.at < TTL_MS) return cache.on;
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === KEY);
    cache = { at: now, on: Boolean(row && isTrue(row.value)) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ keep my place way back: switch read failed — off', { error: err.message });
    return false;
  }
}

const ms = (t) => { const n = Date.parse(t); return Number.isFinite(n) ? n : null; };

/** The child's page for a code minted in the last day; else null. */
async function pageFor(row, now) {
  const minted = row && ms(row.minted_at);
  if (!row || !row.canonical_id || minted === null || new Date(now).getTime() - minted > LINK_WINDOW_MS) return null;
  return require('./web-quiz-hub-flags').hubLink([String(row.canonical_id)], 'bind');
}

async function send(phone, key, language, url) {
  const WhatsAppService = require('../whatsapp.service');
  const body = resolveUx(key, { language });
  try {
    if (url && await WhatsAppService.sendCtaUrl(phone, { body, buttonText: resolveUx('jugnuBindOpenBtn', { language }), url })) return true;
  } catch (err) {
    logToFile('⚠️ keep my place way back: link send failed', { error: err.message });
  }
  try {
    return Boolean(await WhatsAppService.sendMessage(phone, body));
  } catch (err) {
    logToFile('⚠️ keep my place way back: reply failed', { error: err.message });
    return false;
  }
}

async function reply({ phone, reason, code = null, row, user = null, asked = null, language = null, now = new Date() } = {}) {
  try {
    const line = LINES[reason];
    if (!line || !(await on())) return false;
    const [key, trigger] = line;
    // `row` undefined → the code's row is read here (only with the switch on); null → no child to link to
    const r = row === undefined && code ? await require('./child-bind-codes.repo').get(code) : (row || null);
    const named = typeof language === 'function' ? await language(r) : language;
    const lang = clampLanguage(asked || named || (user && (user.personaLanguage || user.preferred_language)) || 'en');
    const Ledger = require('./message-ledger');
    const recipient = trigger === 'teacher_refusal' ? 'teacher' : 'family';
    if (await Ledger.record({ trigger, recipient, phone, reason, now })) await send(phone, key, lang, await pageFor(r, now));
    return true;
  } catch (err) {
    logToFile('⚠️ keep my place way back: reply threw', { error: err.message });
    return false;
  }
}

async function cardState({ canonicalId, device, now = new Date() } = {}) {
  try {
    const dev = require('./web-quiz-token').cleanDeviceRef(device);
    if (!canonicalId || !dev || !(await on())) return null;
    const { data, error } = await supabase.from('child_bind_codes').select('code, canonical_id, minted_at, expires_at, used_at, outcome')
      .eq('canonical_id', String(canonicalId)).eq('device_ref', dev).order('minted_at', { ascending: false }).limit(1);
    if (error) throw new Error(error.message || 'read failed');
    const row = (data || [])[0];
    const t = new Date(now).getTime();
    if (!row) return { state: 'none' };
    if (!row.used_at) return ms(row.expires_at) > t ? { state: 'pending' } : { state: 'none' };
    if (row.outcome === 'bound') {
      const Bindings = require('./child-phone-bindings.repo');
      const active = (await Bindings.activeForChild(String(canonicalId), now)) || [];
      return active.some((b) => String(b.code_id || '') === row.code) ? { state: 'bound' } : { state: 'none' };
    }
    if (PAGE_REFUSALS.has(row.outcome)) {
      return t - (ms(row.used_at) || 0) > REFUSED_HIDE_MS ? { state: 'none' } : { state: 'refused', reason: row.outcome };
    }
    return { state: 'none' };
  } catch (err) {
    logToFile('⚠️ keep my place way back: card state failed — today\'s card', { error: err.message });
    return null;
  }
}

/** A spent code whose binding is THIS phone's, still active → the saved reply again (the family sent it twice). */
async function alreadySaved({ phone, norm, row, resolveChild, user = null, asked = null, now = new Date(), sendSaved, languageFor } = {}) {
  try {
    if (!row || row.outcome !== 'bound' || !(await on())) return false;
    const child = await resolveChild();
    if (!child) return false;
    const Bindings = require('./child-phone-bindings.repo');
    const mine = ((await Bindings.activeForPhone(norm, now)) || []).find((b) => String(b.canonical_id) === String(child.id));
    if (!mine) return false;
    const kids = await Bindings.childrenForPhone(phone);
    const lang = await languageFor(child, user, asked);
    const Ledger = require('./message-ledger');
    if (await Ledger.record({ trigger: 'bind_reply', phone, reason: 'already', now })) await sendSaved(phone, kids.length ? kids : [{ id: child.id }], child, lang);
    return true;
  } catch (err) {
    logToFile('⚠️ keep my place way back: already-saved reply threw', { error: err.message });
    return false;
  }
}

module.exports = { on, reply, cardState, alreadySaved, KEY, LINES, LINK_WINDOW_MS, REFUSED_HIDE_MS, _resetCache: () => { cache = null; } };
