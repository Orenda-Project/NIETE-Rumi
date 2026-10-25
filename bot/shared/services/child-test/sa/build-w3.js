'use strict';

/**
 * The RDF auto and RDF manual forms (switch sa_rdf_w3_forms, default OFF), built from item-bank.sa-w3.v1.json. That file
 * only PICKS items: every scored and practice item is read out of the official banks (item-bank.v3.json Set A, the
 * Rawalpindi May 2026 instrument and Core EGMA; item-bank.sa-extra.v1.json), or is a Rawalpindi list v3 does not carry,
 * copied with its field id. This file decides the W3 shape:
 *
 *   reading  letter names 5, letter sounds 5 (letters with a sound of their own), familiar words 4, the Set A passage
 *            with its own punctuation (word by word, aligned to passage.text), its questions. No blending: no official
 *            EGRA we hold has the task (w3.absent.blending, with the citations).
 *   maths    number identification 8, quantity comparison 2, missing number 4, addition 2, subtraction 2,
 *            multiplication 2 (Rawalpindi: Core EGMA has none), one minute of oral fluency (Rawalpindi blfl1, 20 items).
 *
 * Letters, words, numbers and sums show one item at a time (present 'one_at_a_time'), spoken and recorded, the task
 * clock running across items. RDF auto advances a silent item after advance_after_s (EGRA's 3-second rule; EGMA's 5);
 * RDF manual is the same tasks, the coach reading coach_text (the official administration wording) and Jugnu saying
 * only lines.coach_will_instruct. Both lists are the same ids: the variant changes who instructs, never the measure.
 */

const { COMMON, UR_LETTER_NAMES, EN_LETTER_SOUNDS } = require('./scripts');

const W3_TASKS = [
  'ur.letter_names5', 'ur.letter_sounds5', 'ur.words4', 'ur.story_w3', 'ur.story_comp_w3',
  'en.letter_names5', 'en.letter_sounds5', 'en.words4', 'en.story_w3', 'en.story_comp_w3',
  'ma.number_id8', 'ma.discrimination2', 'ma.missing4', 'ma.add2i', 'ma.sub2i', 'ma.mul2i', 'ma.fluency1m',
];
const VARIANTS = {
  rdf_auto: { name: { en: 'RDF auto', ur: 'آر ڈی ایف خودکار' }, manual: false },
  rdf_manual: { name: { en: 'RDF manual', ur: 'آر ڈی ایف دستی' }, manual: true },
};

const L = (en, ur, from) => ({ en, ur, from });
// The two battery lines the W3 forms add (recorded by the voice lane in exactly these words: the clip key is the text's hash).
const LINES_W3 = {
  coach_will_instruct: L('Your coach will now give the instructions.', 'اب آپ کے کوچ ہدایات دیں گے۔', 'RDF manual (operator, 21 Oct): Jugnu\'s only line before a task'),
  please_go_on: L('Please go on.', 'آگے چلیں۔', 'egra_tk2016:Annex H p.212 ("Please go on." after 3 s)'),
};

// Jugnu's intro for each one-at-a-time task (RDF auto). The official instruction (coach_text below) with its page
// directions turned into what the child does with one item on the screen; the child is addressed with آپ and
// imperatives only.
const INTRO = {
  letter_names: L('Letters will come one at a time. Say the NAME of each letter out loud, not its sound. Then go on to the next one. If you do not know a letter, go on to the next one.',
    'ایک ایک کر کے حروف آئیں گے۔ ہر حرف کا نام اونچی آواز میں بتائیں، آواز نہیں، صرف نام۔ پھر اگلے حرف پر جائیں۔ اگر کوئی حرف نہ آئے تو اگلے حرف پر چلے جائیں۔',
    'v3:sets.A.reading.{lang}.letters.script.intro (one at a time)'),
  letter_sounds: L('Letters will come one at a time. Say the SOUND of each letter out loud, not its name. Then go on to the next one. If you do not know a letter, go on to the next one.',
    'ایک ایک کر کے حروف آئیں گے۔ ہر حرف کی آواز بول کر بتائیں۔ حرف کا نام نہیں، صرف اس کی آواز۔ پھر اگلے حرف پر جائیں۔ اگر کوئی حرف نہ آئے تو اگلے حرف پر چلے جائیں۔',
    'egra_tk2016:Annex H p.187 letter sound (one at a time)'),
  words: L('Words will come one at a time. Read each word out loud. Do not spell it, read the whole word. Then go on to the next one. If you do not know a word, go on to the next one.',
    'ایک ایک کر کے الفاظ آئیں گے۔ ہر لفظ اونچی آواز میں پڑھیں۔ ہجے نہ کریں، پورا لفظ پڑھیں۔ پھر اگلے لفظ پر جائیں۔ اگر کوئی لفظ نہ آئے تو اگلے لفظ پر چلے جائیں۔',
    'v3:sets.A.reading.{lang}.words.script.intro (one at a time)'),
  number_id: L('Numbers will come one at a time. Say each number out loud. Then go on to the next one.',
    'ایک ایک کر کے نمبر آئیں گے۔ ہر نمبر اونچی آواز میں بتائیں۔ پھر اگلے نمبر پر جائیں۔', 'core_egma:p.2 Task 1 (one at a time)'),
  add: L('Here are some addition problems, one at a time. Work out each answer in your head and say it out loud. Then go on to the next one.',
    'یہ جمع کے کچھ سوال ہیں، ایک ایک کر کے۔ ہر جواب ذہن میں سوچیں اور اونچی آواز میں بتائیں۔ پھر اگلے سوال پر جائیں۔', 'core_egma:p.7 Task 4B (mental, one at a time)'),
  sub: L('Here are some subtraction problems, one at a time. Work out each answer in your head and say it out loud. Then go on to the next one.',
    'یہ تفریق کے کچھ سوال ہیں، ایک ایک کر کے۔ ہر جواب ذہن میں سوچیں اور اونچی آواز میں بتائیں۔ پھر اگلے سوال پر جائیں۔', 'core_egma:p.9 Task 5B (mental, one at a time)'),
  mul: L('Here are some multiplication problems, one at a time. Work out each answer in your head and say it out loud. Then go on to the next one.',
    'یہ ضرب کے کچھ سوال ہیں، ایک ایک کر کے۔ ہر جواب ذہن میں سوچیں اور اونچی آواز میں بتائیں۔ پھر اگلے سوال پر جائیں۔', 'rwp2026:bleffcomp level 3 (mental, one at a time)'),
  fluency: L('Here are some quick sums, one at a time. Say each answer out loud, as quickly and carefully as you can, then go on to the next one. If you do not know an answer, go on to the next one.',
    'یہ جلدی والے سوال ہیں، ایک ایک کر کے۔ ہر جواب جتنا جلدی اور دھیان سے ہو سکے اونچی آواز میں بتائیں، پھر اگلے سوال پر جائیں۔ اگر کسی سوال کا جواب نہ آئے تو اگلے سوال پر چلے جائیں۔',
    'rwp2026:blfluency.blfl1 + core_egma:p.6 Task 4A (one at a time, 60 s)'),
};

