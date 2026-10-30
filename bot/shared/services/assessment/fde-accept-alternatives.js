'use strict';
/**
 * Two right answers, one keyed (round 6 blockers, bd-5jmnfj.4.58.9.1). v35 G1 English Q9 iii «The little bird can
 * ___ sweet songs.» keyed sing while hear, from the same box, also fits: its own common error read "Choosing hear".
 * v35 G2 English Q10 v «The duck is ____ the tree.» keyed behind while near, from the printed list, is also true.
 * A match row that fits two Column B phrases is the same defect.
 *
 * The child picks from a list: a word box (`words`), a list printed in the instruction ("fill in the blank with in,
 * on, under, near or behind"), or Column B of a match (every row's answer). Another listed choice is a SECOND FIT
 * when the writer says so in `scheme.also_fits`, when the item's common error names it bare ("Choosing hear": an
 * error that does not say why the word is wrong is a word the writer found close), or when the list item's answer
 * implies it (a thing behind another is near it).
 *   alternativeShortfall  flags those items as `{slot, reason:'answer', items}` for the writer's re-ask.
 *   acceptAlternatives    a list whose choices may be used again (prepositions) takes every second fit into
 *                         accept, so the marking scheme prints it; a word box or match is a one-use list, so its
 *                         item is asked again rather than widened. `also_fits` never prints.
 *   ONE_FIT_RULE          the prompt sentence asking for the check and the field.
 * English common errors only: an Urdu box is checked by its grammar (fde-early-urdu-wordbox).
 *
 * Pure: exam JSON and pattern in; never throws, never mutates.
 */

const ONE_FIT_RULE = 'Where the child picks from a list (a word box, words listed in the instruction, Column B of a match), test every other listed choice against each item: if a second choice also gives a true, sensible answer, rewrite the item so only its key fits; where the list may be used again (prepositions), name each other true choice in `scheme.also_fits` and in accept. A common error never names a choice that would be right.';

