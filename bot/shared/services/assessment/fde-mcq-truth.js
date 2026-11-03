'use strict';
/**
 * A multiple-choice stem that cannot be answered as printed (bd-5jmnfj.4.58.34). v29 G5 Urdu Q1 item 5
 * «سدرہ کے گھر کے باہر کس شہر پر ایٹم بم کا حملہ ہوا؟» placed a city «outside Sidra's house» and had two true
 * options (ہیروشیما and ناگاساکی were both bombed); item 4 «شیخ سعدی کی کتاب جس میں حکایات موجود ہیں» had
 * بوستان and گلستان, both books of حکایات.
 *
 * Two checks, both flag the MCQ's slot so its section is asked again:
 *  - KNOWN PAIRS: a short list of textbook facts that two named things share. When a stem matches the pair's
 *    `when` and both names are options, two options are true. This is a known-pairs list, not generic
 *    detection: it grows as papers show a new pair.
 *  - STEM PARSE (narrow): an Urdu stem that sets a dwelling or building «کے باہر / کے اندر …» and then asks for
 *    a city, country or province («کس شہر»). A city is never outside somebody's house; the stem is two questions.
 *
 * Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed}` out.
 */

const { itemsInOrder, choice } = require('./fde-near-repeats');

const MARKS = /[ً-ٰٟـ]/g;
const norm = (s) => String(s == null ? '' : s).replace(MARKS, '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim().toLowerCase();
const isMcq = (q) => Array.isArray(q.options) && q.options.length > 1;
const excerpt = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 70);

const PAIRS = [
  { names: ['ہیروشیما', 'ناگاساکی'], when: /ایٹم|بم/, fact: 'both cities were hit by an atom bomb' },
  { names: ['hiroshima', 'nagasaki'], when: /atom|bomb/, fact: 'both cities were hit by an atom bomb' },
  { names: ['بوستان', 'گلستان'], when: /حکایت|حکایات/, fact: 'both books hold حکایات' },
  { names: ['قائداعظم', 'محمد علی جناح'], when: /./, fact: 'both names are one person' },
  { names: ['should', 'could'], when: /advice|advise/, fact: 'both modals give advice' },
  { names: ['should', 'ought to'], when: /advice|advise/, fact: 'both modals give advice' },
  { names: ['quaid-e-azam', 'muhammad ali jinnah'], when: /./, fact: 'both names are one person' },
];

// «سدرہ کے گھر کے باہر کس شہر پر …»: a dwelling or building, a locative, then a question word for a city or country.
const PLACE_OF = '(?:گھر|مکان|کمرے|کمرہ|اسکول|دکان|باغ|دروازے)';
const PLACE_Q = new RegExp(`${PLACE_OF}\\s+(?:کے|کی)\\s+(?:باہر|اندر|سامنے|قریب|پاس|اوپر|نیچے|پیچھے)\\s+(?:کس|کون\\s*سے|کون\\s*سی|کون\\s*سا)\\s+(?:شہر|ملک|صوبے|گاؤں|جزیرے)`);

function flagFor(out, q, word, text) {
  const r = out.get(q.slot) || { slot: q.slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
  if (!r.words.includes(word)) r.words.push(word);
  r.with.push(q.slot);
  r.text.push(text);
  out.set(q.slot, r);
}

/** One flag per MCQ slot holding an item with two true options or a stem that does not parse. */
function mcqTruthFlags(examJson) {
  if (!examJson) return [];
  const out = new Map();
  itemsInOrder(examJson).filter(isMcq).forEach((q) => {
    const stem = norm(q.question);
    const options = q.options.map((o) => norm(choice(o)));
    PAIRS.forEach(({ names, when, fact }) => {
      const hits = names.map((n) => options.some((o) => o === n || o.split(' ').join(' ').includes(n)));
      if (hits.every(Boolean) && when.test(stem)) {
        flagFor(out, q, names.join(' / '), `two options are both true (${fact}): «${excerpt(q.question)}»; give each item exactly one true option`);
      }
    });
    const place = PLACE_Q.exec(stem);
    if (place) {
      flagFor(out, q, place[0], `the stem places a city or country outside a house and then asks which one: «${excerpt(q.question)}»; write one grammatical question`);
    }
  });
  return [...out.values()];
}

module.exports = { mcqTruthFlags };
