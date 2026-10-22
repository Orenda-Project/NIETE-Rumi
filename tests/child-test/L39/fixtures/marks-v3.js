/**
 * ai-marks-v3 (CONTRACT §21.5) for one child's 18 task rows. Synthetic: the printed items here are
 * placeholders shaped like the bank's (§21.3), not the bank. No child data.
 *
 * Assumptions this fixture makes about §21.5, stated in lanes/L39/CHANGE_REQUEST.md:
 *   - items[].i is the 1-based item number, as L37 writes it (spec.items[i - 1], or spec.questions for listening);
 *     review[] names items by that number, and story questions as "q:<id>" (bd-s1oo0.50.8);
 *   - items[].ref is the item as printed: a string (letter, word, number) or the bank object ({a, b}, {seq}, {prompt_ur, prompt_en});
 *   - review[] holds item positions i; for a story, a comprehension row is named by its id.
 */
const T = require('../../../../bot/shared/services/child-test/tasks');

// R8 §4 / L37 brief: the quality each task ships with.
const QUALITY = {
  'ur.listening': 'ai_review', 'ur.letters': 'provisional', 'ur.nonwords': 'provisional', 'ur.words': 'ai', 'ur.story': 'ai_review',
  'en.listening': 'provisional', 'en.letters': 'ai_review', 'en.nonwords': 'provisional', 'en.words': 'ai_review', 'en.story': 'ai_review',
  'ma.number_id': 'ai_review', 'ma.discrimination': 'ai_review', 'ma.missing': 'ai_review', 'ma.add1': 'ai', 'ma.sub1': 'ai',
  'ma.add2': 'ai_review', 'ma.sub2': 'ai_review', 'ma.word_problems': 'ai_review',
};
const MV = { audio: 'google/gemini-3.8-flash', stt: 'soniox:test' };

function timed(task, { correct, attempted, total, timeRemaining = 0, refs, review = [], heard = {} }) {
  const items = Array.from({ length: total }, (_, i) => {
    let verdict = 'not_reached';
    if (i < attempted) verdict = i < correct ? 'correct' : 'wrong';
    return { i: i + 1, ref: refs ? refs(i) : `item${i + 1}`, verdict, heard: heard[i] || (verdict === 'not_reached' ? '' : `h${i + 1}`), conf: 0.9, settled: verdict !== 'not_reached' };
  });
  const used = 60 - timeRemaining;
  return {
    version: 'ai-marks-v3', task, quality: QUALITY[task],
    timed: { seconds_given: 60, begin_at_s: 3.2, end_at_s: 3.2 + used, time_remaining: timeRemaining, attempted, correct, rate: (correct / used) * 60 },
    score: null, stopped_by_rule: false, items, review, model_versions: MV,
  };
}

function untimed(task, { verdicts, refs, review = [], heard = {}, unsettled = [] }) {
  const items = verdicts.map((verdict, i) => ({
    i: i + 1, ref: refs(i), verdict, heard: heard[i] != null ? heard[i] : (verdict === 'none' ? '' : `h${i + 1}`),
    conf: unsettled.includes(i) ? 0.3 : 0.92, settled: !unsettled.includes(i) && verdict !== 'none' && verdict !== 'not_reached',
  }));
  const reached = items.filter((x) => x.verdict !== 'not_reached');
  return {
    version: 'ai-marks-v3', task, quality: QUALITY[task], timed: null,
    score: { correct: reached.filter((x) => x.verdict === 'correct').length, of: items.length },
    stopped_by_rule: items.some((x) => x.verdict === 'not_reached'), items, review, model_versions: MV,
  };
}

const vs = (s) => s.split('').map((c) => ({ c: 'correct', w: 'wrong', n: 'none', '-': 'not_reached' }[c]));
const q = (lang, k) => ({ id: `${lang}.listening.q${k}`, prompt: lang === 'ur' ? `سننے کا سوال ${k}؟` : `Listening question ${k}?` });

function story(task, lang, { correct, attempted, timeRemaining = 0, comp, review = [] }) {
  const m = timed(task, { correct, attempted, total: 60, timeRemaining, refs: (i) => `${lang}w${i + 1}` });
  m.comprehension = comp.map((r, k) => ({
    id: `${lang}.story.q${k + 1}`, prompt: lang === 'ur' ? `کہانی کا سوال ${k + 1}؟` : `Story question ${k + 1}?`,
    verdict: r.v, heard: r.heard || '', confidence: r.conf == null ? 0.95 : r.conf, reached: r.reached !== false, asked: r.asked !== false,
  }));
  m.score = { correct: m.comprehension.filter((r) => r.reached && r.asked && r.verdict === 'correct').length, of: comp.length, asked: m.comprehension.filter((r) => r.reached && r.asked).length };
  m.review = review;
  return m;
}

