'use strict';
/**
 * The maker cta's refused-send fallback message and its one send (the words and the buttons only). A leaf: it requires
 * nothing that reaches the menu, so the cta can call it without a require loop back through the /quiz list.
 * maker.fallback.js re-exports these and keeps what the three buttons do when tapped.
 */
const { logToFile } = require('../../utils/logger');
const { clampLanguage } = require('../../config/ux-strings');
const Strings = require('./maker.fallback.strings');

const IDS = Object.freeze({ QUIZ: 'ft_fb_quiz', LP: 'ft_fb_lp', COACH: 'ft_fb_coach' });
const ALL_IDS = Object.freeze([IDS.QUIZ, IDS.LP, IDS.COACH]);

/** → { body, buttons } for who × lang. Pure. */
function fallbackMessage({ lang, who = 'unknown' } = {}) {
  const bi = lang === 'bi' && who !== 'known';
  const l = bi ? 'bi' : clampLanguage(lang === 'bi' ? 'ur' : lang);
  let bodyId;
  if (who === 'known') bodyId = 'maker.fallback.body.known';
  else if (bi) bodyId = 'maker.fallback.body.unknown.bi';
  else bodyId = who === 'door' ? 'maker.fallback.body' : 'maker.fallback.body.unknown';
  const btn = (n) => Strings.str(`maker.fallback.btn${n}${bi ? '.bi' : ''}`, l);
  return {
    body: Strings.str(bodyId, l),
    buttons: [{ id: IDS.QUIZ, title: btn(1) }, { id: IDS.LP, title: btn(2) }, { id: IDS.COACH, title: btn(3) }],
  };
}

/** ONE reply-buttons send; no ledger row (the caller's maker_reply is this reply). → the send's boolean. Never throws. */
async function sendFallback({ phone, lang, who = 'unknown' } = {}) {
  try {
    const WhatsAppService = require('../whatsapp.service');
    return Boolean(await WhatsAppService.sendInteractiveButtons(phone, fallbackMessage({ lang, who })));
  } catch (err) {
    logToFile('⚠️ first touch: the maker fallback send threw', { error: err && err.message });
    return false;
  }
}

module.exports = { IDS, ALL_IDS, fallbackMessage, sendFallback };
