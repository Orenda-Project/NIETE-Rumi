'use strict';
/**
 * The one home of a passage's child-facing title: the passage FILE's title_en / title_ur
 * (bot/shared/data/child-test/passages, ITEMS §1), never the registry row's. A leaf: it requires only the child-test
 * item bank, on use, so the challenge, the hub's play block and the Book all read it without a require loop.
 *
 *   titleOf(p)              { en, ur } of a passage object, or null when it has neither
 *   passageTitle(id)        { en, ur } of the passage file, or null (no such passage, no title, no item bank)
 *   titleFor(id, lang)      the line a child sees: Urdu ur → en, English en; null when the file gives none
 */

/** The child-facing title of a passage as the page renders it (ITEMS §1 title_en/title_ur): { en, ur } or null when it has none. */
function titleOf(p) {
  if (!p || (p.title_en == null && p.title_ur == null)) return null;
  return { en: p.title_en == null ? null : String(p.title_en), ur: p.title_ur == null ? null : String(p.title_ur) };
}

/** One home for every surface that names a passage (the shelf, the stop's intro): passageTitle(id) → { en, ur } | null. */
function passageTitle(passageId) {
  let Bank;
  // the item bank on use, as web-quiz-challenge.js childTest() requires it; a build without it has no titles
  try { Bank = require('../child-test/item-bank'); } catch (_) { return null; }
  return titleOf(typeof Bank.getPassage === 'function' ? Bank.getPassage(passageId) : null);
}

/** The title line in the child's language: Urdu ur → en, English en; null when the file has none (never "null"). */
function titleFor(passageId, lang) {
  const t = passageTitle(passageId);
  const pick = (v) => (typeof v === 'string' && v.trim() ? v : null);
  return t ? (lang === 'ur' ? pick(t.ur) || pick(t.en) : pick(t.en)) : null;
}

module.exports = { titleOf, passageTitle, titleFor };