const sumRef = (op) => (i) => ({ a: 3 + i, b: 2 + (i % 5), answer: op === '+' ? 5 + i + (i % 5) : 1 + i - (i % 5) });

/**
 * One child, the brief's example (L39 brief §2):
 * Urdu "listening 4/6 · letters ≈57/min · made-up ≈12/min · words 20/min · story 29/min, answers 3 of 4 asked"
 * Maths "number ID 14/min · bigger 7/10 · missing 5/10 · + 9/min · − 6/min · harder + 3/5 · harder − 2/5 · problems 4/6"
 */
function child(o = {}) {
  const m = {
    'ur.listening': untimed('ur.listening', { verdicts: vs('ccwccn'), refs: (i) => q('ur', i + 1).id, review: [6], unsettled: [5] }),
    'ur.letters': timed('ur.letters', { correct: 57, attempted: 62, total: 100, refs: (i) => `ل${i}` }),
    'ur.nonwords': timed('ur.nonwords', { correct: 12, attempted: 15, total: 50 }),
    'ur.words': timed('ur.words', { correct: 20, attempted: 24, total: 50 }),
    'ur.story': story('ur.story', 'ur', { correct: 29, attempted: 33, comp: [{ v: 'correct' }, { v: 'correct' }, { v: 'correct' }, { v: 'wrong', conf: 0.5, heard: 'پانی' }, { v: 'none', reached: false, asked: false }, { v: 'none', reached: false, asked: false }], review: ['q:ur.story.q4'] }),
    'en.listening': untimed('en.listening', { verdicts: vs('cwwccn'), refs: (i) => q('en', i + 1).id, review: [6] }),
    'en.letters': timed('en.letters', { correct: 31, attempted: 36, total: 100 }),
    'en.nonwords': timed('en.nonwords', { correct: 6, attempted: 9, total: 50 }),
    'en.words': timed('en.words', { correct: 14, attempted: 18, total: 50 }),
    'en.story': story('en.story', 'en', { correct: 22, attempted: 25, comp: [{ v: 'correct' }, { v: 'wrong' }, { v: 'none', reached: false, asked: false }] }),
    'ma.number_id': timed('ma.number_id', { correct: 14, attempted: 16, total: 20, refs: (i) => String(10 + i * 7) }),
    'ma.discrimination': untimed('ma.discrimination', { verdicts: vs('ccnccwwccc'), refs: (i) => ({ a: 140 + i, b: 153 - i, answer: Math.max(140 + i, 153 - i) }), review: [3], unsettled: [2], heard: { 2: '' } }),
    'ma.missing': untimed('ma.missing', { verdicts: vs('cccwwccnww'), refs: (i) => ({ seq: [i + 1, i + 2, null, i + 4], answer: i + 3 }), review: [8], unsettled: [7] }),
    'ma.add1': timed('ma.add1', { correct: 9, attempted: 11, total: 20, refs: sumRef('+') }),
    'ma.sub1': timed('ma.sub1', { correct: 6, attempted: 9, total: 20, refs: sumRef('-') }),
    'ma.add2': untimed('ma.add2', { verdicts: vs('ccwcw'), refs: (i) => ({ a: 18 + i, b: 7 + i, answer: 25 + 2 * i }) }),
    'ma.sub2': untimed('ma.sub2', { verdicts: vs('cwcww'), refs: (i) => ({ a: 28 + i, b: 9 + i, answer: 19 }) }),
    'ma.word_problems': untimed('ma.word_problems', { verdicts: vs('cccwcn'), refs: (i) => ({ prompt_ur: `عبارتی سوال ${i + 1}`, prompt_en: `Word problem ${i + 1}`, answer: i + 2 }), review: [6], unsettled: [5] }),
  };
  return { ...m, ...o };
}

/** A child who could add nothing: add1 all wrong, so the coach skipped add2 (design §3 "Skipping"). */
function weakChild() {
  return child({
    'ma.add1': timed('ma.add1', { correct: 0, attempted: 6, total: 20, refs: sumRef('+') }),
    'ma.add2': { version: 'ai-marks-v3', task: 'ma.add2', quality: QUALITY['ma.add2'], skipped_by_coach: true, timed: null, score: null, stopped_by_rule: false, items: [], review: [], model_versions: {} },
  });
}

/** Nothing for the coach to review: every review[] emptied. */
function settledChild() {
  const m = child();
  for (const k of Object.keys(m)) m[k] = { ...m[k], review: [] };
  return m;
}

module.exports = { child, weakChild, settledChild, timed, untimed, story, QUALITY, TASKS: T.TASKS_V3 };
