'use strict';
/**
 * A who-said MCQ whose character names are not in the book text the generator held (bd-5jmnfj.4.58.2).
 * v26 G2 Urdu Q1 iv offered «غصیلے کیڑے» and «تگیا»; the book dialogue has «غصیلا بھنورا» and «تتلیا».
 * The text is `loaded.content`, the page range the model was given. Flags come back as
 * `{slot, reason:'answer', items}` so the writer asks the section again with answerNote.
 *
 * Pure: exam JSON, page text and pattern in, flags out; never throws.
 */

const WHO_SAID = /کس نے[^؟?]*(?:کہا|کہی|بولا|بولی|پوچھا|پوچھی|جواب دیا)/;
const MIN_TEXT = 200; // shorter than this is no source to check against
const POSTPOSITIONS = new Set(['نے', 'کو', 'سے', 'کا', 'کی', 'کے', 'نے۔']);
const label = (o) => String(o == null ? '' : o).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '').trim();
// Diacritics out, the Arabic and Urdu forms of ی and ک made one.
const plain = (s) => String(s).normalize('NFC').replace(/[ً-ٰٟ]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
// A word's stem: its last letter goes, so ا / ے / ی endings do not count as a different name.
const stem = (w) => (w.length >= 4 ? w.slice(0, -1) : w);

// The words of an option that are names (not نے, کو...), plain.
const nameWords = (opt) => plain(label(opt)).split(/[\s،۔.,]+/).filter((w) => w.length > 1 && !POSTPOSITIONS.has(w));

/** The unfound words among the options, given the book text. */
function namesNotInText(options, text) {
  const book = plain(text);
  const lost = [];
  (options || []).forEach((o) => nameWords(o).forEach((w) => { if (!book.includes(stem(w)) && !lost.includes(w)) lost.push(w); }));
  return lost;
}

function eachItem(examJson, fn) {
  ['seen', 'unseen'].forEach((branch) => Object.values((examJson && examJson[branch]) || {}).forEach((types) => {
    Object.values(types || {}).forEach((list) => { if (Array.isArray(list)) list.forEach((q) => q && fn(q)); });
  }));
}

/** Who-said items offering a name the book text lacks, as `{slot, reason:'answer', items}`. */
function whoSaidShortfall(examJson, pageText, P) {
  try {
    if (typeof pageText !== 'string' || pageText.length < MIN_TEXT) return [];
    const slots = new Set(((P && P.sections) || []).flatMap((s) => s.slots || []).map((sl) => sl.slot));
    const bySlot = new Map();
    eachItem(examJson, (q) => {
      if (!slots.has(q.slot) || !Array.isArray(q.options) || !WHO_SAID.test(String(q.question))) return;
      const lost = namesNotInText(q.options, pageText);
      if (!lost.length) return;
      if (!bySlot.has(q.slot)) bySlot.set(q.slot, []);
      bySlot.get(q.slot).push(`${String(q.question).trim()} → ${label(q.answer)} (the book text does not hold: ${lost.join(', ')}; every choice must be a name as the book writes it)`);
    });
    return [...bySlot].map(([slot, items]) => ({ slot, reason: 'answer', items }));
  } catch (_) {
    return [];
  }
}

module.exports = { whoSaidShortfall, namesNotInText };
