'use strict';

/**
 * Builds the self-administered (SA) battery bank (CONTRACT §2) from the official banks. Nothing here is test content:
 * every scored item, practice item and tap option is read out of item-bank.v3.json (Set A: RWP May 2026, EGRA Toolkit
 * 2016/2009, Core EGMA, Sindh SELECT), and each item carries the path it came from (`src`). This file decides only the
 * SA shape: forms, response modes (DESIGN §2), the stop rules in the engine's terms, tap options by a named rule, and
 * Jugnu's lines (sa/scripts.js).
 *
 *   node bot/scripts/child-test/build-sa-bank.js        rewrites item-bank.sa.v1.json and sa/<form>.json
 *
 * Pure and deterministic: the same banks give the same bytes (options are ordered by a hash of the item id).
 */

const crypto = require('crypto');
const { TASKS_V3 } = require('../tasks');
const { COMMON, BATTERY, CHECK_WORDS, GAME_LINES, TASKS: LINES, CHAINS, MATHS_PRACTICE, UR_LETTER_NAMES, EN_LETTER_SOUNDS } = require('./scripts');
const W3 = require('./build-w3');
const { applyReviewed, loadReviewed } = require('./reviewed-lines');

const VERSION = 'child-test-items-sa-v1';
const SET = 'A';

// The forms (RULING #4). Coach: Grades 1-5 on the term's set (draw/term-set.js); EGRA/EGMA have no per-grade forms, so
// Grades 1-2 take the G3 items and Grade 4 the G5 items. Game: the Challenge's grade
// bands (web-quiz-challenge-draw.js gradeBand: 2-3 → G3, 4-5 → G5) plus grade 1, which reads the same EGRA forms (the
// May RWP instrument was one form for Grades 1-5) and Core EGMA (written for Grades 1-3).
const FORMS = [
  { form: 'coach.G1.A', surface: 'coach', grades: [1], maths: '3' },
  { form: 'coach.G2.A', surface: 'coach', grades: [2], maths: '3' },
  { form: 'coach.G3.A', surface: 'coach', grades: [3], maths: '3' },
  { form: 'coach.G4.A', surface: 'coach', grades: [4], maths: '5' },
  { form: 'coach.G5.A', surface: 'coach', grades: [5], maths: '5' },
  { form: 'game.G1', surface: 'game', grades: [1], maths: '3' },
  { form: 'game.G23', surface: 'game', grades: [2, 3], maths: '3' },
  { form: 'game.G45', surface: 'game', grades: [4, 5], maths: '5' },
];

// DESIGN §3 blocks (Design A): one block per child per visit.
const BLOCKS = {
  B1: ['ur.letters', 'ur.nonwords', 'ur.words', 'ur.story', 'ur.story_comp'],
  B2: ['en.letters', 'en.nonwords', 'en.words', 'en.story', 'en.story_comp'],
  B3: ['ur.listening', 'en.listening'],
  B4: ['ma.number_id', 'ma.discrimination', 'ma.missing'],
  B5: ['ma.add1', 'ma.sub1', 'ma.add2', 'ma.sub2', 'ma.word_problems'],
};
const BLOCK_NAMES = {
  B1: { en: 'Urdu reading', ur: 'اردو پڑھنا' }, B2: { en: 'English reading', ur: 'انگریزی پڑھنا' },
  B3: { en: 'Listening', ur: 'سن کر سمجھنا' }, B4: { en: 'Maths: numbers', ur: 'ریاضی: نمبر' }, B5: { en: 'Maths: sums', ur: 'ریاضی: سوال' },
};

// DESIGN §2: 5 tiles for letters, 4 for every other tap; replay at 5 s and move on at 10 s on a timed tap task.
const OPTIONS_N = { letters: 5 };
// The SA time rules as data (CONTRACT §2), so the engine's defaults are never the rule of record: a timed item
// replays at 5 s and counts wrong at 10 s; an untimed item offers "next" at 15 s (word problems: answer cap 60 s).
const TIMED_TAP = { item_timeout_s: 10, replay_at_s: 5 };
const UNTIMED_TAP = { item_timeout_s: null, replay_at_s: null, next_at_s: 15 };

const SUBTASK = {
  listening: 'listening_comprehension', letters: 'letter_name_identification', nonwords: 'nonword_reading',
  words: 'familiar_word_reading', story: 'oral_reading_fluency', story_comp: 'reading_comprehension',
  number_id: 'number_identification', discrimination: 'quantity_discrimination', missing: 'missing_number',
  add1: 'addition_level_1', sub1: 'subtraction_level_1', add2: 'addition_level_2', sub2: 'subtraction_level_2',
  word_problems: 'word_problems',
};

const h = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const byHash = (seed) => (a, b) => (h(`${seed}|${a}`) < h(`${seed}|${b}`) ? -1 : 1);
const fill = (line, x) => ({ en: line.en.replace(/\{x\}/g, x.en ?? x), ur: line.ur.replace(/\{x\}/g, x.ur ?? x), from: line.from });
const toUrDigits = (s) => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const audioKey = (lang, text) => `sa/v1/${lang}/${h(`${lang}|${text}`).slice(0, 12)}.mp3`;
const pad = (n, w) => String(n).padStart(w, '0');

/** A line Jugnu speaks in either language, with the clip key each language's text is voiced into. */
function spoken({ en, ur, from }) {
  return { en, ur, ...(from ? { from } : {}), audio: { en: audioKey('en', en), ur: audioKey('ur', ur) } };
}
/** Words in one language only (a story, a question, a word on the grid): { text, lang, audio }. */
function said(lang, text) {
  return { text, lang, audio: audioKey(lang, text) };
}
/** Words Jugnu says in either language (a number, a sum): { en, ur, audio{en,ur} }. */
function sayBoth(en, ur) {
  return { en, ur, audio: { en: audioKey('en', en), ur: audioKey('ur', ur) } };
}
/**
 * RULING #31a: a line naming an item, as the chain of clips the other-language page says: each carrier (CHAINS, both
 * languages) then the item in its own language's clip ('x', 'y'). Kept next to the whole line; runtimeItem picks.
 */
function chainOf(segs, itemLang, x, y) {
  if (!segs) return null;
  return segs.map((s) => (s === 'x' ? said(itemLang, x) : s === 'y' ? said(itemLang, y) : spoken(s)));
}
/** Practice feedback: the whole lines, plus their chains when the task's lines have them. */
function feedbackOf(key, lines, itemLang, x, y) {
  const c = CHAINS[key] || {};
  const two = y !== undefined;
  const whole = (l) => spoken(two ? fill2(l, x, y) : fill(l, x));
  return { correct: whole(lines.right), wrong: whole(lines.wrong),
    ...(c.right ? { correct_chain: chainOf(c.right, itemLang, x, y) } : {}), ...(c.wrong ? { wrong_chain: chainOf(c.wrong, itemLang, x, y) } : {}) };
}

const MARKS = /[\u064B-\u065F\u0670]/gu; // Urdu diacritics: not counted in a word's length
const shapeLen = (x) => [...String(x).replace(MARKS, '')].length;

/**
 * Tap options: the target and n-1 others from the same official list (DESIGN §2: "drawn from the same grid, no new
 * letters"). `key` says when two list entries answer the same prompt (S and s have one name; c and k one sound): no
 * option shares the target's key, or another option's, so exactly one tile is right. Words and made-up words prefer
 * list-mates of the same length and first letter (so length gives nothing away), then any that share a letter.
 * Ordered by a hash of the item id, so the target's place varies but the bytes never do.
 */
function listOptions(id, target, list, n, { shareLetter = false, sameShape = false, key = (x) => x } = {}) {
  const t = String(target);
  const first = [...t.replace(MARKS, '')][0];
  const letters = new Set([...t]);
  const score = (x) => (sameShape ? (shapeLen(x) === shapeLen(t) ? 2 : 0) + ([...x.replace(MARKS, '')][0] === first ? 1 : 0) : 0)
    + (shareLetter && [...x].some((c) => letters.has(c)) ? 0.5 : 0);
  const pool = [...new Set(list.map(String))].filter((x) => x !== t).sort(byHash(`${id}|pick`));
  const ranked = pool.map((x, i) => [x, i]).sort((a, b) => score(b[0]) - score(a[0]) || a[1] - b[1]).map(([x]) => x);
  const keys = new Set([key(t)]);
  const picked = [];
  for (const x of ranked) {
    if (picked.length === n - 1) break;
    if (keys.has(key(x))) continue;
    keys.add(key(x));
    picked.push(x);
  }
  return [t, ...picked].sort(byHash(`${id}|order`));
}

/** Missing-number options (DESIGN §2): the answer and its neighbours one step of the sequence away, then ±1, never < 0. */
function stepOptions(id, answer, step, n = 4) {
  const a = Number(answer);
  const near = [a + step, a - step, a + 2 * step, a - 2 * step, a + 1, a - 1].filter((x) => x >= 0 && x !== a);
  return [a, ...[...new Set(near)].slice(0, n - 1)].sort(byHash(`${id}|order`));
}

function seqStep(seq) {
  const known = seq.map((x, i) => [x, i]).filter(([x]) => x !== null);
  const [[x0, i0], [x1, i1]] = known;
  return Math.abs((x1 - x0) / (i1 - i0)) || 1;
}

// RULING #17 ⚠4: a tap first row stops at chance, not at zero (5 tiles: ≤ 2 of 10 letters; 4 tiles: ≤ 1 of 5 words).
const CHANCE_MAX = { letters: 2, letter_sounds: 2, nonwords: 1, words: 1 };
const CHANCE_NOTE = 'the first-row stop on the tap side is at chance (≤ 2 of 10 letters, ≤ 1 of 5 words; RULING #17), the recording side keeps EGRA\'s zero rule';
const chanceStop = (stop, kind) => (stop && CHANCE_MAX[kind] != null ? { ...stop, max_correct: CHANCE_MAX[kind] } : stop);

function stopOf(v3stop, firstLineN) {
  if (v3stop.type === 'first_row') return { type: 'first_row', n: v3stop.n };
  if (v3stop.type === 'first_line') return { type: 'first_line', n: firstLineN };
  if (v3stop.type === 'consecutive_errors') return { type: 'consecutive_errors', n: v3stop.n };
  return null;
}

/** Jugnu's lines for one task, under CONTRACT §2's names. */
function scriptOf(key, mode, demo, demoChain) {
  const t = LINES[key] || {};
  const intro = mode === 'record' ? (t.intro_record || t.intro_tap) : (t.intro_tap || t.intro_record);
  const out = { intro: spoken(intro) };
  if (demo) out.demo = spoken(demo);
  if (demo && demoChain) out.demo_chain = demoChain;
  for (const k of ['practice_intro', 'practice_right', 'practice_wrong', 'test_intro', 'begin', 'replay', 'time_up', 'early_stop', 'after', 'hand_back']) {
    out[k] = spoken(COMMON[k]);
  }
  return out;
}
const sourceOf = (spec, scriptFrom, adaptation) => ({ items: spec.source && spec.source.items, script: (spec.source && spec.source.script) || scriptFrom, sa_adaptation: adaptation });

