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
const READER_SUBJECTS = Object.freeze(['urdu', 'social_studies']);
// The slots whose items the reader judges, per subject. Social Studies: T6-A, the Section C/D items
// a child could answer from Section A, or from another C/D item's answer.
const JUDGED = Object.freeze({
  urdu: Object.freeze(['urdu.A.Q1']),
  social_studies: Object.freeze(['social_studies.C.Q5', 'social_studies.D.Q6', 'social_studies.D.Q7']),
});

const READER_MARK = 'READER PASS: board-pattern question paper check';
const PAPER_HEAD = '=== THE QUESTION PAPER, AS PRINTED (no answers) ===';
const KEYS_HEAD = '=== Q1 ANSWER KEY (for you only; the paper does not print it) ===';
const ONLY_HEAD = 'Judge ONLY these items:';
const ANSWERS_HEAD = '=== ANSWERS (for you only; the paper does not print them) ===';
const CANDIDATES_HEAD = '=== CANDIDATES (code found each Q1 key below printed in a Q5, Q6 or Q7 stem) ===';

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
  if (P && P.key === 'social_studies') return buildSstReaderPrompt(examJson, P, opts);
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
    '- another Q1 stem names a person, thing or event from the same story as this item, and that name is this item\'s',
    '  key or fits only its key («سدرہ کی فاختہ آزاد کرنے کے بعد …» gives away «… تکیے کے پاس کیا رکھا تھا؟ → کاغذ کی دو',
    '  فاختائیں»; «… اپنے ڈرامے کہاں پیش کرتے تھے؟» gives away «… کیا بنایا؟ → تھیڑ کمپنی»): the evidence is the name;',
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
    '  کرنے کی» tells a child what «… نے کیا بنایا؟» asks);',
    '- another Q1 item\'s CORRECT option states this item\'s answer, or names its key from the same story («… باغ میں',
    '  بچوں کے ساتھ کیا کیا؟ → فاختائیں فضا میں اڑائیں» gives away «… تکیے کے پاس کاغذ کی کیا چیزیں رکھی تھیں؟ → دو',
    '  فاختائیں»): the evidence is that option. A wrong option that only names it (one name among four) tells nothing.',
    'Do NOT flag:',
    '- two items on the same lesson that test different facts;',
    '- a bare word elsewhere that tells nothing about the answer (a one-word distractor; a name in another stem that',
    '  names two or more of this item\'s options, so the child must still choose);',
    '- a grammar term (اسم معرفہ، فعل، حرفِ عطف …) printed only as the name of a part, a category or a question;',
    '- an item whose stem quotes a sentence or words and asks the child to find a part of them («اگر … تو» → which',
    '  word is the حرفِ شرط): its own quote is the question. Another section printing that pair IS a give-away.',
    'When two Q1 items answer each other, flag only the higher-numbered one.',
    '',
    'Then read the Q1 block on its own, item by item from Q1.1 to the last. For EACH item ask: could a child answer',
    'this item from the text of the other Q1 items (their stems and options)? Judge every item this way, not only the',
    'ones another section touches.',
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

// What a Social Studies item answers, for the reader's eyes only: a key or model answer, and its
// marking points.
function answerOf(q) {
  const points = (q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : [])
    .map((p) => (typeof p === 'string' ? p : p && p.text)).filter((t) => typeof t === 'string' && t.trim()).map(strip);
  return { key: keyOf(q), points };
}

/**
 * Social Studies: the reader judges the Q5, Q6 and Q7 items (T6-A, "a child who answers one has
 * answered the other"): a duplicate, an item whose whole answer Section A prints (a Q1 key, or a fact a
 * Q1 stem states), and an item whose marking points another C/D item's answer already contains.
 * `blocks` hold each label's printed text and its answer, so a quote copied from an answer is found.
 */
