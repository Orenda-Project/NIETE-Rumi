'use strict';

/**
 * Battery v3: one plain step message per task (bd-s1oo0.50.2, CONTRACT §21.4, design/COACH_JOURNEY_V3.md §3).
 * Pure: text from the catalog (childTestL36*, config/ux-strings.js) and the item bank (bank-v3.js); nothing
 * here sends or stores.
 *
 *   taskStep(lang, task, { name, grade, set })   the step: header, card line, numbered actions, the words to
 *                                                say «verbatim» from the bank's script, the stop rule, send
 *   header(lang, task, { name, grade })          "*Ayesha Khan* · Urdu 2 of 5 · Letters" (also leads the nudge)
 *   titleOf(lang, task, spec?)                   the bank's title, else the catalog's
 *   position(task, grade)                        { block, k, n }: the task's place in its block
 *
 * Kinds (CONTRACT §21.3, design §3):
 *   timed     letters, nonwords, words, number_id, add1, sub1: practice row first (not recorded), 🎤 + lock,
 *             the begin line, «go on» after a pause, the stop line at 1:00, send at about 1:05
 *   story     timed, then the comprehension questions gated on how far the child read (§20, reach.js)
 *   untimed   discrimination, missing, add2, sub2: record the whole task; stop after n wrong in a row
 *   listening the story read aloud (bank read_times), then the questions
 *   word_problems  each problem read aloud by the coach (Urdu), stop after n wrong in a row
 *
 * The words said TO the child are the bank's `script` lines in the child's language for the task (Urdu for
 * ur.* and maths, English for en.*), never the coach's, wrapped by steps.said (« » inside a direction isolate
 * when the script runs against the message).
 */

const { t } = require('./copy');
const steps = require('./steps');
const bank = require('./bank-v3');
const { anchorFor } = require('../scoring/reach');
const { blockOf, kindOf } = require('../tasks');
const { logError } = require('../../../utils/logger');

const BLOCK_KEY = { urdu: 'childTestL36BlockUrdu', english: 'childTestL36BlockEnglish', maths: 'childTestL36BlockMaths' };
const BOOKLET_KEY = { urdu: 'childTestL36BookletUrdu', english: 'childTestL36BookletEnglish', maths: 'childTestL36BookletMaths' };
const TITLE_KEY = {
  listening: 'childTestL36TitleListening', letters: 'childTestL36TitleLetters', nonwords: 'childTestL36TitleNonwords',
  words: 'childTestL36TitleWords', story: 'childTestL36TitleStory', number_id: 'childTestL36TitleNumberId',
  discrimination: 'childTestL36TitleDiscrimination', missing: 'childTestL36TitleMissing', add1: 'childTestL36TitleAdd1',
  sub1: 'childTestL36TitleSub1', add2: 'childTestL36TitleAdd2', sub2: 'childTestL36TitleSub2', word_problems: 'childTestL36TitleWordProblems',
};
const TIMED = new Set(['letters', 'nonwords', 'words', 'number_id', 'add1', 'sub1']);
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const LRI = '⁦';
const FSI = '⁨';
const PDI = '⁩';
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

// Script keys as L35's bank names them (EGRA Toolkit / Core EGMA order: intro → example/practice → instructions →
// begin), with the few other names a draft may use. CONTRACT §21.3 fixes only `begin` (the clock's cue).
const ALIASES = {
  intro: ['intro'],
  instructions: ['instructions', 'point'],
  begin: ['begin', 'start'],
  go_on: ['go_on', 'next'],
  stop: ['stop'],
  early_stop: ['early_stop', 'stop'],
  after: ['after'],
  ask: ['item', 'ask'],
  questions_intro: ['questions_intro'],
  more: ['more'],
  next_problem: ['next_problem', 'go_on'],
};
// The practice lines, in the order they are said (example, then each practice item); `practice` for word problems.
const PRACTICE_KEYS = ['example', 'practice_1', 'practice_2', 'practice_3', 'practice'];

/** The child's language for a task: English for en.*, Urdu for ur.* and maths. */
const childLang = (task) => (blockOf(task) === 'english' ? 'en' : 'ur');

