'use strict';
/**
 * Listening questions that test the wrong thing (bd-5jmnfj.4.58.4). v28 G1 Urdu's poem asked which two things are
 * in the "first line" after one hearing (memory of line position, not comprehension) and «ہر ایک کیا کرتا ہے؟»,
 * which names no subject. A listening question never asks which line or مصرع something is in, and never opens
 * with «ہر ایک». Pure: items in, the offending asks out.
 */

const POSITION = [
  /(?:پہلی|پہلے|دوسری|دوسرے|تیسری|تیسرے|چوتھی|چوتھے|آخری|کون\s*سی|کس)\s*(?:سطر|مصرع)/u,
  /(?:سطر|مصرعے?)\s*میں/u,
  /\b(?:first|second|third|fourth|last|which)\s+line\b/i,
  /\bline\s+(?:one|two|three|four|\d+)\b/i,
];
const NO_SUBJECT = /^\s*ہر\s+ایک(?:\s|$)/u;

/** The ask of each item that asks a line position or opens with «ہر ایک». */
function badListeningAsks(items) {
  return (Array.isArray(items) ? items : []).map((it) => String((it && it.ask) || '')).filter((a) => NO_SUBJECT.test(a) || POSITION.some((p) => p.test(a)));
}

module.exports = { badListeningAsks };
