'use strict';
/**
 * Is this message a request for the portal, and nothing else?
 *
 * The /portal door opened only for the exact slash command. A teacher who typed the word itself ("portal", "Portal",
 * «پورٹل», "open portal", "mera portal") got "I'm not sure which feature you meant" and the whole menu, or a chat
 * answer: in the 7 days to 27 Oct 2026 on production, 3 bare "portal" turns and 0 portal links from them, while 202 of
 * 213 "/portal" turns got the link. A child's "portal" went to the tutor, and a child's "/portal" was refused.
 *
 * A PORTAL REQUEST is the whole message being the portal word plus, at most, a few words that only ask for it
 * (possessives, "open / send / link / login", "please", and their Roman-Urdu and Urdu counterparts). A message that
 * says anything else ("portal pe lesson nahi khul raha", "what is portal", "portal password") carries content and
 * belongs to the classifier and the chat, as before. `/portal` with anything after it is the command, as it always was.
 *
 * Pure: no IO. The words are normalised by the quiz request's own tokeniser (quiz-menu-request.js), so both keyword
 * doors fold Urdu letters, bidi marks and punctuation the same way.
 *
 * keywordRoutingOn(): the kill switch PORTAL_KEYWORD_ROUTING, read at call time, DEFAULT ON. 'false', '0', 'off' or
 * 'no' puts back today's behaviour exactly on both doors (a teacher's bare word is not the command; a child's
 * "/portal" is refused and a child's "portal" goes to the tutor), with no deploy.
 */
const { tokens } = require('./quiz/quiz-menu-request');

/** Spellings of the word itself, after normalisation. */
const PORTAL_WORD_RX = /^(?:portal|portals|portl|portel|portol|protal|portaal|پورٹل|پورٹال)$/u;

/** Words that ask for the portal and say nothing else. No question words, no "not", no feature names. */
const REQUEST_WORDS = new Set([
  // English
  'my', 'mine', 'me', 'i', 'a', 'the', 'our', 'open', 'send', 'give', 'show', 'get', 'see', 'go', 'to', 'link', 'url',
  'login', 'log', 'in', 'sign', 'signin', 'please', 'pls', 'plz', 'pleas', 'where', 'is', 'can', 'you', 'u', 'want',
  'need', 'niete', 'teacher', 'app', 'web', 'website', 'page',
  // Roman Urdu
  'mera', 'meri', 'mere', 'meray', 'mujhe', 'mujhay', 'muje', 'mjhe', 'mujhy', 'apna', 'apni', 'ap', 'aap',
  'kholo', 'khol', 'kholen', 'kholein', 'kholain', 'kholiye', 'kholdo',
  'do', 'de', 'den', 'dein', 'dain', 'dijiye', 'dijye', 'bhejo', 'bhej', 'bhejen', 'bhejein', 'bhejain', 'bhaijen',
  'dikhao', 'dikhayen', 'dikhaen', 'chahiye', 'chahye', 'chaiye', 'chahie', 'kahan', 'kahaan', 'kidhar',
  'hai', 'hain', 'ka', 'ki', 'ke', 'kar', 'karo', 'karen', 'karein', 'kr', 'krdo',
  // Urdu
  'میرا', 'میری', 'میرے', 'مجھے', 'اپنا', 'اپنی', 'آپ', 'کھولیں', 'کھولو', 'کھول', 'کھولئے', 'کھولیے',
  'لنک', 'لاگ', 'ان', 'دیں', 'دو', 'دیجیے', 'دیجئے', 'بھیجیں', 'بھیجو', 'بھیج', 'دکھائیں', 'دکھاؤ', 'چاہیے', 'چاہئے',
  'کہاں', 'ہے', 'ہیں', 'کا', 'کی', 'کے', 'کریں', 'کرو', 'براہ', 'مہربانی', 'کرم', 'ایپ', 'ٹیچر',
]);

/** A message longer than this is a sentence, not a request for a link. */
const MAX_TOKENS = 6;

/**
 * @param {string} text the message as it arrived
 * @returns {boolean} true when the message asks for the portal and nothing else
 */
function isPortalRequest(text) {
  // bidi controls a copied isolated command carries (LRM/RLM, the embeddings, the isolates, BOM)
  const raw = String(text == null ? '' : text).replace(/[‎‏‪-‮⁦-⁩﻿]/gu, '').trim();
  if (!raw) return false;
  if (/^\/portal(\s|$)/i.test(raw)) return true;
  const toks = tokens(raw);
  if (!toks.length || toks.length > MAX_TOKENS) return false;
  let words = 0;
  for (const tok of toks) {
    if (PORTAL_WORD_RX.test(tok)) { words += 1; continue; }
    if (!REQUEST_WORDS.has(tok)) return false;
  }
  return words === 1;
}

const OFF = new Set(['false', '0', 'off', 'no']);

/** PORTAL_KEYWORD_ROUTING: unset (or anything else) → on; 'false' / '0' / 'off' / 'no' → today's behaviour. */
function keywordRoutingOn() {
  return !OFF.has(String(process.env.PORTAL_KEYWORD_ROUTING == null ? '' : process.env.PORTAL_KEYWORD_ROUTING).trim().toLowerCase());
}

module.exports = { isPortalRequest, keywordRoutingOn, PORTAL_WORD_RX, REQUEST_WORDS, MAX_TOKENS };
