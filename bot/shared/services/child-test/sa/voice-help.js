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
 * No word heard: none, and no model call. The quote and the reason are never kept (they can hold a name); the label
 * and a fixed `kind` are, so Results can say what happened ("an adult said the answer"), not just "another voice".
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
- "help": another person gives content: says or reads an item the child has to read or answer, says or starts an answer, corrects the child ("no, it is…", "what did you miss?" before the child changes the answer), builds the answer with the child (counting on, splitting a sum, spelling out a word, a hint toward the answer), asks the same item again after a WRONG answer and the child then changes the answer, or repeats the child's answer back with the content changed (the right word after the child's wrong one).
- "other_child": a second child reads or answers the same items along with the tested child.
- "support": another person speaks without content: instructions, procedure, encouragement ("louder", "press next", "go on", "well done", "think"), repeating the child's own answer back unchanged, asking a question again when the child had not answered or does not change the answer, reading a sum or a question aloud, translating a question (unless the translation holds the answer), or side talk (adults chatting, a phone call, a teacher teaching the class, another test nearby).
- "unclear": another person may be speaking, but the words are too few, garbled or merged to tell support from help.
- "none": only the tested child, the phone's own voice, or silence.
Pick the strongest that applies: help > other_child > support > unclear > none.
Three kinds of help are easy to miss:
1. A second attempt. Compare each answer of the child with the task's answer. If the other person asks the same item again, or puts it another way, right after a WRONG answer ("-3?", "کیا لگایا، زمین میں؟"), and the child then gives a different answer, that is help (kind "corrected"), whether the new answer is right or not. So is telling the child to read the passage again from some point ("دوبارہ پڑھو، یہاں سے").
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

module.exports = { SCHEMA, LABELS, KINDS, contentOf, promptOf, decide, matchedWords };
