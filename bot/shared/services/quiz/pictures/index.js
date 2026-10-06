'use strict';
/**
 * The web quiz's colour picture bank (color_glyphs.json, built by
 * build_color_bank.js from Microsoft Fluent Emoji Flat, MIT).
 *
 * One flat colour drawing per noun of the figure engine's pictogram roster, on
 * the same 72-unit grid, ~2 KB each, inlined in the page like every figure.
 * The web page uses it for the nouns a child must recognise: things to count,
 * animals to match, the picture that tells the child the word, picture
 * options, and the emoji a WhatsApp picture question uses as its options.
 * WhatsApp never uses it (the PNG path keeps the engine's line art).
 *
 * Pure and synchronous; a missing bank file means no colour, never an error.
 */

let BANK = null;
function bank() {
  if (BANK === null) {
    try { BANK = require('./color_glyphs.json').glyphs || {}; } catch (_) { BANK = {}; }
  }
  return BANK;
}

/** The colour drawing's inner markup for a roster noun (72-unit grid), or null. */
function colorInner(noun) {
  const g = bank()[String(noun == null ? '' : noun)];
  return g && typeof g.inner === 'string' ? g.inner : null;
}

let _byHex = null;
function byHex() {
  if (_byHex === null) {
    _byHex = {};
    for (const [noun, g] of Object.entries(bank())) if (g && g.hex) _byHex[String(g.hex).toUpperCase()] = noun;
  }
  return _byHex;
}

/**
 * The roster noun a single emoji option stands for ('🍃' -> 'leaf'), or null.
 * Only ONE pictographic emoji (an optional variation selector allowed): a
 * symbol ('=', '<'), a word, or a row of emoji ('🏠 🏠 🏠', a counting
 * option) is not a picture option.
 */
/**
 * Emoji that stand in for a noun WhatsApp has no emoji for. A quiz written for WhatsApp uses the
 * chestnut 🌰 for "seed" (plant parts: 🌸 🍃 🌰 🥕); drawn as a chestnut, a child reads it as a
 * chestnut or an onion. Both it and 🫘 are drawn as the seed: beans.
 */
const STANDS_FOR = { '1F330': 'seed', '1FAD8': 'seed' };

function emojiNoun(text) {
  const t = String(text == null ? '' : text).trim().replace(/️/g, '');
  const cps = [...t];
  if (cps.length !== 1 || !/\p{Extended_Pictographic}/u.test(t)) return null;
  const hex = cps[0].codePointAt(0).toString(16).toUpperCase();
  return STANDS_FOR[hex] || byHex()[hex] || null;
}

module.exports = { colorInner, emojiNoun };