// ---------------------------------------------------------------------------------------------- reading tasks
function gridTask({ lang, kind, spec, extraPractice }) {
  const task = `${lang}.${kind}`;
  const base = `v3:sets.${SET}.reading.${lang}.${kind}`;
  const lines = LINES[kind === 'letters' ? task : kind];
  const n = OPTIONS_N[kind] || 4;
  const sayOf = (x) => (lang === 'ur' && kind === 'letters' ? UR_LETTER_NAMES[x] || x : x);
  // Letters: one name per tile (S and s, or two Urdu letters with one name, never both on screen).
  const key = kind === 'letters' ? (x) => String(sayOf(x)).toLowerCase() : (x) => x;
  const opts = (id, x) => listOptions(id, x, spec.items, n, { shareLetter: kind !== 'letters', sameShape: kind !== 'letters', key });
  const items = spec.items.map((x, i) => {
    const id = `${task}.${pad(i + 1, 3)}`;
    return { id, target: x, options: opts(id, x), say: said(lang, sayOf(x)), src: `${base}.items[${i}]` };
  });
  // v3 holds no practice for some grids; an official form's own practice items fill them (extraPractice, with src).
  const own = (spec.practice || []).length ? spec.practice.map((p, i) => ({ ...p, src: `${base}.practice[${i}]` })) : (extraPractice || []);
  const practice = own.map((p, i) => {
    const id = `${task}.p${i + 1}`;
    const s = sayOf(p.item);
    return { id, role: p.role, target: p.item, options: opts(id, p.item), say: said(lang, s),
      feedback: feedbackOf(kind === 'letters' ? task : kind, lines, lang, s), src: p.src };
  });
  const example = practice.find((p) => p.role === 'example');
  return {
    task, lang, kind: 'grid', legacy_block: task, family: 'egra', subtask: SUBTASK[kind], title: spec.title, modes: ['tap'],
    tap: { options_n: n, distractor_rule: kind === 'letters' ? 'same_list_one_name' : 'same_list_same_length_first_letter', input: 'options',
      items, time_limit_s: spec.timed_s, ...TIMED_TAP, stop: chanceStop(stopOf(spec.stop), kind) },
    record: { grid: spec.items, per_row: spec.per_row, direction: spec.direction, time_limit_s: spec.timed_s, stop: stopOf(spec.stop) },
    practice, ...(practice.length ? {} : { practice_note: spec.practice_note }),
    ...(!(spec.practice || []).length && practice.length ? { practice_note: 'practice items from the official form named in each src (v3 holds none)' } : {}),
    script: scriptOf(kind === 'letters' ? task : kind, 'tap', example && lines.example ? fill(lines.example, example.say.text) : null,
      example && chainOf((CHAINS[kind === 'letters' ? task : kind] || {}).example, lang, example.say.text)),
    source: sourceOf(spec, `${base}.script`, 'Tangerine SA hear-then-tap (sec_letter_sounds_01, sec_vocab_01); RULING #2'),
    deviation: `recognition, not production: Jugnu says the item and the child taps it (Tangerine SA's own choice); the 3-second rule becomes replay at 5 s, auto-advance marked wrong at 10 s; ${CHANCE_NOTE}`,
  };
}

function storyTasks({ lang, spec, task = `${lang}.story`, base = `v3:sets.${SET}.reading.${lang}.story`, legacy = task, adaptation = null }) {
  const lines = spec.story.lines || [];
  const lineOf = (i) => (lines.find((l) => i >= l.from && i <= l.to) || {}).n || null;
  const words = spec.items.map((w, i) => ({ id: `${task}.${pad(i + 1, 3)}`, target: w, line: lineOf(i), src: `${base}.items[${i}]` }));
  const first = lines[0] ? lines[0].to - lines[0].from + 1 : spec.items.length;
  const story = {
    task, lang, kind: 'passage', legacy_block: legacy, family: 'egra', subtask: SUBTASK.story, title: spec.title, modes: ['record'],
    tap: null,
    record: { passage: { text: spec.story.text, lines, direction: spec.direction, words }, time_limit_s: spec.timed_s,
      stop: stopOf(spec.stop, first), last_word_tap: true },
    practice: [], practice_note: spec.practice_note,
    script: scriptOf('story', 'record', LINES.story.last_word),
    source: sourceOf(spec, `${base}.script.intro`, adaptation || 'RTI bracket: at time-up the child taps the last word read (RULING #2); Tangerine moving-window reading NOT adopted'),
    deviation: 'the child taps the last word read instead of the assessor bracketing it',
  };
  const questions = spec.questions.map((q, i) => ({ id: q.id, prompt: said(lang, q.prompt), needs_line: q.needs_line || null,
    accept: q.accept, reject: q.reject || [], rubric: q.rubric, ...(q.accept_rule ? { accept_rule: q.accept_rule } : {}), src: `${base}.questions[${i}]` }));
  const comp = {
    task: `${task}_comp`, lang, kind: 'questions', legacy_block: legacy, family: 'egra', subtask: SUBTASK.story_comp,
    title: { en: 'Story questions', ur: 'کہانی کے سوال' }, modes: ['record'], tap: null,
    record: { questions, answer_window_s: 10, replay_max: 1 },
    depends_on: { task, upto_item: 'last_word_tap', needs_line: true },
    practice: [], practice_note: 'EGRA reading comprehension has no practice item (TK 2016 p.197).',
    script: scriptOf('story_comp', 'record'),
    source: sourceOf(spec, `${base}.script.questions_intro`, 'asked only up to the line reached (scoring/reach.js); answers recorded, scored later'),
    deviation: 'the spoken answer is recorded and scored later instead of marked by an assessor',
  };
  return [story, comp];
}

function listeningTask({ lang, spec, task = `${lang}.listening`, base = `v3:sets.${SET}.reading.${lang}.listening`, legacy = task, adaptation = null }) {
  const questions = spec.questions.map((q, i) => ({ id: q.id, prompt: said(lang, q.prompt), accept: q.accept, reject: q.reject || [],
    rubric: q.rubric, src: `${base}.questions[${i}]` }));
  return {
    task, lang, kind: 'listen_questions', legacy_block: legacy, family: 'egra', subtask: SUBTASK.listening, title: spec.title,
    modes: ['record'], tap: null,
    record: { passage: { ...said(lang, spec.story.text), read_times: spec.read_times, shown: false }, questions, answer_window_s: 10, replay_max: 1 },
    practice: [], practice_note: spec.practice_note,
    script: scriptOf('listening', 'record'),
    source: sourceOf(spec, `${base}.script.intro`, adaptation || 'Jugnu reads the story twice (v3/RWP read_times 2); each answer recorded'),
    deviation: 'the spoken answer is recorded and scored later instead of marked by an assessor',
  };
}

// ---------------------------------------------------------------------------------------------- maths tasks
const SAY_OP = { '+': { en: 'plus', ur: 'جمع' }, '-': { en: 'minus', ur: 'منفی' } };

/** Practice feedback on a maths item: the task's own lines, else the Core EGMA word-problem practice wording. */
function mathsFeedback(lines, ans, numberId) {
  const n = { en: String(ans), ur: toUrDigits(ans) };
  return { correct: spoken(fill(lines.right || MATHS_PRACTICE.right, n)),
    wrong: spoken(fill(lines.wrong || (numberId ? MATHS_PRACTICE.wrong_number : MATHS_PRACTICE.wrong), n)) };
}

function mathsTask({ kind, spec, grade, borrowed }) {
  const task = `ma.${kind}`;
  const base = `v3:sets.${SET}.maths.${grade}.${kind}`;
  // RULING #17 M3: missing number is typed at Grade 5 (tap 1 of 4 at Grades 1-3).
  const keypad = ['add1', 'sub1', 'add2', 'sub2', 'word_problems'].includes(kind) || (kind === 'missing' && grade === '5');
  const timed = !!spec.timed_s;
  const lines = LINES[task] || {};
  const op = /^add/.test(kind) ? '+' : /^sub/.test(kind) ? '-' : null;
  const itemOf = (it, id, src) => {
    if (kind === 'number_id') return { id, target: Number(it), options: listOptions(id, it, spec.items, 4).map(Number), say: sayBoth(String(it), toUrDigits(it)), src };
    if (kind === 'discrimination') return { id, target: it.answer, options: [it.a, it.b], src };
    if (kind === 'missing') return { id, target: it.answer, ...(keypad ? {} : { options: stepOptions(id, it.answer, seqStep(it.seq)) }), shown: it.seq, src };
    if (op) return { id, target: it.answer, shown: `${it.a} ${op} ${it.b} =`, say: sayBoth(`${it.a} ${SAY_OP[op].en} ${it.b}`, `${toUrDigits(it.a)} ${SAY_OP[op].ur} ${toUrDigits(it.b)}`), src };
    return { id, target: it.answer, prompt: sayBoth(it.prompt_en, it.prompt_ur), type: it.type || null, counters: 10, src };
  };
  const items = spec.items.map((it, i) => itemOf(it, `${task}.G${grade}.${pad(i + 1, 2)}`, `${base}.items[${i}]`));
  const practice = (spec.practice || []).map((it, i) => {
    const p = itemOf(it, `${task}.G${grade}.p${i + 1}`, `${base}.practice[${i}]`);
    const ans = it.answer;
    if (lines.right) p.feedback = { correct: spoken(fill(lines.right, { en: String(ans), ur: toUrDigits(ans) })), wrong: spoken(fill(lines.wrong, { en: String(ans), ur: toUrDigits(ans) })) };
    return p;
  });
  // A11 (switch sa_practice_all_maths): where the source prints no practice, an official item of the same format that is
  // in no scored set (item-bank.sa-extra.v1.json maths.practice, src per item).
  const practiceV2 = !practice.length && borrowed && borrowed.length ? borrowed.map((b, i) => {
    const p = itemOf(kind === 'number_id' ? b.numeral : b, `${task}.G${grade}.p${i + 1}`, `extra:maths.practice.items.${task}[${i}] (${b.src})`);
    if (kind === 'number_id') p.options = listOptions(p.id, b.numeral, [...spec.items, b.numeral], 4).map(Number);
    p.feedback = mathsFeedback(lines, p.target, kind === 'number_id');
    return p;
  }) : null;
  return {
    task, lang: null, kind: keypad ? 'keypad' : kind === 'number_id' ? 'grid' : 'choice', legacy_block: task, family: 'egma',
    subtask: SUBTASK[kind], title: spec.title, modes: ['tap'],
    tap: { options_n: keypad ? null : kind === 'discrimination' ? 2 : 4,
      distractor_rule: keypad ? null : kind === 'number_id' ? 'same_list' : kind === 'discrimination' ? 'the_pair' : 'plus_minus_one_step',
      input: keypad ? 'keypad' : 'options', items, time_limit_s: spec.timed_s, ...(timed ? TIMED_TAP : UNTIMED_TAP),
      ...(kind === 'word_problems' ? { soft_cap_s: 60 } : {}), ...(op ? { say_on: 'replay' } : {}), stop: stopOf(spec.stop) },
    record: null,
    practice, ...(practice.length ? {} : { practice_note: spec.practice_note }), ...(practiceV2 ? { practice_v2: practiceV2 } : {}),
    script: scriptOf(task, 'tap'),
    source: sourceOf(spec, `${base}.script`, keypad ? 'Tangerine SA keypad (sec_l1_addition_01, sec_l1_word_problem_01); RULING #2' : 'Tangerine SA tap (sec_num_id1, sec_num_comp1, sec_miss_num_01); RULING #2'),
    deviation: keypad ? `typed on a keypad, not spoken${op ? '; the sum is shown and spoken only on the replay tile (RULING #17)' : ''}` : kind === 'number_id' ? 'recognition instead of naming' : null,
  };
}

