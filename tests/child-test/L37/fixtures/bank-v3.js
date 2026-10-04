'use strict';
/**
 * L37 test fixture: task specs in the CONTRACT §21.3 shape (item-bank.v3.json is L35's; until it lands the
 * scorers are proved against this). Maths items are the Core EGMA ones (R9 item_specs.json); reading items
 * are synthetic strings, no child data. `quality` follows the R8 table.
 */

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const UR_LETTERS = 'ا ب پ ت ٹ ث ج چ ح خ د ڈ ذ ر ڑ ز س ش ص ض ط ظ ع غ ف ق ک گ ل م ن و ہ ی ے'.split(' ');
const EN_LETTERS = 'L i h R S y E O n T f e Q x u r O p i t m A c a N S d s o w'.split(' ');
const script = (ur, en) => ({ ur, en });

const BEGIN = { ur: 'شروع کریں', en: 'begin now' };

function readingTask(task, extra) {
  return { task, title: { en: task, ur: task }, practice: [], source: { items: 'fixture' }, script: { begin: script(BEGIN.ur, BEGIN.en) }, ...extra };
}

const STORY_TOKENS = range(60, (i) => `w${i + 1}`);
const QUESTIONS = [
  { id: 'q1', prompt: 'who went', type: 'literal', accept: ['father'], reject: [], rubric: '', needs_line: 1, source: 'fixture' },
  { id: 'q2', prompt: 'where', type: 'literal', accept: ['river'], reject: [], rubric: '', needs_line: 2, source: 'fixture' },
  { id: 'q3', prompt: 'why', type: 'inferential', accept: ['hot'], reject: [], rubric: '', needs_line: 4, source: 'fixture' },
];
const LISTEN_QS = range(6, (i) => ({ id: `lq${i + 1}`, prompt: `listening question ${i + 1}`, type: 'literal', accept: [`answer ${i + 1}`], reject: [], rubric: '', source: 'fixture' }));

function reading(lang) {
  const letters = lang === 'ur' ? UR_LETTERS : EN_LETTERS;
  return {
    listening: readingTask('listening', { timed_s: null, story: { text: 'A short story read aloud.' }, read_times: 2, questions: LISTEN_QS, stop: { type: 'none' }, quality: lang === 'ur' ? 'ai_review' : 'provisional', items: [] }),
    letters: readingTask('letters', { timed_s: 60, per_row: 10, kind: 'names', items: range(100, (i) => letters[i % letters.length]), stop: { type: 'first_row', n: 10 }, quality: lang === 'ur' ? 'provisional' : 'ai_review' }),
    nonwords: readingTask('nonwords', { timed_s: 60, per_row: 5, items: range(50, (i) => `nw${i + 1}`), stop: { type: 'first_row', n: 5 }, quality: 'provisional' }),
    words: readingTask('words', { timed_s: 60, per_row: 5, items: range(50, (i) => `fw${i + 1}`), stop: { type: 'first_row', n: 5 }, quality: lang === 'ur' ? 'ai' : 'ai_review' }),
    story: readingTask('story', {
      timed_s: 60, items: [], stop: { type: 'first_line' }, quality: 'ai_review',
      story: { text: STORY_TOKENS.join(' '), tokens: STORY_TOKENS, lines: range(6, (i) => ({ n: i + 1, from: i * 10, to: i * 10 + 9 })) },
      questions: QUESTIONS,
    }),
  };
}

const pair = (a, b) => ({ a, b, answer: Math.max(a, b) });
const sum = (s) => { const [a, op, b] = s.split(/([+-])/); return { a: +a, b: +b, op, answer: op === '+' ? +a + +b : +a - +b, prompt: s }; };
const ADD1 = ['1+3', '2+3', '6+2', '4+5', '3+3', '8+1', '7+3', '3+9', '2+8', '9+3', '7+8', '4+7', '7+5', '8+6', '9+8', '6+7', '8+8', '8+5', '10+2', '8+10'];
const SUB1 = ['4-3', '5-3', '8-2', '9-5', '6-3', '9-1', '10-3', '12-9', '10-8', '12-3', '15-8', '11-7', '12-5', '14-6', '17-8', '13-7', '16-8', '13-5', '12-2', '18-10'];

function mathsTask(task, extra) {
  return { task, title: { en: task, ur: task }, practice: [], source: { items: 'core-egma' }, script: { begin: script('شروع کریں', 'begin now') }, ...extra };
}

function maths() {
  return {
    number_id: mathsTask('number_id', { timed_s: 60, items: ['2', '9', '0', '12', '30', '22', '45', '39', '23', '48', '91', '33', '74', '87', '65', '108', '245', '587', '731', '989'], stop: { type: 'none' }, quality: 'ai_review' }),
    discrimination: mathsTask('discrimination', { timed_s: null, items: [pair(7, 5), pair(11, 24), pair(47, 42), pair(87, 69), pair(65, 56), pair(146, 153), pair(623, 632), pair(39, 64), pair(118, 181), pair(799, 801)], stop: { type: 'consecutive_errors', n: 4 }, quality: 'ai_review' }),
    missing: mathsTask('missing', { timed_s: null, items: range(10, (i) => ({ seq: [i + 1, i + 2, null, i + 4], answer: i + 3 })), stop: { type: 'consecutive_errors', n: 4 }, quality: 'ai_review' }),
    add1: mathsTask('add1', { timed_s: 60, items: ADD1.map(sum), stop: { type: 'none' }, quality: 'ai' }),
    sub1: mathsTask('sub1', { timed_s: 60, items: SUB1.map(sum), stop: { type: 'none' }, quality: 'ai' }),
    add2: mathsTask('add2', { timed_s: null, items: ['13+6', '18+7', '12+14', '22+37', '38+26'].map(sum), stop: { type: 'consecutive_errors', n: 4 }, quality: 'ai_review' }),
    sub2: mathsTask('sub2', { timed_s: null, items: ['19-6', '25-7', '26-14', '59-37', '64-26'].map(sum), stop: { type: 'consecutive_errors', n: 4 }, quality: 'ai_review' }),
    word_problems: mathsTask('word_problems', { timed_s: null, items: range(6, (i) => ({ id: `wp${i + 1}`, prompt_ur: `سوال ${i + 1}`, prompt_en: `problem ${i + 1}`, answer: i + 2, type: 'add' })), stop: { type: 'consecutive_errors', n: 4 }, quality: 'ai_review' }),
  };
}

const SETS = { A: { reading: { ur: reading('ur'), en: reading('en') }, maths: { 3: maths(), 5: maths() } } };

function getTaskSpec({ grade, set = 'A', task }) {
  const [p, kind] = String(task).split('.');
  const s = SETS[set];
  if (!s) return null;
  if (p === 'ma') return (s.maths[Number(grade)] || {})[kind] || null;
  return (s.reading[p] || {})[kind] || null;
}

module.exports = { getTaskSpec, SETS, BEGIN, STORY_TOKENS, version: 'child-test-items-v3-fixture' };
