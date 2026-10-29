'use strict';
/**
 * Answer words the paper gives away elsewhere (bd-5jmnfj.4.50.8). v22 G1 Urdu keyed «بلی» in Q3 iv
 * and Q7 iii and printed it in Q1 i's stem; «گاجر» was a wrong choice in Q1 ii and the key to Q1 vi.
 *
 * An answer word is a one-word key of three letters or more (a sentence, a sum or a letter is not).
 * It is given away when another item prints it (stem, choices, a word box of another question, a word
 * or question on the oral sheet) or keys it too. Not a give-away: a word the slot keys more than once,
 * two items offering the same set of choices (is/are, has/have), or a function word any sentence uses.
 *
 * Each pair flags the question set later on the paper, as repeatedPictures does; one the oral sheet
 * gives away flags the written item. Pure: reads the exam JSON only.
 *
 * v23 (bd-5jmnfj.4.51.3) widened what counts: a picture's name, sub-questions and answer text of other items
 * (answer text only for words of four letters or more); the words that tell a multiple-choice key from its
 * wrong options («salt» in "a jar with salt water"); the target words of a word-list question ("X: parts"
 * answer lines, or the list after a colon in the stem); and a crude stem (viruses/virus, salty/salt).
 *
 * v25 (bd-5jmnfj.4.55): an Urdu key of two letters («سچ»); a one-word topic choice (`topics`); with the oral
 * tasks known, only a read-aloud word (a listening or speaking ask is heard, not read); a written item asking
 * an oral item's question, keyed with its answer ('oral-question'); the same labelled diagram twice; and a
 * "name the three" key whose parts another stem prints. Each flag says whether its word is `printed` (a child
 * sees it on the paper) or found only in answer text.
 *
 * v26 (bd-5jmnfj.4.57): an Urdu ending stem (بندروں/بندر, اندھیری/اندھیرا); an order list's words and a one-word
 * stem (Make Sentences «چاند») as targets; a two-word target (دندان ساز) matched as a phrase; a written stem
 * naming a heard oral item's person beside its answer word ('oral-answer'); and fde-near-repeats' questions
 * that answer one another in different words.
 *
 * v27 (bd-5jmnfj.4.58.2): near-repeats also compares two written answers and an MCQ key with a mark point; a
 * situation part that states what an earlier part asks (fde-situation-check).
 */

const WORD = /[\p{L}\p{M}]+/gu;
// A grammar item keys these (are, she, under, اور); every other stem prints them, so they give nothing away.
const FUNCTION_WORDS = new Set(('are was were has have had she they you his her him them our their this that these those '
  + 'the and but with from for into over under near behind above below اور ہیں تھا تھی تھے کا کی کے نے کو سے ہے پر یہ وہ تو').split(' '));
const ARABIC = /[\u0600-\u06FF]/; // an Urdu key of two letters («سچ») is a word; an English one ("is") is not
const { nearRepeats } = require('./fde-near-repeats');
const { situationGiveaways } = require('./fde-situation-check');
const wordsOf = (s) => String(s == null ? '' : s).normalize('NFC').toLowerCase().match(WORD) || [];
const optionsOf = (q) => (Array.isArray(q.options) ? q.options : []);
// "الف) گاجر" -> "گاجر", as fde-early-prompt reads a choice.
const choice = (o) => String(o).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '').trim();

