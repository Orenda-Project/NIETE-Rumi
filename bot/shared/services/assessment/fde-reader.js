'use strict';
/**
 * The reader pass of a board-pattern paper: one model call that reads the question paper as the
 * child sees it and names the Section A Q1 items a child could answer from text printed elsewhere
 * on it.
 *
 * The string holds in fde-layout.js catch a give-away whose text repeats: a key printed in another
 * stem, a Q4 sentence in a Q1 stem. A give-away that shares no text with the item it gives away is
 * out of their reach: «نہ جانے، کیا خبر اور شاید … کس قسم کے جملوں میں آتے ہیں؟ → شکیہ» answers
 * «کون سا جملہ شکیہ ہے؟». A reader sees it.
 *
 * This file only builds the prompt and reads the reply; the engine (generatePatternExam) decides
 * what a flag does to the paper. The paper text is built here from the fields the question paper
 * prints, never from an answer, a scheme or a pick list's words.
 */

// Only these subjects are ever read, whatever the setting lists.
const READER_SUBJECTS = Object.freeze(['urdu']);

const READER_MARK = 'READER PASS: board-pattern question paper check';
const PAPER_HEAD = '=== THE QUESTION PAPER, AS PRINTED (no answers) ===';
const KEYS_HEAD = '=== Q1 ANSWER KEY (for you only; the paper does not print it) ===';
const ONLY_HEAD = 'Judge ONLY these items:';

const OPTION_HEAD = /^\s*\(?(?:[a-dA-D]|الف|ب|ج|د)\s*[).]\s*/u;
const strip = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
// One form per letter (Arabic ي/ك/ه/ة as Urdu, Arabic-Indic digits as Urdu), no diacritics or
// punctuation, word by word: how a quote the reader copied is found in the text it was copied from.
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const foldWord = (w) => w.normalize('NFC')
  .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[هة]/g, 'ہ')
  .replace(/[٠-٩]/g, (d) => String.fromCharCode(0x06F0 + ARABIC_DIGITS.indexOf(d)))
  .replace(/[^\p{L}\p{N}]/gu, '')
  .toLowerCase();
const wordsOf = (t) => String(t == null ? '' : t).split(/[\s\p{P}\p{S}]+/u).map(foldWord).filter(Boolean);
// ' w1 w2 … ': a quote matches whole words in order, never the inside of a word.
const fold = (t) => { const w = wordsOf(t); return w.length ? ` ${w.join(' ')} ` : ''; };
// A quote names something only with a word of three letters or more («کا» is everywhere).
const QUOTE_WORD = 3;

function itemsOf(examJson, slotId) {
  const out = [];
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values((examJson && examJson[branch]) || {})) {
      for (const list of Object.values(types || {})) {
        if (Array.isArray(list)) out.push(...list.filter((q) => q && typeof q === 'object' && q.slot === slotId));
      }
    }
  }
  return out;
}

const keyOf = (q) => (typeof q.answer === 'string' ? strip(q.answer.replace(OPTION_HEAD, '')) : '');

// What the question paper prints of one item: stems, options, passages, word lists, a part's
// heading and questions, a pick part's categories and an antonym part's first words.
function printedLines(q) {
  const lines = [];
  const add = (t) => { const s = strip(t); if (s) lines.push(s); };
  add(q.question);
  if (typeof q.passage === 'string') q.passage.split('\n').forEach(add);
  if (Array.isArray(q.options)) add(q.options.filter((o) => typeof o === 'string').join(' | '));
  if (Array.isArray(q.words)) add(q.words.filter((w) => typeof w === 'string').join('، '));
  for (const list of [q.questions, q.pick_questions, q.antonym_questions]) {
    if (Array.isArray(list)) list.forEach((s) => s && add(s.question));
  }
  for (const part of Array.isArray(q.parts) ? q.parts : []) {
    if (!part || typeof part !== 'object') continue;
    add(part.main_question);
    add(part.question);
    if (Array.isArray(part.questions)) part.questions.forEach((s) => s && add(s.question));
    if (part.pick && typeof part.pick === 'object') add(Object.keys(part.pick).join('، '));
    if (Array.isArray(part.antonyms)) add(part.antonyms.map((p) => (Array.isArray(p) ? p[0] : p)).filter((w) => typeof w === 'string').join('، '));
  }
  return lines;
}

/**
 * buildReaderPrompt(examJson, P, { only }) → { prompt, labels }
 *
 * `labels` maps each Q1 label («Q1.7», in printed order) to its item. `only`, a list of Q1 items,
 * asks the reader to judge those alone (the re-check of replacements).
 */
