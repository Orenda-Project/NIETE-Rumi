'use strict';
/**
 * The maker reply: one WhatsApp cta_url that opens the quiz-maker page.
 *
 *   makerUrl({ uid, lang, tour, pf, via, uk })   the public page URL: <web quiz base>/m/<maker token>; null without a
 *                                                base URL or a signing secret
 *   makerCta({ uid, lang, who, via, phone })     the call the first-touch door makes. The send ledger FIRST
 *                                                (trigger maker_reply, recipient teacher); the send only when it
 *                                                said yes. → { sent:false, capped:true } when refused (nothing sent),
 *                                                else { sent: <the cta_url went out> }.
 *
 * Today the ledger's frozen trigger list has no maker_reply, so record() refuses and nothing is sent; this module then
 * logs web_quiz.reply_capped itself (the ledger logs it only for a trigger it knows). The empty-line bodies and the
 * refused-send fallback buttons are not here yet.
 */
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const WhatsAppService = require('../whatsapp.service');
const Ledger = require('../quiz/message-ledger');
const MakerToken = require('./maker.token');
const { clampLanguage } = require('../../config/ux-strings');
const { str } = require('./maker.strings');

const TRIGGER = 'maker_reply';

/** The phone's event key through the sister's ukeyOf (normalises the phone itself); null when it cannot be made. */
function ukeyFor(phone) {
  try {
    return require('../quiz/child-phone-bindings.repo').ukeyOf(phone) || null;
  } catch (_) {
    return null;
  }
}

function makerUrl({ uid, lang, tour = 0, pf, via, uk } = {}) {
  const base = require('../quiz/web-quiz-link').webBaseUrl();
  if (!base) return null;
  const token = MakerToken.signMaker({ uid, lang, tour, pf, via, uk });
  return token ? `${base}/m/${token}` : null;
}

/** The body and button for the reply's language: `bi` → the one bilingual value; else the clamp's language. */
function copyFor(lang) {
  if (lang === 'bi') return { body: str('maker.body.bi', 'en'), buttonText: str('maker.btn.bi', 'en') };
  return { body: str('maker.body', lang), buttonText: str('maker.btn', lang) };
}

async function makerCta({ uid, lang, who = 'unknown', via = 'door', phone, tour = 0, pf } = {}) {
  const allowed = await Ledger.record({ trigger: TRIGGER, phone, reason: via, initiated: 'user', recipient: 'teacher' });
  if (!allowed) {
    if (!Ledger.TRIGGERS.includes(TRIGGER)) logEvent('web_quiz.reply_capped', { trigger: TRIGGER, w: 's' });
    return { sent: false, capped: true };
  }
  const l = lang === 'bi' ? 'bi' : clampLanguage(lang);
  const url = makerUrl({ uid, lang: l, tour: tour === 1 ? 1 : 0, pf, via, uk: ukeyFor(phone) });
  if (!url) {
    logToFile('⚠️ maker cta: no page URL (base URL or signing secret missing) — nothing sent', { via, who });
    return { sent: false };
  }
  const sent = await WhatsAppService.sendCtaUrl(phone, { ...copyFor(l), url });
  return { sent: Boolean(sent) };
}

module.exports = { makerCta, makerUrl, TRIGGER };
