'use strict';

/**
 * Builds the self-administered (SA) battery bank (item-bank.sa.v1.json) from the official banks. Nothing here is
 * test content: every scored item, practice item and tap choice is read out of item-bank.v3.json (Set A: RWP May
 * 2026, EGRA Toolkit 2016/2009, Core EGMA, Sindh SELECT) (the v4 bank is read for its version only), and each
 * item carries the bank path it came from (`src`). This file only decides the SA shape: forms, response modes, the
 * stop rules in the engine's terms, tap choices and Jugnu's lines (sa/scripts.js).
 *
 *   node bot/scripts/child-test/build-sa-bank.js        rewrites bot/shared/data/child-test/item-bank.sa.v1.json
 *
 * Pure and deterministic: the same banks give the same bytes (choices are ordered by a hash of the item id).
 */

const crypto = require('crypto');
const { TASKS_V3 } = require('../tasks');
const { COMMON, BATTERY, TASKS: LINES, UR_LETTER_NAMES } = require('./scripts');

const VERSION = 'child-test-items-sa-v1';
const SET = 'A';
const CHOICES_N = 4;

// The forms. Coach: Grades 3 and 5, the term's set (draw/term-set.js). Game: the Challenge's grade bands
// (web-quiz-challenge-draw.js gradeBand: 2-3 → G3 form, 4-5 → G5 form) plus grade 1, which reads the same EGRA forms
// (the May RWP instrument was one form for Grades 1-5) and Core EGMA (written for Grades 1-3). The v4 grade-1 ten-frame
// block is not used: it has no official source.
const FORMS = [
  { form: 'coach.G3.A', surface: 'coach', grades: [3], maths: '3' },
  { form: 'coach.G5.A', surface: 'coach', grades: [5], maths: '5' },
  { form: 'game.G1', surface: 'game', grades: [1], maths: '3' },
  { form: 'game.G23', surface: 'game', grades: [2, 3], maths: '3' },
  { form: 'game.G45', surface: 'game', grades: [4, 5], maths: '5' },
];

// Response mode per task kind and surface. Coach keeps EGRA's one-to-one measure (the child reads aloud, the audio is
// scored later by the child-test scorer) and adds the tap side; the game is tap-scored on the phone. A lead RULING
// changes this table only.
const MODES = {
  coach: { grid: 'both', passage: 'record', choice: 'both', listen_choice: 'both' },
  game: { grid: 'tap', passage: 'both', choice: 'tap', listen_choice: 'tap' },
};

const SUBTASK = {
  listening: 'listening_comprehension', letters: 'letter_name_identification', nonwords: 'nonword_reading',
  words: 'familiar_word_reading', story: 'oral_reading_fluency', story_comp: 'reading_comprehension',
  number_id: 'number_identification', discrimination: 'quantity_discrimination',
  missing: 'missing_number', add1: 'addition_level_1', sub1: 'subtraction_level_1', add2: 'addition_level_2',
  sub2: 'subtraction_level_2', word_problems: 'word_problems',
};

const h = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const byHash = (seed) => (a, b) => (h(`${seed}|${a}`) < h(`${seed}|${b}`) ? -1 : 1);
const fill = (line, x) => ({ en: line.en.replace(/\{x\}/g, x.en ?? x), ur: line.ur.replace(/\{x\}/g, x.ur ?? x) });
const toUrDigits = (s) => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const audioKey = (lang, text) => `sa/v1/${lang}/${h(`${lang}|${text}`).slice(0, 12)}.mp3`;

/** A spoken line, with the clip key each language's text will be voiced into. */
function spoken({ en, ur, from }) {
  return { en, ur, ...(from ? { from } : {}), audio: { en: audioKey('en', en), ur: audioKey('ur', ur) } };
}

/**
 * Tap choices for one item: the answer and CHOICES_N-1 others from the same official pool (the task's own grid, as
 * Tangerine SA builds a listen-and-tap item from the subtask's item list), never the answer twice; ordered by a hash of
 * the item id so the answer's place varies but the bytes never do.
 */
