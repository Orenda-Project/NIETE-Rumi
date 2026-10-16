'use strict';
/**
 * THE registration Flow invite — the one way any door sends the form.
 *
 * Before this there were four senders and four behaviours. /register sent the Flow with the
 * bare user id as its token and English copy; sendNameQuestion sent a second hand-rolled
 * copy; the "register" keyword branch sent no Flow at all ("I'll ask for your name after you
 * try one of my features!"); and nothing offered the form to a new person — in production
 * (2026-10-16) 6,376 adults had messaged the bot and never registered.
 *
 * What this owns:
 *   - THE TOKEN, "<userId>:registration:<ts>". The registration endpoint reads the user id
 *     before the first colon; the completion is recognised by ":registration:"
 *     (utils/flow-type-detector.js). The endpoint's INIT pre-fills from the users row, so
 *     nothing else rides in the token.
 *   - THE COPY, in her language (en/ur, English floor) from the ux-strings catalog: a new
 *     person, a registered teacher updating her details, or an unregistered person who
 *     reached a feature that needs her school.
 *   - ONCE-ONLY. users.registration_started_at is the moment the form was first offered
 *     (an existing column, empty on production until now — no schema change). The
 *     first-reply and after-feature offers claim it with a conditional update, so two doors
 *     racing (her first message and the lesson plan that lands a minute later) send it once.
 *     Explicit requests (/register, "Register me", /portal, a school feature) always send.
 *   - NEVER SILENT. A refused send gets her a line to retry with /register and logs at
 *     error; a deployment with no Flow configured says registration is not available.
 */
const supabase = require('../config/supabase');
const WhatsAppService = require('./whatsapp.service');
const { logToFile, logError } = require('../utils/logger');
const { resolveUx, clampLanguage } = require('../config/ux-strings');
const { isRegistered } = require('../utils/registration-status');

const VARIANTS = Object.freeze(['new', 'update', 'school']);

const IDENTITY_COLUMNS = 'id, name, registration_completed, registration_state, registration_started_at';

// Catalog KEYS (ux-strings.js), not copy. Named *Key so the language audit's cap scan, which
// reads `header: '…'` / `button: '…'` literals as WhatsApp text, measures the copy, not these.
const COPY_KEYS = {
  new: { headerKey: 'registrationInviteNewHeader', bodyKey: 'registrationInviteNewBody', buttonKey: 'registrationInviteButton' },
  update: { headerKey: 'registrationInviteUpdateHeader', bodyKey: 'registrationInviteUpdateBody', buttonKey: 'registrationInviteUpdateButton' },
  school: { headerKey: 'registrationInviteSchoolHeader', bodyKey: 'registrationInviteSchoolBody', buttonKey: 'registrationInviteButton' },
};

/** The registration Flow's token. Every sender builds it here. */
function registrationFlowToken(userId, now = Date.now()) {
  return `${userId}:registration:${now}`;
}

/** The invite's words for one case, in one language. Pure. */
function inviteCopy({ variant, language }) {
  const keys = COPY_KEYS[variant] || COPY_KEYS.new;
  const lang = clampLanguage(language);
  return {
    header: resolveUx(keys.headerKey, { language: lang }),
    body: resolveUx(keys.bodyKey, { language: lang }),
    buttonText: resolveUx(keys.buttonKey, { language: lang }),
  };
}

/** The one-line text she gets when no Flow can be shown. kind: 'retry' | 'unavailable'. */
function fallbackText({ kind, language }) {
  return resolveUx(kind === 'unavailable' ? 'registrationInviteUnavailable' : 'registrationInviteRetry', {
    language: clampLanguage(language),
  });
}

function hasIdentityFields(user) {
  return ['name', 'registration_completed', 'registration_state'].every((f) => f in user);
}

/** The account as the database has it now; the caller's copy when the read fails. */
async function readAccount(user) {
  try {
    const { data, error } = await supabase.from('users').select(IDENTITY_COLUMNS).eq('id', user.id).maybeSingle();
    if (error || !data) return null;
    return { ...user, ...data };
  } catch (_) {
    return null;
  }
}

function variantFor(account, reason) {
  if (isRegistered(account)) return 'update';
  return reason === 'school_feature' ? 'school' : 'new';
}

/** Stamp "first offered" if it is not set yet. Best effort: the send already happened. */
async function stampFirstOffer(userId) {
  try {
    await supabase.from('users')
      .update({ registration_started_at: new Date().toISOString() })
      .eq('id', userId)
      .is('registration_started_at', null);
  } catch (err) {
    logToFile('⚠️ registration invite: could not stamp the first offer (non-fatal)', { userId, error: err.message }, 'warn');
  }
}

