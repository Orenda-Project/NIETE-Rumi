'use strict';
/**
 * Identity events: three things the bot could not see, recorded and never acted on.
 *
 *   identity.number_changed       WhatsApp says a teacher moved to a new number (`user_changed_number`: the sender is
 *                                 the OLD number, `system.wa_id` the new one) or to a new user id
 *                                 (`user_changed_user_id`, no number). Recorded with what a move WOULD do, using the
 *                                 coach phone edit's own read-only steps: free, shell or taken.
 *   identity.deleted_row_resumed  A soft-deleted account, found by its number, was served as live again. Once per
 *                                 account per process: the lookup runs on every message.
 *   registration.would_match      A finished sign-up sits next to another live account with the same school and the
 *                                 same name. Once per account per process: a sign-up can finish in more than one place.
 *
 * Log only: no reply, no write. Every function swallows its own failure, so a hook can never change what the teacher
 * sees, and the callers fire it without waiting. Events carry a teacher's keyed reference (`tk`, the HMAC of users.id
 * that every NIETE log line uses instead of the raw id), counts and verdicts: never a raw id, a phone number or a name.
 * Without the key on the service a reference is null and the event is still counted.
 */
const StructuredLogger = require('../../utils/structured-logger');
const { logToFile } = require('../../utils/logger');

const NUMBER_CHANGE_TYPES = new Set(['user_changed_number', 'customer_changed_number']);
const USER_ID_CHANGE_TYPES = new Set(['user_changed_user_id']);
const SEEN_CAP = 10000;
const resumedSeen = new Set();
const matchSeen = new Set();

/** A teacher's keyed reference for a log line; null without the key. Never throws. */
function ref(userId) {
  try {
    return userId ? require('../quiz/web-quiz-kid').tk(userId) : null;
  } catch (_) {
    return null;
  }
}

function swallow(where, err) {
  try {
    logToFile('⚠️ identity event skipped', { where, error: (err && err.message) || String(err) }, 'warn');
  } catch (_) { /* a broken logger never reaches the teacher */ }
}

/** Remember an id; false when it was already there. The set is bounded so a long-lived process cannot grow it. */
function firstTime(seen, id) {
  if (seen.has(id)) return false;
  if (seen.size >= SEEN_CAP) seen.clear();
  seen.add(id);
  return true;
}

const digits = (v) => String(v == null ? '' : v).replace(/\D+/g, '');

/**
 * Lower case, every combining mark dropped (Latin accents and Urdu/Arabic vowel marks alike, so "مُحَمَّد" is
 * "محمد"), anything else that is not a letter or digit to one space.
 */
function normaliseName(raw) {
  return String(raw == null ? '' : raw).normalize('NFKD').replace(/\p{M}+/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** A retired or merged number is a closed account, not a second live one. */
function isLiveNumber(phone) {
  const s = String(phone == null ? '' : phone);
  return s !== '' && !s.startsWith('retired:') && !s.startsWith('merged:');
}

/** What moving to this number would do: the coach phone edit's own two read-only steps. */
async function wouldMoveTo(phone) {
  const { loadTargetWithHistory } = require('../observe/teacher-edit-commit.service');
  const { classifyTarget } = require('../observe/teacher-edit.service');
  const target = await loadTargetWithHistory(phone);
  return { verdict: classifyTarget(target), targetId: (target && target.id) || null };
}

/** A `system` message from the webhook. Never throws. */
async function recordSystem({ message, user } = {}) {
  try {
    const s = (message && message.system) || {};
    const isNumber = NUMBER_CHANGE_TYPES.has(s.type);
    if (!isNumber && !USER_ID_CHANGE_TYPES.has(s.type)) return;

    let verdict = isNumber ? 'no_new_number' : 'user_id_only';
    let targetId = null;
    const newPhone = isNumber ? digits(s.wa_id || s.new_wa_id) : '';
    if (newPhone) {
      try {
        ({ verdict, targetId } = await wouldMoveTo(newPhone));
      } catch (err) {
        verdict = 'unknown';
        swallow('identity.number_changed: lookup', err);
      }
    }
    StructuredLogger.logEvent('identity.number_changed', {
      tk: ref(user && user.id), type: s.type, verdict, targetTk: ref(targetId),
    });
  } catch (err) {
    swallow('identity.number_changed', err);
  }
}

/** getOrCreateUser found a row with deleted_at set. Never throws. */
function deletedRowResumed(userId) {
  try {
    if (!userId || !firstTime(resumedSeen, userId)) return;
    StructuredLogger.logEvent('identity.deleted_row_resumed', { tk: ref(userId) });
  } catch (err) {
    swallow('identity.deleted_row_resumed', err);
  }
}

/** A sign-up just finished: is there another live account with her school and her name? Never throws. */
async function checkWouldMatch(userId, source) {
  try {
    if (!userId || !firstTime(matchSeen, userId)) return;
    const supabase = require('../../config/supabase');
    const { data: me, error } = await supabase.from('users')
      .select('id, name, school_id').eq('id', userId).maybeSingle();
    if (error || !me || !me.school_id) return;
    const name = normaliseName(me.name);
    if (!name) return;

    const { data: peers, error: peersError } = await supabase.from('users')
      .select('id, name, phone_number, deleted_at, registration_completed, last_message_at')
      .eq('school_id', me.school_id)
      .neq('id', userId)
      .is('deleted_at', null);
    if (peersError || !Array.isArray(peers)) return;

    const matches = peers.filter((p) => p && p.id !== userId && !p.deleted_at
      && isLiveNumber(p.phone_number) && normaliseName(p.name) === name);
    if (!matches.length) return;
    StructuredLogger.logEvent('registration.would_match', {
      tk: ref(userId),
      source: source || null,
      matchCount: matches.length,
      matchTks: matches.slice(0, 5).map((p) => ref(p.id)),
      matchesRegistered: matches.filter((p) => p.registration_completed === true).length,
      matchesEverMessaged: matches.filter((p) => Boolean(p.last_message_at)).length,
    });
  } catch (err) {
    swallow('registration.would_match', err);
  }
}

module.exports = { recordSystem, deletedRowResumed, checkWouldMatch, normaliseName };
