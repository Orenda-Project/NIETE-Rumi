'use strict';
/**
 * An accepted alternative that the common error names is that error, not an
 * answer (bd-5jmnfj.4.50.10). The model writes "accept: running; run" beside
 * "common error: writing run without ing": the teacher cannot follow both, so
 * the alternative goes and the error stays.
 *
 * An entry names the error when the common_error says the child WRITES it:
 * its words, whole and in order, straight after "writing". Urdu puts the verb
 * last («بس کی جگہ ریل گاڑی لکھنا»), where the written form's first word cannot
 * be told apart, so an Urdu error drops nothing: the prompt rule covers it.
 * An entry the error only mentions ("miscounting during repeated subtraction")
 * is a method, not the wrong form, and stays. Only a short form (up to three
 * words) is checked: a sentence the error repeats is not a form the child
 * writes. The key answer itself is never dropped, and a one-character entry is
 * too short to tell from an ordinary word, so it stays.
 *
 * Pure: no I/O, never throws.
 */

const FORM_WORDS_MAX = 3;
const WRITE_BEFORE = new Set(['writing', 'writes', 'write', 'wrote', 'written']);

// Lower-case words with their edge punctuation stripped ("'run'," -> "run").
function words(text) {
  return String(text).toLowerCase().split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

// True when `form` sits in `error` as the thing written.
function writes(error, form) {
  for (let i = 0; i + form.length <= error.length; i += 1) {
    if (!form.every((w, k) => error[i + k] === w)) continue;
    if (WRITE_BEFORE.has(error[i - 1])) return true;
  }
  return false;
}

/** { accept, dropped }: `accept` without the entries `commonError` names. */
function dropContradictedAccepts(accept, answer, commonError) {
  if (!Array.isArray(accept) || typeof commonError !== 'string') return { accept, dropped: [] };
  const error = words(commonError);
  const key = words(answer === null || answer === undefined ? '' : answer).join(' ');
  const kept = [];
  const dropped = [];
  for (const a of accept) {
    const w = words(a);
    const form = w.join(' ');
    const named = w.length > 0 && w.length <= FORM_WORDS_MAX && form !== key && [...form].length > 1 && writes(error, w);
    (named ? dropped : kept).push(a);
  }
  return { accept: kept, dropped };
}

module.exports = { dropContradictedAccepts };