// What the coach reads out in RDF manual: the official administration wording (v3 carries each instrument's script),
// adapted only where a phone changes it: a page becomes items that come one at a time, and the Urdu speaks to the child
// without the speaker's or the child's gendered forms (گا/گی, گے/گی): passive or imperative instead. Then the hand-over.
const GIVE = L('Then give the phone to the child.', 'پھر فون بچے کو دے دیں۔', 'W3 RDF manual: the coach screen\'s last line');
// RULING W3-12 4c: a mental sum is not read aloud, so its screen's chip asks for the answer (shown, not spoken).
const SAY_ANSWER = { en: 'Say the answer', ur: 'جواب بتائیں' };
const LANG_NAME = { ur: { en: 'URDU', ur: 'اردو' }, en: { en: 'ENGLISH', ur: 'انگریزی' } };
const COACH = {
  letter_names: (n) => L(`Here are some letters of the ${n.en} alphabet. They will come one at a time. Please tell me the NAME of each letter. Not its sound, but its name. If you come to a letter you do not know, go on to the next letter.`,
    `یہ ${n.ur} حروفِ تہجی کے کچھ حروف ہیں۔ یہ ایک ایک کر کے آئیں گے۔ ہر حرف کا نام بتائیں۔ آواز نہیں، صرف نام۔ اگر کوئی حرف نہ آئے تو اگلے حرف پر چلے جائیں۔`,
    'v3:sets.A.reading.{lang}.letters.script (rwp2026 coach card; egra_tk2016 Annex H p.189), one at a time'),
  letter_sounds: (n) => L(`Here are some letters of the ${n.en} alphabet. They will come one at a time. Please tell me the SOUND of each letter. Not its name, but its sound. If you come to a letter you do not know, go on to the next letter.`,
    `یہ ${n.ur} حروفِ تہجی کے کچھ حروف ہیں۔ یہ ایک ایک کر کے آئیں گے۔ ہر حرف کی آواز بتائیں۔ نام نہیں، صرف آواز۔ اگر کوئی حرف نہ آئے تو اگلے حرف پر چلے جائیں۔`,
    'egra_tk2016:Annex H p.187 letter sound identification ("the sounds … not their names"), one at a time'),
  words: (n) => L(`Here are some words in ${n.en}. They will come one at a time. Please read each word. Do not spell the word, but read it. If you come to a word you do not know, go on to the next word.`,
    `یہ کچھ ${n.ur} الفاظ ہیں۔ یہ ایک ایک کر کے آئیں گے۔ ہر لفظ پڑھیں۔ ہجے نہ کریں، پورا لفظ پڑھیں۔ اگر کوئی لفظ نہ آئے تو اگلے لفظ پر چلے جائیں۔`,
    'v3:sets.A.reading.{lang}.words.script (egra_tk2016 Annex H p.195), one at a time'),
  story: () => L('Here is a short story. I want you to read it aloud, quickly but carefully. When you finish, I will ask you some questions about what you have read. When I say "Begin," read the story as best as you can. If you come to a word you do not know, go on to the next word. Put your finger on the first word.',
    'یہ ایک مختصر کہانی ہے۔ اسے بلند آواز سے، جلدی مگر دھیان سے پڑھیں۔ کہانی پڑھنے کے بعد آپ سے چند سوال پوچھے جائیں گے۔ جب «شروع کریں» کہا جائے تو جتنا اچھا ہو سکے کہانی پڑھیں۔ اگر کوئی لفظ نہ آئے تو اگلے لفظ پر چلے جائیں۔ پہلے لفظ پر انگلی رکھیں۔',
    'v3:sets.A.reading.{lang}.story.script.intro (rwp2026 coach card; egra_tk2016 Annex H p.197)'),
  story_comp: () => L('Now I am going to ask you a few questions about the story you just read. Try to answer the questions as well as you can. You can provide your answers in whichever language you prefer.',
    'اب آپ سے اس کہانی کے بارے میں چند سوال پوچھے جائیں گے جو آپ نے ابھی پڑھی۔ جتنا اچھا ہو سکے جواب دیں۔ آپ جس زبان میں چاہیں جواب دیں۔',
    'v3:sets.A.reading.{lang}.story.script.questions_intro (egra_tk2016 Annex H p.197)'),
  number_id: () => L('Here are some numbers. They will come one at a time. Tell me what each number is. I will tell you when to begin and when to stop.',
    'یہ کچھ نمبر ہیں۔ یہ ایک ایک کر کے آئیں گے۔ بتائیں کہ ہر نمبر کون سا ہے۔ کب شروع کرنا ہے اور کب رکنا ہے، یہ آپ کو بتایا جائے گا۔',
    'core_egma:p.2 Task 1 script, one at a time'),
  add: () => L('Here are some addition problems. Work out each answer in your head and say it. If you do not know an answer, go on to the next problem.',
    'یہ جمع کے کچھ سوال ہیں۔ ہر جواب ذہن میں سوچ کر بتائیں۔ اگر کسی سوال کا جواب نہ آئے تو اگلے سوال پر چلے جائیں۔', 'core_egma:p.7 Task 4B script (no paper: mental)'),
  sub: () => L('Here are some subtraction problems. Work out each answer in your head and say it. If you do not know an answer, go on to the next problem.',
    'یہ تفریق کے کچھ سوال ہیں۔ ہر جواب ذہن میں سوچ کر بتائیں۔ اگر کسی سوال کا جواب نہ آئے تو اگلے سوال پر چلے جائیں۔', 'core_egma:p.9 Task 5B script (no paper: mental)'),
  mul: () => L('Here are some multiplication problems. Work out each answer in your head and say it. If you do not know an answer, go on to the next problem.',
    'یہ ضرب کے کچھ سوال ہیں۔ ہر جواب ذہن میں سوچ کر بتائیں۔ اگر کسی سوال کا جواب نہ آئے تو اگلے سوال پر چلے جائیں۔', 'core_egma:p.7 Task 4B script, read for multiplication (rwp2026 bleffcomp level 3)'),
  fluency: () => L('Here are some addition and subtraction problems. They will come one at a time. I will tell you when to start and when to stop. Say the answer for each problem. If you don\'t know an answer, move to the next problem.',
    'یہ جمع اور تفریق کے کچھ سوال ہیں۔ یہ ایک ایک کر کے آئیں گے۔ کب شروع کرنا ہے اور کب رکنا ہے، یہ آپ کو بتایا جائے گا۔ ہر سوال کا جواب بولیں۔ اگر کسی سوال کا جواب نہ آئے تو اگلے سوال پر چلے جائیں۔',
    'core_egma:p.6 Task 4A script (rwp2026 blfluency blfl1: + and −), one at a time'),
};
// "Then go on" models for a practice item: the carrier in the page's language, then the answer in the item's own
// language (RULING #31a: no clip says an item of the other language inside a sentence).
const MODEL = {
  letter_names: L('The name of this letter is:', 'اس حرف کا نام ہے:', 'egra_tk2016:Annex H p.189 practice ("The name of this letter is …")'),
  letter_sounds: L('The sound of this letter is:', 'اس حرف کی آواز ہے:', 'egra_tk2016:Annex H p.187 practice ("The sound of this letter is …")'),
  words: L('This word is:', 'یہ لفظ ہے:', 'egra_tk2016:Annex H p.195 practice ("This word is …")'),
  number_id: L('This number is:', 'یہ نمبر ہے:', 'core_egma:Task 1 practice wording'),
  sums: L('The answer is:', 'جواب ہے:', 'core_egma:practice wording ("The answer is …")'),
};
const TITLE = {
  letter_names: { en: 'Letter names', ur: 'حروف کے نام' }, letter_sounds: { en: 'Letter sounds', ur: 'حروف کی آوازیں' },
  words: { en: 'Familiar words', ur: 'جانے پہچانے الفاظ' }, number_id8: { en: 'Number identification', ur: 'نمبر پہچاننا' },
  discrimination2: { en: 'Which is bigger', ur: 'کون سا بڑا ہے' }, missing4: { en: 'Missing number', ur: 'گمشدہ نمبر' },
  add2i: { en: 'Addition', ur: 'جمع' }, sub2i: { en: 'Subtraction', ur: 'تفریق' }, mul2i: { en: 'Multiplication', ur: 'ضرب' },
  fluency1m: { en: 'Quick sums, one minute', ur: 'جلدی والے سوال، ایک منٹ' },
};
const OP = { '+': { sign: '+', en: 'plus', ur: 'جمع' }, '-': { sign: '−', en: 'minus', ur: 'منفی' }, '×': { sign: '×', en: 'times', ur: 'ضرب' } };
// EGRA's 3-second rule (Annex H pp.212-213, 219); EGMA's 5 seconds (Core EGMA p.2).
const ADVANCE = { reading: 3, numbers: 5 };
const pad = (n) => String(n).padStart(2, '0');