// Crude plural / -y / -ed stem for the words a picture does not name: a picture item keeps exact words,
// since its key is spelt from the picture and «flower» is no give-away in "The flowers are red."
// An Urdu word without its plural or gender ending, while four letters remain (ٹڈی/ٹڈا and شیر/شیریں stay
// apart). Used only to find a key printed in another slot, not in the checks above it.
const URDU_END = /(وں|یں|ے|ی|ا)$/;
const urduStem = (w) => { const m = ARABIC.test(w) && URDU_END.exec(w); return m && [...w].length - [...m[0]].length >= 4 ? w.slice(0, -m[0].length) : w; };
const stem = (w, loose = true) => {
  if (!loose || !/^[a-z]+$/.test(w) || w.length < 5) return w;
  if (/(ss|us|is)$/.test(w)) return w;
  if (/es$/.test(w) && /(s|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w)) return w.slice(0, -1);
  if (/(y|ed)$/.test(w)) return w.slice(0, w.endsWith('y') ? -1 : -2);
  return w;
};
const GENERIC = new Set(['more', 'less', 'most', 'many', 'much', 'same', 'only']); // comparatives are not an answer
const longWord = (w) => [...w].length >= 4 && !FUNCTION_WORDS.has(w) && !GENERIC.has(w);
const targetWord = (w) => longWord(w) || (ARABIC.test(w) && [...w].length >= 3 && !FUNCTION_WORDS.has(w));
// The slot types whose whole stem is the word list: an order list («انگور، تربوز، بندر»), a word to use in a sentence («چاند»).
const WHOLE_STEM_LIST = /alphabetical|order|make sentences|use in sentences/i;
const subs = (q) => (Array.isArray(q.questions) ? q.questions.filter(Boolean) : []);

/** The item's one-word key, lower-cased; null for a sentence, a sum, a number or a single letter. */
function answerWord(q) {
  if (/\d/.test(String(q.answer == null ? '' : q.answer))) return null; // "6 + 5 = 11 pencils": the unit is not the key
  const w = wordsOf(choice(q.answer == null ? '' : q.answer));
  return w.length === 1 && [...w[0]].length >= (ARABIC.test(w[0]) ? 2 : 3) && !FUNCTION_WORDS.has(w[0]) ? w[0] : null;
}

const choiceSet = (q) => optionsOf(q).map((o) => wordsOf(choice(o)).join(' ')).sort().join('|');

// A multiple-choice key's own words: those no wrong option has («salt» in "a jar with salt water").
function distinctive(q) {
  const opts = optionsOf(q).map((o) => wordsOf(choice(o)));
  const key = wordsOf(choice(q.answer == null ? '' : q.answer)).join(' ');
  const at = opts.findIndex((w) => w.join(' ') === key);
  if (opts.length < 2 || at < 0 || opts[at].length < 3) return [];
  const others = new Set(opts.filter((_, k) => k !== at).flat());
  const own = opts[at].filter((w) => longWord(w) && !others.has(w));
  return own.length === 1 ? own : []; // a key that differs by one word; more than one is a different answer, not a word to hide
}

// The words a word-list question asks about: the list after the colon in the stem
// ("write in parts: A, B"), an order list that is the whole stem («انگور، تربوز، بندر»), a one-word stem
// (Make Sentences «چاند») and a one-word topic choice («Recycling»). Answer-line leads are not read:
// they are speaker names and field labels.
const topicsOf = (q) => (Array.isArray(q.topics) ? q.topics : []);
function listParts(q, type) {
  const t = String(q.question == null ? '' : q.question);
  const m = /[:：]([^:：]*)$/.exec(t);
  if (m) return m[1].split(/[،,]/).map(wordsOf);
  const parts = t.split(/[،,]/).map(wordsOf);
  return WHOLE_STEM_LIST.test(type || '') && parts.every((w) => w.length === 1) ? parts : [];
}
function targets(q, type) {
  const out = new Set();
  listParts(q, type).forEach((w) => { if (w.length === 1) out.add(w[0]); });
  topicsOf(q).forEach((t) => { const w = wordsOf(t); if (w.length === 1) out.add(w[0]); });
  return [...out].filter(targetWord);
}
// An Urdu target of two or three words (دندان ساز), matched as a phrase; «اس نے» is no target.
const phrasesOf = (q) => listParts(q).filter((w) => w.length > 1 && w.length <= 3 && w.every((x) => ARABIC.test(x) && targetWord(x))).map((w) => w.join(' '));