function buildReaderPrompt(examJson, P, opts = {}) {
  const labels = new Map();
  const blocks = new Map(); // label → the text printed under it, folded (for the evidence check)
  const paper = [];
  for (const section of P.sections) {
    for (const slot of section.slots) {
      const list = itemsOf(examJson, slot.slot);
      if (!list.length) continue;
      const name = slot.slot.split('.').pop();
      const heading = strip(list[0].main_question || slot.label_ur || slot.label_en || '');
      paper.push(`${name}${heading ? `: ${heading}` : ''}`);
      list.forEach((q, i) => {
        const label = list.length > 1 || name === 'Q1' ? `${name}.${i + 1}` : name;
        if (name === 'Q1') labels.set(label, q);
        const lines = printedLines(q);
        const [first, ...rest] = lines;
        blocks.set(label, fold(lines.join(' ')));
        paper.push(`${label} ${first || ''}`.trim());
        rest.forEach((l) => paper.push(`    ${l}`));
      });
      paper.push('');
    }
  }
  const keys = [...labels.entries()].map(([label, q]) => `${label} → ${keyOf(q)}`);
  const only = Array.isArray(opts.only) && opts.only.length
    ? [...labels.entries()].filter(([, q]) => opts.only.includes(q)).map(([label]) => label)
    : null;

  const prompt = [
    READER_MARK,
    '',
    'You check a Grade 5 board exam paper before it prints. A child must not be able to answer a Section A',
    'Q1 item from text printed ELSEWHERE on the question paper: another Q1 item\'s stem or options, the Q2',
    'passage or its questions, the Q3/Q5 word lists, a Q4 item or its options, the Q6 verses, or any other prompt.',
    '',
    'The test: a child who answers one has answered the other. Flag a Q1 item when:',
    '- its key, or the exact phrase that is its key, is printed elsewhere in a way that points to it;',
    '- another item\'s printed text states the rule or the answer that answers it (a concept twin:',
    '  «نہ جانے، کیا خبر، شاید → شکیہ» answers «کون سا جملہ شکیہ ہے؟»);',
    '- another item\'s stem DEFINES a term, and this item asks for that term or an example of it: «جو لفظ کسی انسان،',
    '  جانور یا بے جان چیز کی آواز ظاہر کرے» ایسے اسم کی مثال … answers «… اسمِ صوت کون سا ہے؟», and the reverse;',
    '  the evidence is the definition;',
    '- its own stem QUOTES the word its key is built from, a word no other option carries, even inside a longer',
    '  word or phrase («ان پڑھ» اور «روٹی» جیسے ایک ہی املا … → «ان اور ان»): the evidence is the quoted words;',
    '- its own stem prints its key (a spelling item whose stem prints the right spelling anywhere, even inside a longer phrase);',
    '- its own printed text answers an item of ANOTHER section (its stem prints «اگر … تو», the pair a Q4 item asks the',
    '  child to supply; its stem prints a Q3/Q5 word with its meaning): by is that item\'s label, and the evidence is the',
    '  words in the Q1 item that answer it;',
    '- Q3 or Q5 asks the child to explain or use the word or idiom that is its key, or the word whose meaning it asks;',
    '- the Q6 verses or the Q2 passage state its answer;',
    '- the SENSE of a verse line or a passage sentence answers it, in other words than its key (a verse that asks',
    '  «یہ گندگی ہے کیسی؟» answers «نظم میں ندی کیا چاہتی ہے؟ → اسے صاف کیا جائے»): the evidence is that line;',
    '- its own stem explains its key: besides the word or idiom it asks about, the stem prints a phrase that means',
    '  what the key means («ٹکڑا ٹکڑا ہو جانا» کے مفہوم میں «… چکنا چور ہونا» → «امیدوں کا ٹوٹ جانا»);',
    '- another form of its key is printed elsewhere: the same idiom or word with another verb ending or inflection',
    '  (Q1 asks «دھوم مچ جانا», Q5 sets «دھوم مچانا»);',
    '- an option of another item states its answer as a fact, even as a wrong option («ب) … کی تھیڑ کمپنی بند',
    '  کرنے کی» tells a child what «… نے کیا بنایا؟» asks).',
    'Do NOT flag:',
    '- two items on the same lesson that test different facts;',
    '- a bare word elsewhere that tells nothing about the answer (a one-word distractor, a name in another stem);',
    '- a grammar term (اسم معرفہ، فعل، حرفِ عطف …) printed only as the name of a part, a category or a question;',
    '- an item whose stem quotes a sentence or words and asks the child to find a part of them («اگر … تو» → which',
    '  word is the حرفِ شرط): its own quote is the question. Another section printing that pair IS a give-away.',
    'When two Q1 items answer each other, flag only the higher-numbered one.',
    '',
    'Reply with ONE JSON object and nothing after it. List every item you considered as a candidate and decide',
    'each one in its own entry: "given_away": true only when a child really can answer it from that text, false',
    'when, on a closer look, it cannot. Never write a correction or a second object after the first; change the',
    'verdict inside the entry instead.',
    '{"candidates":[{"item":"Q1.<n>","by":"<the label of the text that gives it away: Q1.13, Q2, Q3, Q4.2, Q5, Q6 …>","evidence":"<the words, copied exactly from the text printed under that label, that answer the item>","reason":"<one short line>","given_away":true}]}',
    'Inside a JSON string never use the character "; quote Urdu with « ». Use the labels exactly as printed below.',
    '{"candidates":[]} is the right answer when nothing is given away.',
    ...(only ? ['', `${ONLY_HEAD} ${only.join(', ')}. The other items were already checked: flag one of these when it is`,
      'given away, or when its own text gives away another item (then item is the item given away and by is this one).',
      'Read each of these against EVERY other Q1 item on the paper, one pair at a time: one that asks the same fact of the',
      'book as another item, in other words or with another form of its key (singular or plural: «فاختہ» / «فاختائیں»), is',
      'given away by that item (item is this one, by is the other, evidence is the words of the other that state the fact).'] : []),
    '',
    PAPER_HEAD,
    ...paper,
    KEYS_HEAD,
    ...keys,
  ].join('\n');
  return { prompt, labels, only, blocks };
}

