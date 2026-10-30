'use strict';
/**
 * G1/G2 Urdu "make a sentence with the word" (v37r4 g1-urdu Q9 i): every model and alternate sentence holds the
 * asked word. The alternate «امی کو دیکھ کر میں خوش ہوا» had no «خوشی», and its accept text ran two ideas
 * into one garbled line. An alternate without the word is dropped; the trailing clause "but any correct sentence
 * with the word" is split off and reprinted as one clean sentence. A model answer without the word is flagged
 * for a re-ask (never rewritten). Pure.
 */

const { mapItems, URDU_EARLY } = require('./fde-early-urdu-walk');
const { eachItem } = require('./fde-urdu-walk-all');

const TYPE = 'Make Sentences';
const CLAUSE = /\s*[،,]\s*لیکن\s+لفظ\s*«[^»]+»\s*کے\s+ساتھ\s+ہر\s+درست\s+جملہ\s*$/u;
const strip = (s) => String(s || '').replace(/[ً-ٰٟۖ-ۭ]/g, '').replace(/[۔،؟!:"“”«»().]/g, '').trim();
const holds = (text, word) => strip(text).includes(word);
const stopped = (s) => (/[۔؟!]$/.test(s) ? s : `${s}۔`);
// needs fluent-Urdu review
const clause = (word) => `لفظ «${word}» کے ساتھ کوئی بھی درست جملہ قبول ہے۔`;

function mendAccept(accept, word, asked) {
  const out = [];
  accept.forEach((e) => {
    const text = String(e);
    const m = CLAUSE.exec(text);
    if (m) {
      const head = text.slice(0, m.index).trim();
      if (head && holds(head, word)) out.push(stopped(head));
      out.push(clause(asked));
    } else if (holds(text, word)) out.push(text);
  });
  return [...new Set(out)];
}

function useWordFix(examJson) {
  const notes = [];
  const out = mapItems(examJson, (q, type) => {
    const accept = q.scheme && q.scheme.accept;
    if (type !== TYPE || !Array.isArray(accept) || !accept.length) return q;
    const asked = String(q.question || '').replace(/[«»]/g, '').trim();
    const word = strip(asked);
    if (!word || /\s/.test(word)) return q; // the item is the bare asked word
    const next = mendAccept(accept, word, asked);
    if (next.length === accept.length && next.every((e, i) => e === accept[i])) return q;
    notes.push(`${q.slot}: an alternate sentence without «${asked}» was dropped or the accept text was made one clean sentence`);
    return { ...q, scheme: { ...q.scheme, accept: next } };
  });
  return { examJson: out, notes };
}

/** A model answer without the asked word, as an answer flag for a re-ask. */
function useWordShortfall(examJson, P) {
  const types = new Map(((P && P.sections) || []).flatMap((s) => s.slots || []).map((sl) => [sl.slot, sl.type]));
  const bySlot = new Map();
  eachItem(examJson, (q) => {
    if (!URDU_EARLY.test(String(q.slot || '')) || types.get(q.slot) !== TYPE) return;
    const word = strip(String(q.question || ''));
    if (!word || /\s/.test(word) || holds(q.answer, word)) return; // only an item that is the bare asked word
    if (!bySlot.has(q.slot)) bySlot.set(q.slot, []);
    bySlot.get(q.slot).push(`${word} → ${String(q.answer).trim()} (the model sentence does not hold the asked word; every model sentence uses it)`);
  });
  return [...bySlot].map(([slot, items]) => ({ slot, reason: 'answer', items }));
}

module.exports = { useWordFix, useWordShortfall };
