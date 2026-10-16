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
// Letters only, one form each (Arabic ي/ك/ه/ة as Urdu), no diacritics, spaces or punctuation: how a
// quote the reader copied is found in the text it was copied from.
const fold = (t) => String(t == null ? '' : t).normalize('NFC')
  .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[هة]/g, 'ہ')
  .replace(/[^\p{L}\p{N}]/gu, '')
  .toLowerCase();

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
    '- its own stem prints its key (a spelling item whose stem prints the right spelling anywhere, even inside a longer phrase);',
    '- its own printed text answers an item of ANOTHER section (its stem prints «اگر … تو», the pair a Q4 item asks the',
    '  child to supply; its stem prints a Q3/Q5 word with its meaning): by is that item\'s label, and the evidence is the',
    '  words in the Q1 item that answer it;',
    '- Q3 or Q5 asks the child to explain or use the word or idiom that is its key, or the word whose meaning it asks;',
    '- the Q6 verses or the Q2 passage state its answer.',
    'Do NOT flag:',
    '- two items on the same lesson that test different facts;',
    '- a word that appears elsewhere without pointing to the answer (an option that is only a distractor elsewhere);',
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
    ...(only ? ['', `${ONLY_HEAD} ${only.join(', ')}. The other items were already checked; flag none of them.`] : []),
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
function giversOf(by, blocks) {
  const named = String(by || '').split(/[\s,،/&+]+|and/).map((x) => x.trim()).filter((x) => /^Q\d+(\.\d+)?$/.test(x));
  return [...blocks.keys()].filter((label) => named.some((n) => label === n || label.startsWith(`${n}.`)));
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
    const item = f.item.trim();
    if (!labels.has(item) || seen.has(item) || (only && !only.includes(item))) continue;
    const by = typeof f.by === 'string' ? f.by.trim() : '';
    const evidence = typeof f.evidence === 'string' ? strip(f.evidence) : '';
    if (blocks) {
      // The quote is printed under the giver, or, when the Q1 item gives another section away, under the item.
      const quote = fold(evidence);
      // Under the item it is its stem's, never its options': its own options are what the child picks from.
      const stem = fold(labels.get(item) && labels.get(item).question);
      if (quote.length < 2 || !(giversOf(by, blocks).some((label) => blocks.get(label).includes(quote)) || stem.includes(quote))) continue;
    }
    seen.add(item);
    out.push({ item, by, evidence, reason: typeof f.reason === 'string' ? strip(f.reason) : '' });
  }
  return out;
}

// A flag whose giver is another Q1 item: the give-away stays inside Section A.
const inQ1 = (flag) => /^Q1(\.|$)/.test(flag.by || '');

/** The note the Section A top-up carries: what was taken off and why. */
function readerNote(flags, labels) {
  const lines = flags.map((f) => {
    const q = labels.get(f.item);
    return `- ${strip(q && q.question)} → ${q ? keyOf(q) : ''}${f.reason ? `: ${f.reason}` : ''}`;
  });
  return 'A reader of this paper found that these Section A items can be answered from text printed elsewhere on '
    + `the paper, so they are taken off it; never write these again, in any wording:\n${lines.join('\n')}\n`
    + 'Every new item must test a fact that no other item and no other section of this paper prints or answers.';
}

module.exports = {
  READER_SUBJECTS, READER_MARK, PAPER_HEAD, KEYS_HEAD, ONLY_HEAD,
  buildReaderPrompt, parseFlags, readerNote, inQ1, itemsOf, keyOf, fold, giversOf,
};
