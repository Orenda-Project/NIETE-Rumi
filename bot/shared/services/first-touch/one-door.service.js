'use strict';
/**
 * THE ONE DOOR (switch quiz_one_door) — every quiz request from any phone gets exactly ONE reply: a cta_url button
 * into WhatsApp's own browser. The server decides who is asking BEFORE the reply (role.service); the page asks only
 * when the server cannot know, and asks once. WhatsApp never asks, never lists, never shows a menu or a Flow for a
 * quiz request.
 *
 *   child (a binding, a chat-joined row)  → today's child reply, byte-identical (StudentQuiz.open → the hub cta_url)
 *   teacher (identity/activity, or the remembered teacher answer) → od.teacher.* → /quiz/go/<t> → the teacher home
 *   join (the remembered child answer, no row yet)                → the child home words → /quiz/go/<t> → the join screen
 *   unknown                                                       → od.unknown.* → /quiz/go/<t> → the one question
 *
 * The reply is counted on the ledger FIRST (trigger one_door_reply, the `reply_to_own_message` counter, 20 a phone a
 * PKT day): over it → nothing on WhatsApp, `web_quiz.reply_capped{counter}`; the page already held still answers. A
 * cta_url WhatsApp refuses → ONE plain text (od.fallback.unknown), the same count. The URL carries a signed token with
 * an opaque nonce; the phone sits in Redis under the nonce (go.store), never in the URL, the body or a log line.
 *
 * Events (ids only): onboard.quiz_door{door, verdict, src, reply, lang}; with web_quiz_events_v3 ON,
 * web_quiz.quiz_cmd{known, reply, src} in the v3 envelope.
 */
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx } = require('../../config/ux-strings');
const Flags = require('./one-door.flags');
const Role = require('./role.service');
const Strings = require('./one-door.strings');

const TRIGGER = 'one_door_reply';
const DOORS = Object.freeze(['text', 'menu', 'home']);
const GO_PATH = '/quiz/go/';

// The prefilled return words (EVENTS_V3 quiz_cmd{src}): the class message's line prefills exactly `quiz`; the shared
// card's line prefills `quiz please` / «کوئز دکھائیں» (lead-child RULING #C4) — and `jugnu` / «جگنو» answer too.
const CLASS_WORD = 'quiz';
const CARD_WORDS = Object.freeze(['quiz please', 'کوئز دکھائیں', 'jugnu', 'جگنو']);
const RETURN_WORDS = Object.freeze(['jugnu', 'جگنو']);

