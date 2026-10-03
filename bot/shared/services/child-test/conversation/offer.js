'use strict';

/**
 * "Test 5 children now? About 25 minutes" — the child-test offer at the end of an observation
 * (after the /observe2 brief, and after classic /observe delivers the teacher's report).
 *
 * Its own small module on purpose: the observe code that calls it must not pull in the
 * conversation machine (which reaches the menu, which reaches observe again — a require cycle).
 * Gated here (CHILD_TEST_ENABLED + coach role + ICT), so callers just call it. Never throws.
 *
 * Buttons: ctst_offer:<kind>:<id> / ctst_later:<kind>:<id>; kind 'f' = observe2 field form,
 * 's' = classic /observe coaching session.
 */

const supabase = require('../../../config/supabase');
const WhatsAppService = require('../../whatsapp.service');
const { logToFile, logError } = require('../../../utils/logger');
const { isChildTestAvailable, isObserveLinkOn } = require('./gate');
const { langOf, t, clip } = require('./copy');

/** → true when the offer was sent. */
async function sendOffer({ coachUserId, kind = 'f', id }) {
  if (!isObserveLinkOn()) return false;   // kept separate from the observation (gate.js)
  try {
    const { data: coach } = await supabase.from('users')
      .select('id, role, region, preferred_language, phone_number').eq('id', coachUserId).maybeSingle();
    if (!coach || !coach.phone_number || !isChildTestAvailable(coach)) return false;
    const lang = langOf(coach);
    const ok = await WhatsAppService.sendInteractiveButtons(coach.phone_number, {
      body: t(lang, 'childTestOfferBody'),
      buttons: [
        { id: `ctst_offer:${kind}:${id}`, title: clip(t(lang, 'childTestOfferYes'), 20) },
        { id: `ctst_later:${kind}:${id}`, title: clip(t(lang, 'childTestOfferLater'), 20) },
      ],
    });
    if (ok === false) { logError('child_test.offer_send_failed', { coachUserId, kind, id }); return false; }
    logToFile('child_test.offer_sent', { coachUserId, kind, id });
    return true;
  } catch (err) {
    logError('child_test.offer_failed', { coachUserId, kind, id, error: err.message });
    return false;
  }
}

module.exports = { sendOffer };