// ---------------------------------------------------------------------------------------------- extra subtasks
// DESIGN §2b: subtasks beyond the 18 v3 tasks, from item-bank.sa-extra.v1.json (official items only, each with src).
// They join the game islands and the coach full form; patterns also joins block B4.
// The source writes − × ÷ (sometimes - * /); the screen shows the school signs.
const OP_SAY = { '+': { en: 'plus', ur: 'جمع' }, '−': { en: 'minus', ur: 'منفی' }, '×': { en: 'times', ur: 'ضرب' }, '÷': { en: 'divided by', ur: 'تقسیم' } };
const TITLES = {
  'ma.patterns': { en: 'Patterns', ur: 'ترتیب' }, 'ma.patterns_hi': { en: 'Patterns 2', ur: 'ترتیب ۲' },
  'ma.number_repr': { en: 'Tens and hundreds', ur: 'دہائیاں اور سینکڑے' }, 'ma.ordering': { en: 'Number order', ur: 'نمبروں کی ترتیب' },
  'ma.fluency_l34': { en: 'Quick sums 2', ur: 'جلدی والے سوال ۲' }, 'ma.word_problems_l2': { en: 'Story sums 2', ur: 'کہانی والے سوال ۲' },
  'ma.number_id_upper': { en: 'Big numbers', ur: 'بڑے نمبر' },
};
const OP_NORM = { '-': '−', '*': '×', '/': '÷' };