async function sayFallback(phone, kind, language) {
  try {
    await WhatsAppService.sendMessage(phone, fallbackText({ kind, language }));
  } catch (err) {
    logError('❌ registration invite: fallback line could not be sent', { error: err.message });
  }
}

/**
 * Send the registration Flow now.
 *
 * @param {object} args
 * @param {object|null} args.user   the users row, or at least { id }
 * @param {string} args.phone       her WhatsApp number
 * @param {string} [args.language]  the language to address her in (clamped to en/ur)
 * @param {string} [args.reason]    which door: register_command | register_intent | portal |
 *                                  school_feature | first_reply | after_first_feature | …
 * @returns {Promise<boolean>} true when the Flow was sent
 */
async function sendRegistrationInvite({ user, phone, language, reason = 'unspecified' } = {}) {
  const lang = clampLanguage(language || (user && user.preferred_language));
  const flowId = process.env.REGISTRATION_FLOW_ID || '';

  if (!flowId) {
    logError('❌ registration invite: REGISTRATION_FLOW_ID is unset — no form to send', { reason, userId: user && user.id });
    await sayFallback(phone, 'unavailable', lang);
    return false;
  }
  if (!user || !user.id) {
    // No account id means the lookup failed: a token built from a phone number cannot be
    // written to any row, so the form would lose every answer. Ask her to try again.
    logError('❌ registration invite: no account id — not sending a Flow that cannot be saved', { reason });
    await sayFallback(phone, 'retry', lang);
    return false;
  }

  const account = hasIdentityFields(user) ? user : ((await readAccount(user)) || user);
  const variant = variantFor(account, reason);
  const copy = inviteCopy({ variant, language: lang });

  let sent = false;
  try {
    sent = (await WhatsAppService.sendFlow(phone, {
      flowId,
      flowToken: registrationFlowToken(user.id),
      header: copy.header,
      body: copy.body,
      buttonText: copy.buttonText,
    })) !== false;
  } catch (err) {
    sent = false;
    logError('❌ registration invite: sendFlow threw', { userId: user.id, reason, error: err.message });
  }

  if (!sent) {
    logError('❌ registration invite: the Flow was refused — told her to retry with /register', { userId: user.id, reason, variant, language: lang });
    await sayFallback(phone, 'retry', lang);
    return false;
  }

  logToFile('📝 registration invite sent', { userId: user.id, reason, variant, language: lang });
  if (!account.registration_started_at) await stampFirstOffer(user.id);
  return true;
}

/**
 * Offer the form once, unprompted — after her first reply, or after a feature is delivered.
 * Never to a registered teacher; never twice; never two doors at once.
 *
 * @returns {Promise<boolean>} true when this call sent it
 */
async function offerRegistrationOnce({ user, phone, language, reason = 'unspecified' } = {}) {
  if (!user || !user.id || !process.env.REGISTRATION_FLOW_ID) return false;

  const account = await readAccount(user);
  if (!account) return false; // cannot tell — do not risk offering a registered teacher the form
  if (isRegistered(account) || account.registration_started_at) return false;

  // Claim the offer. Only the call that flips NULL → now sends it.
  const claimedAt = new Date().toISOString();
  let claimed = false;
  try {
    const { data, error } = await supabase.from('users')
      .update({ registration_started_at: claimedAt })
      .eq('id', user.id)
      .is('registration_started_at', null)
      .select('id');
    if (error) {
      logToFile('⚠️ registration offer: claim refused (not offered)', { userId: user.id, error: error.message }, 'warn');
      return false;
    }
    claimed = Array.isArray(data) && data.length > 0;
  } catch (err) {
    logToFile('⚠️ registration offer: claim failed (non-fatal, not offered)', { userId: user.id, error: err.message }, 'warn');
    return false;
  }
  if (!claimed) return false;

  const sent = await sendRegistrationInvite({
    user: { ...account, registration_started_at: claimedAt }, phone, language, reason,
  });
  if (!sent) {
    // Release the claim, so a later message can offer it once it can be delivered.
    try {
      await supabase.from('users').update({ registration_started_at: null }).eq('id', user.id);
    } catch (_) { /* best effort */ }
  }
  return sent;
}

module.exports = {
  sendRegistrationInvite,
  offerRegistrationOnce,
  registrationFlowToken,
  inviteCopy,
  fallbackText,
  VARIANTS,
};
