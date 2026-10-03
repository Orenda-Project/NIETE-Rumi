'use strict';

/**
 * Coach copy for the child test, read from the catalog (config/ux-strings.js, keys childTest*).
 *
 * The coach's language: Urdu unless the coach chose English (NIETE offers exactly ur/en, and Urdu
 * is first-offered). Numbers in Urdu lines are written in Urdu digits (language-protocol §9.4);
 * names and other values pass through untouched and the catalog's keepDirection isolates them.
 */

const { resolveUx } = require('../../../config/ux-strings');

const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function langOf(user) {
  return user && user.preferred_language === 'en' ? 'en' : 'ur';
}

function digits(lang, value) {
  const s = String(value);
  return lang === 'en' ? s : s.replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)]);
}

/**
 * Numeric params (numbers, or strings of digits) are localised; everything else passes through.
 * A roll is optional roster data (3.4% of NIETE children have none, CONTRACT §18): a missing `roll`
 * prints a dash rather than throwing, so a line still keyed on a roll never takes the coach's turn down
 * (a roll-less child once stopped the list). Lines that name a child use identity.js and pass `child`, not `roll`.
 */
function t(lang, key, params) {
  const p = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k === 'roll' && (v === null || v === undefined || String(v).trim() === '')) { p[k] = '—'; continue; }
    p[k] = (typeof v === 'number' || /^\d+$/.test(String(v))) ? digits(lang, v) : v;
  }
  return resolveUx(key, { language: lang, params: p });
}

/** Clip to `max` code points (what Meta counts), with an ellipsis when cut. */
function clip(s, max) {
  const cps = [...String(s || '')];
  return cps.length <= max ? cps.join('') : `${cps.slice(0, max - 1).join('')}…`;
}

const BLOCK_KEY = { urdu: 'childTestBlockUrdu', english: 'childTestBlockEnglish', maths: 'childTestBlockMaths' };
const blockName = (lang, block) => t(lang, BLOCK_KEY[block]);

module.exports = { langOf, digits, t, clip, blockName };
