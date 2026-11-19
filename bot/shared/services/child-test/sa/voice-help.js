'use strict';
/**
 * The another-voice check, help only (app_settings sa_r28_voice_help, OFF by default; read by the sweep).
 *
 * The audio check asks "is another person heard?". On real recordings that is nearly always yes (a coach saying
 * "louder", "press next", a teacher in the corridor), and the flag went up on most tests while hand checks found a
 * person HELPING the child (saying an item or the answer, correcting, building the answer) in a few. Help changes a
 * score; support does not. ON, each clip gets a speech-to-text transcript split by speaker, and a text model reads it
 * beside the task's own items and answers and labels the clip:
 *
 *   help         another person gives content: says or reads an item the child must read or answer, says or starts
 *                the answer, corrects the child, or builds the answer with the child          → FLAG
 *   other_child  a second child reads or answers along                                         → FLAG
 *   support      instructions, procedure, encouragement, reading a sum or question aloud (the app does too), side talk
 *   unclear      a second person may speak, but the words cannot tell support from help      → logged, never a flag
 *   none         only the child, the phone's own voice, or silence
 *
 * A flag needs evidence: the model quotes the other person's words, and those words must be in the transcript (as the
 * stricter check sa_r26_voice_strict does). A help label whose quote is not in the transcript is kept as "unclear".
 * No word heard: none, and no model call. The quote is never kept (it can hold a name); the label, a fixed `kind`,
 * the task's own words the quote holds and the ids of those items are, so Results can say what happened and where
 * ("an adult said the answer (word 7)"), not just "another voice".
 * Still a flag, never a change of mark.
 */

const LABELS = ['none', 'support', 'unclear', 'help', 'other_child'];
const KINDS = ['said_answer', 'read_item', 'corrected', 'prompted', 'read_along', ''];
const FLAGS = new Set(['help', 'other_child']);

const SCHEMA = {
  name: 'sa_voice_help',
  schema: {
    type: 'object', additionalProperties: false, required: ['label', 'kind', 'who', 'evidence', 'confidence'],
    properties: {
      label: { type: 'string', enum: LABELS },
      kind: { type: 'string', enum: KINDS },
      who: { type: 'string', enum: ['adult', 'child', 'unsure', 'none'] },
      evidence: { type: 'string' },
      confidence: { type: 'number' },
    },
  },
};

const clip1 = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

/** What the task asked of the child and what counts as the answer: the model compares the other person's words to it. */
function contentOf(task) {
  const rec = (task && task.record) || {};
  const sub = String(task.subtask || task.task || '');
  if (rec.passage && rec.passage.text) {
    return `The child reads this passage aloud (any word of it said by someone else is HELP):\n${clip1(rec.passage.text, 1200)}`;
  }
  if (Array.isArray(rec.questions) && rec.questions.length) {
    const qs = rec.questions.map((q, i) => `${i + 1}. ${(q.prompt && q.prompt.text) || q.show || q.word || ''} → answer: ${(q.accept || []).slice(0, 4).join(' / ') || '-'}`);
    return `The child answers these questions about a story it read (the app reads each question aloud; an adult reading or translating a question is SUPPORT, giving or starting the answer is HELP):\n${qs.join('\n')}`;
  }
  const items = Array.isArray(rec.items) ? rec.items : [];
  if (items.length && items.some((x) => x && x.answer != null && /[+\-−×x÷]/.test(String(x.show || '')))) {
    const list = items.map((x, i) => `${i + 1}: ${x.show} = ${x.answer}`).join(' | ');
    return `The child solves these sums and says each RESULT (reading a sum aloud is SUPPORT; saying, starting or building the result is HELP):\n${list}`;
  }
  const grid = (rec.grid || []).map(String);
  const answers = rec.answers || [];
  const list = grid.map((x, i) => `${i + 1}: ${x}${answers[i] && answers[i] !== x ? ` (${answers[i]})` : ''}`).join(' | ');
  if (/sound/.test(sub)) return `The child says the SOUND of each letter shown (saying a letter's sound is HELP; naming the letter, or asking for its sound, is SUPPORT):\n${list}`;
  if (/letter/.test(sub)) return `The child says the NAME of each letter shown (saying a shown letter's name or sound is HELP):\n${list}`;
  if (/number/.test(sub)) return `The child says each number shown (saying a shown number is giving the answer: HELP):\n${list}`;
  return `The child reads each item shown (saying or spelling out a shown word is HELP):\n${list}`;
}