function pick(v, lang) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v[lang] || v.ur || v.en || '';
}

/** The script line to say for `key`, verbatim, in the task's language; '' when the bank has none. */
function line(spec, task, key) {
  const script = (spec && spec.script) || {};
  for (const k of ALIASES[key] || [key]) {
    const s = pick(script[k], childLang(task));
    if (s && String(s).trim()) return String(s).trim();
  }
  return '';
}

function position(task, grade) {
  const block = blockOf(task);
  const mine = bank.tasksFor({ grade }).filter((x) => blockOf(x) === block);
  return { block, k: mine.indexOf(task) + 1, n: mine.length };
}

function titleOf(lang, task, spec = null) {
  const own = spec && spec.title ? pick(spec.title, lang) : '';
  return own || t(lang, TITLE_KEY[kindOf(task)] || 'childTestL36TitleStory');
}

function header(lang, task, { name, grade, set } = {}) {
  const spec = bank.specFor({ grade, set, task });
  const { block, k, n } = position(task, grade);
  return t(lang, 'childTestL36Header', { name, block: t(lang, BLOCK_KEY[block]), k, n, title: titleOf(lang, task, spec) });
}

// ------------------------------------------------------------------ pieces

const said = (lang, s) => steps.said(lang, s);
const toDigits = (lang, s) => (lang === 'en' ? String(s) : String(s).replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)]));

/** A practice item as printed: a letter or word, a pair, a sum, a row with a gap. */
function itemText(task, it) {
  if (it == null) return '';
  if (typeof it !== 'object') return String(it);
  if (it.item != null) return String(it.item);
  const kind = kindOf(task);
  if (Array.isArray(it.seq)) return it.seq.map((x) => (x == null ? '__' : x)).join(', ');
  if (it.a != null && it.b != null) {
    if (kind === 'discrimination') return `${it.a} · ${it.b}`;
    return `${it.a} ${/^sub/.test(kind) ? '−' : '+'} ${it.b}`;
  }
  return String(it.text || it.prompt || '');
}

/** The practice items on one line, isolated as a unit (Urdu letters in an English message, sums in an Urdu one). */
function practiceItems(task, spec) {
  const items = ((spec && spec.practice) || []).map((x) => itemText(task, x)).filter(Boolean);
  if (!items.length) return '';
  const sep = blockOf(task) === 'maths' ? '   ' : ' ';
  return `${blockOf(task) === 'maths' ? LRI : FSI}${items.join(sep)}${PDI}`;
}

function cardLine(lang, task, spec, grade, set) {
  const kind = kindOf(task);
  if (kind === 'word_problems') return t(lang, 'childTestL36NoBookletWp');
  if (!bank.hasSheet(task)) return t(lang, 'childTestL36NoBooklet');
  const page = bank.pageOf({ grade, set, task });
  const title = titleOf(lang, task, spec);
  const what = lang === 'en' ? title.toLowerCase() : title;
  return t(lang, BOOKLET_KEY[blockOf(task)], { page: page || '—', what, grade: Number(grade) || '—' });
}

function stopRule(lang, task, spec) {
  const stop = (spec && spec.stop) || {};
  const words = line(spec, task, stop.type === 'consecutive_errors' ? 'stop' : 'early_stop') || line(spec, task, 'after');
  const say = words ? said(lang, words) : null;
  // A bank with no closing line for the task: the rule without a line to say (never a placeholder).
  const key = (base) => (say ? base : `${base}NoSay`);
  if (stop.type === 'first_row') return t(lang, key('childTestL36RuleFirstRow'), { say });
  if (stop.type === 'first_line') return t(lang, key('childTestL36RuleFirstLine'), { say });
  if (stop.type === 'consecutive_errors') return t(lang, key('childTestL36RuleConsecutive'), { say, n: Number(stop.n) || 4 });
  return null;
}

const qPrompt = (q, task) => pick(q && (q.prompt != null ? q.prompt : q.text), childLang(task));
const bullet = (i) => `${LRI}${CIRCLED[i] || '•'}${PDI}`;