/** Lower-case, no punctuation, single spaces (Urdu letters kept). */
function norm(text) {
  return String(text == null ? '' : text).normalize('NFKC').toLowerCase()
    .replace(/[​-‏‪-‮⁦-⁩﻿]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Is this the bare return word (`jugnu` / «جگنو») — quiz-shaped ONLY under the switch? Pure. */
function isReturnWord(text) {
  return RETURN_WORDS.includes(norm(text));
}

/** Which words asked: typed | class_msg | card_share | menu | home. Pure. */
function srcOf(body, door = 'text') {
  if (door === 'menu') return 'menu';
  if (door === 'home') return 'home';
  const raw = String(body || '').trim();
  if (/^\/quiz/i.test(raw)) return 'typed';
  const n = norm(raw);
  if (n === CLASS_WORD) return 'class_msg';
  if (CARD_WORDS.includes(n)) return 'card_share';
  return 'typed';
}

/** The ONE body + button for this side and language. Pure (the child-home words come from ux-strings). */
function messageFor(side, lang, { childHome = true } = {}) {
  const uxLang = lang === 'ur' ? 'ur' : 'en';
  if (side === 'join') {
    // the remembered child, no row yet: the child home's own words (the join screen follows on the page)
    return {
      body: resolveUx(childHome ? 'sqHomeBody' : 'sqHubBody', { language: uxLang }),
      button: resolveUx(childHome ? 'sqHomeBtnPlain' : 'sqHubBtn', { language: uxLang }),
    };
  }
  const id = side === 'teacher' ? 'od.teacher' : 'od.unknown';
  if (lang === 'ur') return { body: Strings.str(`${id}.body`, 'ur'), button: Strings.str(`${id}.btn`, 'ur') };
  return { body: Strings.bi(`${id}.body`), button: Strings.str('od.btn.bi', 'en') };
}

async function v3Event(name, props) {
  try {
    if (!(await Flags.flags()).eventsV3) return;
    logEvent(`web_quiz.${name}`, { w: 's', ev_v: 3, v3: 1, kid: null, ...props });
  } catch (_) { /* an event never decides a reply */ }
}

/** The landing URL for this person, or null (no base URL, no secret, Redis could not keep the nonce). */
async function landingUrl({ user, phone, side, lang, src }) {
  const Token = require('../quiz/web-quiz-token');
  const GoToken = require('./go.token');
  const Store = require('./go.store');
  const { webBaseUrl } = require('../quiz/web-quiz-link');
  const { normalisePhone } = require('../quiz/student-identity.service');
  const base = webBaseUrl();
  if (!base) return null;
  const n = Token.newNonce();
  if (!(await Store.put(n, { phoneNorm: normalisePhone(phone), userId: user.id }))) return null;
  const t = GoToken.signGo({ uid: String(user.id), side, n, lang, src });
  return t ? `${base}${GO_PATH}${t}` : null;
}

/** Mint a landing link for a page that already knows the person (the teacher home's "Change", the child home's corner). */
async function mintLanding({ user, phone, side = 'unknown', lang = 'bi', src = 'other' }) {
  if (!user || !user.id || !phone) return null;
  return landingUrl({ user, phone, side, lang, src });
}

/**
 * Answer a quiz request with the ONE reply. Never throws.
 * @param {{user:object, from:string, door?:'text'|'menu'|'home', body?:string, language?:string|null}} args
 * @returns {Promise<string>} what was sent: child | one_door | fallback | capped | error
 */
async function reply({ user, from, door = 'text', body = '', language = null } = {}) {
  const d = DOORS.includes(door) ? door : 'text';
  const src = srcOf(body, d);
  const userId = (user && user.id) || null;
  try {
    const who = await Role.resolveRole({ user, phone: from, body });
    const lang = who.lang;
    const event = (reply_, extra = {}) => logEvent('onboard.quiz_door', { door: d, verdict: who.side, src: who.src, reply: reply_, lang, userId, ...extra });

    if (who.side === 'child') {
      // a known / bound child: today's one hub reply, byte-identical (its own count rides `ownReply`)
      const StudentQuiz = require('../quiz/student-quiz.service');
      await StudentQuiz.open(from, { language: (user && (user.personaLanguage || user.preferred_language)) || language || 'en' });
      event('one_door', { how: 'child_hub' });
      await v3Event('quiz_cmd', { known: 'child', reply: 'iab_link', src: src === 'menu' || src === 'home' ? 'other' : src, lang });
      return 'child';
    }

    const Ledger = require('../quiz/message-ledger');
    const counted = await Ledger.record({
      trigger: TRIGGER, phone: from, reason: who.side, ownReply: true,
      recipient: who.side === 'teacher' ? 'teacher' : 'family',
    });
    if (!counted) {
      event('capped');
      await v3Event('quiz_cmd', { known: who.side === 'teacher' ? 'teacher' : (who.side === 'join' ? 'child' : 'unknown'), reply: 'none', src: src === 'menu' || src === 'home' ? 'other' : src, lang });
      return 'capped';
    }

    const url = await landingUrl({ user, phone: from, side: who.side, lang, src });
    let sent = false;
    if (url) {
      const childHome = who.side === 'join' ? Boolean((await require('../quiz/web-quiz-hub-flags').flags()).childHome) : true;
      const { body: text, button } = messageFor(who.side, lang, { childHome });
      sent = await WhatsAppService.sendCtaUrl(from, { body: text, buttonText: button, url });
    }
    if (!sent) {
      await WhatsAppService.sendMessage(from, lang === 'ur' ? Strings.str('od.fallback.unknown', 'ur') : Strings.bi('od.fallback.unknown'));
      event('fallback', { why: url ? 'send' : 'link' });
    } else {
      event('one_door');
    }
    await v3Event('quiz_cmd', { known: who.side === 'teacher' ? 'teacher' : (who.side === 'join' ? 'child' : 'unknown'), reply: sent ? 'iab_link' : 'none', src: src === 'menu' || src === 'home' ? 'other' : src, lang });
    return sent ? 'one_door' : 'fallback';
  } catch (err) {
    logToFile('❌ one door: the reply failed', { error: err && err.message }, 'error');
    return 'error';
  }
}

module.exports = {
  reply, mintLanding, messageFor, srcOf, isReturnWord, norm,
  TRIGGER, DOORS, GO_PATH, CLASS_WORD, CARD_WORDS, RETURN_WORDS,
};