function poolChoices(id, answer, pool, n = CHOICES_N) {
  const others = [...new Set(pool.map(String))].filter((x) => x !== String(answer)).sort(byHash(`${id}|pick`)).slice(0, n - 1);
  return [String(answer), ...others].sort(byHash(`${id}|order`));
}

/**
 * Numeric choices: the answer and its near neighbours, the grade-1 block's rule (v4 anchor_blocks.G1A.tiles_rule:
 * "the answer and two distractors from {k-1, k+1, k-2, k+2, …}"), widened by ±10 for two-digit work; never below 0.
 */
function numberChoices(id, answer, step = 1, n = CHOICES_N) {
  const a = Number(answer);
  const near = [a + step, a - step, a + 1, a - 1, a + 2, a - 2, a + 10, a - 10].filter((x) => x >= 0 && x !== a);
  const others = [...new Set(near)].slice(0, n - 1);
  return [a, ...others].sort(byHash(`${id}|order`));
}

function stopOf(v3stop, timed, firstLineN) {
  const stop = {};
  if (v3stop.type === 'first_row') Object.assign(stop, { first_line_n: v3stop.n, first_line_min_correct: 1 });
  if (v3stop.type === 'first_line') Object.assign(stop, { first_line_n: firstLineN, first_line_min_correct: 1 });
  if (v3stop.type === 'consecutive_errors') stop.consecutive_errors = v3stop.n;
  if (timed) stop.time_up = true;
  return stop;
}

function scriptOf(key, surfaceMode, extra = {}) {
  const t = LINES[key] || {};
  const out = {};
  for (const [k, line] of Object.entries(t)) if (['intro_record', 'intro_tap', 'example'].includes(k)) out[k] = spoken(line);
  out.practice_intro = spoken(COMMON.practice_intro);
  out.test_intro = spoken(COMMON.test_intro);
  out.begin = spoken(COMMON.begin);
  out.time_up = spoken(COMMON.time_up);
  out.early_stop = spoken(COMMON.early_stop);
  out.after = spoken(COMMON.after);
  return Object.assign(out, extra);
}

function instructionOf(script, mode) {
  const line = mode === 'record' ? script.intro_record : script.intro_tap || script.intro_record;
  return { text: { en: line.en, ur: line.ur }, audio: line.audio };
}

function lineKey(lang, kind) {
  if (kind === 'letters') return `${lang}.letters`;
  return kind;
}

// ---------------------------------------------------------------------------------------------- reading tasks
function gridTask({ lang, kind, spec, surface }) {
  const id = `${lang}.${kind}`;
  const base = `v3:sets.${SET}.reading.${lang}.${kind}`;
  const mode = MODES[surface].grid;
  const lines = LINES[lineKey(lang, kind)];
  const sayOf = (x) => (lang === 'ur' && kind === 'letters' ? UR_LETTER_NAMES[x] || x : x);
  const pool = spec.items;
  const items = spec.items.map((x, i) => {
    const iid = `${id}.${String(i + 1).padStart(3, '0')}`;
    const say = sayOf(x);
    return { id: iid, label: x, answer: x, say, prompt_audio: audioKey(lang, say), choices: poolChoices(iid, x, pool), src: `${base}.items[${i}]` };
  });
  const practice = (spec.practice || []).map((p, i) => {
    const pid = `${id}.p${i + 1}`;
    const say = sayOf(p.item);
    const fb = { right: spoken(fill(lines.right, say)), wrong: spoken(fill(lines.wrong, say)) };
    return { id: pid, role: p.role, label: p.item, answer: p.item, say, prompt_audio: audioKey(lang, say),
      choices: poolChoices(pid, p.item, [p.item, ...pool]), feedback: fb, src: `${base}.practice[${i}]` };
  });
  const example = practice.find((p) => p.role === 'example');
  const script = scriptOf(lineKey(lang, kind), mode, example && lines.example ? { example: spoken(fill(lines.example, example.say)) } : {});
  return {
    id, legacy_block: id, family: 'egra', subtask: SUBTASK[kind], lang, title: spec.title, kind: 'grid', mode,
    timed_s: spec.timed_s, grid: { cols: spec.per_row, direction: spec.direction }, distractor_pool: [...new Set([...pool, ...practice.map((p) => p.label)])],
    stop: stopOf(spec.stop, spec.timed_s), scoring: { unit: 'correct_per_minute', tap: 'choice === answer', record: 'scored later from audio (child-test scorer)' },
    instruction: instructionOf(script, mode), script, practice, ...(practice.length ? {} : { practice_note: spec.practice_note }),
    items, source: { ...spec.source, sa_choices: 'poolChoices: the answer + 3 others from the same grid' },
  };
}