/** Questions, one per line; with `gated`, every question needing a line past the first carries its §20 anchor. */
function questionLines(lang, task, spec, { gated }) {
  return ((spec && spec.questions) || []).map((q, i) => {
    const row = `   ${bullet(i)} ${said(lang, qPrompt(q, task))}`;
    if (!gated || !(i > 0 || Number(q.needs_line) > 1)) return row;
    const anchor = anchorFor(spec, q);
    return anchor ? `   ${t(lang, 'childTestL34OnlyIfPast')}\n   ${said(lang, anchor)}\n${row}` : row;
  }).join('\n');
}

function questionsStep(lang, task, spec, gated) {
  const questions = questionLines(lang, task, spec, { gated });
  if (!questions) return null;
  const intro = line(spec, task, 'questions_intro');
  return intro ? t(lang, 'childTestL36Questions', { say: said(lang, intro), questions })
    : t(lang, 'childTestL36QuestionsNoIntro', { questions });
}

/** Several said lines, each on its own indented line (the first follows the catalog's own indent). */
const saidLines = (lang, list) => list.map((x) => said(lang, x)).join('\n   ');

function practiceStep(lang, task, spec) {
  const items = practiceItems(task, spec);
  const script = (spec && spec.script) || {};
  const say = PRACTICE_KEYS.map((k) => pick(script[k], childLang(task))).filter((x) => x && x.trim());
  if (!items && !say.length) return null;
  const head = say.length ? t(lang, 'childTestL36Practice', { say: saidLines(lang, say) }) : t(lang, 'childTestL36PracticeOnly');
  const help = Object.keys(script).some((k) => /^practice(_\d)?_wrong$/.test(k)) ? t(lang, 'childTestL36PracticeHelp') : null;
  return [head, items ? t(lang, 'childTestL36PracticeItems', { items }) : null, help].filter(Boolean).join('\n');
}

function sayStep(lang, spec, task, key, catalogKey = 'childTestL36Say') {
  const s = line(spec, task, key);
  return s ? t(lang, catalogKey, { say: said(lang, s) }) : null;
}

// ------------------------------------------------------------------ the kinds

function timedSteps(lang, task, spec, { story = false } = {}) {
  const out = [
    sayStep(lang, spec, task, 'intro', 'childTestL36SayFirst'),
    practiceStep(lang, task, spec),
    sayStep(lang, spec, task, 'instructions'),
    t(lang, 'childTestL36Mic'),
  ];
  let begin = sayStep(lang, spec, task, 'begin');
  const goOn = line(spec, task, 'go_on');
  if (goOn) {
    const s = blockOf(task) === 'maths' ? 5 : 3;   // EGMA-TK p.33: 5 s; EGRA Toolkit: 3 s
    begin = [begin, t(lang, 'childTestL36GoOn', { s, say: said(lang, goOn) })].filter(Boolean).join('\n');
  }
  out.push(begin);
  const stopLine = line(spec, task, 'stop');
  const stopAt = stopLine ? t(lang, 'childTestL36StopAt', { say: said(lang, stopLine) }) : t(lang, 'childTestL36StopAtNoSay');
  if (story) {
    out.push(`${stopAt}\n${t(lang, 'childTestL36Finger')}`);
    out.push(questionsStep(lang, task, spec, true));
    out.push(t(lang, 'childTestL36Send'));
  } else {
    out.push(`${stopAt}\n${t(lang, 'childTestL36SendAt')}`);
  }
  return out;
}

function untimedSteps(lang, task, spec) {
  const said1 = [line(spec, task, 'intro'), line(spec, task, 'begin')].filter(Boolean);
  let begin = said1.length ? t(lang, 'childTestL36Say', { say: saidLines(lang, said1) }) : null;
  const ask = line(spec, task, 'ask');
  if (ask) begin = [begin, t(lang, 'childTestL36Ask', { say: said(lang, ask) })].filter(Boolean).join('\n');
  const goOn = line(spec, task, 'go_on');
  if (goOn) begin = [begin, t(lang, 'childTestL36NoAnswer', { s: 5, say: said(lang, goOn) })].filter(Boolean).join('\n');
  return [practiceStep(lang, task, spec), t(lang, 'childTestL36MicWhole'), begin, endStep(lang, task, spec)];
}

