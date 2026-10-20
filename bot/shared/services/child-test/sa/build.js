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
const { COMMON, BATTERY, TASKS: LINES, UR_LETTER_NAMES } = require('./scripts');

const VERSION = 'child-test-items-sa-v1';
const SET = 'A';

// The forms (RULING #4). Coach: Grades 3 and 5 on the term's set (draw/term-set.js). Game: the Challenge's grade
// bands (web-quiz-challenge-draw.js gradeBand: 2-3 → G3, 4-5 → G5) plus grade 1, which reads the same EGRA forms (the
// May RWP instrument was one form for Grades 1-5) and Core EGMA (written for Grades 1-3).
const FORMS = [
  { form: 'coach.G3.A', surface: 'coach', grades: [3], maths: '3' },
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
const TIMED_TAP = { item_timeout_s: 10, replay_at_s: 5 };
const UNTIMED_TAP = { item_timeout_s: null, replay_at_s: null };

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
 * Tap options: the target and n-1 others from the same official list (DESIGN §2: "drawn from the same grid, no new
 * letters"; words and made-up words prefer list-mates that share a letter with the target). Ordered by a hash of the
 * item id, so the target's place varies but the bytes never do.
 */
function listOptions(id, target, list, n, { shareLetter = false } = {}) {
  const t = String(target);
  const pool = [...new Set(list.map(String))].filter((x) => x !== t).sort(byHash(`${id}|pick`));
  const letters = new Set([...t]);
  const near = shareLetter ? pool.filter((x) => [...x].some((c) => letters.has(c))) : [];
  const picked = [...near, ...pool.filter((x) => !near.includes(x))].slice(0, n - 1);
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

function stopOf(v3stop, firstLineN) {
  if (v3stop.type === 'first_row') return { type: 'first_row', n: v3stop.n };
  if (v3stop.type === 'first_line') return { type: 'first_line', n: firstLineN };
  if (v3stop.type === 'consecutive_errors') return { type: 'consecutive_errors', n: v3stop.n };
  return null;
}

/** Jugnu's lines for one task, under CONTRACT §2's names. */
function scriptOf(key, mode, demo) {
  const t = LINES[key] || {};
  const intro = mode === 'record' ? (t.intro_record || t.intro_tap) : (t.intro_tap || t.intro_record);
  const out = { intro: spoken(intro) };
  if (demo) out.demo = spoken(demo);
  for (const k of ['practice_intro', 'practice_right', 'practice_wrong', 'test_intro', 'begin', 'replay', 'time_up', 'early_stop', 'after', 'hand_back']) {
    out[k] = spoken(COMMON[k]);
  }
  return out;
}
const sourceOf = (spec, scriptFrom, adaptation) => ({ items: spec.source && spec.source.items, script: (spec.source && spec.source.script) || scriptFrom, sa_adaptation: adaptation });

// ---------------------------------------------------------------------------------------------- reading tasks
function gridTask({ lang, kind, spec }) {
  const task = `${lang}.${kind}`;
  const base = `v3:sets.${SET}.reading.${lang}.${kind}`;
  const lines = LINES[kind === 'letters' ? task : kind];
  const n = OPTIONS_N[kind] || 4;
  const sayOf = (x) => (lang === 'ur' && kind === 'letters' ? UR_LETTER_NAMES[x] || x : x);
  const opts = (id, x) => listOptions(id, x, spec.items, n, { shareLetter: kind !== 'letters' });
  const items = spec.items.map((x, i) => {
    const id = `${task}.${pad(i + 1, 3)}`;
    return { id, target: x, options: opts(id, x), say: said(lang, sayOf(x)), src: `${base}.items[${i}]` };
  });
  const practice = (spec.practice || []).map((p, i) => {
    const id = `${task}.p${i + 1}`;
    const s = sayOf(p.item);
    return { id, role: p.role, target: p.item, options: opts(id, p.item), say: said(lang, s),
      feedback: { correct: spoken(fill(lines.right, s)), wrong: spoken(fill(lines.wrong, s)) }, src: `${base}.practice[${i}]` };
  });
  const example = practice.find((p) => p.role === 'example');
  return {
    task, lang, kind: 'grid', legacy_block: task, family: 'egra', subtask: SUBTASK[kind], title: spec.title, modes: ['tap'],
    tap: { options_n: n, distractor_rule: kind === 'letters' ? 'same_list' : 'same_list_shares_letter', input: 'options',
      items, time_limit_s: spec.timed_s, ...TIMED_TAP, stop: stopOf(spec.stop) },
    record: { grid: spec.items, per_row: spec.per_row, direction: spec.direction, time_limit_s: spec.timed_s, stop: stopOf(spec.stop) },
    practice, ...(practice.length ? {} : { practice_note: spec.practice_note }),
    script: scriptOf(kind === 'letters' ? task : kind, 'tap', example && lines.example ? fill(lines.example, example.say.text) : null),
    source: sourceOf(spec, `${base}.script`, 'Tangerine SA hear-then-tap (sec_letter_sounds_01, sec_vocab_01); RULING #2'),
    deviation: 'recognition, not production: Jugnu says the item and the child taps it (Tangerine SA\'s own choice); the 3-second rule becomes replay at 5 s, auto-advance marked wrong at 10 s',
  };
}

function storyTasks({ lang, spec }) {
  const task = `${lang}.story`;
  const base = `v3:sets.${SET}.reading.${lang}.story`;
  const lines = spec.story.lines || [];
  const lineOf = (i) => (lines.find((l) => i >= l.from && i <= l.to) || {}).n || null;
  const words = spec.items.map((w, i) => ({ id: `${task}.${pad(i + 1, 3)}`, target: w, line: lineOf(i), src: `${base}.items[${i}]` }));
  const first = lines[0] ? lines[0].to - lines[0].from + 1 : spec.items.length;
  const story = {
    task, lang, kind: 'passage', legacy_block: task, family: 'egra', subtask: SUBTASK.story, title: spec.title, modes: ['record'],
    tap: null,
    record: { passage: { text: spec.story.text, lines, direction: spec.direction, words }, time_limit_s: spec.timed_s,
      stop: stopOf(spec.stop, first), last_word_tap: true },
    practice: [], practice_note: spec.practice_note,
    script: scriptOf('story', 'record', LINES.story.last_word),
    source: sourceOf(spec, `${base}.script.intro`, 'RTI bracket: at time-up the child taps the last word read (RULING #2); Tangerine moving-window reading NOT adopted'),
    deviation: 'the child taps the last word read instead of the assessor bracketing it',
  };
  const questions = spec.questions.map((q, i) => ({ id: q.id, prompt: said(lang, q.prompt), needs_line: q.needs_line || null,
    accept: q.accept, reject: q.reject || [], rubric: q.rubric, src: `${base}.questions[${i}]` }));
  const comp = {
    task: `${lang}.story_comp`, lang, kind: 'questions', legacy_block: task, family: 'egra', subtask: SUBTASK.story_comp,
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

function listeningTask({ lang, spec }) {
  const task = `${lang}.listening`;
  const base = `v3:sets.${SET}.reading.${lang}.listening`;
  const questions = spec.questions.map((q, i) => ({ id: q.id, prompt: said(lang, q.prompt), accept: q.accept, reject: q.reject || [],
    rubric: q.rubric, src: `${base}.questions[${i}]` }));
  return {
    task, lang, kind: 'listen_questions', legacy_block: task, family: 'egra', subtask: SUBTASK.listening, title: spec.title,
    modes: ['record'], tap: null,
    record: { passage: { ...said(lang, spec.story.text), read_times: spec.read_times, shown: false }, questions, answer_window_s: 10, replay_max: 1 },
    practice: [], practice_note: spec.practice_note,
    script: scriptOf('listening', 'record'),
    source: sourceOf(spec, `${base}.script.intro`, 'Jugnu reads the story twice (v3/RWP read_times 2); each answer recorded'),
    deviation: 'the spoken answer is recorded and scored later instead of marked by an assessor',
  };
}

// ---------------------------------------------------------------------------------------------- maths tasks
const SAY_OP = { '+': { en: 'plus', ur: 'جمع' }, '-': { en: 'minus', ur: 'منفی' } };

function mathsTask({ kind, spec, grade }) {
  const task = `ma.${kind}`;
  const base = `v3:sets.${SET}.maths.${grade}.${kind}`;
  const keypad = ['add1', 'sub1', 'add2', 'sub2', 'word_problems'].includes(kind);
  const timed = !!spec.timed_s;
  const lines = LINES[task] || {};
  const op = /^add/.test(kind) ? '+' : /^sub/.test(kind) ? '-' : null;
  const itemOf = (it, id, src) => {
    if (kind === 'number_id') return { id, target: Number(it), options: listOptions(id, it, spec.items, 4).map(Number), say: sayBoth(String(it), toUrDigits(it)), src };
    if (kind === 'discrimination') return { id, target: it.answer, options: [it.a, it.b], src };
    if (kind === 'missing') return { id, target: it.answer, options: stepOptions(id, it.answer, seqStep(it.seq)), shown: it.seq, src };
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
  return {
    task, lang: null, kind: keypad ? 'keypad' : kind === 'number_id' ? 'grid' : 'choice', legacy_block: task, family: 'egma',
    subtask: SUBTASK[kind], title: spec.title, modes: ['tap'],
    tap: { options_n: keypad ? null : kind === 'discrimination' ? 2 : 4,
      distractor_rule: keypad ? null : kind === 'number_id' ? 'same_list' : kind === 'discrimination' ? 'the_pair' : 'plus_minus_one_step',
      input: keypad ? 'keypad' : 'options', items, time_limit_s: spec.timed_s, ...(timed ? TIMED_TAP : UNTIMED_TAP),
      ...(kind === 'word_problems' ? { soft_cap_s: 60 } : {}), stop: stopOf(spec.stop) },
    record: null,
    practice, ...(practice.length ? {} : { practice_note: spec.practice_note }),
    script: scriptOf(task, 'tap'),
    source: sourceOf(spec, `${base}.script`, keypad ? 'Tangerine SA keypad (sec_l1_addition_01, sec_l1_word_problem_01); RULING #2' : 'Tangerine SA tap (sec_num_id1, sec_num_comp1, sec_miss_num_01); RULING #2'),
    deviation: keypad ? 'typed on a keypad, not spoken' : kind === 'number_id' ? 'recognition instead of naming' : null,
  };
}

// ---------------------------------------------------------------------------------------------- forms
function formTasks({ maths }, v3) {
  const set = v3.sets[SET];
  const tasks = [];
  for (const tid of TASKS_V3) {
    const [fam, kind] = tid.split('.');
    if (fam === 'ma') {
      const t = mathsTask({ kind, spec: set.maths[maths][kind], grade: maths });
      if (['add2', 'sub2'].includes(kind) && set.maths[maths].skip_level2_if_level1_zero) t.depends_on = { task: `ma.${kind.slice(0, 3)}1`, skip_if_zero: true };
      tasks.push(t);
      continue;
    }
    const spec = set.reading[fam][kind];
    if (kind === 'listening') tasks.push(listeningTask({ lang: fam, spec }));
    else if (kind === 'story') tasks.push(...storyTasks({ lang: fam, spec }));
    else tasks.push(gridTask({ lang: fam, kind, spec }));
  }
  return tasks;
}

function buildSaBank({ v3 }) {
  const forms = {};
  const tasks = {};
  for (const f of FORMS) {
    const list = formTasks(f, v3);
    const full = list.map((t) => t.task);
    const form = { surface: f.surface, grades: f.grades, set: f.surface === 'coach' ? SET : null, maths_form: `G${f.maths}`, order: full };
    if (f.surface === 'coach') Object.assign(form, { full, blocks: BLOCKS, block_names: BLOCK_NAMES });
    else Object.assign(form, { islands: { maths: [...BLOCKS.B4, ...BLOCKS.B5], english: ['en.listening', ...BLOCKS.B2], urdu: ['ur.listening', ...BLOCKS.B1] }, tower: full });
    forms[f.form] = form;
    for (const t of list) tasks[`${f.form}/${t.task}`] = t;
  }
  return {
    version: VERSION,
    built_from: { v3: v3.version, set: SET },
    rule: 'Generated by shared/services/child-test/sa/build.js; never edit by hand. Every item and option comes from item-bank.v3.json (src); Jugnu\'s lines adapt the official EGRA/EGMA wording for self-administration (sa/scripts.js, from).',
    // v3's sources, less any url that is not public (a local transcription is cited by its title alone).
    sources: Object.fromEntries(Object.entries(v3.sources).map(([k, v]) => [k, /^https?:/.test(v.url || '') ? v : { title: v.title, pages: v.pages }])),
    conventions: {
      tasks: 'keyed "<form>/<task>"; task = the v3 block id (legacy_block), plus <lang>.story_comp for the story questions',
      modes: 'tap: Jugnu says the target, the child taps it (options) or types it (keypad), scored on the phone; record: audio kept, scored later by the child-test scorer',
      stop: 'first_row n: no correct item in the first n → stop (EGRA); first_line n: no correct word in the first line (n words); consecutive_errors n (Core EGMA); time_limit_s: the clock',
      feedback: 'correct/wrong feedback on practice items only; scored items get none (EGRA)',
      audio: 'keys sa/v1/<lang>/<sha1(lang|text)[0,12]>.mp3 under SA_AUDIO_BASE; a missing clip falls back to the browser\'s speech of the same text',
      digits: 'maths shows Western digits; Urdu speech uses Urdu digits (v3 convention)',
      translation: 'Urdu renderings of English scripts are pending native review (v3 convention)',
    },
    lines: Object.fromEntries(Object.entries(BATTERY).map(([k, l]) => [k, spoken(l)])),
    forms,
    tasks,
  };
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
const RESPONSE = { options: 'tap', keypad: 'keypad' };

function runtimeStop(s) {
  if (!s) return {};
  if (s.type === 'first_row' || s.type === 'first_line') return { first_line_n: s.n, first_line_min_correct: 1 };
  if (s.type === 'consecutive_errors') return { consecutive_errors: s.n };
  return {};
}

/** A spoken thing in the battery's language: { text, audio } (sayBoth/spoken carry both languages). */
function inLang(x, lang) {
  if (!x) return null;
  if (x.text != null) return { text: x.text, audio: x.audio };
  return { text: x[lang], audio: x.audio && x.audio[lang] };
}

function runtimeItem(it, lang) {
  const o = { ...it };
  if (it.say) {
    const s = inLang(it.say, lang);
    o.say = s.text;
    o.prompt_audio = s.audio;
  }
  if (it.prompt) o.prompt = inLang(it.prompt, lang);
  if (it.feedback) o.feedback = { correct: inLang(it.feedback.correct, lang), wrong: inLang(it.feedback.wrong, lang) };
  return o;
}

function runtimeTask(t, lang) {
  const base = { id: t.task, legacy_block: t.legacy_block, family: t.family, subtask: t.subtask, lang: t.lang, title: t.title, kind: t.kind,
    script: Object.fromEntries(Object.entries(t.script).map(([k, l]) => [k, inLang(l, lang)])),
    instruction: inLang(t.script.intro, lang), source: t.source, deviation: t.deviation, ...(t.practice_note ? { practice_note: t.practice_note } : {}) };
  const practice = (t.practice || []).map((p) => runtimeItem(p, lang));
  if (t.tap) {
    const tap = t.tap;
    return { ...base, response: RESPONSE[tap.input], time_limit_s: tap.time_limit_s || null, item_timeout_s: tap.item_timeout_s,
      replay_at_s: tap.replay_at_s, ...(tap.soft_cap_s ? { item_timeout_s: tap.soft_cap_s } : {}), stop: runtimeStop(tap.stop),
      options_n: tap.options_n, distractor_rule: tap.distractor_rule, items: tap.items.map((it) => runtimeItem(it, lang)), practice,
      ...(t.record && t.record.grid ? { grid: t.record.grid, per_row: t.record.per_row, direction: t.record.direction } : {}),
      ...(t.depends_on ? { depends_on: t.depends_on } : {}) };
  }
  const r = t.record;
  if (r.passage && r.passage.words) {
    const { words, ...passage } = r.passage;
    return { ...base, response: 'record', time_limit_s: r.time_limit_s, stop: runtimeStop(r.stop), last_word_tap: true, passage,
      items: words, practice, depends_on: { task: `${t.lang}.words`, skip_if_stop: 'early_stop_first_line' } };
  }
  const items = r.questions.map((q) => runtimeItem(q, lang));
  return { ...base, response: 'oral', question_timeout_s: r.answer_window_s, replay_max: r.replay_max,
    ...(r.passage ? { passage: r.passage } : {}), items, practice,
    ...(t.depends_on ? { depends_on: { task: t.depends_on.task, upto_item: t.depends_on.upto_item } } : {}) };
}

/** One form in one instruction language, as the engine runs it. */
function runtimeBattery(bank, formId, lang) {
  const form = bank.forms[formId];
  const { order, ...shape } = form;
  return {
    battery_id: `sa.${formId}.${lang}`, version: bank.version, form: formId, lang, ...shape,
    rule: bank.rule, conventions: bank.conventions,
    lines: Object.fromEntries(Object.entries(bank.lines).map(([k, l]) => [k, inLang(l, lang)])),
    tasks: order.map((id) => runtimeTask(bank.tasks[`${formId}/${id}`], lang)),
  };
}

/** The bank as files: the whole bank, one file per form (the same shape), and per form × language the runtime battery. */
function splitSaBankWithRuntime(bank) {
  const files = splitSaBank(bank);
  for (const id of Object.keys(bank.forms)) {
    for (const lang of ['ur', 'en']) files[`sa/sa.${id}.${lang}.json`] = runtimeBattery(bank, id, lang);
  }
  return files;
}

module.exports = { buildSaBank, splitSaBank, splitSaBankWithRuntime, runtimeBattery, listOptions, stepOptions, FORMS, BLOCKS };
