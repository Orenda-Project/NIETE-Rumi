'use strict';
/**
 * "This question points at a picture": the ONE word list for it, shared by
 * every reader (the web quiz's E2 guard; the authoring check may import it).
 *
 * It matches a stem that sends the child to a picture on screen ("Look at the
 * pictures", "in the diagram", "this clock", "the chart below", "which
 * drawing", «تصویریں دیکھیں», «اس تصویر», «خاکے میں»), not one that only uses
 * the word ("Why is a mirror image virtual?", "a table shows 125 apples",
 * «حرف کی شکل»). Quoted text is ignored: a sentence quoted from the lesson
 * («"اس تصویر کو دیوار پر لٹکائیں"») is about words, not a picture.
 *
 * Measured on every sandbox quiz_questions row (12,136): 224 stems match, 7 of
 * them carry no picture of any kind, and each of those 7 needs one. A bare
 * look|picture|image|shown|drawn|تصویر|شکل|دیکھ list matches 381 and calls
 * 145 picture-less, most of them good questions.
 */

const NOUN = '(?:picture|image|diagram|figure|drawing|chart|graph|clock|grid|map|shape|number line)s?';
const UR_NOUN = '(?:تصویر|تصویریں|تصویروں|خاکے|خاکہ)';

const POINTS_AT_PICTURE = new RegExp([
  `\\b(?:look(?:ing)?\\s+at|see|in|from|use)\\s+(?:the|this|these|each)\\s+${NOUN}\\b`,
  `\\b(?:this|these|the\\s+following)\\s+${NOUN}\\b`,
  `\\b${NOUN}\\s+(?:below|above|here)\\b`,
  `\\b(?:shown|drawn)\\s+(?:here|in\\s+the\\s+${NOUN})\\b`,
  '\\bwhich\\s+(?:picture|image|drawing)\\b',
  `(?:اس|ان|یہ|دی\\s+گئی|نیچے\\s+دی\\s+گئی)\\s+(?:${UR_NOUN}|شکل)`,
  `${UR_NOUN}\\s*(?:میں|کو\\s+دیکھ|دیکھ)`,
].join('|'), 'i');

const QUOTED = /[“"«][^”"»]*[”"»]/g;

/** True when the text sends the child to a picture. */
function pointsAtPicture(text) {
  return POINTS_AT_PICTURE.test(String(text || '').replace(QUOTED, ' '));
}

module.exports = { POINTS_AT_PICTURE, pointsAtPicture };