function promptOf(task, turns) {
  const L = task.lang === 'en' ? 'English' : task.lang === 'ur' ? 'Urdu' : 'maths';
  return `A phone recorded a child (grade 1-5, a Pakistani government school) doing ONE ${L} task of an EGRA/EGMA test. A coach may sit with the child, and teachers or other children may be nearby. Below are the task and a speech-to-text transcript of the whole recording, in turns. The speaker labels (spk1, spk2…) come from an automatic step that is often wrong: one person can be split in two, and a child and an adult can be merged in one turn. Use what the words say to tell who is speaking. The phone's own narrator may be heard giving instructions ("اب آپ کی باری", "آگے کا بٹن دبائیں", "پہلے مشق کرتے ہیں", "تیار ہو جائیں") or reading a question: that is the app, not a person.

THE TASK
${contentOf(task)}

THE TRANSCRIPT ([seconds] speaker: words)
${turns || '(no words)'}

Did anyone OTHER than the tested child HELP in a way that can change the score? Labels:
- "help": another person gives content: says or reads an item the child has to read or answer, says or starts an answer, corrects the child ("no, it is…", "what did you miss?" before the child changes the answer), builds the answer with the child (counting on, splitting a sum, spelling out a word, a hint toward the answer), asks the same item again after a WRONG answer and the child then changes to the RIGHT answer, or repeats the child's answer back with the content changed (the right word after the child's wrong one).
- "other_child": a second child reads or answers the same items along with the tested child.
- "support": another person speaks without content: instructions, procedure, encouragement ("louder", "press next", "go on", "well done", "think"), repeating the child's own answer back unchanged, asking a question again when the child had not answered, does not change the answer, or changes it to another wrong answer, reading a sum or a question aloud, translating a question (unless the translation holds the answer), or side talk (adults chatting, a phone call, a teacher teaching the class, another test nearby).
- "unclear": another person may be speaking, but the words are too few, garbled or merged to tell support from help.
- "none": only the tested child, the phone's own voice, or silence.
Pick the strongest that applies: help > other_child > support > unclear > none.
Three kinds of help are easy to miss:
1. A second attempt. Compare each answer of the child with the task's answer. If the other person asks the same item again, or puts it another way, right after a WRONG answer ("-3?", "کیا لگایا، زمین میں؟"), and the child then gives a different answer and the new answer is right, that is help (kind "corrected"). If the new answer is still wrong, or the child keeps the same answer, the re-ask is support: the score cannot move. Telling the child to read the passage again from some point ("دوبارہ پڑھو، یہاں سے") is help too.
2. A demonstration. Someone explaining how the test works who says the task's items aloud (e.g. "دال، پھر بچہ کہتا ہے دال") gives the answers away: help (kind "read_item"), even when no child answers.
3. A changed repeat. The other person repeats the child's answer with different content (the right word after the child's wrong one), and the child takes it up: help (kind "corrected").
A word is not another person's just because its turn has another speaker label: the tested child is often split across two labels. Pick "help" only when the words show another person (they speak TO the child, instruct or ask, or say an item or answer that the child then repeats), or when someone explains the task and reads its items aloud. One short word or number under another label, with nothing else showing a second person, is "unclear".
For "help" or "other_child", evidence = the other person's words that show it, copied EXACTLY from the transcript; if you cannot quote such words, do not pick help. Otherwise evidence = "".
kind: for help, "said_answer" (said or started the answer, or said the item the child had to read), "read_item" (read a word or passage words for the child), "corrected" or "prompted" (built the answer, gave a hint); for other_child, "read_along"; else "".
who: who the other person is ("adult", "child", "unsure", or "none" when nobody else speaks).
Return ONLY JSON: {"label": "...", "kind": "...", "who": "...", "evidence": "...", "confidence": <0-1>}`;
}