function permutations(xs) {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

function extraMathsTask({ task, spec, items, input, options_n, distractor_rule, scriptKey, adaptation, deviation, extraBase, depends_on, sayOnReplay, stop = null, softCap = null, practiceV2 = null, demoCopy = false }) {
  const timed = !!spec.timed_s;
  const script = scriptOf(scriptKey, 'tap');
  // A11 (switch sa_practice_all_maths): no unused fielded item exists, so Tangerine's demo pattern: a disabled copy of
  // item 1 shown with the instruction, its answer not shown; item 1 then scores as normal.
  if (demoCopy && items.length) {
    const { target: _t, ...first } = items[0];
    script.demo_item = { ...first, id: `${items[0].id}.demo`, disabled: true };
  }
  return {
    task, lang: null, kind: input === 'keypad' ? 'keypad' : 'choice', legacy_block: null, family: 'egma', subtask: spec.subtask,
    title: TITLES[task], modes: ['tap'],
    tap: { options_n, distractor_rule, input, items, time_limit_s: spec.timed_s, ...(timed ? TIMED_TAP : UNTIMED_TAP), stop,
      ...(softCap ? { soft_cap_s: softCap } : {}), ...(sayOnReplay ? { say_on: 'replay' } : {}) },
    record: null, practice: [], practice_note: spec.practice_note, ...(practiceV2 && practiceV2.length ? { practice_v2: practiceV2 } : {}),
    script,
    source: { items: extraBase, script: LINES[scriptKey].intro_tap.from, sa_adaptation: adaptation },
    deviation, ...(depends_on ? { depends_on } : {}),
  };
}

function extraTasks(f, extra) {
  const m = extra.maths;
  const base = (k) => `extra:maths.${k}`;
  const ur = extra.conventions.ur_words;
  const glyph = extra.conventions.glyphs;
  const out = [];
  const say = (it) => sayBoth(it.say_en, it.say_ur);
  const src = (k, i) => `${base(k)}.items[${i}]`;
  const P = m.practice || { items: {}, disabled_copy: [] };
  const demoCopy = (task) => (P.disabled_copy || []).includes(task);
  const borrowed = (task) => P.items[task] || [];
  const psrc = (task, i, b) => `extra:maths.practice.items.${task}[${i}] (${b.src})`;
  // An authored practice item (src authored:practice) carries its own feedback lines where the bank's would not fit.
  const practiceFeedback = (b) => {
    const d = mathsFeedback({}, b.answer);
    return { correct: b.right_en ? spoken({ en: b.right_en, ur: b.right_ur, from: b.src }) : d.correct,
      wrong: b.wrong_en ? spoken({ en: b.wrong_en, ur: b.wrong_ur, from: b.src }) : d.wrong };
  };
  const authoredPractice = (task, item) => borrowed(task).map((b, i) => ({ ...item(b, i), id: `${task}.p${i + 1}`, practice: true, src: b.src, feedback: practiceFeedback(b) }));

  // Patterns: levels 1-2 tap 1 of the item's own 4 printed options; levels 3-4 typed, only after a correct level 1-2 item.
  const pat = m.patterns.items.map((it, i) => ({ it, i }));
  // RULING #44 addendum 2: the row as RWP printed it — a "what comes next" row ends with its blank, and a printed ___
  // is the same gap (null), so the gap tile marks where the child answers on either page's reading direction.
  const BLANK_LAST = ['next_term_mc', 'next_term_open'];
  const shownOf = (it) => [...it.seq.map((s) => (s === '___' ? null : glyph[s] || s)), ...(BLANK_LAST.includes(it.type) ? [null] : [])];
  const patItem = ({ it, i }) => {
    const id = `ma.patterns.${it.id.replace('patterns_', '')}`;
    if (it.options) {
      // Numerals stay Western digits on both pages (the maths convention), as the row shows them.
      const labels = { en: it.options, ur: it.options.map((o) => ur[o] || o) };
      const glyphs = it.options.map((o) => glyph[o] || null);
      // RULING #44 (A13): picture options; Jugnu says the four, as the RWP enumerator read the card's a)-d).
      const pictured = glyphs.every(Boolean);
      const listEn = `${labels.en.slice(0, -1).join(', ')}, or ${labels.en[labels.en.length - 1]}?`;
      const listUr = `${labels.ur.slice(0, -1).join('، ')} یا ${labels.ur[labels.ur.length - 1]}؟`;
      return { id, target: it.answer, options: it.options, labels, glyphs, shown: shownOf(it),
        say: pictured ? sayBoth(`${it.say_en}: ${listEn}`, `${it.say_ur}: ${listUr}`) : say(it), level: it.level, src: src('patterns', i) };
    }
    return { id, target: it.answer, shown: shownOf(it), say: say(it), level: it.level, src: src('patterns', i) };
  };
  out.push(extraMathsTask({ task: 'ma.patterns', spec: m.patterns, items: pat.filter((x) => x.it.level <= 2).map(patItem), input: 'options',
    options_n: 4, distractor_rule: 'printed_in_source', scriptKey: 'ma.patterns', extraBase: base('patterns'), demoCopy: demoCopy('ma.patterns'),
    practiceV2: authoredPractice('ma.patterns', (b, i) => patItem({ it: b, i })),
    adaptation: 'Tangerine SA tap 1 of 4 (sec_miss_num_01); the RWP card\'s four printed options', deviation: null,
    stop: { type: 'consecutive_errors', n: 4 } })); // EGMA's untimed convention: 4 wrong in a row ends the task
  out.push(extraMathsTask({ task: 'ma.patterns_hi', spec: m.patterns, items: pat.filter((x) => x.it.level >= 3).map(patItem), input: 'keypad',
    options_n: null, distractor_rule: null, scriptKey: 'ma.patterns_hi', extraBase: base('patterns'), demoCopy: demoCopy('ma.patterns_hi'),
    practiceV2: authoredPractice('ma.patterns_hi', (b, i) => patItem({ it: b, i })),
    adaptation: 'Tangerine SA keypad (sec_l1_addition_01); RWP levels 3-4', deviation: 'typed on a keypad, not spoken',
    depends_on: { task: 'ma.patterns', skip_if_zero: true }, stop: { type: 'consecutive_errors', n: 4 } }));

  // Number representation: the items that need no picture (levels 1-2 picture cards were not recovered).
  const rep = m.number_repr.items.map((it, i) => ({ it, i })).filter((x) => !x.it.picture);
  out.push(extraMathsTask({ task: 'ma.number_repr', spec: m.number_repr, input: 'keypad', options_n: null, distractor_rule: null,
    items: rep.map(({ it, i }) => ({ id: `ma.number_repr.${it.id.replace('represent_', '')}`, target: it.answer, say: say(it), level: it.level, src: src('number_repr', i) })),
    // A11: no source prints a place-value practice item, so one authored example (src authored:practice), never scored.
    practiceV2: authoredPractice('ma.number_repr', (b) => ({ target: b.answer, say: say(b) })),
    scriptKey: 'ma.number_repr', extraBase: base('number_repr'), adaptation: 'Tangerine SA keypad; RWP number representation', demoCopy: demoCopy('ma.number_repr'),
    deviation: `typed on a keypad; picture items ${m.number_repr.items.filter((x) => x.picture).map((x) => x.id).join(', ')} held out until their pictures exist, so no level gate` }));

  // Ordering and next number: tap 1 of 4 (next: the ±1-step rule; order: orderings of the same three numbers).
  out.push(extraMathsTask({ task: 'ma.ordering', spec: m.ordering, input: 'options', options_n: 4, distractor_rule: 'plus_minus_one_step | orderings_of_the_set',
    items: m.ordering.items.map((it, i) => {
      const id = `ma.ordering.${it.id.replace('identify_', '')}`;
      if (it.type === 'next') return { id, target: it.answer, options: stepOptions(id, it.answer, seqStep(it.seq)), shown: [...it.seq, null], say: say(it), level: it.level, src: src('ordering', i) };
      const t = it.answer.join(', ');
      const others = permutations(it.numbers).map((p) => p.join(', ')).filter((p) => p !== t).sort(byHash(`${id}|pick`)).slice(0, 3);
      return { id, target: t, options: [t, ...others].sort(byHash(`${id}|order`)), shown: it.numbers, say: say(it), level: it.level, src: src('ordering', i) };
    }),
    scriptKey: 'ma.ordering', extraBase: base('ordering'), adaptation: 'Tangerine SA tap 1 of 4; RWP number ordering',
    deviation: 'the child taps 1 of 4 orderings instead of saying the order; no level gate (the larger-of items are the comparison task)' }));

  // Fact fluency levels 3-4 (+, −, ×, ÷), RWP's second 60-second grid.
  const factItem = (it, id, s) => {
    const op = OP_NORM[it.op] || it.op;
    return { id, target: it.answer, shown: `${it.a} ${op} ${it.b} =`,
      say: sayBoth(`${it.a} ${OP_SAY[op].en} ${it.b}`, `${toUrDigits(it.a)} ${OP_SAY[op].ur} ${toUrDigits(it.b)}`), src: s };
  };
  out.push(extraMathsTask({ task: 'ma.fluency_l34', spec: m.fluency_l34, input: 'keypad', options_n: null, distractor_rule: null,
    items: m.fluency_l34.items.map((it, i) => factItem(it, `ma.fluency_l34.${pad(i + 1, 2)}`, src('fluency_l34', i))),
    practiceV2: borrowed('ma.fluency_l34').map((b, i) => ({ ...factItem(b, `ma.fluency_l34.p${i + 1}`, psrc('ma.fluency_l34', i, b)), feedback: mathsFeedback({}, b.answer) })),
    scriptKey: 'ma.fluency_l34', extraBase: base('fluency_l34'), adaptation: 'Tangerine SA keypad; RWP fact grid levels 3-4 (60 s)', sayOnReplay: true,
    deviation: 'typed on a keypad; RWP gave this grid only after 5+ correct on its level 1-2 grid, here after any correct addition level 1 item',
    depends_on: { task: 'ma.add1', skip_if_zero: true } }));

  // Word problems level 2 (the two RWP items not in v3).
  out.push(extraMathsTask({ task: 'ma.word_problems_l2', spec: m.word_problems_l2, input: 'keypad', options_n: null, distractor_rule: null,
    items: m.word_problems_l2.items.map((it, i) => ({ id: `ma.word_problems_l2.${it.id.replace('word_problems_', '')}`, target: it.answer,
      prompt: sayBoth(it.prompt_en, it.prompt_ur), counters: 10, src: src('word_problems_l2', i) })),
    scriptKey: 'ma.word_problems', extraBase: base('word_problems_l2'), adaptation: 'Tangerine SA keypad (sec_l1_word_problem_01); RWP word problems 2a/2b', softCap: 60,
    deviation: 'typed on a keypad, not spoken' }));

  // Upper-grade number identification (RTI Rwanda P6 sample items), Grades 4-5 forms only.
  if (f.grades.some((g) => (m.number_id_upper.grades || []).includes(g))) {
    const list = m.number_id_upper.items.map((x) => x.numeral);
    out.push(extraMathsTask({ task: 'ma.number_id_upper', spec: m.number_id_upper, input: 'options', options_n: 4, distractor_rule: 'same_list',
      items: m.number_id_upper.items.map((it, i) => {
        const id = `ma.number_id_upper.${pad(i + 1, 2)}`;
        return { id, target: it.numeral, options: listOptions(id, it.numeral, list, 4), say: sayBoth(it.numeral, toUrDigits(it.numeral)), src: src('number_id_upper', i) };
      }),
      practiceV2: borrowed('ma.number_id_upper').map((b, i) => {
        const id = `ma.number_id_upper.p${i + 1}`;
        return { id, target: b.numeral, options: listOptions(id, b.numeral, [...list, b.numeral], 4), say: sayBoth(b.numeral, toUrDigits(b.numeral)),
          feedback: mathsFeedback({}, b.numeral, true), src: psrc('ma.number_id_upper', i, b) };
      }),
      scriptKey: 'ma.number_id', extraBase: base('number_id_upper'), adaptation: 'Tangerine SA tap (sec_num_id1); RTI Rwanda P6 sample items',
      deviation: `recognition instead of naming; ${m.number_id_upper.caveat}` }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- reading extras
// Same-sound groups: a tile from the target's group would be a second right answer to a sound prompt.
const EN_SOUND_KEY = (x) => ({ c: 'k', q: 'k' }[String(x).toLowerCase()] || String(x).toLowerCase());
const UR_SOUND_GROUPS = [['ذ', 'ز', 'ض', 'ظ'], ['ث', 'س', 'ص'], ['ت', 'ط'], ['ح', 'ہ', 'ھ'], ['ع', 'ا', 'آ', 'ء'], ['ک', 'ق']];
const UR_SOUND_KEY = (x) => (UR_SOUND_GROUPS.find((g) => g.includes(x)) || [x])[0];
const fill2 = (line, x, y) => ({ en: line.en.replace(/\{x\}/g, x).replace(/\{y\}/g, y.en ?? y), ur: line.ur.replace(/\{x\}/g, x).replace(/\{y\}/g, y.ur ?? y), from: line.from });

function readingTask({ task, lang, kind, subtask, title, items, practice, timed_s, stop, options_n, distractor_rule, scriptLines, demo, demoChain, extraBase, adaptation, deviation, record }) {
  return {
    task, lang, kind, legacy_block: null, family: 'egra', subtask, title, modes: ['tap'],
    tap: { options_n, distractor_rule, input: 'options', items, time_limit_s: timed_s, ...(timed_s ? TIMED_TAP : UNTIMED_TAP), stop },
    record: record || null, practice, ...(practice.length ? {} : { practice_note: 'none printed in the source' }),
    script: scriptOf(scriptLines, 'tap', demo, demoChain),
    source: { items: extraBase, script: LINES[scriptLines].intro_tap.from, sa_adaptation: adaptation }, deviation,
  };
}

// SELECT counts the reduplicated ٹَیں ٹَیں as one word (its markers sum to 60 only that way).
const toks = (t) => t.replace(/ٹَیں ٹَیں/g, 'ٹَیں_ٹَیں').split(/\s+/).map((w) => w.replace(/^[“"‘(]+|[.,!?”"’:;۔،؟)]+$/gu, '').replace('_', ' ')).filter(Boolean);

function readingExtras(extra) {
  const r = extra.reading;
  if (!r) return [];
  const out = [];
  const snd = (l) => EN_LETTER_SOUNDS[String(l).toLowerCase()] || l;

  // English letter sounds: the TK2009 letter grid; Jugnu says a sound, the child taps 1 of 5 from the grid.
  const ls = r.en.letter_sounds;
  const grid = ls.items.map((x) => x.letter);
  const lsOpts = (id, x) => listOptions(id, x, grid, 5, { key: EN_SOUND_KEY });
  const L = LINES['en.letter_sounds'];
  out.push(readingTask({ task: 'en.letter_sounds', lang: 'en', kind: 'grid', subtask: ls.subtask, title: { en: 'Letter sounds', ur: 'حروف کی آوازیں' },
    items: ls.items.map((x, i) => {
      const id = `en.letter_sounds.${pad(i + 1, 3)}`;
      return { id, target: x.letter, options: lsOpts(id, x.letter), say: said('en', snd(x.letter)), say_kind: 'sound', src: `extra:reading.en.letter_sounds.items[${i}]` };
    }),
    practice: ls.practice.filter((p) => p.role !== 'example').map((p, i) => {
      const id = `en.letter_sounds.p${i + 1}`;
      return { id, role: p.role, target: p.item, options: listOptions(id, p.item, [...grid, p.item], 5, { key: EN_SOUND_KEY }), say: said('en', snd(p.item)), say_kind: 'sound',
        feedback: feedbackOf('en.letter_sounds', L, 'en', snd(p.item)), src: `extra:reading.en.letter_sounds.practice[${ls.practice.indexOf(p)}]` };
    }),
    timed_s: ls.timed_s, stop: chanceStop({ type: 'first_row', n: ls.stop.n }, 'letter_sounds'), options_n: 5, distractor_rule: 'same_list_one_sound',
    scriptLines: 'en.letter_sounds', demo: fill(L.example, snd(ls.practice.find((p) => p.role === 'example').item)),
    demoChain: chainOf(CHAINS['en.letter_sounds'].example, 'en', snd(ls.practice.find((p) => p.role === 'example').item)), extraBase: 'extra:reading.en.letter_sounds',
    record: { grid, per_row: ls.per_row, direction: 'ltr', time_limit_s: ls.timed_s, stop: { type: 'first_row', n: ls.stop.n } },
    adaptation: 'Tangerine SA hear-then-tap (sec_letter_sounds_01); TK2009 letter grid (p.28: the same page as letter names)',
    deviation: `recognition, not production: Jugnu says the sound and the child taps the letter; Jugnu's isolated sounds are synthetic until a human recording replaces them; ${CHANCE_NOTE}` }));

  // Initial sound: Jugnu says the word twice; the child taps the letter of its first sound (1 of 4, from the list's
  // own first letters, never a same-sound letter).
  const initial = (lang) => {
    const t = r[lang].initial_sound;
    const task = `${lang}.initial_sound`;
    const Ln = LINES[task];
    const letterOf = (w) => (lang === 'en' ? w.word[0] : w.letter);
    const soundSay = (l) => (lang === 'en' ? snd(l) : l);
    const pool = t.items.map(letterOf);
    const key = lang === 'en' ? EN_SOUND_KEY : UR_SOUND_KEY;
    const twice = (w) => said(lang, lang === 'en' ? `${w}. ${w}.` : `${w}۔ ${w}۔`);
    const prac = lang === 'en' ? t.practice.map((p) => ({ ...p, role: 'practice' })) : t.practice.filter((p) => p.role !== 'example');
    const ex = lang === 'en' ? t.example : t.practice.find((p) => p.role === 'example');
    return readingTask({ task, lang, kind: 'choice', subtask: t.subtask, title: { en: 'First sounds', ur: 'پہلی آواز' },
      items: t.items.map((w, i) => {
        const id = `${task}.${pad(i + 1, 2)}`;
        return { id, target: letterOf(w), options: listOptions(id, letterOf(w), pool, 4, { key }), say: twice(w.word), word: w.word, src: `extra:reading.${lang}.initial_sound.items[${i}]` };
      }),
      practice: prac.map((p, i) => {
        const id = `${task}.p${i + 1}`;
        const l = letterOf(p);
        return { id, role: 'practice', target: l, options: listOptions(id, l, [...pool, l], 4, { key }), say: twice(p.word), word: p.word,
          feedback: feedbackOf(task, Ln, lang, p.word, soundSay(l)),
          src: `extra:reading.${lang}.initial_sound.practice[${t.practice.indexOf(p)}]` };
      }),
      timed_s: null, stop: { type: 'first_row', n: t.stop.n }, options_n: 4, distractor_rule: 'first_letters_of_the_list_one_sound',
      scriptLines: task, demo: fill2(Ln.example, ex.word, soundSay(letterOf(ex))), demoChain: chainOf(CHAINS[task].example, lang, ex.word, soundSay(letterOf(ex))),
      extraBase: `extra:reading.${lang}.initial_sound`,
      adaptation: lang === 'en' ? 'TK2009 p.34 initial sound; Tangerine SA hear-then-tap' : 'SELECT 2024 p.100 initial sound; Tangerine SA hear-then-tap',
      deviation: 'the child taps the letter of the first sound instead of saying the sound (a letter tile, so letter knowledge is part of the answer)' });
  };
  out.push(initial('ur'), initial('en'));

  // English phoneme segmentation (TK2009): Jugnu says the word twice, the child says its sounds; each answer is recorded
  // and scored later (no phone scoring, so the toolkit's first-5 stop is applied by the scorer).
  const seg = r.en.segmentation;
  const phon = (ps) => ps.map((x) => { const k = x.replace(/\//g, ''); return k.length === 1 ? snd(k) : k; }).join(', ');
  const segLines = LINES['en.segmentation'];
  out.push({
    task: 'en.segmentation', lang: 'en', kind: 'questions', legacy_block: null, family: 'egra', subtask: seg.subtask,
    title: { en: 'Sounds in a word', ur: 'لفظ کی آوازیں' }, modes: ['record'], tap: null,
    record: { questions: seg.items.map((w, i) => ({ id: `en.segmentation.${pad(i + 1, 2)}`, prompt: said('en', `What are the sounds in "${w.word}"? "${w.word}".`),
      word: w.word, accept: [w.phonemes.join(' ')], phonemes: w.phonemes, src: `extra:reading.en.segmentation.items[${i}]` })),
    answer_window_s: 10, replay_max: 1, stop_later: { type: 'first_n_zero', n: seg.stop.n } },
    practice: [], practice_note: 'TK2009 practice words fan and miss are modelled by Jugnu before the task (a spoken answer cannot be checked on the phone)',
    script: { ...scriptOf('en.segmentation', 'tap', fill2(segLines.example, seg.example.word, phon(seg.example.phonemes)),
      chainOf(CHAINS['en.segmentation'].example, 'en', seg.example.word, phon(seg.example.phonemes))),
    practice_models: seg.practice.map((p) => spoken(fill2(segLines.example, p.word, phon(p.phonemes)))),
    practice_models_chain: seg.practice.map((p) => chainOf(CHAINS['en.segmentation'].example, 'en', p.word, phon(p.phonemes))) },
    source: { items: 'extra:reading.en.segmentation', script: segLines.intro_tap.from, sa_adaptation: 'each spoken answer recorded and scored later (CONTRACT §5 per-item audio)' },
    deviation: 'the answer is recorded and scored later instead of marked by an assessor; the first-5 stop is applied when scored',
  });

  // The official second passages and listening stories (TK2009; SELECT 2024). They run on the game's islands in place
  // of the coach's Set A passage and story, so the coach measure is not practised at home.
  const en2 = r.en.story2;
  const enWords = en2.lines.map(toks);
  const enLines = [];
  enWords.reduce((at, ws, i) => { enLines.push({ n: i + 1, from: at, to: at + ws.length - 1 }); return at + ws.length; }, 0);
  const ur2 = r.ur.story2;
  const urSegs = ur2.segments.map((x) => toks(x.seg));
  const urLines = [];
  urSegs.reduce((at, ws, i) => { urLines.push({ n: i + 1, from: at, to: at + ws.length - 1 }); return at + ws.length; }, 0);
  const segOfMarker = (m) => ur2.segments.findIndex((x) => x.cum_marker >= m) + 1;
  const story2 = (lang, spec, lines, words, questions) => storyTasks({ lang, task: `${lang}.story2`, legacy: `${lang}.story`, base: `extra:reading.${lang}.story2`,
    adaptation: 'as the Set A story: the child reads aloud for 60 s, then taps the last word read; questions only up to the line reached',
    spec: { title: { en: 'Story reading 2', ur: 'کہانی پڑھنا ۲' }, timed_s: 60, direction: lang === 'ur' ? 'rtl' : 'ltr', stop: { type: 'first_line' },
      practice_note: 'EGRA oral reading has no practice item', source: { items: `extra:reading.${lang}.story2` },
      items: words, story: { text: lang === 'en' ? en2.lines.join('\n') : ur2.text, lines }, questions } });
  out.push(...story2('en', en2, enLines, enWords.flat(), en2.questions.map((q, i) => ({ id: `en.story2.q${i + 1}`, prompt: q.q, accept: q.accept, needs_line: q.needs_line,
    rubric: q.any_reasonable ? 'any reasonable answer is accepted (TK2009)' : null, accept_rule: q.accept_rule }))));
  out.push(...story2('ur', ur2, urLines, urSegs.flat(), ur2.questions.map((q, i) => ({ id: `ur.story2.q${i + 1}`, prompt: q.q, accept: q.accept, needs_line: segOfMarker(q.after_marker) }))));
  for (const lang of ['en', 'ur']) {
    const l = r[lang].listening2;
    out.push(listeningTask({ lang, task: `${lang}.listening2`, legacy: `${lang}.listening`, base: `extra:reading.${lang}.listening2`,
      adaptation: `Jugnu reads the story once (${lang === 'en' ? 'TK2009' : 'SELECT 2024'}: one reading); each answer recorded`,
      spec: { title: { en: 'Listening 2', ur: 'سن کر سمجھنا ۲' }, story: { text: l.story }, read_times: l.read_times, practice_note: 'EGRA listening comprehension has no practice item',
        source: { items: `extra:reading.${lang}.listening2` }, questions: l.questions.map((q, i) => ({ id: `${lang}.listening2.q${i + 1}`, prompt: q.q, accept: q.accept })) } }));
  }
  for (const t of out) if (/(story2|listening2)/.test(t.task)) t.parallel_of = t.task.replace('2', '');

  // English dictation (TK2009 sentence) as Tangerine SA's typed spelling: Jugnu says the word, the sentence, the word;
  // the child types it on an a-z strip. The TK2009 rubric stays with the task for the whole-sentence score.
  const dic = r.en.dictation;
  const dw = dic.sentence.replace(/[.]$/, '').split(/\s+/);
  out.push({
    task: 'en.spelling', lang: 'en', kind: 'keyboard', legacy_block: null, family: 'egra', subtask: 'spelling',
    title: { en: 'Spelling', ur: 'ہجے' }, modes: ['tap'],
    tap: { options_n: null, distractor_rule: null, input: 'keyboard', time_limit_s: null, ...UNTIMED_TAP, stop: null,
      items: dw.map((w, i) => ({ id: `en.spelling.${pad(i + 1, 2)}`, target: w.toLowerCase(), say: said('en', `${w}. ${dic.sentence} ${w}.`), src: 'extra:reading.en.dictation.sentence' })) },
    record: null, practice: [], practice_note: 'TK2009 dictation has no practice item',
    rubric: { sentence: dic.sentence, grouping: dic.grouping, rows: dic.rubric, src: dic.rubric_src },
    scoring: 'per word: letters in the right place, max = letters + 2 (Tangerine SA spelling, Kenya rule); the TK2009 dictation rubric scores the same answers as a sentence',
    script: scriptOf('en.dictation', 'tap'),
    source: { items: 'extra:reading.en.dictation', script: LINES['en.dictation'].intro_tap.from, sa_adaptation: 'Tangerine SA typed spelling (word, sentence, word; letter-level partial credit scored later); TK2009 sentence and rubric' },
    deviation: 'typed word by word instead of the whole sentence handwritten',
  });

  // Urdu vocabulary (SELECT 2024 action pictures): Jugnu says what is happening, the child taps 1 of 4 pictures.
  const voc = r.ur.vocabulary;
  const vk = (x) => `ur.vocabulary.${x.image.replace(/^ur\.vocabulary\.|\.webp$/g, '')}`;
  const images = Object.fromEntries([...voc.practice, ...voc.items].map((x) => [vk(x), `sa/img/vocab/${x.image}`]));
  const itemKeys = voc.items.map(vk);
  const VL = LINES['ur.vocabulary'];
  const vex = voc.practice.find((p) => p.role === 'example');
  out.push({
    task: 'ur.vocabulary', lang: 'ur', kind: 'choice', legacy_block: null, family: 'egra', subtask: voc.subtask,
    title: { en: 'Pictures', ur: 'تصویریں' }, modes: ['tap'],
    tap: { options_n: 4, distractor_rule: 'same_set_of_pictures', input: 'options', time_limit_s: null, ...UNTIMED_TAP, stop: { type: 'first_row', n: voc.stop.n },
      option_images: images,
      items: voc.items.map((x, i) => {
        const id = `ur.vocabulary.${pad(i + 1, 2)}`;
        return { id, target: vk(x), options: listOptions(id, vk(x), itemKeys, 4), say: said('ur', x.say), accept_spoken: x.accept, src: `extra:reading.ur.vocabulary.items[${i}]` };
      }) },
    record: null,
    practice: voc.practice.filter((p) => p.role !== 'example').map((p) => {
      const id = `${vk(p)}.p`;
      return { id, role: 'practice', target: vk(p), options: listOptions(id, vk(p), [...voc.practice.map(vk), ...itemKeys], 4), say: said('ur', p.say),
        feedback: feedbackOf('ur.vocabulary', VL, 'ur', p.say), src: `extra:reading.ur.vocabulary.practice[${voc.practice.indexOf(p)}]` };
    }),
    script: { ...scriptOf('ur.vocabulary', 'tap', fill(VL.example, vex.say), chainOf(CHAINS['ur.vocabulary'].example, 'ur', vex.say)), demo_image: images[vk(vex)] },
    source: { items: 'extra:reading.ur.vocabulary', script: VL.intro_tap.from, sa_adaptation: 'Tangerine SA hear-then-tap; the SELECT picture cards (p.113) as tiles' },
    deviation: 'receptive (hear, tap the picture) instead of expressive (say what is happening)',
  });
  return out;
}

// Orientation to print (RULING #2: before the story at coach G3 and game G1-G3): the official prompts asked on the
// passage this form shows next (Set A on the coach, the second passage in the game); the child taps a word or an arrow.
const ARROWS = ['→', '←', '↓', '↑'];
function printOrientation(lang, story, extra) {
  const r = extra.reading[lang].print_orientation;
  const p = story.record.passage;
  const w = p.words.map((x) => x.target);
  const L1 = p.lines[0];
  const L2 = p.lines[1];
  const sentence1 = p.text.split(/[۔.!?]/)[0].split(/\s+/).filter(Boolean).length;
  const pos = { start: 0, line_end: L1.to, next_line: L2.from, sentence_end: Math.min(sentence1, w.length) - 1, story_end: w.length - 1 };
  const words = [...new Set(Object.values(pos).map((i) => w[i]))];
  const wordItem = (id, at, say, src) => ({ id, target: w[at], target_index: at, options: listOptions(id, w[at], words, Math.min(4, words.length)), say: said(lang, say), src });
  const arrowItem = (id, say, src) => ({ id, target: lang === 'ur' ? '←' : '→', options: ARROWS, say: said(lang, say), src });
  const base = `extra:reading.${lang}.print_orientation.prompts`;
  let items;
  if (lang === 'en') {
    const q = r.prompts;
    items = [
      wordItem('en.print_orientation.1', pos.start, `${q[0]} ${q[1].replace('Show me with your finger.', 'Tap that word.')}`, `${base}[1]`),
      arrowItem('en.print_orientation.2', 'Now tap the arrow that shows which way you would read next.', `${base}[2]`),
      wordItem('en.print_orientation.3', pos.next_line, `${q[3]} Tap that word.`, `${base}[3]`),
    ];
  } else {
    const tapUr = (t) => t.replace('میں نہیں چاہتا/ چاہتی کہ ابھی آپ یہ پیراگراف پڑھیں۔', 'ابھی یہ پیراگراف نہ پڑھیں۔')
      .replace(/اس صفحے پر انگلی رکھ کر بتائیے/, 'اس صفحے پر دبا کر بتائیں').replace(/اپنی انگلی کی مدد سے بتائیے/, 'دبا کر بتائیں')
      .replace(/آپ اپنی انگلی کے اشارے سے مجھے بتائیے|اپنی انگلی کے اشارے سے مجھے بتائیے/, 'دبا کر بتائیں').replace('اب آپ مجھے بتائیے', 'اب تیر دبا کر بتائیں');
    // Prompts 1-3 are reworded for a tap and for a child addressed without گے forms (a native speaker's review);
    // 4-5 keep the PRP-KP wording with the tap substitution.
    const q = r.prompts.map((x) => tapUr(x.q).replace('کونسا', 'کون سا'));
    q[0] = 'ابھی یہ کہانی نہ پڑھیں۔ آپ کس لفظ سے پڑھنا شروع کریں؟ وہ لفظ دبائیں۔';
    q[1] = 'اب وہ تیر دبائیں جو بتائے کہ کس طرف پڑھنا ہے۔';
    q[2] = 'پہلی سطر ختم ہو جائے تو پھر کہاں سے پڑھنا ہے؟ وہ لفظ دبائیں۔';
    items = [
      wordItem('ur.print_orientation.1', pos.start, q[0], `${base}[0]`),
      arrowItem('ur.print_orientation.2', q[1], `${base}[1]`),
      wordItem('ur.print_orientation.3', pos.next_line, q[2], `${base}[2]`),
      wordItem('ur.print_orientation.4', pos.sentence_end, q[3], `${base}[3]`),
      wordItem('ur.print_orientation.5', pos.story_end, q[4], `${base}[4]`),
    ];
  }
  const { words: _w, ...shown } = p;
  return {
    task: `${lang}.print_orientation`, lang, kind: 'choice', legacy_block: null, family: 'egra', subtask: r.subtask,
    title: { en: 'How we read', ur: 'ہم کیسے پڑھتے ہیں' }, modes: ['tap'],
    tap: { options_n: 4, distractor_rule: 'words_of_the_passage | arrows', input: 'options', time_limit_s: null, ...UNTIMED_TAP, stop: null,
      passage: { ...shown, words: p.words.map((x) => ({ id: x.id, target: x.target, line: x.line })) }, items },
    record: null, practice: [], practice_note: 'orientation to print has no practice item',
    script: scriptOf(`${lang}.print_orientation`, 'tap'),
    source: { items: `extra:reading.${lang}.print_orientation`, script: LINES[`${lang}.print_orientation`].intro_tap.from,
      sa_adaptation: `the official prompts asked on the passage that follows (${story.task}); the expected word comes from that passage` },
    deviation: 'the child taps the word or arrow instead of pointing; prompts address the passage this form shows',
  };
}

// Where a task sits in its section's run order (EGRA toolkit order within each language; the 18 v3 tasks keep v3's).
const RUN_ORDER = [
  'ur.listening', 'ur.listening2', 'ur.vocabulary', 'ur.initial_sound', 'ur.letters', 'ur.nonwords', 'ur.words', 'ur.print_orientation',
  'ur.story', 'ur.story_comp', 'ur.story2', 'ur.story2_comp',
  'en.listening', 'en.listening2', 'en.initial_sound', 'en.segmentation', 'en.letters', 'en.letter_sounds', 'en.nonwords', 'en.words',
  'en.print_orientation', 'en.story', 'en.story_comp', 'en.story2', 'en.story2_comp', 'en.spelling',
];
const runRank = (id) => {
  const i = RUN_ORDER.indexOf(id);
  const sec = ['ur', 'en', 'ma'].indexOf(id.split('.')[0]);
  return [sec, i < 0 ? 999 : i];
};

// ---------------------------------------------------------------------------------------------- A02 passage rotation
/**
 * RULING #39 (A02, switch sa_passage_rotation): on the coach forms the passage, its questions and the listening story
 * rotate per child over the fielded, sourced texts. variants[0] is the form's own (RWP May 2026, Set A); then SELECT
 * 2024 and PRP-KP 2020 for Urdu, the EGRA Toolkit 2009 sample for English (fielded: false, the sourcing gap named in
 * PASSAGE_SOURCES). Each variant is a whole task of the same shape; the page picks one index per child for all three.
 * PRP-KP's story is out of the oral-reading rotation: its report prints the passage as an unpunctuated word grid, so
 * its punctuation would be ours (W3, operator items 4/6: official punctuation only); its listening story stays.
 */
function passageVariants(core18, extra) {
  const r = extra && extra.reading;
  if (!r) return {};
  const ex = readingExtras(extra);
  const own = (id) => core18.find((t) => t.task === id);
  const of = (id) => ex.find((t) => t.task === id);
  const lineSpans = (lines) => {
    const out = [];
    lines.reduce((at, ws, i) => { out.push({ n: i + 1, from: at, to: at + ws.length - 1 }); return at + ws.length; }, 0);
    return out;
  };
  const p3 = r.ur.story3;
  const p3w = p3 ? p3.lines.map(toks) : [];
  const prp = p3 ? storyTasks({ lang: 'ur', task: 'ur.story3', legacy: 'ur.story', base: 'extra:reading.ur.story3',
    adaptation: 'as the Set A story: read aloud for 60 s, then the last word read is tapped; questions only up to the line reached',
    spec: { title: own('ur.story').title, timed_s: 60, direction: 'rtl', stop: { type: 'first_line' }, practice_note: 'EGRA oral reading has no practice item',
      source: { items: 'extra:reading.ur.story3' }, items: p3w.flat(), story: { text: (p3.lines_shown || p3.lines).join('\n'), lines: lineSpans(p3w) },
      questions: p3.questions.map((q, i) => ({ id: `ur.story3.q${i + 1}`, prompt: q.q, accept: q.accept, needs_line: q.needs_line })) } }) : [];
  const l3 = r.ur.listening3;
  const prpL = l3 ? listeningTask({ lang: 'ur', task: 'ur.listening3', legacy: 'ur.listening', base: 'extra:reading.ur.listening3',
    adaptation: 'Jugnu reads the story once (PRP-KP: one reading); each answer recorded',
    spec: { title: own('ur.listening').title, story: { text: l3.story }, read_times: l3.read_times, practice_note: 'EGRA listening comprehension has no practice item',
      source: { items: 'extra:reading.ur.listening3' }, questions: l3.questions.map((q, i) => ({ id: `ur.listening3.q${i + 1}`, prompt: q.q, accept: q.accept })) } }) : null;
  const V = (id, src, fielded, task) => (task ? { id, src, fielded, task } : null);
  const RWP = 'rwp2026:May 2026 instrument (Set A)';
  const SEL = 'select2024:Sindh SELECT EGRA Urdu';
  const PRP = 'prpkp2020:EGRA Urdu Form 1';
  const TK = 'egra_tk2009:sample assessment design';
  const list = (...xs) => xs.filter(Boolean);
  return {
    'ur.story': list(V('rwp2026', RWP, true, own('ur.story')), V('select2024', SEL, true, of('ur.story2')), !p3.editorial_punct && V('prpkp2020', PRP, true, prp[0])),
    'ur.story_comp': list(V('rwp2026', RWP, true, own('ur.story_comp')), V('select2024', SEL, true, of('ur.story2_comp')), !p3.editorial_punct && V('prpkp2020', PRP, true, prp[1])),
    'ur.listening': list(V('rwp2026', RWP, true, own('ur.listening')), V('select2024', SEL, true, of('ur.listening2')), V('prpkp2020', PRP, true, prpL)),
    'en.story': list(V('rwp2026', RWP, true, own('en.story')), V('tk2009', TK, false, of('en.story2'))),
    'en.story_comp': list(V('rwp2026', RWP, true, own('en.story_comp')), V('tk2009', TK, false, of('en.story2_comp'))),
    'en.listening': list(V('rwp2026', RWP, true, own('en.listening')), V('tk2009', TK, false, of('en.listening2'))),
  };
}

// ---------------------------------------------------------------------------------------------- A11 reuse, A14 RDF
/**
 * A11: a maths task with no unused fielded item practises on another task's official practice item of the same format
 * (extra maths.practice.reuse, "<from>" or {from, pick, after, src, say_en/ur}: one item of it, after the task's own practice, said in the task's frame): practice is unscored everywhere. A tap task
 * gets the item's options by the same rule; a keypad task gets none.
 */
function reusePractice(list, extra) {
  const reuse = (extra && extra.maths && extra.maths.practice && extra.maths.practice.reuse) || {};
  for (const [to, rule] of Object.entries(reuse)) {
    const from = typeof rule === 'string' ? rule : rule.from;
    const t = list.find((x) => x.task === to);
    const s = list.find((x) => x.task === from);
    if (!t || !s || !s.practice.length) continue;
    const picked = typeof rule === 'object' && rule.pick != null ? [s.practice[rule.pick]] : s.practice;
    const before = rule.after && t.practice_v2 ? t.practice_v2 : [];
    t.practice_v2 = [...before, ...picked.map((p, j) => {
      const i = before.length + j;
      const id = `${to}.p${i + 1}`;
      const q = { ...p, id, src: `${rule.src ? `${rule.src} = ` : ''}${p.src} (reused from ${from})`, ...(rule.say_en ? { say: sayBoth(rule.say_en, rule.say_ur) } : {}),
        ...(typeof rule === 'object' ? { practice: true } : {}) };
      if (t.tap.input === 'options' && Array.isArray(p.shown)) {
        q.shown = p.shown;
        q.options = stepOptions(id, p.target, seqStep(p.shown));
      } else if (t.tap.input === 'keypad') delete q.options;
      return q;
    })];
  }
}

// RULING #42 (A14): the RDF short form, exactly the tester's list. Checks = the battery's own audio check and mic
// pre-flight; letter sounds and familiar words are read aloud on the official grids (60 s, recorded, scored per
// minute later as EGRA does; panel C1); word problems run their first 3 items; the Set A story questions drop lit4
// (panel C2: lit1-3 + both inference items), the reach rule on top. rdf_items: a number caps the items, {drop}
// names the items left out.
const RDF = ['ur.letter_sounds_rec', 'ur.words_rec', 'ur.story', 'ur.story_comp', 'en.letter_sounds_rec', 'en.words_rec', 'en.story', 'en.story_comp',
  'ma.number_id', 'ma.missing', 'ma.add1', 'ma.sub1', 'ma.word_problems'];
const RDF_ITEMS = { 'ma.word_problems': 3, 'ur.story_comp': { drop: ['ur.story.q4'] }, 'en.story_comp': { drop: ['en.story.q4'] } };
const RDF_NAME = { en: 'RDF', ur: 'آر ڈی ایف' };

/** An official grid the child reads aloud, recorded and scored later (RDF): 60 s, EGRA's own administration. */
function recordGrid({ task, lang, subtask, title, scriptKey, grid, per_row, direction, base, stop, adaptation, deviation }) {
  return {
    task, lang, kind: 'grid', legacy_block: null, family: 'egra', subtask, title, modes: ['record'], tap: null,
    record: { grid, per_row, direction, time_limit_s: 60, stop },
    practice: [], practice_note: 'a spoken answer cannot be checked on the phone; the oral practice screen (RULING #13) comes before the first spoken answer',
    script: scriptOf(scriptKey, 'record'),
    source: { items: base, script: LINES[scriptKey].intro_record.from, sa_adaptation: adaptation }, deviation,
  };
}

function rdfTasks(v3, extra) {
  const rd = v3.sets[SET].reading;
  const ul = rd.ur.letters;
  const ls = extra.reading.en.letter_sounds;
  const sounds = { en: 'Letter sounds', ur: 'حروف کی آوازیں' };
  const read = 'EGRA as administered: read aloud for 60 s, recorded and scored later';
  const words = (lang) => recordGrid({ task: `${lang}.words_rec`, lang, subtask: 'familiar_word_reading', title: rd[lang].words.title, scriptKey: 'words',
    grid: rd[lang].words.items, per_row: rd[lang].words.per_row, direction: rd[lang].words.direction || (lang === 'ur' ? 'rtl' : 'ltr'),
    base: `v3:sets.${SET}.reading.${lang}.words`, stop: stopOf(rd[lang].words.stop), adaptation: `${read} (per minute, comparable to EGRA)`,
    deviation: 'none (EGRA read-aloud); the first-row stop is applied when scored' });
  return [
    recordGrid({ task: 'ur.letter_sounds_rec', lang: 'ur', subtask: 'letter_sound_identification', title: { en: 'Urdu letter sounds', ur: 'اردو حروف کی آوازیں' },
      scriptKey: 'ur.letter_sounds_rec', grid: ul.items, per_row: ul.per_row, direction: ul.direction, base: `v3:sets.${SET}.reading.ur.letters`, stop: stopOf(ul.stop),
      adaptation: read, deviation: 'the official Urdu letter-name grid read as sounds (no Urdu letter-sound grid is printed in a source we hold); the first-row stop is applied when scored' }),
    words('ur'),
    recordGrid({ task: 'en.letter_sounds_rec', lang: 'en', subtask: 'letter_sound_identification', title: sounds, scriptKey: 'en.letter_sounds_rec',
      grid: ls.items.map((x) => x.letter), per_row: ls.per_row, direction: 'ltr', base: 'extra:reading.en.letter_sounds', stop: { type: 'first_row', n: ls.stop.n },
      adaptation: read, deviation: 'the first-row stop is applied when scored' }),
    words('en'),
  ];
}

// ---------------------------------------------------------------------------------------------- forms
function formTasks({ maths }, v3, extra) {
  const set = v3.sets[SET];
  const ur = extra && extra.reading && extra.reading.ur;
  const prp = (k) => (ur && ur[k] ? ur[k].map((p, i) => ({ item: p.item, role: /^example/.test(p.role) ? 'example' : 'practice', src: `extra:reading.ur.${k}[${i}]` })) : null);
  const extraPractice = { 'ur.letters': prp('letters_practice'), 'ur.words': prp('words_practice') };
  const tasks = [];
  for (const tid of TASKS_V3) {
    const [fam, kind] = tid.split('.');
    if (fam === 'ma') {
      const borrowed = extra && extra.maths && extra.maths.practice ? extra.maths.practice.items[`ma.${kind}`] : null;
      const t = mathsTask({ kind, spec: set.maths[maths][kind], grade: maths, borrowed });
      if (['add2', 'sub2'].includes(kind) && set.maths[maths].skip_level2_if_level1_zero) t.depends_on = { task: `ma.${kind.slice(0, 3)}1`, skip_if_zero: true };
      tasks.push(t);
      continue;
    }
    const spec = set.reading[fam][kind];
    if (kind === 'listening') tasks.push(listeningTask({ lang: fam, spec }));
    else if (kind === 'story') tasks.push(...storyTasks({ lang: fam, spec }));
    else tasks.push(gridTask({ lang: fam, kind, spec, extraPractice: extraPractice[tid] }));
  }
  return tasks;
}

/**
 * RULING #31a addendum: where a line has its chain (`<k>_chain`), the other-language page says the chain, so the whole
 * line keeps only the task's own language: no clip says an item of the other language inside a sentence.
 */
function dropCrossWholeLines(task) {
  if (!task.lang) return;
  const other = task.lang === 'en' ? 'ur' : 'en';
  const strip = (l) => {
    if (!l || typeof l !== 'object' || !(other in l)) return;
    delete l[other];
    if (l.audio) delete l.audio[other];
  };
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    for (const k of Object.keys(o)) {
      if (o[`${k}_chain`]) (Array.isArray(o[k]) ? o[k] : [o[k]]).forEach(strip);
      walk(o[k]);
    }
  };
  walk(task);
}

function buildSaBank({ v3, extra, w3, reviewed = loadReviewed() }) {
  const forms = {};
  const tasks = {};
  for (const f of FORMS) {
    const core18 = formTasks(f, v3, extra);
    // The second passages and stories (parallel_of) are the game's; the coach keeps Set A only.
    const extras = extra ? [...readingExtras(extra), ...extraTasks(f, extra)].filter((t) => f.surface === 'game' || !t.parallel_of) : [];
    // Orientation to print at Grades 1-3 (RULING #2), on the passage this form shows.
    if (extra && f.grades.some((g) => g <= 3)) {
      for (const lang of ['ur', 'en']) {
        const story = extras.find((t) => t.task === `${lang}.story2`) || core18.find((t) => t.task === `${lang}.story`);
        extras.push(printOrientation(lang, story, extra));
      }
    }
    // Each extra sits in its language's section (stable: the core order and the maths extras' order are kept).
    const list = [...core18, ...extras].map((t, i) => ({ t, i })).sort((a, b) => {
      const [sa, ra] = runRank(a.t.task);
      const [sb, rb] = runRank(b.t.task);
      return sa - sb || (ra !== 999 && rb !== 999 ? ra - rb : a.i - b.i);
    }).map(({ t }) => t);
    reusePractice(list, extra);
    list.forEach(dropCrossWholeLines);
    const order = list.map((t) => t.task);
    const extraIds = list.filter((t) => extras.includes(t)).map((t) => t.task);
    const rdfOnly = f.surface === 'coach' && extra ? rdfTasks(v3, extra) : [];
    if (f.surface === 'coach') {
      const pv = passageVariants(core18, extra);
      for (const t of list) {
        const vs = pv[t.task];
        // A copy of each variant's task, so the task that is variant 0 does not hold itself.
        if (vs && vs.length > 1) t.variants = vs.map((v) => ({ id: v.id, src: v.src, fielded: v.fielded, task: { ...v.task, variants: undefined } }));
      }
      for (const lang of ['ur', 'en']) W3.relineStory(list, lang);
    }
    // W3 (switch sa_rdf_w3_forms): the RDF auto / RDF manual forms' own tasks, after the rotation's variants exist.
    const w3Only = W3.w3Tasks(f, { v3, extra, w3 }, list, W3_HELPERS);
    const form = { surface: f.surface, grades: f.grades, set: f.surface === 'coach' ? SET : null, maths_form: `G${f.maths}`, order, extra: extraIds };
    if (f.surface === 'coach') {
      // DESIGN §2b: initial sound joins B3 (oral), patterns joins B4; every other extra is in the full form only.
      // RULING #16: Design A's blocks hold the 18 v3 tasks only; every extra is in the full form (the coach's toggle).
      const blocks = BLOCKS;
      Object.assign(form, { full: order, blocks, block_names: BLOCK_NAMES, ...(rdfOnly.length ? { rdf: RDF, rdf_items: RDF_ITEMS, rdf_name: RDF_NAME } : {}) });
      if (w3Only.length) {
        const ids = w3Only.map((t) => t.task);
        Object.assign(form, { rdf_auto: ids, rdf_manual: ids, rdf_variants: W3.VARIANTS, rdf_w3_absent: w3.absent });
      }
    } else {
      // Each island: that subject's tasks in run order, extras included; the tower stays the 18 (RULING #5).
      const swapped = new Set(list.filter((t) => t.parallel_of).map((t) => t.parallel_of).flatMap((id) => [id, `${id}_comp`]));
      const of = (p) => order.filter((id) => id.startsWith(p) && !swapped.has(id));
      Object.assign(form, { islands: { maths: of('ma.'), english: of('en.'), urdu: of('ur.') }, tower: core18.map((t) => t.task) });
    }
    if (f.surface === 'game') {
      // DESIGN §5: no test words on a game screen, and at home there is no teacher to hand the phone back to.
      form.lines = { welcome: 'welcome_game', end: 'end_game' };
      for (const t of list) t.script.hand_back = spoken(GAME_LINES.hand_back);
    }
    forms[f.form] = form;
    for (const t of [...list, ...rdfOnly, ...w3Only]) tasks[`${f.form}/${t.task}`] = t;
  }
  // The content reviewers' wording (sa-lines-reviewed.v1.json), over every form's copy of each line.
  return applyReviewed({
    version: VERSION,
    built_from: { v3: v3.version, set: SET, ...(extra ? { extra: extra.version } : {}), ...(w3 ? { w3: w3.version } : {}) },
    rule: 'Generated by shared/services/child-test/sa/build.js; never edit by hand. Every item and option comes from item-bank.v3.json (src); Jugnu\'s lines adapt the official EGRA/EGMA wording for self-administration (sa/scripts.js, from).',
    // v3's sources, less any url that is not public (a local transcription is cited by its title alone).
    sources: { ...Object.fromEntries(Object.entries(v3.sources).map(([k, v]) => [k, /^https?:/.test(v.url || '') ? v : { title: v.title, pages: v.pages }])), ...(extra ? extra.sources : {}),
      ...(w3 ? Object.fromEntries(Object.entries(w3.sources).filter(([k]) => !v3.sources[k] && !(extra && extra.sources[k]))) : {}) },
    conventions: {
      tasks: 'keyed "<form>/<task>"; task = the v3 block id (legacy_block), plus <lang>.story_comp for the story questions',
      modes: 'tap: Jugnu says the target, the child taps it (options) or types it (keypad), scored on the phone; record: audio kept, scored later by the child-test scorer',
      stop: 'first_row n: no correct item in the first n → stop (EGRA); first_line n: no correct word in the first line (n words); consecutive_errors n (Core EGMA); time_limit_s: the clock',
      feedback: 'correct/wrong feedback on practice items only; scored items get none (EGRA)',
      audio: 'keys sa/v1/<lang>/<sha1(lang|text)[0,12]>.mp3 under SA_AUDIO_BASE; a missing clip falls back to the browser\'s speech of the same text',
      digits: 'maths shows Western digits; Urdu speech uses Urdu digits (v3 convention)',
      translation: 'Urdu renderings of English scripts are pending native review (v3 convention)',
    },
    // The audio check's words, each with its clip in both languages (the engine's own pool has none).
    check_words: CHECK_WORDS.map(({ pic, en, ur }) => ({ pic, ...sayBoth(en, ur) })),
    lines: Object.fromEntries(Object.entries({ ...BATTERY, ...(w3 ? W3.LINES_W3 : {}) }).map(([k, l]) => [k, spoken(l)])),
    forms,
    tasks,
  }, reviewed);
}

/** The bank as files: the whole bank, and one file per form (the same shape, that form's tasks only). */
function splitSaBank(bank) {
  const files = { 'item-bank.sa.v1.json': bank };
  for (const id of Object.keys(bank.forms)) {
    const tasks = Object.fromEntries(Object.entries(bank.tasks).filter(([k]) => k.startsWith(`${id}/`)));
    files[`sa/${id}.json`] = { ...bank, forms: { [id]: bank.forms[id] }, tasks };
  }
  return files;
}

// ---------------------------------------------------------------------------------------------- runtime batteries
// What the engine runs (dashboard/sa/sa-core.js normalize/validate, served at /sa/batteries/sa.<form>.<lang>.json):
// one form in one instruction language, tasks[] in the form's order, each with one response mode.
const RESPONSE = { options: 'tap', keypad: 'keypad', keyboard: 'keyboard' };
// The mercy rule on a recorded passage: no voice for 12 s → Jugnu offers the star once; 20 s → the task ends
// early_stop_silence (the SA analogue of EGRA's line-1 stop). Data, so the engine's numbers are only a fallback.
const MERCY_AFTER_S = 12;
const SILENCE_STOP_S = 20;

function runtimeStop(s) {
  if (!s) return {};
  if (s.type === 'first_row' || s.type === 'first_line') {
    return s.max_correct != null ? { first_line_n: s.n, first_line_min_correct: s.max_correct + 1, max_correct: s.max_correct } : { first_line_n: s.n, first_line_min_correct: 1 };
  }
  if (s.type === 'consecutive_errors') return { consecutive_errors: s.n };
  return {};
}

/** A spoken thing in the battery's language: { text, audio } (sayBoth/spoken carry both languages). */
function inLang(x, lang) {
  if (!x) return null;
  if (x.text != null) return { text: x.text, audio: x.audio };
  return { text: x[lang], audio: x.audio && x.audio[lang] };
}

/** A chain in the page's language: [{ text, audio, lang }], the items keeping their own language's clip. */
function chainIn(segs, lang) {
  return segs.map((x) => (x.text != null ? { text: x.text, audio: x.audio, lang: x.lang } : { text: x[lang], audio: x.audio && x.audio[lang], lang }));
}

/** One item in the page's language; `tl` is the task's language (a practice line naming its item chains across). */
function runtimeItem(it, lang, tl) {
  const o = { ...it };
  const cross = !!tl && tl !== lang;
  if (it.labels) {
    // Options shown as words in the battery's language (the key stays the source's word in `option_keys`).
    o.option_keys = it.options;
    o.options = it.labels[lang];
    o.target = it.labels[lang][it.options.indexOf(it.target)];
    delete o.labels;
  }
  if (it.say) {
    const s = inLang(it.say, lang);
    o.say = s.text;
    o.prompt_audio = s.audio;
  }
  if (it.prompt) o.prompt = inLang(it.prompt, lang);
  if (it.feedback) {
    const f = it.feedback;
    o.feedback = { correct: cross && f.correct_chain ? chainIn(f.correct_chain, lang) : inLang(f.correct, lang),
      wrong: cross && f.wrong_chain ? chainIn(f.wrong_chain, lang) : inLang(f.wrong, lang) };
  }
  return o;
}

/** A task's lines in the page's language: a line naming an other-language item is its chain (RULING #31a). */
function runtimeScript(t, lang) {
  const sc = t.script;
  const cross = !!t.lang && t.lang !== lang;
  const out = {};
  for (const [k, l] of Object.entries(sc)) {
    if (/_chain$/.test(k)) continue;
    if (k === 'demo_item') out[k] = runtimeItem(l, lang, t.lang);
    else if (k === 'practice_models') out[k] = l.map((m, i) => (cross && sc.practice_models_chain ? chainIn(sc.practice_models_chain[i], lang) : inLang(m, lang)));
    else out[k] = cross && sc[`${k}_chain`] ? chainIn(sc[`${k}_chain`], lang) : inLang(l, lang);
  }
  return out;
}

/** A rotation variant in the page's language: what replaces the task's passage, items and stop for one child. */
function runtimeVariant(v, lang) {
  const r = runtimeTask(v.task, lang);
  return { id: v.id, src: v.src, fielded: v.fielded, ...(r.passage ? { passage: r.passage } : {}), items: r.items, ...(r.stop ? { stop: r.stop } : {}) };
}

function runtimeTask(t, lang) {
  const variants = t.variants ? { variants: t.variants.map((v) => runtimeVariant(v, lang)) } : {};
  const base = { id: t.task, legacy_block: t.legacy_block, family: t.family, subtask: t.subtask, lang: t.lang, title: t.title, kind: t.kind,
    script: runtimeScript(t, lang),
    instruction: inLang(t.script.intro, lang), source: t.source, deviation: t.deviation, ...(t.practice_note ? { practice_note: t.practice_note } : {}),
    // A11 (switch sa_practice_all_maths): the practice the engine runs when the switch is on.
    ...(t.practice_v2 ? { practice_v2: t.practice_v2.map((p) => runtimeItem(p, lang, t.lang)) } : {}), ...variants };
  const practice = (t.practice || []).map((p) => runtimeItem(p, lang, t.lang));
  if (t.tap) {
    const tap = t.tap;
    return { ...base, response: RESPONSE[tap.input], time_limit_s: tap.time_limit_s || null, ...(tap.soft_cap_s ? {} : { item_timeout_s: tap.item_timeout_s }),
      replay_at_s: tap.replay_at_s, ...(tap.next_at_s ? { next_at_s: tap.next_at_s } : {}),
      // The word-problem answer cap is its own field, never the move-on one.
      ...(tap.soft_cap_s ? { soft_cap_s: tap.soft_cap_s } : {}), stop: runtimeStop(tap.stop), ...(tap.say_on ? { say_on: tap.say_on } : {}),
      options_n: tap.options_n, distractor_rule: tap.distractor_rule, items: tap.items.map((it) => runtimeItem(it, lang)), practice,
      ...(tap.passage ? { passage: tap.passage, tap_on: 'passage' } : {}), ...(tap.option_images ? { option_images: tap.option_images } : {}),
      ...(t.rubric ? { rubric: t.rubric } : {}), ...(t.scoring ? { scoring: t.scoring } : {}),
      ...(t.record && t.record.grid ? { grid: t.record.grid, per_row: t.record.per_row, direction: t.record.direction } : {}),
      ...(t.depends_on ? { depends_on: t.depends_on } : {}) };
  }
  const r = t.record;
  if (r.grid) {
    // A letter grid read aloud (RDF letter sounds): the recording is scored later.
    return { ...base, response: 'record', time_limit_s: r.time_limit_s, stop: runtimeStop(r.stop), grid: r.grid, per_row: r.per_row, direction: r.direction,
      mercy_after_s: MERCY_AFTER_S, silence_stop_s: SILENCE_STOP_S, items: [], practice };
  }
  if (r.passage && r.passage.words) {
    const { words, ...passage } = r.passage;
    return { ...base, response: 'record', time_limit_s: r.time_limit_s, stop: runtimeStop(r.stop), last_word_tap: true, passage,
      mercy_after_s: MERCY_AFTER_S, silence_stop_s: SILENCE_STOP_S,
      items: words, practice, depends_on: { task: `${t.lang}.words`, skip_if_stop: 'early_stop_first_line' } };
  }
  const items = r.questions.map((q) => runtimeItem(q, lang, t.lang));
  return { ...base, response: 'oral', question_timeout_s: r.answer_window_s, replay_max: r.replay_max,
    ...(r.passage ? { passage: r.passage } : {}), items, practice,
    ...(t.depends_on ? { depends_on: { task: t.depends_on.task, upto_item: t.depends_on.upto_item } } : {}) };
}

/** One form in one instruction language, as the engine runs it. */
function runtimeBattery(bank, formId, lang) {
  const form = bank.forms[formId];
  const { order, ...shape } = form;
  const w3Lines = form.rdf_auto ? [] : Object.keys(W3.LINES_W3);
  const short = [...(form.rdf || []), ...(form.rdf_auto || [])];
  return {
    battery_id: `sa.${formId}.${lang}`, version: bank.version, form: formId, lang, ...shape,
    rule: bank.rule, conventions: bank.conventions,
    check_words: bank.check_words,
    lines: Object.fromEntries(Object.entries(bank.lines).filter(([k]) => !/_game$/.test(k) && !w3Lines.includes(k))
      .map(([k, l]) => [k, inLang(form.lines && form.lines[k] ? bank.lines[form.lines[k]] : l, lang)])),
    // The full order, then the tasks only a short form runs (RDF; RDF auto / manual), so the page can pick either list.
    tasks: [...new Set([...order, ...short])].map((id) => {
      const t = bank.tasks[`${formId}/${id}`];
      return t.w3 ? W3.runtimeW3Task(t, lang, W3_HELPERS) : runtimeTask(t, lang);
    }),
  };
}

// What build-w3.js borrows from this file (passed in, so neither file requires the other's internals).
const W3_HELPERS = { spoken, said, sayBoth, toUrDigits, mathsTask, inLang, chainIn, runtimeTask, runtimeScript };

/** The bank as files: the whole bank, one file per form (the same shape), and per form × language the runtime battery. */
function splitSaBankWithRuntime(bank) {
  const files = splitSaBank(bank);
  for (const id of Object.keys(bank.forms)) {
    for (const lang of ['ur', 'en']) files[`sa/sa.${id}.${lang}.json`] = runtimeBattery(bank, id, lang);
  }
  return files;
}

module.exports = { buildSaBank, splitSaBank, splitSaBankWithRuntime, runtimeBattery, listOptions, stepOptions, FORMS, BLOCKS };