/** A bank path "v3:sets.A.reading.ur.letters" (or extra:…) → the object it names; a key may hold a dot (ma.add2). */
function at(banks, ref) {
  const [bank, path] = ref.split(':');
  const parts = path.split('.');
  let o = banks[bank];
  for (let i = 0; i < parts.length && o != null; i += 1) {
    let k = parts[i];
    while (!(k in o) && i + 1 < parts.length) { i += 1; k = `${k}.${parts[i]}`; }
    o = o[k];
  }
  if (o == null) throw new Error(`no ${ref}`);
  return o;
}
/** Whitespace tokens of a passage, the reduplicated ٹَیں ٹَیں kept as one word (as the scored items count it). */
const passageTokens = (text) => text.replace(/ٹَیں ٹَیں/g, 'ٹَیں\u0000ٹَیں').split(/\s+/).filter(Boolean).map((w) => w.replace('\u0000', ' '));

const SENTENCE_END = /[.!?۔؟]["”’)]*$/u;
/**
 * One line per sentence on a passage's record (words carry their printed tokens, or texts gives them): words, lines,
 * print_lines and a first-line stop are rewritten in place. Returns old line → new line, a line mapping to the sentence
 * that holds its last word (the reach an old line asked for, e.g. SELECT's word markers).
 */
function sentenceLines(rec, texts) {
  const p = rec.passage;
  const text = texts || p.words.map((w) => w.text);
  const oldLast = new Map((p.lines || []).map((l) => [l.n, l.to]));
  let n = 1;
  p.words.forEach((w, i) => { w.line = n; if (SENTENCE_END.test(text[i]) && i < p.words.length - 1) n += 1; });
  p.lines = [];
  p.words.forEach((w, i) => { const l = p.lines[w.line - 1]; if (l) l.to = i; else p.lines.push({ n: w.line, from: i, to: i }); });
  p.print_lines = p.lines.map((l) => text.slice(l.from, l.to + 1).join(' '));
  if (rec.stop && rec.stop.type === 'first_line') rec.stop = { ...rec.stop, n: p.lines[0].to + 1 };
  return (old) => (oldLast.has(old) ? p.words[oldLast.get(old)].line : old);
}

/**
 * RULING W3-12 on the Wave 2 coach passage (<lang>.story, every rotation variant) and its questions: one line per
 * sentence of the variant's own printed text, so the Whole battery and the W3 forms draw a passage the same way.
 * A variant 0 shares its record with the task, so each record is relined once.
 */
function relineStory(core, lang) {
  const story = core.find((t) => t.task === `${lang}.story`);
  const comp = core.find((t) => t.task === `${lang}.story_comp`);
  if (!story) return;
  const to = new Map();
  for (const [id, v] of [[null, story], ...(story.variants || []).map((x) => [x.id, x.task])]) {
    const rec = v.record;
    if (!to.has(rec)) {
      const tokens = passageTokens(rec.passage.text);
      if (tokens.length !== rec.passage.words.length) throw new Error(`${v.task}: ${tokens.length} tokens of passage.text, ${rec.passage.words.length} scored words`);
      to.set(rec, sentenceLines(rec, tokens));
    }
    to.set(id, to.get(rec));
  }
  if (!comp) return;
  const done = new Set();
  for (const [id, c] of [[null, comp], ...(comp.variants || []).map((x) => [x.id, x.task])]) {
    if (done.has(c.record.questions) || !to.has(id)) continue;
    done.add(c.record.questions);
    c.record.questions.forEach((q) => { if (q.needs_line != null) q.needs_line = to.get(id)(q.needs_line); });
  }
}

function w3Tasks(f, { v3, extra, w3 }, core, H) {
  if (f.surface !== 'coach' || !w3) return [];
  const banks = { v3, extra };
  const { spoken, said, sayBoth, toUrDigits, mathsTask } = H;
  const grade = f.maths;
  const out = [];
  // A panel-signed text from ITEMS_W3 (w3.coach_text) replaces ours in its own language; its Urdu speaker form
  // («دکھاؤں گا/گی») is said without a gendered verb.
  const signed = (id, l) => {
    const c = (w3.coach_text || {})[id];
    if (!c || !c[l]) return null;
    const t = c[l].replace('میں آپ کو ایک ایک کر کے کچھ حروف دکھاؤں گا/گی۔', 'آپ کو ایک ایک کر کے کچھ حروف دکھائے جائیں گے۔');
    if (/(گا\/گی|گے\/گی)/u.test(t)) throw new Error(`${id}: a gendered form left in the coach text`);
    return { text: t.replace(/\s*(Then give the phone to the child\.|پھر فون بچے کو دے دیں۔)\s*$/u, ''),
      src: `${c.src}${l === 'ur' && c.authored_translation ? ' (authored translation, panel-signed; speaker form made neutral)' : ''}` };
  };
  const coachText = (kind, lang, id) => {
    const c = COACH[kind](LANG_NAME[lang] || {});
    const out = { en: `${c.en} ${GIVE.en}`, ur: `${c.ur} ${GIVE.ur}`, src: c.from.replace('{lang}', lang || '') };
    for (const l of ['en', 'ur']) {
      const s2 = id && signed(id, l);
      if (s2) Object.assign(out, { [l]: `${s2.text} ${GIVE[l]}`, [`src_${l}`]: s2.src });
    }
    return out;
  };
  const childScript = (intro, lang) => {
    const s = { intro: spoken({ ...intro, from: intro.from.replace('{lang}', lang || '') }) };
    for (const k of ['practice_intro', 'test_intro', 'begin', 'time_up', 'early_stop', 'after', 'hand_back']) s[k] = spoken(COMMON[k]);
    return s;
  };
  const model = (kind, answer, lang) => [spoken(MODEL[kind]), lang ? said(lang, answer) : sayBoth(String(answer), toUrDigits(answer))];

  // ------------------------------------------------------------------------------------------- reading, one at a time
  for (const lang of ['ur', 'en']) {
    const spec = w3.reading[lang];
    // sayOf: what a practice model's clip says (an Urdu letter sound is voiced as the letter with zabar, بَ).
    const oneAtATime = (kind, id, sel, answerOf, practice, extra2 = {}, sayOf = answerOf) => {
      const list = at(banks, sel.from).items;
      const items = sel.pick.map((p, i) => {
        const x = typeof list[p] === 'object' ? list[p].letter : list[p];
        return { id: `${id}.${pad(i + 1)}`, show: x, target: x, answer: answerOf(x), src: `${sel.from}.items[${p}]` };
      });
      return {
        task: id, lang, w3: true, kind: 'grid', legacy_block: null, family: 'egra', subtask: extra2.subtask, title: TITLE[kind],
        response: 'record', present: 'one_at_a_time', grid: items.map((it) => it.show), direction: lang === 'ur' ? 'rtl' : 'ltr',
        items, practice: practice.map((p, i) => ({ id: `${id}.p${i + 1}`, role: p.role, show: p.item, target: p.item, answer: answerOf(p.item),
          model: model(kind, sayOf(p.item), lang), src: p.src })),
        time_limit_s: 60, advance_after_s: ADVANCE.reading, stop: null,
        stop_note: 'EGRA\'s first-row stop (no item right in the first row) is applied when scored: with 5 items, all 5 wrong',
        script: childScript(INTRO[kind], lang),
        coach_text: coachText(kind, lang, id),
        source: { items: sel.from, script: COACH[kind](LANG_NAME[lang]).from.replace('{lang}', lang), sa_adaptation: 'one item at a time, spoken and recorded, scored later; the task clock runs across items (W3 operator item 1)' },
        deviation: extra2.deviation || 'one item at a time instead of a page of 100 (the operator\'s ask); the child (RDF auto) or coach (RDF manual) moves on',
      };
    };
    const ln = spec.letter_names;
    const roleOf = (r) => (/^example/.test(r) ? 'example' : 'practice');
    const namePractice = ln.practice_from
      ? at(banks, ln.practice_from).map((p, i) => ({ item: p.item, role: roleOf(p.role), src: p.src || `${ln.practice_from}[${i}]` }))
      : (ln.practice || []).map((x) => { const p = at(banks, x.from)[x.index]; return { item: p.item, role: roleOf(p.role), src: p.src || `${x.from}[${x.index}]` }; });
    out.push(oneAtATime('letter_names', `${lang}.letter_names5`, ln, (x) => (lang === 'ur' ? UR_LETTER_NAMES[x] || x : x), namePractice,
      { subtask: 'letter_name_identification' }));
    const ls = spec.letter_sounds;
    const soundOf = (x) => (lang === 'ur' ? `/${x}/` : EN_LETTER_SOUNDS[String(x).toLowerCase()] || x);
    const soundPractice = lang === 'ur'
      ? ls.practice.map((p) => ({ item: at(banks, ls.from).items[p.pick], role: p.role || 'practice', src: p.src }))
      : at(banks, ls.practice_from).map((p, i) => ({ item: p.item, role: p.role, src: p.src || `${ls.practice_from}[${i}]` }));
    const sounds = oneAtATime('letter_sounds', `${lang}.letter_sounds5`, ls, soundOf, soundPractice,
      { subtask: 'letter_sound_identification', ...(ls.deviation ? { deviation: `one item at a time; ${ls.deviation}` } : {}) },
      (x) => (lang === 'ur' ? `${x}\u064E` : soundOf(x)));
    if (ls.no_sound_rule) sounds.letter_rule = { text: ls.no_sound_rule, src: ls.src };
    out.push(sounds);
    const wd = spec.words;
    const wordPractice = at(banks, wd.practice_from).map((p, i) => ({ item: p.item, role: /^example/.test(p.role) ? 'example' : 'practice', src: p.src || `${wd.practice_from}[${i}]` }));
    out.push(oneAtATime('words', `${lang}.words4`, wd, (x) => x, wordPractice, { subtask: 'familiar_word_reading' }));

    // The passage and its questions: the form's own (Set A, with the rotation's variants), each word carrying its own
    // token of passage.text, so the page draws the official punctuation and the scored words stay as they are.
    const story = JSON.parse(JSON.stringify(core.find((t) => t.task === `${lang}.story`)));
    const comp = JSON.parse(JSON.stringify(core.find((t) => t.task === `${lang}.story_comp`)));
    const sid = `${lang}.story_w3`;
    Object.assign(story, { task: sid, w3: true, legacy_block: null, print_lines: spec.story.print_lines, print_src: spec.story.print_src,
      coach_text: coachText('story', lang) });
    Object.assign(comp, { task: `${lang}.story_comp_w3`, w3: true, legacy_block: null, depends_on: { ...comp.depends_on, task: sid },
      coach_text: coachText('story_comp', lang) });
    // The W3 forms rotate only the passages with official punctuation (ITEMS_W3: UR RWP + SELECT; EN RWP alone).
    for (const t of [story, comp]) {
      if (!t.variants) continue;
      t.variants = t.variants.filter((v) => spec.story.variants.includes(v.id));
      if (t.variants.length < 2) delete t.variants;
    }
    // The form's own words and questions take the W3 task's ids (a variant keeps its own text's ids).
    const own = new RegExp(`^${lang}\\.story\\.`);
    const rename = (x) => { x.id = x.id.replace(own, `${sid}.`); };
    for (const t of [story, ...(story.variants || []).filter((v) => v.id === 'rwp2026').map((v) => v.task)]) t.record.passage.words.forEach(rename);
    for (const t of [comp, ...(comp.variants || []).filter((v) => v.id === 'rwp2026').map((v) => v.task)]) t.record.questions.forEach(rename);
    for (const v of [story, ...(story.variants || []).map((x) => x.task)]) {
      const p = v.record.passage;
      const tokens = passageTokens(p.text);
      if (tokens.length !== p.words.length) throw new Error(`${v.task}: ${tokens.length} tokens of passage.text, ${p.words.length} scored words`);
      p.words.forEach((w, i) => { w.text = tokens[i]; });
    }
    // RULING W3-12: each sentence starts a new line on every variant (app and paper alike), so a word's line is the
    // sentence it sits in, counted on that variant's own text; its questions' needs_line and the first-line stop follow.
    const relined = new Map([story, ...(story.variants || []).map((x) => x.task)].map((v) => [v, sentenceLines(v.record)]));
    const storyOf = (id) => story.variants.find((x) => x.id === id).task;
    for (const [c, st] of [[comp, story], ...(comp.variants || []).map((x) => [x.task, storyOf(x.id)])]) {
      const to = relined.get(st);
      c.record.questions.forEach((q) => { if (q.needs_line != null) q.needs_line = to(q.needs_line); });
    }
    // The Set A coach card's accept lists (added to the bank's, never narrower), its rule, and its per-question gate.
    const card = Object.fromEntries((spec.story.questions || []).map((q) => [q.id, q]));
    const own0 = (comp.variants || []).filter((v) => v.id === 'rwp2026').map((v) => v.task.record.questions);
    for (const q of [...comp.record.questions, ...own0.flat()]) {
      const c = card[q.id];
      if (!c) throw new Error(`${q.id}: no Set A card entry`);
      Object.assign(q, { accept: [...new Set([...q.accept, ...c.accept])], accept_rule: c.accept_rule, gate: c.gate, card_src: c.src });
    }
    out.push(story, comp);
  }

  // ------------------------------------------------------------------------------------------- maths
  const m = w3.maths;
  const mScript = (kind) => childScript(INTRO[kind], null);

  const set = v3.sets.A.maths[grade];
  const sumItem = (it, id, src) => {
    const op = OP[it.op === 'x' || it.op === '*' ? '×' : it.op];
    return { id, show: `${it.a} ${op.sign} ${it.b}`, target: it.answer, answer: it.answer,
      say: sayBoth(`${it.a} ${op.en} ${it.b}`, `${toUrDigits(it.a)} ${op.ur} ${toUrDigits(it.b)}`), src };
  };
  const oral = (id, kind, items, practice, extra2) => ({
    task: id, lang: null, w3: true, kind: 'oral', legacy_block: null, family: 'egma', subtask: extra2.subtask, title: TITLE[id.split('.')[1]],
    response: 'record', present: 'one_at_a_time', items, practice,
    time_limit_s: extra2.time_limit_s || null, advance_after_s: extra2.advance_after_s || null, ...(extra2.next_at_s ? { next_at_s: extra2.next_at_s } : {}),
    // A sum is shown; Jugnu says it only on the replay tile (RULING #17), so reading it stays the child's.
    ...(items.some((it) => it.say) ? { say_on: 'replay' } : {}),
    stop: extra2.stop || null, ...(extra2.practice_note ? { practice_note: extra2.practice_note } : {}), ...(extra2.chip ? { chip: extra2.chip } : {}),
    script: mScript(kind), coach_text: coachText(kind, null),
    source: { items: extra2.from, script: COACH[kind]().from, sa_adaptation: 'one item at a time, the answer spoken and recorded, scored later' },
    deviation: extra2.deviation,
  });

  const nid = m.number_id;
  const nFrom = nid.from.replace('{g}', grade);
  const nList = at(banks, nFrom).items;
  out.push(oral('ma.number_id8', 'number_id', nid.pick.map((p, i) => ({ id: `ma.number_id8.${pad(i + 1)}`, show: String(nList[p]), target: Number(nList[p]), answer: Number(nList[p]),
    src: `${nFrom}.items[${p}]` })),
  at(banks, nid.practice_from).map((b, i) => ({ id: `ma.number_id8.p${i + 1}`, role: 'practice', show: b.numeral, target: Number(b.numeral), answer: Number(b.numeral),
    model: model('number_id', b.numeral, null), src: b.src })),
  { subtask: 'number_identification', from: nFrom, time_limit_s: 60, advance_after_s: ADVANCE.numbers,
    deviation: 'one numeral at a time, said aloud and recorded (Core EGMA: the child names each numeral on a page of 20)' }));

  // Comparison and missing number: tapped as on the Wave 2 forms (Tangerine SA tap), one item per screen already.
  const tapTask = (kind, id, sel) => {
    const base = set[kind];
    const items = sel.pick.map((p) => base.items[p]);
    const prac = at(banks, sel.practice_from);
    const t = mathsTask({ kind, spec: { ...base, items, practice: sel.practice_pick ? sel.practice_pick.map((k) => prac[k]) : prac }, grade, borrowed: null });
    const from = sel.from;
    t.task = id;
    t.w3 = true;
    t.legacy_block = null;
    t.title = TITLE[id.split('.')[1]];
    t.tap.items.forEach((it, i) => { it.id = `${id}.${pad(i + 1)}`; it.src = `${from}.items[${sel.pick[i]}]`; });
    t.practice.forEach((it, i) => { it.id = `${id}.p${i + 1}`; it.src = `${sel.practice_from}[${sel.practice_pick ? sel.practice_pick[i] : i}]`; });
    if (sel.practice_note) t.practice_note = sel.practice_note;
    t.tap.stop = null;
    t.stop_note = 'Core EGMA\'s 4-errors-in-a-row stop cannot fire on 2-4 items';
    // Core EGMA prints these two tasks' instruction as the item line (Tasks 2, 3), verbatim
    const said0 = base.script.intro || base.script.item;
    t.coach_text = { en: `${said0.en} ${GIVE.en}`, ur: `${said0.ur} ${GIVE.ur}`, src: `${from}.script.${base.script.intro ? 'intro' : 'item'}` };
    t.source = { ...t.source, items: from };
    return t;
  };
  out.push(tapTask('discrimination', 'ma.discrimination2', m.discrimination), tapTask('missing', 'ma.missing4', m.missing));

  const mental = (key, id, kind, subtask, sel) => {
    const list = sel.items || at(banks, sel.from).items;
    const picked = sel.pick ? sel.pick.map((p) => ({ it: list[p], src: `${sel.from}.items[${p}]` })) : list.map((it) => ({ it, src: it.src }));
    const op = key === 'add' ? '+' : key === 'sub' ? '-' : '×';
    return oral(id, kind, picked.map(({ it, src }, i) => sumItem({ ...it, op }, `${id}.${pad(i + 1)}`, src)),
      (sel.practice || (sel.practice_from ? at(banks, sel.practice_from) : [])).map((b, i) => ({ ...sumItem({ ...b, op }, `${id}.p${i + 1}`, b.src), role: 'practice', model: model('sums', b.answer, null) })),
      { subtask, from: sel.from || 'w3:maths.mul.items', next_at_s: 15, practice_note: sel.practice_note, chip: SAY_ANSWER,
        deviation: 'said in the head and answered aloud, no paper (the operator\'s "mental"); Core EGMA Level 2 allows paper and pencil' });
  };
  out.push(mental('add', 'ma.add2i', 'add', 'mental_addition', m.add), mental('sub', 'ma.sub2i', 'sub', 'mental_subtraction', m.sub),
    mental('mul', 'ma.mul2i', 'mul', 'mental_multiplication', m.mul));

  const fl = m.fluency;
  out.push(oral('ma.fluency1m', 'fluency', fl.items.map((it, i) => sumItem(it, `ma.fluency1m.${pad(i + 1)}`, it.src)),
    (fl.practice || []).map((b, i) => ({ ...sumItem(b, `ma.fluency1m.p${i + 1}`, b.src), role: 'practice', model: model('sums', b.answer, null) })),
    { subtask: 'mental_math_fluency', from: 'rwp2026:blfluency.blfl1', time_limit_s: fl.timed_s, advance_after_s: ADVANCE.numbers, practice_note: fl.practice_note, chip: SAY_ANSWER,
      deviation: 'one sum at a time, answered aloud and recorded; the items reached in 60 s are the score basis' }));

  const order = new Map(W3_TASKS.map((id, i) => [id, i]));
  return out.sort((a, b) => order.get(a.task) - order.get(b.task));
}

/**
 * Round 6, bar C (RULING R6-11 item 3): what the coach reads in RDF manual when Jugnu asks the questions
 * (sa_app_asks; the engine shows it only then). The coach's script less what the app now does: a first-person line
 * the app performs names Jugnu, a pointing cue is dropped (the app asks per item), and the panel-signed letter-sounds
 * script stops before its example (the practice and the ready line are Jugnu's), keeping its skip rule.
 */
const COACH_C = {
  en: [
    [/^Say: "(.*?)\s*For example,.*(If you come to a letter you do not know, go on to the next letter\.).*?(Then give the phone to the child\.)$/s, '$1 $2 $3'],
    [/^I will show you /, 'Jugnu will show you '],
    [/When you finish, I will ask you/, 'When you finish, Jugnu will ask you'],
    [/When I say "Begin,"/, 'When Jugnu says "Begin,"'],
    [/^Now I am going to ask you/, 'Now Jugnu will ask you'],
    [/I will tell you when to/, 'Jugnu will tell you when to'],
    [/\[Point to the box\] /, ''],
  ],
  ur: [
    [/^کہیں: «(.*?)\s*مثال کے طور پر،.*(اگر کوئی حرف نہ آئے تو اگلے حرف پر چلے جائیں۔).*?(پھر فون بچے کو دے دیں۔)$/s, '$1 $2 $3'],
    [/کہانی پڑھنے کے بعد آپ سے چند سوال پوچھے جائیں گے۔/, 'کہانی پڑھنے کے بعد جگنو آپ سے چند سوال پوچھے گا۔'],
    [/جب «شروع کریں» کہا جائے تو/, 'جب جگنو «شروع کریں» کہے تو'],
    [/^اب آپ سے اس کہانی کے بارے میں چند سوال پوچھے جائیں گے/, 'اب جگنو آپ سے اس کہانی کے بارے میں چند سوال پوچھے گا'],
    [/کب شروع کرنا ہے اور کب رکنا ہے، یہ آپ کو بتایا جائے گا۔/, 'جگنو بتائے گا کہ کب شروع کرنا ہے اور کب رکنا ہے۔'],
    [/\[خالی خانے کی طرف اشارہ کریں\] /, ''],
  ],
};
const coachTextC = (text, lang) => (COACH_C[lang] || []).reduce((s, [re, to]) => s.replace(re, to), text);

/** A W3 task in the page's language (the engine's contract, RULING W3-2 §8). */
function runtimeW3Task(t, lang, H) {
  const { inLang, chainIn, runtimeTask, runtimeScript } = H;
  const coach = { text: t.coach_text[lang], src: t.coach_text[`src_${lang}`] || t.coach_text.src };
  const coachC = { coach_text_c: { text: coachTextC(coach.text, lang), src: `${coach.src}; manual with the app asking (round 6, R6-2)` } };
  if (t.kind === 'passage' || t.kind === 'questions' || (t.tap && t.kind !== 'oral' && t.kind !== 'grid')) {
    const r = runtimeTask({ ...t, variants: t.variants }, lang);
    const o = { ...r, w3: true, coach_text: coach, ...coachC };
    if (t.kind === 'passage') {
      o.depends_on = { task: `${t.lang}.words4`, skip_if_stop: 'early_stop_first_line' };
      o.passage = { ...o.passage, print_lines: t.print_lines, print_src: t.print_src };
    }
    if (t.kind === 'questions') o.depends_on = { task: t.depends_on.task, upto_item: t.depends_on.upto_item };
    if (t.stop_note) o.stop_note = t.stop_note;
    return o;
  }
  const item = (it) => {
    const { say, model, ...rest } = it;
    return { ...rest, ...(say ? { say: inLang(say, lang).text, prompt_audio: inLang(say, lang).audio } : {}), ...(model ? { model: chainIn(model, lang) } : {}) };
  };
  return {
    id: t.task, w3: true, legacy_block: null, family: t.family, subtask: t.subtask, lang: t.lang, title: t.title, kind: t.kind,
    script: runtimeScript(t, lang), instruction: inLang(t.script.intro, lang), coach_text: coach, ...coachC,
    source: t.source, deviation: t.deviation, ...(t.practice_note ? { practice_note: t.practice_note } : {}),
    response: t.response, present: t.present, time_limit_s: t.time_limit_s, advance_after_s: t.advance_after_s,
    ...(t.next_at_s ? { next_at_s: t.next_at_s } : {}), ...(t.say_on ? { say_on: t.say_on } : {}), stop: {}, ...(t.stop_note ? { stop_note: t.stop_note } : {}),
    ...(t.grid ? { grid: t.grid, direction: t.direction } : {}), ...(t.letter_rule ? { letter_rule: t.letter_rule } : {}), ...(t.chip ? { chip: t.chip[lang] } : {}),
    items: t.items.map(item), practice: t.practice.map(item),
  };
}

module.exports = { W3_TASKS, VARIANTS, LINES_W3, w3Tasks, runtimeW3Task, passageTokens, relineStory };
