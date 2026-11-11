'use strict';
/**
 * Is this message a request for the menu? (bd-2ym4ve)
 *
 * Operator, 11 Nov 2026: "If they don't use a / command, they just write menu, would it work? Because I think it
 * should. People are going to mess up this. If ... it's a single one or two words and it contains the word menu, the
 * menu should open." Our own messages already tell teachers to send "menu" without the slash.
 *
 * Until now only a whole-message COMMAND was rewritten to /menu (utils/slash-command.js: "menu/", "/ menu", slips by
 * edit distance). A bare "menu" went to the intent classifier, which may or may not choose the menu. In the 30 days
 * to 11 Nov 2026 on production: 255 bare "menu", 20 "menue", 3 "show menu", "manu", "send manu", "menu bajhain",
 * "**"menu"**", "l/menu", "/menu report", «مینو».
 *
 * A MENU REQUEST is one or two words (the quiz door's tokeniser: punctuation, slashes, emoji and bidi marks are not
 * words), one of them the menu word, that no other door reads today. Those doors keep what they read:
 *   - the quiz menu: "quiz menu", "menu quiz", «کوئز مینو» (quiz-menu-request.js)
 *   - attendance: "attendance menu", "hazri menu", «حاضری مینو» (attendance-keywords.js)
 *   - coaching: a message that starts with coach / coaching / «کوچنگ» (handlers/coaching-trigger.js)
 *   - another /command in the message: "/exam menu", "/portal/menu", "menu /training" (utils/slash-command.js words)
 * Any other second word still opens the menu ("show menu", "menu please", "training menu", "portal menu"): the menu
 * lists every feature. Three words or more is a sentence and is left to the classifier, as before.
 *
 * The menu word is "menu" and the slips teachers actually type; NOT "men", "man", "mn", "meni", "mene", "meny" (Roman
 * Urdu for "in" / "I": "men wait kr rhi hon", "man teacher nahi hon", "meny bheja") and not «مینوں» (Punjabi "to me").
 *
 * Pure: no IO. keywordRoutingOn(): the kill switch MENU_KEYWORD_ROUTING, read at call time, DEFAULT ON. 'false', '0',
 * 'off' or 'no' puts back the old behaviour (a bare "menu" goes to the classifier) with no deploy.
 */
const { tokens, isQuizMenuRequest } = require('./quiz/quiz-menu-request');
const AttendanceKeywords = require('./attendance-keywords');
const { COACHING_TRIGGER_RX } = require('../handlers/coaching-trigger');
const { COMMANDS, OTHER_COMMANDS } = require('../utils/slash-command');

/** The menu word, after the tokeniser's normalisation (lower case, Urdu letters folded, harakat dropped). */
const MENU_WORDS = new Set([
  'menu', 'menus', 'menú',
  // slips seen in production (bare or slashed), none of them a Roman-Urdu or English word
  'menue', 'menues', 'manu', 'manue', 'mneu', 'mnue', 'meun', 'mune', 'munu', 'munue', 'menuu', 'meneu', 'maneu',
  'menyu',
  // Urdu
  'مینو', 'مینیو', 'منیو',
]);

/** More words than this is a sentence, not a request for the menu (operator: "a single one or two words"). */
const MAX_TOKENS = 2;

// Bidi controls a copied message carries: LRM/RLM, the embeddings, the isolates, BOM.
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩﻿]/gu;

/** Command words other than the menu's own, each with a door of its own. */
const OTHER_DOOR_COMMANDS = [...COMMANDS, ...OTHER_COMMANDS].filter((c) => c !== 'menu' && !c.includes(' '));

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "/exam", "/ portal", "training/": another command, with the slash that makes it one, is in the message. */
const ANOTHER_COMMAND_RX = new RegExp(
  `(?:\\/\\s*(?:${OTHER_DOOR_COMMANDS.map(escapeRx).join('|')})(?![a-z0-9]))`
  + `|(?:(?<![a-z0-9])(?:${OTHER_DOOR_COMMANDS.map(escapeRx).join('|')})\\s*\\/)`,
  'i',
);

/** Another door reads this message today, and keeps it. */
function claimedByAnotherDoor(raw) {
  if (isQuizMenuRequest(raw)) return true;
  if (AttendanceKeywords.detect(raw).detected) return true;
  if (COACHING_TRIGGER_RX.test(raw)) return true;
  return ANOTHER_COMMAND_RX.test(raw);
}

/**
 * @param {string} text the message as it arrived
 * @returns {boolean} true when the message is one or two words, one of them the menu word, and no other door reads it
 */
function isMenuRequest(text) {
  const raw = String(text == null ? '' : text).replace(BIDI_CONTROLS, '').trim();
  if (!raw) return false;
  const toks = tokens(raw);
  if (!toks.length || toks.length > MAX_TOKENS) return false;
  if (!toks.some((tok) => MENU_WORDS.has(tok))) return false;
  return !claimedByAnotherDoor(raw);
}

const OFF = new Set(['false', '0', 'off', 'no']);

/** MENU_KEYWORD_ROUTING: unset (or anything else) → on; 'false' / '0' / 'off' / 'no' → the old behaviour. */
function keywordRoutingOn() {
  return !OFF.has(String(process.env.MENU_KEYWORD_ROUTING == null ? '' : process.env.MENU_KEYWORD_ROUTING).trim().toLowerCase());
}

module.exports = { isMenuRequest, keywordRoutingOn, MENU_WORDS };
