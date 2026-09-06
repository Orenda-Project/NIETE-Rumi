/**
 * lp612-edit-router — the one decision that closes the hole.
 *
 * THE HOLE. A teacher receives a 6-12 lesson and replies "make the homework shorter". Today that
 * message falls through roughly thirty-five branches of the text handler — the homework trigger
 * is whole-message anchored, the capability inquiry excludes "make", every conversation-state
 * branch is skipped because this lane sets no state — and lands in the general conversation path,
 * where a small model answers her without ever having seen her lesson. It reads like an answer.
 * That is why it was never reported as a bug.
 *
 * THE SHAPE OF THE FIX. This runs in front of that fall-through and answers three questions:
 *
 *   1. Is this even ours?  Only if she has a 6-12 lesson on the shelf. That single condition is
 *      the entire blast radius: a teacher who has not received one in 24 hours cannot tell this
 *      code exists.
 *   2. What did she mean?  Delegated to the classifier.
 *   3. Who should answer?  A QUESTION or a THANK-YOU is not ours. It falls through to the normal
 *      path — which is now grounded, because the delivery is on the shelf and `buildLpContext`
 *      can finally see it. Only an edit request or an out-of-scope ask is answered here.
 *
 * THE RETURN VALUE IS ASYMMETRIC ON PURPOSE. `true` means "handled, stop"; `false` means "carry
 * on exactly as before". Every degraded path — no shelf, no user, a classifier that throws, Redis
 * down — returns `false`, so the worst this can do is leave her with today's behaviour. A router
 * that fails toward `true` would swallow her message entirely, which is strictly worse than the
 * bug it replaces.
 */

const { logToFile } = require('../utils/logger');
const LPShelfService = require('./lp-shelf.service');
const WhatsAppService = require('./whatsapp.service');
const { resolveUx, clampLanguage } = require('../config/ux-strings');
const { classifyEditIntent } = require('./lp612-edit-intent.service');
const { isLp612EditEnabled } = require('../config/lp612-flags');

/** Only entries this lane wrote. `lane` is stamped by lp612-serving's recordDelivery, so this is
 *  a positive test rather than "a K-5 entry with fields missing", which would misfire the day
 *  K-5 stops setting one of them. */
function newestLp612Entry(shelf) {
  const ours = (Array.isArray(shelf) ? shelf : []).filter((e) => e && e.lane === 'lp612');
  return ours.length ? ours[ours.length - 1] : null;   // shelf is oldest → newest
}

/** Say it, and never let saying it break the caller. A send that fails must still count as
 *  handled: giving her a generic reply ON TOP of a failed honest one is the worse outcome. */
async function tell(phone, key, language) {
  try {
    await WhatsAppService.sendMessage(phone, resolveUx(key, { language }));
  } catch (err) {
    logToFile('LP 6-12 edit: could not send the reply', { key, error: err.message });
  }
}

/**
 * @param {object} args
 * @param {string} args.from         her WhatsApp number
 * @param {string} args.messageBody  her reply, verbatim
 * @param {object} args.user         needs `.id`
 * @param {string} [args.language]   her resolved UI language
 * @param {string} [args.correlationId]
 * @returns {Promise<boolean>} true = handled here, stop. false = carry on as before.
 */
async function maybeHandleLp612Reply({ from, messageBody, user, language, correlationId } = {}) {
  const userId = user && user.id;
  if (!userId || !String(messageBody || '').trim()) return false;

  let entry;
  try {
    entry = newestLp612Entry(await LPShelfService.getShelf(userId));
  } catch (err) {
    // Redis down. Not ours to fix and not worth her message: fall through.
    logToFile('LP 6-12 edit: shelf read failed — falling through', { userId, error: err.message });
    return false;
  }
  if (!entry) return false;

  const lang = clampLanguage(language || entry.lang);

  let verdict;
  try {
    verdict = await classifyEditIntent({ text: messageBody, language: lang, correlationId });
  } catch (err) {
    // The classifier already self-degrades to `question`; this catches the case where it throws
    // outright. Falling through leaves her with today's behaviour, which is the floor.
    logToFile('LP 6-12 edit: classifier threw — falling through', { userId, error: err.message });
    return false;
  }

  const kind = verdict && verdict.kind;

  // NOT OURS. A question about the lesson belongs to the conversation path, which is grounded now
  // that the delivery is on the shelf — answering it here with a form letter would be a
  // regression dressed as a feature. "Thanks" likewise deserves no reply from this code.
  if (kind === 'question' || kind === 'gratitude') return false;

  if (kind === 'out_of_scope') {
    logToFile('LP 6-12 edit: out-of-scope request answered honestly', {
      userId, segmentId: entry.segment_id, correlationId,
    });
    await tell(from, 'lp612EditOutOfScope', lang);
    return true;
  }

  if (kind === 'edit') {
    // The flag is off until the fork machinery lands. She is told it is NOT READY — deliberately
    // not the out-of-scope sentence, because what she asked for is exactly what this will do, and
    // telling her otherwise is a lie she would repeat to a colleague (rule 24(d): distinct state,
    // distinct sentence).
    if (!isLp612EditEnabled()) {
      logToFile('LP 6-12 edit: edit requested while the lane is off', {
        userId, segmentId: entry.segment_id, correlationId,
      });
      await tell(from, 'lp612EditNotYet', lang);
      return true;
    }

    // Phase 2 hooks in here: fork the persisted lp_doc, run the constrained revision round, gate
    // it, and deliver HER copy. Until that exists the flag above is the only thing standing in
    // front of this line, which is why it defaults to off.
    logToFile('LP 6-12 edit: edit lane enabled but not yet implemented — holding', {
      userId, segmentId: entry.segment_id, correlationId,
    });
    await tell(from, 'lp612EditNotYet', lang);
    return true;
  }

  // An unrecognised verdict cannot reach here (the classifier closes its own set), but if one
  // ever does, the safe move is the one that changes nothing.
  return false;
}

module.exports = { maybeHandleLp612Reply, newestLp612Entry };