/** The last step of an untimed task: the closing line the bank gives (stop, else "after"), then send. */
function endStep(lang, task, spec) {
  const end = line(spec, task, 'stop') || line(spec, task, 'after');
  return end ? t(lang, 'childTestL36EndSend', { say: said(lang, end) }) : t(lang, 'childTestL36Send');
}

function listeningSteps(lang, task, spec) {
  const n = Number(spec && spec.read_times) || 1;
  const times = n === 1 ? t(lang, 'childTestL36Times1') : n === 2 ? t(lang, 'childTestL36Times2') : t(lang, 'childTestL36TimesN', { n });
  const text = pick(spec && spec.story && (spec.story.text != null ? spec.story.text : spec.story), childLang(task));
  return [
    t(lang, 'childTestL36MicWhole'),
    sayStep(lang, spec, task, 'intro'),
    text ? t(lang, 'childTestL36ReadStory', { times, story: said(lang, text) }) : null,
    questionsStep(lang, task, spec, false),
    endStep(lang, task, spec),
  ];
}

function wordProblemSteps(lang, task, spec) {
  const problems = ((spec && spec.items) || [])
    .map((p, i) => `   ${bullet(i)} ${said(lang, (p && (p.prompt_ur || pick(p.prompt, 'ur'))) || itemText(task, p))}`).join('\n');
  const first = ((spec && spec.practice) || [])[0];
  const practice = line(spec, task, 'practice') || (first && (first.prompt_ur || pick(first.prompt, 'ur'))) || '';
  const more = line(spec, task, 'more');
  const next = line(spec, task, 'next_problem');
  return [
    t(lang, 'childTestL36MicWhole'),
    sayStep(lang, spec, task, 'intro'),
    practice ? t(lang, 'childTestL36WpPractice', { say: said(lang, practice) }) : null,
    problems ? [more ? t(lang, 'childTestL36Say', { say: said(lang, more) }) : null,
      t(lang, more ? 'childTestL36ReadProblemsThen' : 'childTestL36ReadProblems', { problems }),
      next ? t(lang, 'childTestL36NoAttempt', { s: 5, say: said(lang, next) }) : null].filter(Boolean).join('\n') : null,
    endStep(lang, task, spec),
  ];
}

/** "1. …" / "۱۔ …" before each step that has something to say. */
function numberSteps(lang, parts) {
  return parts.filter(Boolean).map((p, i) => `${toDigits(lang, i + 1)}${lang === 'en' ? '.' : '۔'} ${p.replace(/^\s+/, '')}`).join('\n');
}

/**
 * The step for `task`. A task the bank has no spec for still gets a step that names it (the coach can run it
 * from the printed coach card) and the miss is logged at error, never silent.
 */
function taskStep(lang, task, { name, grade, set = 'A' } = {}) {
  const spec = bank.specFor({ grade, set, task });
  const head = header(lang, task, { name, grade, set });
  if (!spec || spec.gap) {
    // A gap is skipped by the conversation before any step is built (machine.sendStepV3); only a missing spec is an error.
    if (!spec) logError('child_test.task_spec_missing', { task, grade, set });
    return [head, t(lang, 'childTestL36SpecMissing'), t(lang, 'childTestL36SkipHint')].join('\n');
  }
  const kind = kindOf(task);
  let parts;
  if (kind === 'listening') parts = listeningSteps(lang, task, spec);
  else if (kind === 'story') parts = timedSteps(lang, task, spec, { story: true });
  else if (kind === 'word_problems') parts = wordProblemSteps(lang, task, spec);
  else if (TIMED.has(kind) || Number(spec.timed_s) > 0) parts = timedSteps(lang, task, spec);
  else parts = untimedSteps(lang, task, spec);
  const rule = stopRule(lang, task, spec);
  return [head, cardLine(lang, task, spec, grade, set), numberSteps(lang, parts), rule, t(lang, 'childTestL36SkipHint')]
    .filter(Boolean).join('\n');
}

module.exports = { taskStep, header, titleOf, position, childLang };
