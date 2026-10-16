'use strict';
/**
 * The maker cta's refused-send fallback, and what its three buttons do when tapped.
 *
 * sendFallback — when the cta_url send is refused (sent:false), the SAME inbound gets ONE reply-buttons message
 * instead: a body chosen by who the phone is, and three buttons (Ready quiz · Lesson plan · Record a lesson). It writes
 * NO ledger row: the caller (makerCta) already recorded `maker_reply` before the cta, and the fallback is that same
 * counted reply, not a second one.
 *
 *   who 'known'   → maker.fallback.body.known    a registered teacher with no lesson (the empty /quiz line); no undo line
 *   who 'door'    → maker.fallback.body          the door's teacher key, not registered; the undo line above "Pick one:"
 *   who 'unknown' → maker.fallback.body.unknown  a never-met phone; the undo line above "Pick one to start:"
 *   lang 'bi'     → .unknown.bi + the .bi buttons for 'unknown' and 'door' (the copy has no .bi of maker.fallback.body;
 *                   both carry the undo line). A known teacher is never answered bilingually: 'bi' reads as 'ur' there.
 *
 * handleFallbackButton — a tap on one of the three ids calls TODAY's entry for it, with today's words (no new copy):
 *   ft_fb_quiz  → the student video library Flow  (what a typed /video opens)
 *   ft_fb_lp    → the lesson-plan catalogue Flow  (what a typed "lesson plan" / «لیسن پلان» opens)
 *   ft_fb_coach → the record-a-lesson prompt       (what a typed "coaching" sends)
 * With `quiz_maker_page` off, or an id that is not ours, → false and the caller's chain runs as today.
 */
const { logToFile } = require('../../utils/logger');
const { clampLanguage } = require('../../config/ux-strings');
const Strings = require('./maker.fallback.strings');

const IDS = Object.freeze({ QUIZ: 'ft_fb_quiz', LP: 'ft_fb_lp', COACH: 'ft_fb_coach' });
const ALL_IDS = Object.freeze([IDS.QUIZ, IDS.LP, IDS.COACH]);
const REASON = 'ft_fallback';

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

async function makerPageOn() {
  try {
    return Boolean((await require('../quiz/web-quiz-identity-flags').flags()).makerPage);
  } catch (_) {
    return false;
  }
}

/**
 * A tap on a fallback button. → true when the id is ours and today's entry for it was called; false otherwise (the
 * caller's chain then runs as today). `lang` is the tapper's preferred language; the entries answer in en | ur.
 */
async function handleFallbackButton({ user, phone, id, lang } = {}) {
  if (!ALL_IDS.includes(id)) return false;
  if (!(await makerPageOn())) return false;
  const userId = user && user.id;
  if (!userId) return false;
  const language = clampLanguage(lang || (user && user.preferred_language));
  const AppRedirect = require('../app-redirect.service');

  if (id === IDS.QUIZ) {
    // text-message.handler's /video door: the app redirect, then the one library entry.
    if (await AppRedirect.redirectIfFlagged('video', { userId, from: phone, language, reason: REASON })) return true;
    const Videos = require('../student-videos-entry.service');
    const opened = await Videos.openStudentVideosFlow({ from: phone, userId, language, reason: REASON });
    if (!opened) logToFile('ℹ️ first touch: no student video library on this deployment — the tap is answered by nothing', { userId });
    return true;
  }
  if (id === IDS.LP) {
    // text-message.handler's bare "lesson plan" door (the redirect is inside the entry).
    const Lp = require('../lp-browse-entry.service');
    const opened = await Lp.openLpBrowseFlow({ from: phone, userId, language, reason: REASON });
    if (!opened) logToFile('ℹ️ first touch: the lesson-plan catalogue was not sent', { userId });
    return true;
  }
  // IDS.COACH — text-message.handler's typed "coaching": the redirect, the first-use intro, the coaching prompt.
  if (await AppRedirect.redirectIfFlagged('ai_coaching', { userId, from: phone, language, reason: REASON })) return true;
  const FeatureIntro = require('../feature-intro.service');
  const MenuService = require('../menu.service');
  const Helpers = require('../../database/bot-helpers');
  await FeatureIntro.sendFirstUseIntroIfNeeded(userId, phone, 'ai_coaching', language);
  const sessionId = await Helpers.getOrCreateSession(userId);
  await MenuService._handleClassroomCoachingChoice(userId, sessionId, phone, language);
  return true;
}

module.exports = { IDS, ALL_IDS, fallbackMessage, sendFallback, handleFallbackButton };