function storyTasks({ lang, spec, surface }) {
  const id = `${lang}.story`;
  const base = `v3:sets.${SET}.reading.${lang}.story`;
  const mode = MODES[surface].passage;
  const lines = spec.story.lines || [];
  const lineOf = (i) => (lines.find((l) => i >= l.from && i <= l.to) || {}).n || null;
  const items = spec.items.map((w, i) => ({ id: `${id}.${String(i + 1).padStart(3, '0')}`, label: w, answer: w, line: lineOf(i), src: `${base}.items[${i}]` }));
  const first = lines[0] ? lines[0].to - lines[0].from + 1 : spec.items.length;
  const script = scriptOf('story', mode);
  const story = {
    id, legacy_block: id, family: 'egra', subtask: SUBTASK.story, lang, title: spec.title, kind: 'passage', mode,
    timed_s: spec.timed_s, passage: { text: spec.story.text, lines, direction: spec.direction },
    stop: stopOf(spec.stop, spec.timed_s, first),
    scoring: { unit: 'correct_words_per_minute', record: 'scored later from audio (child-test scorer)', tap: 'the child taps the last word read; words read = position (not scored for accuracy on the phone)' },
    instruction: instructionOf(script, mode), script, practice: [], practice_note: spec.practice_note, items, source: spec.source,
  };
  const comp = compTask({ lang, kind: 'story_comp', spec, surface, legacy: id, base, depends: { task: id, items_read_upto: true } });
  return [story, comp];
}

function compTask({ lang, kind, spec, surface, legacy, base, depends }) {
  const id = `${lang}.${kind}`;
  const mode = MODES[surface][kind === 'listening' ? 'listen_choice' : 'choice'];
  const script = scriptOf(kind, mode);
  const passage = kind === 'listening' ? { text: spec.story.text, lang, read_times: spec.read_times, audio: audioKey(lang, spec.story.text), shown: false } : null;
  const items = spec.questions.map((q, i) => {
    const answer = q.accept[0];
    const choices = [answer, ...(q.reject || []).slice(0, 2)].sort(byHash(`${q.id}|order`));
    return { id: q.id, prompt: { text: q.prompt, lang, audio: audioKey(lang, q.prompt) }, answer, accept: q.accept, choices,
      choice_audio: choices.map((c) => audioKey(lang, c)), needs_line: q.needs_line || null, rubric: q.rubric, src: `${base}.questions[${i}]` };
  });
  return {
    id, legacy_block: legacy, family: 'egra', subtask: SUBTASK[kind], lang, title: kind === 'listening' ? spec.title : { en: 'Reading questions', ur: 'کہانی کے سوال' },
    kind: kind === 'listening' ? 'listen_choice' : 'choice', mode, timed_s: null, ...(passage ? { passage } : {}), ...(depends ? { depends_on: depends } : {}),
    stop: { ...(kind === 'listening' ? {} : { only_read_lines: true }) },
    scoring: { unit: 'correct_of_asked', tap: 'choice === answer', record: 'scored later against accept[] (child-test scorer)' },
    instruction: instructionOf(script, mode), script, practice: [], practice_note: spec.practice_note || 'EGRA comprehension has no practice item (TK p.197-199).',
    items, question_timeout_s: spec.question_timeout_s || null,
    source: { ...spec.source, sa_choices: 'the key\'s first accepted answer + its first two listed wrong answers (item-bank v3 accept/reject)' },
  };
}

