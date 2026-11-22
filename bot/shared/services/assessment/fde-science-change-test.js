'use strict';
/**
 * G5 Science physical vs chemical change (bd-5jmnfj.36). The prompt_rule says the test a key pays is whether a new substance
 * forms (chemical) or not (physical); reversibility is only a supporting sign. A written item about physical or chemical change
 * whose key pays reversibility and never a new substance is flagged on its own slot, with a `note` the re-ask prints.
 * Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed:false, note}` out.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const ABOUT = /\b(?:physical|chemical)\b[^.?]{0,30}\bchanges?\b|\bchanges?\b[^.?]{0,20}\b(?:physical|chemical)\b/i;
const REVERSE = /\breversib|\bcan(?:not| be|'t)?\s+(?:easily\s+)?be\s+(?:changed|turned|reversed|undone)\b|\b(?:changed|turned|goes?|comes?)\s+back\b|\breversed\b/i;
const NEW_SUBSTANCE = /\bnew (?:substance|material|product)s?\b/i;
const NOTE = 'Physical or chemical change: the test the key pays is whether a new substance forms (chemical) or no new substance forms (physical); '
  + 'reversibility is only a supporting sign, never the test. Rewrite the key so a point pays the new substance.';

const str = (v) => (typeof v === 'string' ? v : '');
const keyOf = (o) => [str(o.answer), ...((o.scheme && Array.isArray(o.scheme.points)) ? o.scheme.points.map((p) => str(p && p.text)) : [])].join(' ');

function changeTestFlags(examJson) {
  if (!examJson || typeof examJson !== 'object') return [];
  const out = new Map();
  itemsInOrder(examJson).filter((q) => q && /^science\.[ABC]\./.test(str(q.slot)) && !Array.isArray(q.options)).forEach((q) => {
    const subs = Array.isArray(q.questions) ? q.questions.filter((s) => s && typeof s === 'object') : [];
    (subs.length ? subs : [q]).forEach((o) => {
      const key = keyOf(o);
      if (!ABOUT.test(`${str(o.question)} ${subs.length ? '' : str(q.main_question)}`) || !REVERSE.test(key) || NEW_SUBSTANCE.test(key)) return;
      if (!out.has(q.slot)) out.set(q.slot, { slot: q.slot, reason: 'giveaway', words: ['reversibility is not the test of a chemical change'], with: [q.slot], text: ['this key'], printed: false, note: NOTE });
    });
  });
  return [...out.values()];
}

module.exports = { changeTestFlags };
