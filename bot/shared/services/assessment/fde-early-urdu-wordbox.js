'use strict';
/**
 * Word-box blanks must be uniquely fillable (v29 blocker, G1 Urdu Q5, bd-5jmnfj.4.58). «میری ایک ___ ہے۔» and
 * «بنٹی کی ___ گم ہو گئی تھی۔» both took بہن and گڑیا from the box, and the key paid one word each.
 *
 * The check is grammatical, from the paper's own keys, with no word list: a box word's gender and number are read
 * from the frame it is keyed to (میری/کی/تھی/گئی feminine; میرا/کا/تھا/گیا masculine; میرے/کے/تھے/گئے plural or
 * oblique). A blank is OPEN when its frame holds only function words (possessives, numbers, copulas, a possessor
 * name) and so says nothing about meaning. A box word of the blank's class fits an open blank. Any box word that
 * fits another open blank than its own is a clash:
 *   boxClashes  flags the slot ({slot, reason:'answer', items}) for the writer's re-ask (fde-key-checks consults it);
 *   wordBoxFix  if the paper still ships, two words that fit each other's blanks are accepted in both keys.
 *
 * Pure.
 */

const { mapItems, itemsOf } = require('./fde-early-urdu-walk');

const BOX_TYPES = new Set(['Complete the Sentences', 'Fill in the Blanks']);
const CLASS_OF = new Map();
[['F', ['میری', 'کی', 'تھی', 'گئی']], ['S', ['میرا', 'کا', 'تھا', 'گیا']], ['P', ['میرے', 'کے', 'تھے', 'گئے']]]
  .forEach(([c, words]) => words.forEach((w) => CLASS_OF.set(w, c)));
const FUNCTION = new Set(['میں', 'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو', 'دس', 'ہے', 'ہیں', 'ہوں', 'تھا', 'گم', 'ہو', 'یہ', 'وہ']);
const BLANK = /_{2,}|…+/u;

const bare = (s) => String(s == null ? '' : s).replace(/[۔.،!؟?:"“”«»()\s]+/gu, ' ').trim().normalize('NFC');
const tokensOf = (frame) => bare(frame).split(' ').filter(Boolean);

function frameClass(frame) {
  const tally = {};
  tokensOf(frame).forEach((t) => { if (CLASS_OF.has(t)) tally[CLASS_OF.get(t)] = (tally[CLASS_OF.get(t)] || 0) + 1; });
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  return ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : '';
}

function isOpen(frame) {
  const tokens = tokensOf(String(frame).replace(/_{2,}|…+/gu, ' '));
  return tokens.every((t, i) => CLASS_OF.has(t) || FUNCTION.has(t) || (CLASS_OF.has(tokens[i + 1]) && !/ں$/u.test(t) && !CLASS_OF.has(t)));
}

const keyed = (examJson, slot) => itemsOf(examJson, slot).filter((q) => BLANK.test(String(q.question || '')) && String(q.answer || '').trim());

function wordClasses(list) {
  const classes = new Map();
  list.forEach((q) => { const c = frameClass(q.question); if (c) classes.set(bare(q.answer), c); });
  return classes;
}

/** True when `word` (read as the key of one of the paper's frames) fits the open frame `frame`. */
function fits(examJson, word, frame) {
  const all = [];
  mapItems(examJson, (q) => { if (BLANK.test(String(q.question || ''))) all.push(q); return q; });
  const c = wordClasses(all).get(bare(word));
  return Boolean(c) && isOpen(frame) && frameClass(frame) === c;
}

function clashesOf(examJson, slot) {
  const list = keyed(examJson, slot);
  const box = ((itemsOf(examJson, slot).find((q) => Array.isArray(q.words) && q.words.length) || {}).words || []).map(bare);
  const classes = wordClasses(list);
  const out = [];
  list.forEach((q) => {
    const own = new Set([bare(q.answer)].concat(((q.scheme && q.scheme.accept) || []).map(bare)));
    box.filter((w) => !own.has(w) && classes.has(w) && isOpen(q.question) && frameClass(q.question) === classes.get(w))
      .forEach((w) => out.push({ item: q, word: w }));
  });
  return out;
}

/** Slots (by `P`) of Urdu box types whose blanks take a box word that is not their key. */
function boxClashes(examJson, P) {
  const slots = ((P && P.sections) || []).flatMap((s) => s.slots || []).filter((sl) => BOX_TYPES.has(sl.type) && sl.print_words);
  return slots.map((sl) => {
    const hits = clashesOf(examJson, sl.slot);
    return hits.length ? {
      slot: sl.slot, reason: 'answer',
      items: hits.map(({ item, word }) => `${String(item.question).trim()} → ${String(item.answer).trim()} (the box word ${word} fits this blank too; a blank must take only one box word)`),
    } : null;
  }).filter(Boolean);
}

const POSTPOSITION = new Set(['میں', 'پر', 'سے', 'کو', 'کا', 'کی', 'کے', 'تک']);

/** The oblique spelling (ا to ے) of a masculine -ا key when the blank sits between an oblique modifier (اپنے) and a postposition. */
function obliqueOf(q) {
  const t = tokensOf(q.question);
  const at = t.findIndex((w) => /^_{2,}$|^…+$/u.test(w));
  const key = bare(q.answer);
  if (at < 1 || !POSTPOSITION.has(t[at + 1]) || !/ے$/u.test(t[at - 1]) || !/ا$/u.test(key)) return null;
  return key.replace(/ا$/u, 'ے');
}

/** Two box words that each fit the other's open blank are accepted in both keys. */
function wordBoxFix(examJson) {
  const notes = [];
  const slots = new Set();
  mapItems(examJson, (q, type) => { if (BOX_TYPES.has(type)) slots.add(q.slot); return q; });
  const extra = new Map();
  slots.forEach((slot) => {
    const hits = clashesOf(examJson, slot);
    hits.forEach(({ item, word }) => {
      const mate = hits.find((h) => bare(h.item.answer) === word && h.word === bare(item.answer));
      if (!mate) return;
      extra.set(item, (extra.get(item) || []).concat(word));
    });
  });
  const out = mapItems(examJson, (q, type) => {
    const ob = BOX_TYPES.has(type) ? obliqueOf(q) : null;
    if (ob && !(extra.get(q) || []).includes(ob)) extra.set(q, (extra.get(q) || []).concat(ob));
    const add = extra.get(q);
    if (!add) return q;
    const scheme = { ...(q.scheme || {}) };
    scheme.accept = (scheme.accept || []).concat([q.answer], add);
    scheme.accept = [...new Map(scheme.accept.map((w) => [bare(w), w])).values()];
    notes.push(`${q.slot}: «${bare(q.answer)}» also takes «${add.join('، ')}» from the box; both are accepted`);
    return { ...q, scheme };
  });
  return { examJson: out, notes };
}

module.exports = { boxClashes, wordBoxFix, fits, frameClass, isOpen };