// ---------------------------------------------------------------------------------------------- maths tasks
function mathsTask({ kind, spec, grade, surface }) {
  const id = `ma.${kind}`;
  const base = `v3:sets.${SET}.maths.${grade}.${kind}`;
  const kindOf = kind === 'number_id' ? 'grid' : kind === 'word_problems' ? 'listen_choice' : 'choice';
  const mode = MODES[surface][kindOf];
  const lines = LINES[id] || {};
  const label = (it) => {
    if (kind === 'discrimination') return `${it.a}   ${it.b}`;
    if (kind === 'missing') return it.seq.map((x) => (x === null ? '□' : x)).join('  ');
    if (/^add/.test(kind)) return `${it.a} + ${it.b} =`;
    if (/^sub/.test(kind)) return `${it.a} - ${it.b} =`;
    return String(it);
  };
  const stepOf = (it) => {
    const s = it.seq.filter((x) => x !== null);
    const d = it.seq.findIndex((x) => x === null);
    return Math.abs(s[1] - s[0]) / (d === 1 || d === 2 ? (it.seq.indexOf(s[1]) - it.seq.indexOf(s[0])) : 1) || 1;
  };
  const choicesOf = (iid, it) => {
    if (kind === 'number_id') return poolChoices(iid, it, spec.items);
    if (kind === 'discrimination') return [it.a, it.b];
    if (kind === 'missing') return numberChoices(iid, it.answer, stepOf(it));
    return numberChoices(iid, it.answer);
  };
  const answerOf = (it) => (kind === 'number_id' ? it : it.answer);
  const items = spec.items.map((it, i) => {
    const iid = `${id}.G${grade}.${String(i + 1).padStart(2, '0')}`;
    const out = { id: iid, label: kind === 'word_problems' ? null : label(it), answer: answerOf(it), choices: choicesOf(iid, it), src: `${base}.items[${i}]` };
    if (kind === 'number_id') Object.assign(out, { say: { en: String(it), ur: toUrDigits(it) }, prompt_audio: { en: audioKey('en', String(it)), ur: audioKey('ur', toUrDigits(it)) } });
    if (kind === 'word_problems') Object.assign(out, { prompt: { en: it.prompt_en, ur: it.prompt_ur, audio: { en: audioKey('en', it.prompt_en), ur: audioKey('ur', it.prompt_ur) } }, type: it.type });
    return out;
  });
  const practice = (spec.practice || []).map((it, i) => {
    const pid = `${id}.G${grade}.p${i + 1}`;
    const ans = it.answer;
    const p = { id: pid, label: kind === 'word_problems' ? null : label(it), answer: ans, choices: choicesOf(pid, it), src: `${base}.practice[${i}]` };
    if (kind === 'word_problems') Object.assign(p, { prompt: { en: it.prompt_en, ur: it.prompt_ur, audio: { en: audioKey('en', it.prompt_en), ur: audioKey('ur', it.prompt_ur) } } });
    if (lines.right) p.feedback = { right: spoken(fill(lines.right, { en: String(ans), ur: toUrDigits(ans) })), wrong: spoken(fill(lines.wrong, { en: String(ans), ur: toUrDigits(ans) })) };
    return p;
  });
  const script = scriptOf(id, mode);
  return {
    id, legacy_block: id, family: 'egma', subtask: SUBTASK[kind], lang: null, title: spec.title, kind: kindOf, mode,
    timed_s: spec.timed_s, ...(kindOf === 'grid' ? { grid: { cols: 5, direction: 'ltr' }, distractor_pool: [...new Set(spec.items.map(String))] } : {}),
    stop: stopOf(spec.stop, spec.timed_s),
    scoring: { unit: spec.timed_s ? 'correct_per_minute' : 'correct_of_attempted', tap: 'choice === answer', record: 'scored later from audio (child-test scorer)' },
    instruction: instructionOf(script, mode), script, practice, ...(practice.length ? {} : { practice_note: spec.practice_note }),
    items, source: { ...spec.source, sa_choices: kind === 'number_id' ? 'the answer + 3 others from the same grid' : kind === 'discrimination' ? 'the item\'s own two numbers' : 'the answer + near neighbours (v4 G1A tiles_rule: k±1, k±2; ±step for patterns; ±10 for two-digit)' },
  };
}