// What a "label" stem asks to draw: its long words after the last "the" (Label the parts of the human
// respiratory system -> human, respiratory, system). Empty for any other stem.
function diagramOf(q) {
  const t = String(q.question == null ? '' : q.question);
  if (!/\blabel\b/i.test(t)) return [];
  const at = t.toLowerCase().lastIndexOf('the ');
  return [...new Set(wordsOf(at < 0 ? t : t.slice(at + 4)).filter(longWord))];
}
const NAME_N = /\bname (?:the |any )?(two|three|four|five)\b/i;
const NUM = { two: 2, three: 3, four: 4, five: 5 };

function itemsInOrder(examJson) {
  const order = new Map();
  ((examJson._layout && examJson._layout.sections) || []).forEach((s) => (s.slots || []).forEach((sl) => order.set(sl.slot, order.size)));
  const list = [];
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values(examJson[branch] || {})) {
      for (const l of Object.values(types || {})) if (Array.isArray(l)) list.push(...l.filter(Boolean));
    }
  }
  const at = (q) => (order.has(q.slot) ? order.get(q.slot) : order.size);
  return list.map((q, i) => ({ q, i })).sort((a, b) => at(a.q) - at(b.q) || a.i - b.i).map((x) => x.q);
}

const excerpt = (q) => String(q.question || '').replace(/\s+/g, ' ').trim().slice(0, 70);

// The oral sheet's asks that put words in front of a child: with the task kinds known, only the read-aloud
// ones (a listening or speaking ask is heard, not read); with none on the sheet, every ask, as before v25.
function oralAsks(oralLayout) {
  const tasks = Array.isArray(oralLayout.tasks) && oralLayout.tasks.length ? oralLayout.tasks : null;
  const kind = (id) => { const t = tasks && tasks.find((x) => x.id === id); return t ? t.kind : null; };
  return (oralLayout.content || []).map((c) => ({ c, readAloud: !tasks || kind(c.id) === 'read_aloud', heard: Boolean(tasks) && kind(c.id) !== 'read_aloud' }));
}