/**
 * The reply's flags that name a Q1 label of this prompt (and, on a re-check, one it asked about),
 * once each. Throws when the reply carries no flags list: that is a failed read, not a clean one.
 */
// The labels a flag's `by` names that are on the paper: «Q4» names every Q4 item, «Q3/Q5» both.
// A bare «Q1» names no item: twenty stems are not a giver.
function giversOf(by, blocks) {
  const named = String(by || '').split(/[\s,،/&+]+|\band\b/i).map((x) => x.trim().replace(/[.:]+$/, '')).filter((x) => /^Q\d+(\.\d+)?$/.test(x));
  return [...blocks.keys()].filter((label) => named.some((n) => label === n || (n !== 'Q1' && label.startsWith(`${n}.`))));
}

/**
 * The reply's candidates judged given away that name a Q1 label of this prompt (and, on a
 * re-check, one it asked about), once each, whose evidence is printed under the label `by` names. With `blocks` (the prompt's),
 * a flag whose quote is not on the paper where it says is dropped: the reader saw nothing there.
 * Throws when the reply carries no candidates list: that is a failed read, not a clean one.
 */
function parseFlags(reply, labels, only = null, blocks = null) {
  if (!reply || typeof reply !== 'object' || !Array.isArray(reply.candidates)) throw new Error('reader reply has no candidates list');
  const seen = new Set();
  const out = [];
  for (const f of reply.candidates) {
    if (!f || typeof f !== 'object' || typeof f.item !== 'string' || f.given_away !== true) continue;
    let item = f.item.trim();
    let by = typeof f.by === 'string' ? f.by.trim() : '';
    if (!labels.has(item)) continue;
    const evidence = typeof f.evidence === 'string' ? strip(f.evidence) : '';
    let gives = false;
    if (blocks) {
      // The quote is printed under the giver, never the item's own block (its options are what the
      // child picks from), or in the item's own stem (it prints its key, or answers another section).
      const quote = fold(evidence);
      const real = quote && quote.trim().split(' ').some((w) => w.length >= QUOTE_WORD);
      const givers = giversOf(by, blocks).filter((label) => label !== item && blocks.get(label).includes(quote));
      const stem = fold(labels.get(item) && labels.get(item).question);
      if (!real || !(givers.length || stem.includes(quote))) continue;
      // On a re-check, a kept item given away BY a replacement takes the replacement off.
      if (only && !only.includes(item)) {
        const repl = givers.find((label) => only.includes(label));
        if (!repl) continue;
        [item, by, gives] = [repl, item, true];
      }
    } else if (only && !only.includes(item)) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push({ item, by, evidence, reason: typeof f.reason === 'string' ? strip(f.reason) : '', ...(gives ? { gives } : {}) });
  }
  return out;
}

// A flag whose giver is another Q1 item: the give-away stays inside Section A.
const inQ1 = (flag) => /^Q1(\.|$)/.test(flag.by || '');

/**
 * The note a Section A top-up carries: what was taken off and why. Each flag carries its item (`q`)
 * and, when another Q1 item gave it away, that kept `partner`: the top-up is told the partner's fact
 * too, or it writes the same fact again in a new shape (a plural key, another stem). `labels`, when
 * given, finds an item a flag names only by label.
 */
function readerNote(flags, labels = null) {
  const lines = flags.map((f) => {
    const q = f.q || (labels && labels.get(f.item));
    const p = f.partner;
    const line = `- ${strip(q && q.question)} → ${q ? keyOf(q) : ''}${f.reason ? `: ${f.reason}` : ''}`;
    return p ? `${line}\n  The paper keeps ${strip(p.question)} → ${keyOf(p)}: never ask that fact again, in any wording, in the singular or the plural.` : line;
  });
  return 'A reader of this paper found that these Section A items can be answered from text printed elsewhere on '
    + `the paper, so they are taken off it; never write these again, in any wording:\n${lines.join('\n')}\n`
    + 'Every new item must test a fact that no other item and no other section of this paper prints or answers.';
}

module.exports = {
  READER_SUBJECTS, READER_MARK, PAPER_HEAD, KEYS_HEAD, ONLY_HEAD,
  buildReaderPrompt, parseFlags, readerNote, inQ1, itemsOf, keyOf, fold, giversOf,
};