function buildSstReaderPrompt(examJson, P, opts = {}) {
  const judged = new Set(JUDGED.social_studies);
  const labels = new Map();
  const blocks = new Map();
  const paper = [];
  const answers = [];
  // Q1's keys and the judged items' stems, folded: a Q1 key a Q5, Q6 or Q7 stem prints is a candidate.
  const q1Keys = [];
  const stems = [];
  for (const section of P.sections) {
    for (const slot of section.slots) {
      const list = itemsOf(examJson, slot.slot);
      if (!list.length) continue;
      const name = slot.slot.split('.').pop();
      const heading = strip(list[0].main_question || slot.label_ur || slot.label_en || '');
      paper.push(`${name}${heading ? `: ${heading}` : ''}`);
      list.forEach((q, i) => {
        const label = list.length > 1 || name === 'Q1' ? `${name}.${i + 1}` : name;
        if (judged.has(slot.slot)) labels.set(label, q);
        const lines = printedLines(q);
        const [first, ...rest] = lines;
        const { key, points } = answerOf(q);
        if (name === 'Q1') q1Keys.push({ label, key, folded: fold(key) });
        if (judged.has(slot.slot)) stems.push({ label, folded: fold(q.question) });
        blocks.set(label, fold([...lines, key, ...points].join(' ')));
        paper.push(`${label} ${first || ''}`.trim());
        rest.forEach((l) => paper.push(`    ${l}`));
        if (name === 'Q1' || judged.has(slot.slot)) {
          answers.push(`${label} → ${key}${points.length && name !== 'Q1' ? ` | points: ${points.join('; ')}` : ''}`);
        }
      });
      paper.push('');
    }
  }
  const only = Array.isArray(opts.only) && opts.only.length
    ? [...labels.entries()].filter(([, q]) => opts.only.includes(q)).map(([label]) => label)
    : null;
  // Every Q1 key (with a word of three letters or more) a judged stem prints, whole words in order: handed to
  // the reader to judge beside its open read, which misses a key printed in a stem on another topic.
  const named = (k) => Boolean(k.folded) && k.folded.trim().split(' ').some((w) => w.length >= QUOTE_WORD);
  const candidates = stems.filter((x) => !only || only.includes(x.label))
    .flatMap((x) => q1Keys.filter((k) => named(k) && x.folded.includes(k.folded)).map((k) => `- ${x.label} prints «${k.key}», the key of ${k.label}`));

  const prompt = [
    READER_MARK,
    '',
    'You check a Grade 5 Social Studies board exam paper before it prints. A child must not be able to answer a',
    'Section C or D item (Q5, Q6, Q7) from text printed ELSEWHERE on the question paper, and no two of those items',
    'may be answered by the same answer.',
    '',
    'The test: a child who answers one has answered the other. Flag a Q5, Q6 or Q7 item when:',
    '- another item on the paper asks the same question, in any wording (a duplicate);',
    '- a Q5, Q6 or Q7 stem that prints a Q1 key (a name, a year or a number) beside that Q1 item\'s topic',
    '  («قراردادِ پاکستان 23 مارچ 1940ء کو …» beside Q1 «قراردادِ پاکستان کس سال منظور ہوئی؟ → 1940ء»), or',
    '  a Q1 item that asks what a Q5 asks («… کیوں سمجھا جاتا ہے؟» beside the Q5 «… کیوں کہا جاتا ہے؟ دو وجوہات لکھیں۔»):',
    '  flag the Q5, Q6 or Q7 item and name the Q1 item in "by";',
    '- a Q1 key, or a fact a Q1 stem states, is its whole answer: Q1 «پاکستان 1947ء میں کس رہنما کی قیادت میں …»',
    '  answers «پاکستان کس سال ابھرا؟ → 1947ء»; two Q1 items that together print its whole answer count too;',
    '- EVERY fact its answer needs is printed in Section A: in a Q1 stem, in a Q1 key, or across two Q1 items. Read every',
    '  Q1 stem as well as its key: a stem that states two facts to ask which idea they describe gives away a Q5 that asks',
    '  for those facts, and a Q5 that asks how two things differ is given away when one Q1 item prints what the first',
    '  does and another prints what the second does. A marking point that only asks for a clear or complete answer adds',
    '  no fact: judge the facts;',
    '- EACH of its marking points is printed in Section A as a Q1 key, across any number of Q1 items (three points,',
    '  three Q1 keys): a child who knows those keys has written its answer. The short reason a point adds after the act',
    '  («… سے غصے میں کہی گئی بات سے بچا جا سکتا ہے») does not save it when the act itself is the key. Name every Q1 label',
    '  in "by" and quote each key;',
    '- a Q1 item asks which act is right («کون سا عمل درست ہے؟», «سب سے بہتر رویہ کون سا ہے؟»), so it tells the child',
    '  that its wrong options are wrong acts: a C/D item EVERY one of whose points is one of those acts, not done, is',
    '  given away by it («بغیر اجازت شیئر نہ کریں» beside the option «… بغیر اجازت شیئر کرنا»). Quote the wrong options.',
    '  When even one point is an act no Q1 item prints, or a reason, a benefit or a definition of its own, it is partial;',
    '- its key is the same answer as a Q1 key in another form (plural, oblique, a longer sentence of the same fact);',
    '- its marking points are contained in another Q5, Q6 or Q7 item\'s answer or marking points: a child who answers',
    '  that item has already written this one\'s answer.',
    'Do NOT flag:',
    '- an item whose fact appears in Q1 only as a wrong option (a distractor), unless that Q1 item asks which act is',
    '  right and the item\'s points are its wrong acts, not done (above);',
    '- the same name, place or tier with a DIFFERENT fact asked about it;',
    '- an item Section A answers only in part: one of its two parts, or its answer without the reasons its points ask for',
    '  (the one exception is the rule above where EACH point\'s act is a Q1 key);',
    '- two items on the same chapter that need different facts.',
    'Which one to flag: when a Q5 and a Q6 or Q7 item answer each other, flag the Q6 or Q7; when a Q6 and a Q7 do,',
    'flag the Q7; two items in one question, the higher-numbered one. A Q5 is flagged only when Section A gives it away.',
    '',
    'Reply with ONE JSON object and nothing after it. List every item you considered as a candidate and decide',
    'each one in its own entry: "given_away": true only when a child really can answer it from that text, false',
    'when, on a closer look, it cannot. Never write a correction or a second object after the first; change the',
    'verdict inside the entry instead.',
    '{"candidates":[{"item":"Q7.<n>","by":"<the label of the text that gives it away: Q1.5, Q5.3, Q6.2 …>","evidence":"<the words, copied exactly from that label\'s printed text, answer or points, that answer the item>","reason":"<one short line>","given_away":true}]}',
    'When the facts are printed in two places, name both labels in "by" (Q1.1, Q1.11) and quote each fact from its own',
    'label in "evidence", the quotes separated by " | ".',
    'Inside a JSON string never use the character "; quote Urdu with « ». Use the labels exactly as printed below.',
    '{"candidates":[]} is the right answer when nothing is given away.',
    ...(only ? ['', `${ONLY_HEAD} ${only.join(', ')}. The other items were already checked: flag one of these when it is`,
      'given away, or when its own text gives away another item (then item is the item given away and by is this one).'] : []),
    '',
    PAPER_HEAD,
    ...paper,
    ANSWERS_HEAD,
    ...answers,
    ...(candidates.length ? ['', CANDIDATES_HEAD,
      'Judge every candidate below as well as reading the whole paper: flag the Q5, Q6 or Q7 item when its stem tells a',
      'child the Q1 item\'s answer, with that Q1 label in "by" and the key, copied from the Q1 item, as the evidence.',
      ...candidates] : []),
  ].join('\n');
  return { prompt, labels, only, blocks, split: true };
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
function parseFlags(reply, labels, only = null, blocks = null, opts = {}) {
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
      // With `split` (Social Studies), facts printed in two places come as two quotes, « | » between
      // them, and each must be printed under a label `by` names. A quote that runs a Q1 stem into its
      // key («… کس ادارے کے پاس ہے؟ (key: مقننہ)») is read a piece at a time: the options print between
      // them, and the reader's own «key:» or «…» is not on the paper.
      const named3 = (q) => q.trim().split(' ').some((w) => w.length >= QUOTE_WORD);
      const segments = opts.split ? evidence.split(/\s*\|\s*/) : [evidence];
      const quotes = (opts.split ? segments.flatMap((q) => q.split(/[؟?۔()…]+|\.{2,}|\b(?:key|answer)\s*:/i)) : segments).map(fold).filter(Boolean);
      // Every quote the reader separated names something: «… | کا» is one fact, not two.
      const real = quotes.length > 0 && segments.every((q) => named3(fold(q)))
        && (opts.split ? quotes.some(named3) : quotes.every(named3));
      const named = giversOf(by, blocks).filter((label) => label !== item);
      const placed = quotes.map((q) => named.filter((label) => blocks.get(label).includes(q)));
      const givers = [...new Set(placed.flat())];
      const stem = fold(labels.get(item) && labels.get(item).question);
      if (!real || !quotes.every((q, i) => placed[i].length || stem.includes(q))) continue;
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
 * The note a top-up carries: what was taken off and why (Section A for Urdu, Section D for Social Studies).
 * An Urdu flag carries its item (`q`) and, when another Q1 item gave it away, that kept `partner`: the
 * top-up is told the partner's fact too, or it writes the same fact again in a new shape (a plural key,
 * another stem). `labels`, when given, finds an item a flag names only by label.
 */
function readerNote(flags, labels = null, P = null) {
  if (P && P.key === 'social_studies') {
    const lines = flags.map((f) => {
      const q = labels.get(f.item);
      return `- ${strip(q && q.question)} → ${q ? keyOf(q) : ''}${f.reason ? `: ${f.reason}` : ''}`;
    });
    return 'A reader of this paper found that these items can be answered from Section A or from another item\'s answer, '
      + `so they are taken off it; never write these again, in any wording:\n${lines.join('\n')}\n`
      + 'Every new item must need an answer that no Section A item prints and no other item on this paper asks for.';
  }
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
  READER_SUBJECTS, JUDGED, READER_MARK, PAPER_HEAD, KEYS_HEAD, ONLY_HEAD, ANSWERS_HEAD,
  buildReaderPrompt, parseFlags, readerNote, inQ1, itemsOf, keyOf, fold, giversOf,
};