// ---------------------------------------------------------------------------------------------- batteries
function battery({ form, surface, grades, maths }, lang, v3) {
  const set = v3.sets[SET];
  const tasks = [];
  for (const tid of TASKS_V3) {
    const [fam, kind] = tid.split('.');
    if (fam === 'ma') {
      const spec = set.maths[maths][kind];
      const t = mathsTask({ kind, spec, grade: maths, surface });
      if (['add2', 'sub2'].includes(kind) && set.maths[maths].skip_level2_if_level1_zero) t.depends_on = { task: `ma.${kind.slice(0, 3)}1`, skip_if_zero: true };
      tasks.push(t);
      continue;
    }
    const spec = set.reading[fam][kind];
    if (kind === 'listening') tasks.push(compTask({ lang: fam, kind, spec, surface, legacy: tid, base: `v3:sets.${SET}.reading.${fam}.listening` }));
    else if (kind === 'story') tasks.push(...storyTasks({ lang: fam, spec, surface }));
    else tasks.push(gridTask({ lang: fam, kind, spec, surface }));
  }
  const lines = Object.fromEntries(Object.entries(BATTERY).map(([k, l]) => [k, spoken(l)]));
  return {
    battery_id: `sa.${form}.${lang}`, version: '1', form, surface, grades, set: surface === 'coach' ? SET : null, lang,
    maths_form: `G${maths}`, lines, tasks,
  };
}

function buildSaBank({ v3, v4 }) {
  const batteries = {};
  for (const f of FORMS) for (const lang of ['ur', 'en']) {
    const b = battery(f, lang, v3);
    batteries[b.battery_id] = b;
  }
  return {
    version: VERSION,
    built_from: { v3: v3.version, v4: v4.version, set: SET },
    rule: 'Generated by shared/services/child-test/sa/build.js; never edit by hand. Every item and tap choice comes from item-bank.v3.json or item-bank.v4.json (src); Jugnu\'s lines adapt the official EGRA/EGMA wording for self-administration (sa/scripts.js, from).',
    // v3's sources, less any url that is not public (a local transcription is cited by its title alone).
    sources: Object.fromEntries(Object.entries(v3.sources).map(([k, v]) => [k, /^https?:/.test(v.url || '') ? v : { title: v.title, pages: v.pages }])),
    conventions: {
      battery: 'one battery per form x instruction language (lang: the language Jugnu speaks); reading tasks keep their own language',
      modes: 'tap: Jugnu says the item, the child taps it among the choices; record: the child reads aloud and the audio is scored later; both: record, then the tap side',
      stop: 'first_line_n/first_line_min_correct = EGRA early stop (no correct item in the first row or line); consecutive_errors = Core EGMA; time_up = the 60-second clock',
      feedback: 'right/wrong feedback on practice items only; scored items get none (EGRA)',
      audio: 'audio keys are sa/v1/<lang>/<sha1(lang|text)[0,12]>.mp3 under the served SA audio base; a missing clip falls back to the browser\'s speech of the same text',
      digits: 'maths items show Western digits; Urdu speech uses Urdu digits (v3 convention)',
    },
    batteries,
  };
}

/** The bank as files: the index (every battery's id, form, surface, grades, lang and file) and one file per battery. */
function splitSaBank(bank) {
  const { batteries, ...rest } = bank;
  const index = { ...rest, batteries: Object.values(batteries).map((b) => ({ battery_id: b.battery_id, form: b.form, surface: b.surface,
    grades: b.grades, set: b.set, lang: b.lang, file: `sa/${b.battery_id}.json`, tasks: b.tasks.map((t) => t.id) })) };
  const files = { 'item-bank.sa.v1.json': index };
  for (const b of Object.values(batteries)) files[`sa/${b.battery_id}.json`] = b;
  return files;
}

module.exports = { buildSaBank, splitSaBank, poolChoices, numberChoices, FORMS, MODES };