/**
 * The model's answer → the check's verdict. A flag (help / other_child) stands only when its quote is in the
 * transcript (`heard(quote)` true); otherwise the clip is "unclear", logged and not flagged.
 * { label, kind, flag: true | false, why }
 */
function decide(json, heard) {
  const label = json && LABELS.includes(json.label) ? json.label : null;
  if (!label) return { label: null, kind: '', flag: null, why: 'no_label' };
  const kind = KINDS.includes(json.kind) ? json.kind : '';
  if (!FLAGS.has(label)) return { label, kind: '', flag: false, why: label };
  if (!heard(String(json.evidence || ''))) return { label: 'unclear', kind: '', flag: false, why: 'not_corroborated' };
  return { label, kind: kind || (label === 'other_child' ? 'read_along' : 'prompted'), flag: true, why: 'words_heard' };
}

// Urdu/Arabic digits as ASCII, harakat and punctuation dropped: the same word in either script compares equal
const DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const norm = (t) => String(t || '').toLowerCase().normalize('NFC').replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d]).replace(/[\u064B-\u065F\u0670\u06EA-\u06ED]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
const tokens = (t) => String(t || '').split(/[\s،,.؟?!۔:;()«»"'\-—]+/).filter(Boolean);

/** Every word the task itself holds: items shown, answers, accepted answers, question text, the passage. */
function taskWords(task) {
  const rec = (task && task.record) || {};
  const out = new Set();
  const add = (x) => tokens(x).forEach((w) => { const n = norm(w); if (n) out.add(n); });
  (rec.grid || []).forEach(add);
  (rec.answers || []).forEach(add);
  (rec.items || []).forEach((x) => { if (x) { add(x.show); add(x.answer); add(x.target); (x.accept || []).forEach(add); } });
  (rec.questions || []).forEach((q) => { if (q) { add(q.prompt && q.prompt.text); (q.accept || []).forEach(add); } });
  if (rec.passage && rec.passage.text) add(rec.passage.text);
  return out;
}

/**
 * The other person's words that ARE the task's content (an item, an answer, passage words), as `second_voice_reason`:
 * the longest run of the quote's words that the task holds; a lone word counts only when it is a number or 3+ letters.
 * Never the rest of what was said (it can hold a name). '' when nothing matches.
 */
function matchedWords(quote, task) {
  const known = taskWords(task);
  const ws = tokens(quote);
  let best = [];
  let cur = [];
  for (const w of ws) {
    if (known.has(norm(w))) { cur.push(w); if (cur.length > best.length) best = cur.slice(); } else cur = [];
  }
  if (best.length === 1 && !/^\p{N}+$/u.test(norm(best[0])) && norm(best[0]).length < 3) return '';
  return best.join(' ');
}

/*
 * Across scripts. On an English task the coach often speaks Urdu, and speech-to-text writes the English word in Urdu
 * script («پلانٹ» for plant) or spells it in Urdu letter names («ایف کے بعد آئی» for f, i). Both sides go to a
 * consonant skeleton (vowels, w/y/h and their Urdu letters dropped), and letter names to their letters.
 */
const UR_SK = { 'ب': 'b', 'پ': 'p', 'ت': 't', 'ٹ': 't', 'ث': 's', 'ج': 'j', 'چ': 'C', 'خ': 'k', 'د': 'd', 'ڈ': 'd', 'ذ': 'z', 'ر': 'r', 'ڑ': 'r', 'ز': 'z', 'ژ': 'z', 'س': 's', 'ش': 'S', 'ص': 's', 'ض': 'z', 'ط': 't', 'ظ': 'z', 'غ': 'g', 'ف': 'f', 'ق': 'k', 'ک': 'k', 'ك': 'k', 'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ں': 'n' };
// s and z are one sound class (the English plural s is written ز: «ٹریز» for trees)
const urSkeleton = (w) => [...norm(w)].map((c) => UR_SK[c] || '').join('').replace(/z/g, 's').replace(/(.)\1+/g, '$1');
const enSkeleton = (w) => norm(w).replace(/sch/g, 'sk').replace(/sh/g, 'S').replace(/ch/g, 'C').replace(/ph/g, 'f').replace(/th/g, 't').replace(/ck/g, 'k')
  .replace(/c(?=[eiy])/g, 's').replace(/[cq]/g, 'k').replace(/x/g, 'ks')
  .replace(/[aeiouywhv]/g, '').replace(/z/g, 's').replace(/(.)\1+/g, '$1');
const LETTER_NAMES = { 'اے': 'a', 'بی': 'b', 'سی': 'c', 'ڈی': 'd', 'ای': 'e', 'ایف': 'f', 'جی': 'g', 'ایچ': 'h', 'آئی': 'i', 'جے': 'j', 'ایل': 'l', 'ایم': 'm', 'این': 'n', 'او': 'o', 'پی': 'p', 'کیو': 'q', 'آر': 'r', 'ایس': 's', 'ٹی': 't', 'یو': 'u', 'وی': 'v', 'ڈبلیو': 'w', 'ایکس': 'x', 'وائی': 'y', 'زیڈ': 'z' };
const URDU = /[؀-ۿ]/;
const isLetterTask = (task) => /letter/.test(String((task && (task.subtask || task.task)) || ''));

/** A task's items, each with its id and the phrases that are its content (the sum itself is left out: reading it is support). */
function itemsOf(task) {
  const rec = (task && task.record) || {};
  return (Array.isArray(rec.items) ? rec.items : []).filter((x) => x && typeof x.id === 'string').map((x) => {
    const sum = /[+\-−×x÷]/.test(String(x.show || ''));
    const phrases = [sum ? null : x.show, sum ? null : x.target, x.answer, ...(Array.isArray(x.accept) ? x.accept : [])]
      .filter((p) => p != null && String(p).trim()).map(String);
    // the item's own word; a question has none (only accepted answers), so the answer said stands for it
    const own = x.answer != null ? x.answer : (sum ? null : (x.target != null ? x.target : x.show));
    return { id: x.id, sum, phrases, text: own == null ? null : String(own) };
  });
}

/**
 * The items `size(phrase)` finds (a phrase's matched length, 0 = no match), as { words, items }: words = every found
 * item's own word (else the phrase that matched); items = the ONE item with the longest match, or [] on a tie (an
 * ambiguous pointer is worse than none). null when nothing is found.
 */
function found(task, size) {
  const hits = itemsOf(task).map((it) => {
    const best = it.phrases.map((p) => [p, size(p, it)]).reduce((a, b) => (b[1] > a[1] ? b : a), [null, 0]);
    return { it, p: best[0], n: best[1] };
  }).filter((h) => h.n > 0);
  if (!hits.length) return null;
  const top = Math.max(...hits.map((h) => h.n));
  const lead = hits.filter((h) => h.n === top);
  return { words: [...new Set(hits.map((h) => (h.it.text != null ? h.it.text : h.p)))].join(' '), items: lead.length === 1 ? [lead[0].it.id] : [] };
}

/** A reason as stored: the words without a sound's slashes («/ب/» → ب) or trailing punctuation. */
const tidy = (s) => String(s || '').split(/\s+/).map((w) => w.replace(/^\/+|\/+$/g, '').replace(/[^\p{L}\p{N}'’-]+$/u, '')).filter(Boolean).join(' ');

/** The longest run of `ws` (quote words) equal, word by word under `eq`, to a run of `seq`: [quote start, seq start, length]. */
function longestRun(ws, seq, eq) {
  let best = [0, 0, 0];
  for (let i = 0; i < ws.length; i += 1) {
    for (let j = 0; j < seq.length; j += 1) {
      let n = 0;
      while (i + n < ws.length && j + n < seq.length && eq(ws[i + n], seq[j + n])) n += 1;
      if (n > best[2]) best = [i, j, n];
    }
  }
  return best;
}

/**
 * The task's items the other person's quote touched, as { words, items }: words = those items' own text (the target
 * word in the task's spelling, never the adult's other words); items = the ids it points at. A passage gives the word
 * positions of the longest run of passage words in the quote (a repeated word: where a reader meets it first).
 * Anywhere else it points at ONE item or none: the item whose whole word or accepted answer is the longest run in the
 * quote, and [] on a tie (the words are still given). On timed sums a number names a sum only when it is the answer of
 * exactly one sum and an operand of none (reading a sum aloud is support). A lone word counts only when it is a number
 * or 3+ letters (any length on a letter task). On an English task the quote is also read across scripts (Urdu-script
 * spelling, Urdu letter names). Nothing matched: { words: '', items: [] }.
 */
function matchedItems(quote, task) {
  const none = { words: '', items: [] };
  const ws = tokens(quote);
  if (!ws.length || !task) return none;
  const rec = task.record || {};
  const lone = (w) => /^\p{N}+$/u.test(norm(w)) || norm(w).length >= 3 || isLetterTask(task);
  const en = task.lang === 'en';
  const same = (a, b) => norm(a) !== '' && norm(a) === norm(b);
  const across = (a, b) => en && URDU.test(a) && !URDU.test(b) && norm(b).length >= 3 && urSkeleton(a).length >= 2 && urSkeleton(a) === enSkeleton(b);
  const eq = (a, b) => same(a, b) || across(a, b);
  const words = rec.passage && Array.isArray(rec.passage.words) ? rec.passage.words.filter((w) => w && typeof w.id === 'string') : [];
  if (words.length) {
    const seq = words.map((w) => String(w.target));
    const [, j, n] = longestRun(ws, seq, eq);
    if (!n || (n === 1 && !lone(seq[j]))) return none;
    const run = words.slice(j, j + n);
    return { words: run.map((w) => String(w.target).replace(/[^\p{L}\p{N}'’-]+$/u, '')).join(' '), items: run.map((w) => w.id) };
  }
  // timed sums: every number on a sum's face, and how many sums have each answer
  const all = itemsOf(task);
  const operands = new Set((rec.items || []).filter((x) => x && /[+\-−×x÷]/.test(String(x.show || '')))
    .flatMap((x) => tokens(String(x.show)).map(norm).filter((n) => /^\d+$/.test(n))));
  const answers = {};
  all.filter((it) => it.sum && it.text != null).forEach((it) => { const n = norm(it.text); answers[n] = (answers[n] || 0) + 1; });
  const whole = found(task, (p, it) => {
    if (it.sum && /^\d+$/.test(norm(p)) && (operands.has(norm(p)) || answers[norm(p)] !== 1)) return 0;
    const ps = tokens(p);
    const [, , n] = longestRun(ws, ps, eq);
    return ps.length > 0 && n === ps.length && (n > 1 || lone(ps[0])) ? n : 0;
  });
  if (whole) return whole;
  if (!en) return none;
  // a word spelled in Urdu letter names (two letters or more, in order, inside one item's word; one on a letter task)
  const letters = ws.map((w) => LETTER_NAMES[norm(w)] || '').filter(Boolean).join('').replace(/(.)\1+/g, '$1');
  if (!letters || (letters.length < 2 && !isLetterTask(task))) return none;
  return found(task, (p) => (letters.length < 2 ? norm(p) === letters : norm(p).length >= 3 && norm(p).includes(letters)) ? 1 : 0) || none;
}

module.exports = { SCHEMA, LABELS, KINDS, contentOf, promptOf, decide, matchedWords, matchedItems, tidy };