const BOX_TYPES = new Set(['Complete the Sentences', 'Fill in the Blanks']);
// The error says why the word is wrong, or names a class of word: not a second fit.
const QUALIFIED = /\b(does ?n[o']t|do not|not (fit|make|match|right)|wrong|incorrect|such as|like|different|instead of|spell|unrelated|any other|another|confus|mix)/i;
// List answers that make another listed choice true as well (v35 G2 Q10 v: the duck behind the tree is near it).
const IMPLIES = { behind: ['near'] };
const LIST = /\b(?:with|from|use|using|write|choose)\s+((?:[a-z']+\s*,\s*)+[a-z']+\s*,?\s+or\s+[a-z']+)\s*\.?\s*$/i;

const norm = (w) => String(w == null ? '' : w).replace(/^\s*\(?[^\s)]{1,3}\)\s+/, '').replace(/[.,!?؟۔،]+$/u, '').trim().toLowerCase().normalize('NFC');
const isMatch = (def) => !!def && (def.shape === 'match' || /\bmatch/i.test(String(def.type || '')));
const isBox = (def, items) => !!def && (BOX_TYPES.has(def.type) || items.some((q) => Array.isArray(q.words) && q.words.length));

function eachList(examJson, fn) {
  ['seen', 'unseen'].forEach((branch) => Object.values((examJson && examJson[branch]) || {}).forEach((types) => {
    Object.entries(types || {}).forEach(([type, list]) => { if (Array.isArray(list)) fn(type, list); });
  }));
}

function slotDefs(P) {
  return new Map(((P && P.sections) || []).flatMap((s) => (s && s.slots) || []).filter((sl) => sl && sl.slot).map((sl) => [sl.slot, sl]));
}

/** The listed choices an item's child picks from: box words, an instruction list, or a match's Column B. */
function choicesOf(q, slotItems, def) {
  if (!q || typeof q !== 'object') return [];
  const items = Array.isArray(slotItems) ? slotItems.filter((x) => x && typeof x === 'object') : [];
  if (isMatch(def)) return items.map((x) => x.answer).filter((a) => typeof a === 'string' && a.trim());
  const box = (Array.isArray(q.words) && q.words.length ? q : items.find((x) => Array.isArray(x.words) && x.words.length) || {}).words;
  if (box) return box.slice();
  const text = [q.main_question, def && def.instruction_en].find((t) => typeof t === 'string' && LIST.test(t));
  if (!text) return [];
  return text.match(LIST)[1].split(/\s*,\s*|\s+or\s+/).map((w) => w.trim()).filter(Boolean);
}

const isEnglish = (s) => typeof s === 'string' && /[a-z]/i.test(s) && !/[؀-ۿ]/.test(s);

/** The second fits of one item, as {word, why}, never the key or an accepted answer. */
function secondFits(q, choices, oneUse) {
  if (!q || !q.scheme || typeof q.scheme !== 'object' || !choices.length) return [];
  const taken = new Set([q.answer].concat(Array.isArray(q.scheme.accept) ? q.scheme.accept : []).map(norm));
  const open = choices.filter((c) => !taken.has(norm(c)));
  const has = (w) => open.find((c) => norm(c) === norm(w));
  const out = [];
  const add = (word, why) => { if (word && !out.some((o) => norm(o.word) === norm(word))) out.push({ word, why }); };
  (Array.isArray(q.scheme.also_fits) ? q.scheme.also_fits : []).forEach((w) => add(has(w), 'the writer lists it as also fitting'));
  if (!oneUse) (IMPLIES[norm(q.answer)] || []).forEach((w) => add(has(w), `a thing ${norm(q.answer)} another is ${w} it too`));
  const err = q.scheme.common_error;
  if (isEnglish(err) && !QUALIFIED.test(err)) {
    open.filter((c) => new RegExp(`(^|[^a-z'])${norm(c).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z']|$)`, 'i').test(err))
      .forEach((c) => add(c, `the common error names it ("${err.trim()}") without saying why it is wrong`));
  }
  return out;
}

function bySlot(examJson, defs, fn) {
  eachList(examJson, (type, list) => {
    const groups = new Map();
    list.forEach((q) => { if (q && typeof q === 'object' && defs.has(q.slot)) (groups.get(q.slot) || groups.set(q.slot, []).get(q.slot)).push(q); });
    groups.forEach((items, slot) => fn(slot, items, defs.get(slot), list));
  });
}

/** Items with a second listed choice that fits, as re-ask flags `{slot, reason:'answer', items}`. */
function alternativeShortfall(examJson, P) {
  try {
    const defs = slotDefs(P);
    const out = [];
    bySlot(examJson, defs, (slot, items, def) => {
      const oneUse = isMatch(def) || isBox(def, items);
      const bad = [];
      items.forEach((q) => {
        // A reusable list's also_fits and implied choices are mended into accept below; only a bare common error is asked again.
        const fits = secondFits(q, choicesOf(q, items, def), oneUse).filter((f) => oneUse || /common error/.test(f.why));
        if (!fits.length) return;
        const words = fits.map((f) => `${f.word} (${f.why})`).join('; ');
        bad.push(`${String(q.question).trim()} → ${String(q.answer).trim()} (another listed choice also fits: ${words}; ${oneUse
          ? 'rewrite the item so only its key fits, and give a common error that is truly wrong'
          : 'set the item so only its key is true, or list each other true choice in accept'})`);
      });
      if (bad.length) out.push({ slot, reason: 'answer', items: bad });
    });
    return out;
  } catch (e) {
    return [];
  }
}

/** Reusable-list items take their second fits into accept; `also_fits` is dropped from every item. */
function acceptAlternatives(examJson, P) {
  const notes = [];
  try {
    if (!examJson || typeof examJson !== 'object') return { examJson, notes };
    const defs = slotDefs(P);
    const swap = new Map();
    bySlot(examJson, defs, (slot, items, def) => {
      const oneUse = isMatch(def) || isBox(def, items);
      items.forEach((q) => {
        const fits = oneUse ? [] : secondFits({ ...q, scheme: { ...q.scheme, common_error: null } }, choicesOf(q, items, def), false);
        const hasField = q.scheme && Object.prototype.hasOwnProperty.call(q.scheme, 'also_fits');
        if (!fits.length && !hasField) return;
        const { also_fits: _drop, ...scheme } = q.scheme;
        if (fits.length) {
          scheme.accept = (Array.isArray(scheme.accept) ? scheme.accept : [q.answer]).concat(fits.map((f) => f.word));
          notes.push(`${slot}: «${String(q.question).trim()}» also accepts ${fits.map((f) => f.word).join(', ')}`);
        }
        swap.set(q, { ...q, scheme });
      });
    });
    if (!swap.size) return { examJson, notes };
    const out = { ...examJson };
    ['seen', 'unseen'].forEach((branch) => {
      if (!out[branch] || typeof out[branch] !== 'object') return;
      out[branch] = Object.fromEntries(Object.entries(out[branch]).map(([k, types]) => [k, types && typeof types === 'object'
        ? Object.fromEntries(Object.entries(types).map(([t, list]) => [t, Array.isArray(list) ? list.map((q) => swap.get(q) || q) : list]))
        : types]));
    });
    return { examJson: out, notes };
  } catch (e) {
    return { examJson, notes: [] };
  }
}

module.exports = { ONE_FIT_RULE, choicesOf, alternativeShortfall, acceptAlternatives };
