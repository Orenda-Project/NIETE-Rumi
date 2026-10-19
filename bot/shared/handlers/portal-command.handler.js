/**
 * Portal Command Handler — /portal opens the portal, already signed in (bd-x7aprz.3).
 *
 * A registered adult gets ONE message: a short line and a button whose link is her signed /go link
 * (services/app-login-link.js — her user id, encrypted, 24 h, re-tappable). The portal turns it into a
 * session and lands her on her home (dashboard/routes/app-login.routes.js). No password, no set-up step.
 *
 * What this replaced: a 7-day set-up link (portal-invite.service) for anyone without a password, and
 * "log in with the password you created" for the rest. 170 teachers who registered on the form let the
 * set-up link lapse and then met "No account found" on the portal; 3,075 were told to log in with a
 * password they never made.
 *
 * Someone NOT registered is routed to the registration form by the text handler before this runs; if one
 * reaches it anyway, she is asked to register and gets no link.
 */

const WhatsAppService = require('../services/whatsapp.service');
const { signAppLink } = require('../services/app-login-link');
const { isRegistered } = require('../utils/registration-status');
const { logToFile } = require('../utils/logger');
const { portalUrl: getPortalUrl } = require('../config/branding');

// en + ur only (NIETE's flat offer). The button is a cta_url display text: 20 code points at most.
// NIETE stays Latin inside the Urdu line, isolated (LRI … PDI) so it cannot reorder the sentence.
const COPY = Object.freeze({
  en: {
    body: 'Open your NIETE portal. This link works for 24 hours.',
    button: 'Open portal',
    unavailable: 'Sorry, the portal link is not available right now. Please try again in a few minutes.',
    registerFirst: 'Please register first. Type /register to get started.',
  },
  ur: {
    body: 'اپنا ⁦NIETE⁩ پورٹل کھولیں۔ یہ لنک ۲۴ گھنٹے چلتا ہے۔',
    button: 'پورٹل کھولیں',
    unavailable: 'معذرت، پورٹل کا لنک ابھی دستیاب نہیں۔ براہ کرم کچھ منٹ بعد دوبارہ کوشش کریں۔',
    registerFirst: 'براہ کرم پہلے رجسٹریشن مکمل کریں۔ ⁦/register⁩ ٹائپ کریں۔',
  },
});

// Her stored language when it is one of the two this catalog has; anything else reads English.
const copyFor = (language) => COPY[language] || COPY.en;

/**
 * Handle /portal.
 *
 * @param {object} user - the users row (id, name, registration_completed, registration_state, preferred_language)
 * @param {string} phoneNumber - her WhatsApp number, digits only with the 92 prefix
 * @returns {Promise<string>} '' when this handler sent the message itself, else the text for the caller to send
 */
async function handlePortalCommand(user, phoneNumber) {
  const words = copyFor(user && user.preferred_language);
  try {
    if (!isRegistered(user)) {
      logToFile('📱 /portal from someone not registered — asked to register, no link', { userId: user && user.id });
      return words.registerFirst;
    }

    const base = String(getPortalUrl() || '').replace(/\/+$/, '');
    const token = base ? signAppLink(user.id, 'menu') : null;
    if (!token) {
      logToFile('❌ /portal: no portal URL or signing key on this deployment — no link sent', { userId: user.id }, 'error');
      return words.unavailable;
    }
    const url = `${base}/go/${token}`;

    // The button is the nicer form; if Meta refuses it, the same link goes as text. The token is the
    // credential: it is never logged.
    let sent = await WhatsAppService.sendCtaUrl(phoneNumber, { body: words.body, buttonText: words.button, url });
    let via = 'cta_url';
    if (!sent) {
      via = 'text';
      sent = await WhatsAppService.sendMessage(phoneNumber, `${words.body}\n${url}`);
    }
    if (!sent) {
      logToFile('❌ /portal: sign-in link not delivered', { userId: user.id }, 'error');
      return words.unavailable;
    }
    logToFile('🔗 /portal: sign-in link sent', { userId: user.id, via });
    return '';
  } catch (error) {
    logToFile('❌ Error in handlePortalCommand', {
      userId: user && user.id,
      error: error.message,
      stack: error.stack,
    }, 'error');
    return words.unavailable;
  }
}

module.exports = { handlePortalCommand };
