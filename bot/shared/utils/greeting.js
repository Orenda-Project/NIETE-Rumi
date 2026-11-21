'use strict';
/**
 * Is the WHOLE message just a greeting? (pure)
 *
 * Sandbox, 2026-10-19: a brand-new person who said "hi" got TWO greetings — the general AI reply
 * and then the registration invite. For a greeting and nothing else, the invite IS the reply
 * (text-message.handler.js, the greeting door). So this answers one narrow question: did she say
 * hello and nothing more? Anything carrying a request — "aoa lesson plan chahiye", "hi, I need a
 * quiz" — is NOT greeting-only and is answered as usual.
 *
 * How: the message is cut into words (punctuation, emoji and bidi controls dropped, Latin case
 * folded, a letter repeated for emphasis kept once — "hiiii", "salaaam"), and must be covered
 * end to end by known pieces — a greeting ("hi", "aoa", "assalam o alaikum", «السلام علیکم
 * ورحمۃ اللہ»), a form of address ("sir", "ji", «جی») or a pleasantry ("how are you", "kaise
 * hain") — with at least one greeting among them. A piece may span words, so every spelling of
 * "assalam-o-alaikum" lands on the same joined form. A word that is none of these makes it not
 * greeting-only; that is deliberately strict, because the cost of a miss is only that she gets
 * the ordinary reply.
 */

const BIDI_AND_JOINERS = /[​-‏‪-‮⁦-⁩﻿‍️]/g;
const EMOJI = /\p{Extended_Pictographic}/gu;
const ARABIC_DIACRITICS = /[ً-ٰٟ]/g;
// Punctuation in both scripts becomes a word break.
const PUNCT = /[.,!?;:'"“”‘’()\[\]{}*_~\-–—…\/\\|،۔؟٫٬]+/g;

/** Arabic-keyboard letters folded to their Urdu forms, so «السلام عليكم» reads as «السلام علیکم». */
function foldUrdu(s) {
  return s.replace(/ي|ى/g, 'ی') // ي ى → ی
    .replace(/ك/g, 'ک')                // ك → ک
    .replace(/ة/g, 'ۃ')                // ة → ۃ
    .replace(/ه/g, 'ہ');               // ه → ہ
}

// Latin pieces are matched on the joined, repeat-collapsed form ("good" → "god", "rahmatullah"
// → "rahmatulah", "assalam" → "asalam"), which is why they are written that way here.
const SALAM = '(?:a?salam|aslam|slam|salm)(?:o|u|un|a|e)?(?:alaikum|alaykum|alaikom|alekum|alikum|aleikum|alykum|alakum|aleykum)?(?:warahmatulahi?(?:wabarakatuhu?)?)?';
const LATIN_GREETING = new RegExp(`^(?:hi|hy|hey|hei|hai|hiya|helo|hlo|halo|hola|${SALAM}|aoa|wa?(?:alaikum|alaykum|alikum|aleikum)(?:u|a|o)?a?salam|god(?:morning|afternon|evening|day)|morning|gm)$`);
const LATIN_ADDRESS = /^(?:sir|sr|madam|madm|mam|maam|miss|ji|je|dear|der|bhai|baji|baje|al|everyone|there|team|friends?|niete|rumi|bot|teacher)$/;
const LATIN_PLEASANTRY = /^(?:howareyou|howareu|howru|hru|howdy|kaisehain|kaiseho|kesehain|keseho|kesyhain|kesyho|kesihain|kesiho|kaisihain|kyahalhai|kyahalhe|kyahal|apkaisehain|aapkaisehain|apkesehain|apkesyhain|apkesihain|aapkesihain)$/;

const URDU_GREETING = /^(?:(?:ال|ا)?سلام(?:و)?(?:علیکم)?(?:ورحم(?:ۃ|ت)(?:ا)?للہ(?:وبرکاتہ)?)?|وعلیکم(?:ال|ا)?سلام|ہیلو|ہائے|آداب|صبحبخیر)$/;
const URDU_ADDRESS = /^(?:جی|سر|میڈم|باجی|بھائی|صاحب|صاحبہ)$/;
const URDU_PLEASANTRY = /^(?:آپ)?(?:کیسےہیں|کیسیہیں|کیسےہو|کیسیہو)$|^کیاحالہے$/;

const MAX_WORDS = 10;
const MAX_SPAN = 7; // the longest greeting, «السلام علیکم ورحمۃ اللہ وبرکاتہ», is five words

function pieceOf(joined) {
  if (/[؀-ۿ]/.test(joined)) {
    if (URDU_GREETING.test(joined)) return 'greeting';
    if (URDU_ADDRESS.test(joined) || URDU_PLEASANTRY.test(joined)) return 'other';
    return null;
  }
  const latin = joined.replace(/([a-z])\1+/g, '$1');
  if (LATIN_GREETING.test(latin)) return 'greeting';
  if (LATIN_ADDRESS.test(latin) || LATIN_PLEASANTRY.test(latin)) return 'other';
  return null;
}

function wordsOf(text) {
  const cleaned = foldUrdu(text.replace(BIDI_AND_JOINERS, '').replace(EMOJI, ' ').replace(ARABIC_DIACRITICS, ''))
    .toLowerCase()
    .replace(PUNCT, ' ')
    .trim();
  return cleaned ? cleaned.split(/\s+/) : [];
}

/**
 * @param {*} text the message as it arrived
 * @returns {boolean} true when the message is a greeting and nothing else
 */
function isGreetingOnly(text) {
  if (typeof text !== 'string') return false;
  const words = wordsOf(text);
  if (!words.length || words.length > MAX_WORDS) return false;
  if (words.some((w) => /\d/.test(w))) return false;

  // best[i] = { ok, greeted } for the first i words: can they be covered, and did a greeting appear?
  const best = Array.from({ length: words.length + 1 }, () => null);
  best[0] = { greeted: false };
  for (let i = 0; i < words.length; i++) {
    if (!best[i]) continue;
    for (let j = i + 1; j <= Math.min(words.length, i + MAX_SPAN); j++) {
      const kind = pieceOf(words.slice(i, j).join(''));
      if (!kind) continue;
      const greeted = best[i].greeted || kind === 'greeting';
      if (!best[j] || (greeted && !best[j].greeted)) best[j] = { greeted };
    }
  }
  return !!(best[words.length] && best[words.length].greeted);
}

module.exports = { isGreetingOnly };