/** `{slot, reason:'giveaway', words, with, text, printed}` for each question whose answer word another question gives away. */
function answerRepeats(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson);
  const types = new Map();
  ((examJson._layout && examJson._layout.sections) || []).forEach((s) => (s.slots || []).forEach((sl) => types.set(sl.slot, sl.type)));
  // A bag of words: exact, and stemmed. A picture item's key is matched exactly (see `stem`).
  const bag = (texts) => {
    const raw = new Set(texts.flatMap(wordsOf));
    const st = new Set([...raw].map((w) => stem(w)));
    return { has: (w, loose) => (loose ? st.has(stem(w)) : raw.has(w)) };
  };
  const printedTexts = list.map((q) => [q.question, ...optionsOf(q), q.picture && q.picture.name, ...topicsOf(q), ...subs(q).map((s) => s.question)]);
  const printed = printedTexts.map(bag);
  const urduPrinted = printedTexts.map((t) => new Set(t.flatMap(wordsOf).filter((w) => ARABIC.test(w)).map(urduStem)));
  // Answer text is checked by word of four letters or more: a key of three letters is no give-away there.
  const answered = list.map((q) => bag([q.answer, ...subs(q).map((s) => s.answer)].flatMap(wordsOf).filter(longWord)));
  const banks = list.map((q) => bag(Array.isArray(q.words) ? q.words : []));
  const keys = list.map(answerWord);
  const kws = list.map((q, i) => (keys[i] ? [{ w: keys[i], strict: false }]
    : distinctive(q).map((w) => ({ w, strict: true, printedOnly: true })).concat(targets(q, types.get(q.slot)).map((w) => ({ w, strict: true })))));
  // The oral sheet's words and questions, not its story: a story read aloud uses everyday words.
  const sheet = oralAsks((examJson._layout && examJson._layout.oral) || {});
  const oralWords = bag(sheet.filter((x) => x.readAloud).flatMap((x) => (x.c.items || []).map((it) => it && it.ask)));
  const out = new Map();
  const flag = (slot, word, other, text, seen = true) => {
    const r = out.get(slot) || { slot, reason: 'giveaway', words: [], with: [], text: [] };
    if (!r.words.includes(word)) r.words.push(word);
    if (!r.with.includes(other)) { r.with.push(other); r.text.push(text); }
    if (seen) r.printed = true; // absent, not false, when no child sees it: flags read as before v25
    out.set(slot, r);
  };
  list.forEach((q, i) => kws[i].forEach(({ w, strict, printedOnly }) => {
    const loose = !q.picture;
    if (!strict && keys.filter((k, j) => k === w && list[j].slot === q.slot).length > 1) return;
    if (!strict && oralWords.has(w, loose)) flag(q.slot, w, 'oral', 'the oral sheet', false); // the oral re-ask's, not printed on the paper
    list.forEach((o, j) => {
      if (j === i || (optionsOf(q).length && choiceSet(q) === choiceSet(o))) return;
      const other = o.slot !== q.slot;
      const seen = (printedOnly ? printed[j].has(w, loose) && answered[j].has(w, true) : printed[j].has(w, loose)) || (!printedOnly && ((other && banks[j].has(w, loose))
        || (other && ARABIC.test(w) && urduPrinted[j].has(urduStem(w)))
        || (keys[j] && (loose ? stem(keys[j]) === stem(w) : keys[j] === w)) || (other && kws[j].some((k) => (loose ? stem(k.w) === stem(w) : k.w === w)))));
      const hit = seen || (!printedOnly && loose && w.length > 3 && answered[j].has(w, true));
      if (!hit || (strict && !other)) return;
      if (j > i) flag(o.slot, w, q.slot, excerpt(q), seen); else flag(q.slot, w, o.slot, excerpt(o), seen);
    });
  }));
  // v27 G1/G2 Urdu (bd-5jmnfj.4.58.3): a word the child reads aloud from the card and then meets printed in a stem, an
  // option or a key is read twice. Every read-aloud word is checked against each item's print and key, not only the keys.
  const readAloud = [...new Set(sheet.filter((x) => x.readAloud).flatMap(({ c }) => (c.items || []).flatMap((it) => wordsOf(it && it.ask)))
    .filter((w) => [...w].length >= 3 && !FUNCTION_WORDS.has(w) && !GENERIC.has(w)))];
  readAloud.forEach((w) => list.forEach((q, j) => {
    const inPrint = printed[j].has(w, true) || (ARABIC.test(w) && urduPrinted[j].has(urduStem(w)));
    if (inPrint || (keys[j] && stem(keys[j]) === stem(w))) flag(q.slot, w, 'oral', 'the oral sheet', false);
  }));
  // A written item asking a heard oral item's question, keyed with that item's answer, is the same question twice.
  sheet.filter((x) => x.heard).forEach(({ c }) => (c.items || []).forEach((it) => {
    const ask = wordsOf(it && it.ask).filter((w) => [...w].length >= 3 && !FUNCTION_WORDS.has(w));
    const said = new Set(wordsOf(it && it.answer));
    if (ask.length < 2) return;
    list.forEach((q, i) => {
      const stemWords = new Set(wordsOf(q.question));
      if (keys[i] && said.has(keys[i]) && ask.every((w) => stemWords.has(w))) flag(q.slot, keys[i], 'oral-question', excerpt({ question: it.ask }), false);
    });
  }));
  // The same labelled diagram twice, and a "name the three" key whose parts another stem prints: the later item.
  const later = (i, j, words) => (j > i ? flag(list[j].slot, words, list[i].slot, excerpt(list[i])) : flag(list[i].slot, words, list[j].slot, excerpt(list[j])));
  const diagrams = list.map(diagramOf);
  // Stems only: a wrong choice naming a part ("bones, nerves, muscles, lungs") does not answer the list.
  const stems = list.map((q) => bag([q.question, ...subs(q).map((s) => s.question)]));
  list.forEach((q, i) => {
    const n = NAME_N.exec(String(q.question == null ? '' : q.question));
    const own = new Set(wordsOf(q.question));
    const parts = n ? [...new Set(wordsOf(q.answer).filter((w) => longWord(w) && !own.has(w)))] : [];
    list.forEach((o, j) => {
      if (j === i || o.slot === q.slot) return;
      const d = diagrams[i];
      if (j > i && d.length && diagrams[j].length && (d.every((w) => diagrams[j].includes(w)) || diagrams[j].every((w) => d.includes(w)))) {
        (d.length <= diagrams[j].length ? d : diagrams[j]).forEach((w) => later(i, j, w));
      }
      const shown = parts.filter((w) => stems[j].has(w, true));
      if (n && shown.length >= NUM[n[1].toLowerCase()]) shown.forEach((w) => later(i, j, w));
    });
  });
  // A two-word target another slot prints as a phrase (a choice «د) دندان ساز»).
  const said = list.map((q) => [q.question, ...optionsOf(q).map(choice), ...subs(q).map((s) => s.question)].map((t) => ` ${wordsOf(t).join(' ')} `));
  list.forEach((q, i) => phrasesOf(q).forEach((p) => list.forEach((o, j) => {
    if (o.slot !== q.slot && said[j].some((t) => t.includes(` ${p} `))) later(i, j, p);
  })));
  // A written stem naming a heard oral item's person beside a word of its answer: the stem tells the answer.
  sheet.filter((x) => x.heard).forEach(({ c }) => (c.items || []).forEach((it) => {
    const ask = String((it && it.ask) || '');
    const names = (ask.match(/[\p{L}]+/gu) || []).slice(1).filter((w) => /^\p{Lu}/u.test(w)).map((w) => w.toLowerCase());
    const askWords = new Set(wordsOf(ask));
    const answer = wordsOf(it && it.answer).filter((w) => longWord(w) && !askWords.has(w));
    if (!names.length || !answer.length) return;
    list.forEach((q) => {
      const st = new Set(wordsOf(q.question));
      if (!names.some((w) => st.has(w))) return;
      answer.filter((w) => st.has(w)).forEach((w) => flag(q.slot, w, 'oral-answer', excerpt({ question: ask }), false));
    });
  }));
  situationGiveaways(examJson).concat(nearRepeats(examJson)).forEach((f) => f.with.forEach((s, k) => f.words.forEach((w) => flag(f.slot, w, s, f.text[k]))));
  return [...out.values()];
}

/** The flagged slots still giving an answer away once a section has been asked again. */
const stillGivenAway = (examJson) => answerRepeats(examJson);

/** The flags a written section's re-ask can fix: an oral-sheet give-away alone is the oral re-ask's. */
const writtenGiveaways = (flags) => flags.filter((f) => f.with.some((w) => w !== 'oral'));

/** A re-ask's note naming the answer words this section's flagged questions give away; null if none. */
function giveawayNote(shortfall) {
  const flags = shortfall.filter((f) => f.reason === 'giveaway');
  const words = [...new Set(flags.flatMap((f) => f.words))];
  if (!words.length) return null;
  const where = flags.flatMap((f) => (f.with || []).map((s, k) => `${s}${f.text && f.text[k] ? ` («${f.text[k]}»)` : ''}`));
  return `These answers already appear elsewhere on this paper: ${words.join(', ')}. `
    + `The other place${where.length > 1 ? 's' : ''}: ${[...new Set(where)].join('; ')}. `
    + 'Rewrite the items so that no answer word is printed in any other question, choice or word box, or is the answer to another item.';
}

module.exports = { answerRepeats, answerWord, giveawayNote, stillGivenAway, writtenGiveaways };
