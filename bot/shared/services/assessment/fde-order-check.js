'use strict';
/**
 * Story-order checks and task line (bd-5jmnfj.4.58.2, v26 finding 4).
 * v26 g2-english Q16: the sentence "Finally, ..." was keyed fifth of six, and the paper printed no
 * task. The key is the order of the sentences, as letters ("c, e, a, d, b, f") or numbers ("3, 5, ...").
 */

const ORDER_TASK = 'Write the letters in order.';
const CLOSING = /^\s*(finally|at last|lastly|in the end)\b/i;

/** The sentence indexes in keyed order, or null when the key is not a full permutation. */
function keyedOrder(q, value) {
  const n = q && Array.isArray(q.questions) ? q.questions.length : 0;
  const text = String(value === undefined ? q && q.answer : value || '').trim();
  if (n < 2 || n > 26) return null;
  let order = null;
  if (/^[\d\s,،.-]+$/.test(text)) order = (text.match(/\d+/g) || []).map((v) => Number(v) - 1);
  else if (text.split(/[\s,،.-]+/).filter(Boolean).every((t) => /^[a-z]$/i.test(t))) {
    order = (text.match(/[a-z]/gi) || []).map((c) => c.toLowerCase().charCodeAt(0) - 97);
  }
  if (!order || order.length !== n) return null;
  return [...order].sort((a, b) => a - b).every((v, i) => v === i) ? order : null;
}

/** Index of the sentence keyed last, or null. */
function lastSentence(q, value) {
  const order = keyedOrder(q, value);
  return order ? order[order.length - 1] : null;
}

/** True when a "Finally"/"At last" sentence is not the one the key puts last (the answer or any accept entry). */
function finallyNotLast(q) {
  if (!q || !Array.isArray(q.questions)) return false;
  const at = q.questions.findIndex((s) => CLOSING.test(String(s)));
  if (at < 0) return false;
  const accept = q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept : [];
  return [q.answer, ...accept].some((v) => {
    const last = lastSentence(q, v);
    return last !== null && last !== at;
  });
}

module.exports = { finallyNotLast, lastSentence, keyedOrder, ORDER_TASK };
