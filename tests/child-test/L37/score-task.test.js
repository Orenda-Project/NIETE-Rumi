'use strict';
/**
 * L37 (bd-s1oo0.50.3, CONTRACT §21.5) — scoreTask: one scorer per v3 task kind → ai-marks-v3.
 * Only the network boundary is mocked: OpenRouter (openai SDK), Soniox (axios), ffmpeg (child_process).
 * The real dispatcher, scorers, cue matcher, story.js, comprehension.js and reach.js run.
 */

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  const fs = jest.requireActual('fs');
  return {
    ...actual,
    execFile: jest.fn((bin, args, opts, cb) => {
      if (args.includes('-hide_banner')) { const e = new Error('no output'); cb(e, '', '  Duration: 00:01:20.00, start: 0'); return; }
      global.__cuts = (global.__cuts || []).concat([[Number(args[args.indexOf('-ss') + 1]), Number(args[args.indexOf('-to') + 1])]]);
      fs.writeFileSync(args[args.length - 1], Buffer.from('clip'));
      cb(null, '', '');
    }),
  };
});
jest.mock('form-data', () => class FormData {
  append(_k, v) { if (v && typeof v.destroy === 'function') { v.on('error', () => {}); v.destroy(); } }
  getHeaders() { return { 'content-type': 'multipart/form-data' }; }
});
const mockCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a) => mockCreate(...a) } }, audio: { transcriptions: { create: jest.fn(async () => { throw new Error('whisper down'); }) } } })));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const H = require('./harness');
const bank = require('./fixtures/bank-v3');
const { scoreTask } = require('../../../bot/shared/services/child-test/scoring');
const C = require('../../../bot/shared/services/child-test/scoring/tasks/common');

const AUDIO = path.join(os.tmpdir(), 'l37-note.ogg');
fs.writeFileSync(AUDIO, 'OggS');
const media = (extra = {}) => ({ file: AUDIO, durationSec: 80, ...extra });
const spec = (task, grade = 3) => bank.getTaskSpec({ grade, set: 'A', task });
const prompts = () => mockCreate.mock.calls.map(([r]) => H.promptOf(r));

// coach (1) says the begin line at 2 s (its last word ends at 2.9 s); the child (2) answers after it
const BEGIN_UR = [1, 2.0, bank.BEGIN.ur];
const BEGIN_EN = [1, 2.0, bank.BEGIN.en];
const BEGIN_END = 2.9;

beforeEach(() => {
  jest.clearAllMocks();
  global.__cuts = [];
  process.env.SONIOX_API_KEY = 'test-soniox';
  process.env.OPENROUTER_API_KEY = 'test-or';
  delete process.env.SPEECHACE_API_KEY;
});

function route(map) {
  mockCreate.mockImplementation(async (req) => {
    const p = H.promptOf(req);
    for (const [needle, r] of map) if (p.includes(needle)) return typeof r === 'function' ? r(p, req) : r;
    throw new Error(`unrouted prompt: ${p.slice(0, 80)}`);
  });
}

describe('dispatch: every v3 task id has a scorer and returns ai-marks-v3', () => {
  test.each([
    ['ur.listening'], ['ur.letters'], ['ur.nonwords'], ['ur.words'], ['ur.story'],
    ['en.listening'], ['en.letters'], ['en.nonwords'], ['en.words'], ['en.story'],
    ['ma.number_id'], ['ma.discrimination'], ['ma.missing'], ['ma.add1'], ['ma.sub1'], ['ma.add2'], ['ma.sub2'], ['ma.word_problems'],
  ])('%s', async (task) => {
    const lang = task.startsWith('en') ? 'en' : 'ur';
    H.sonioxReturns(axios, [lang === 'en' ? BEGIN_EN : BEGIN_UR, [2, 4, 'one two three'], [1, 50, 'question'], [2, 52, 'answer']]);
    const s = spec(task);
    const n = (s.items || []).length;
    route([
      ['Work row by row', H.rows(Array(10).fill('cccccccccc'))],
      ['LETTER IDENTIFICATION', H.items(H.rep('c', 100))],
      ['reading aloud from a printed', H.words(H.rep('c', Math.max(n, 60)))],
      ['reading-comprehension', H.reply({ questions: s.questions ? s.questions.map((q) => ({ id: q.id, asked: true, answer: 'a', verdict: 'correct', confidence: 0.95 })) : [] })],
      ['LISTENING-comprehension', H.items(H.rep('c', 6))],
      ['', H.items(H.rep('c', n))],
    ]);
    const m = await scoreTask({ task, spec: s, media: media(), lang, grade: 3 });
    expect(m.version).toBe('ai-marks-v3');
    expect(m.task).toBe(task);
    expect(m.quality).toBe(s.quality);
    expect(typeof m.stopped_by_rule).toBe('boolean');
    expect(Array.isArray(m.items)).toBe(true);
    expect(Array.isArray(m.review)).toBe(true);
    expect(m.model_versions).toBeTruthy();
    if (s.timed_s) expect(m.timed).toBeTruthy(); else expect(m.timed).toBeNull();
    // untimed tasks carry a score; the story's score is its comprehension (§20), every other timed task has none
    if (!s.timed_s || task.endsWith('.story')) expect(m.score).toBeTruthy(); else expect(m.score).toBeNull();
    for (const it of m.items) {
      expect(Object.keys(it)).toEqual(expect.arrayContaining(['i', 'ref', 'verdict', 'heard', 'conf', 'settled']));
      expect(['correct', 'wrong', 'none', 'not_reached']).toContain(it.verdict);
    }
  });

  test('an unknown task id is refused without a model call', async () => {
    const r = await scoreTask({ task: 'ma.multiply', spec: {}, media: media(), lang: 'ur', grade: 3 });
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'bad_task' }));
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('timed tasks: the clock, attempted, correct, time remaining, rate (EGRA Toolkit §10.3)', () => {
  test('the 60-s clock starts at the begin line; the clip is cut from there; practice before it is ignored', async () => {
    H.sonioxReturns(axios, [[2, 0.5, 'practice one'], BEGIN_UR, [2, 4, 'one plus three four'], [2, 70, 'late']]);
    route([['ADDITION', H.items(H.rep('c', 12) + H.rep('w', 3) + H.rep('s', 5))]]);
    const m = await scoreTask({ task: 'ma.add1', spec: spec('ma.add1'), media: media(), lang: 'ur', grade: 3 });
    expect(m.timed.begin_at_s).toBeCloseTo(BEGIN_END, 1);
    expect(m.timed.clock).toBe('cue');
    expect(m.timed.seconds_given).toBe(60);
    expect(m.timed.end_at_s).toBeCloseTo(BEGIN_END + 60, 1);
    // 5 s of pre-roll (a late cue match must not cut off the child's first items), 2 s after the minute
    const [s, e] = global.__cuts[0];
    expect(s).toBeCloseTo(0, 1);                      // max(0, 2.9 − 5)
    expect(e).toBeCloseTo(BEGIN_END + 62, 1);
    expect(m.timed.attempted).toBe(15);
    expect(m.timed.correct).toBe(12);
    expect(m.timed.time_remaining).toBe(0);
    expect(m.timed.rate).toBe(12);
    expect(m.items.slice(15).every((x) => x.verdict === 'not_reached')).toBe(true);
    // the prompt carries the exact 20 sums with answers
    expect(prompts()[0]).toContain('1. 1+3 = 4');
    expect(prompts()[0]).toContain('20. 8+10 = 18');
  });

  test('a child who finishes early: time remaining from the last answer, rate = correct / (60 − remaining) × 60', async () => {
    // last child word starts at 40 s (its tokens end 40.4 s): 37.5 s used, 22.5 s remaining
    H.sonioxReturns(axios, [BEGIN_UR, [2, 4, 'four five'], [2, 40, '18'], [1, 44, 'بس شکریہ']]);
    route([['ADDITION', H.items(H.rep('c', 18) + H.rep('w', 2))]]);
    const m = await scoreTask({ task: 'ma.add1', spec: spec('ma.add1'), media: media(), lang: 'ur', grade: 3 });
    expect(m.timed.attempted).toBe(20);
    expect(m.timed.correct).toBe(18);
    expect(m.timed.time_remaining).toBeCloseTo(60 - (40.4 - BEGIN_END), 1);
    expect(m.timed.rate).toBeCloseTo(18 / (60 - m.timed.time_remaining) * 60, 1);
    expect(m.timed.rate).toBeGreaterThan(18);
  });

  test('no begin line: the clock starts at the first item response, flagged clock:inferred', async () => {
    H.sonioxReturns(axios, [[1, 1, 'چلو بیٹا'], [2, 5.0, 'two nine zero']]);
    route([['NUMBER IDENTIFICATION', H.items(H.rep('c', 10) + H.rep('s', 10))]]);
    const m = await scoreTask({ task: 'ma.number_id', spec: spec('ma.number_id'), media: media(), lang: 'ur', grade: 3 });
    expect(m.timed.clock).toBe('inferred');
    expect(m.timed.begin_at_s).toBeCloseTo(5.0, 1);
    expect(m.timed.correct).toBe(10);
    // EGMA: 3-digit numbers need "hundred" (سو)
    expect(prompts()[0]).toMatch(/hundred/i);
    expect(prompts()[0]).toContain('17. 245');
  });

  test('pre-roll is 5 s when the begin line is later in the note; an evaluation window overrides the cut', async () => {
    H.sonioxReturns(axios, [[1, 8.0, bank.BEGIN.ur], [2, 10, 'چار']]);
    route([['ADDITION', H.items(H.rep('c', 5) + H.rep('s', 15))]]);
    await scoreTask({ task: 'ma.add1', spec: spec('ma.add1'), media: media(), lang: 'ur', grade: 3 });
    expect(global.__cuts[0][0]).toBeCloseTo(8.9 - 5, 1);
    global.__cuts = [];
    await scoreTask({ task: 'ma.add1', spec: spec('ma.add1'), media: media({ window: { start: 1, end: 75 } }), lang: 'ur', grade: 3 });
    expect(global.__cuts[0]).toEqual([1, 75]);
  });

  test('rate formula is EGRA Toolkit §10.3 exactly', () => {
    expect(C.rate(30, 0)).toBe(30);
    expect(C.rate(30, 20)).toBe(45);
    expect(C.rate(0, 0)).toBe(0);
    expect(C.rate(10, 60)).toBe(0);
  });
});

describe('stop rules', () => {
  test('letters: nothing right in row 1 (10) and the child stopped there → stopped_by_rule, score 0', async () => {
    H.sonioxReturns(axios, [BEGIN_EN, [2, 4, 'a b c']]);
    route([
      ['Work row by row', H.rows(['wwwwwwwwww', 'cccsssssss', ...Array(8).fill('ssssssssss')])],
      ['LETTER IDENTIFICATION', H.items(H.rep('w', 10) + H.rep('c', 3) + H.rep('s', 87))],
    ]);
    const m = await scoreTask({ task: 'en.letters', spec: spec('en.letters'), media: media(), lang: 'en', grade: 3 });
    expect(m.stopped_by_rule).toBe(true);
    expect(m.timed.correct).toBe(0);
    expect(m.timed.rate).toBe(0);
    expect(m.items.slice(0, 10).every((x) => x.verdict === 'wrong')).toBe(true);
    expect(m.items.slice(10).every((x) => x.verdict === 'not_reached')).toBe(true);
  });

  test('letters: row 1 marked all wrong but the child read on (a full row right after it) → the coach did not stop them: no auto-stop, count flagged', async () => {
    // May re-measure, G3 child keyed 83: the grid prompt misjudged row 1 and the stop zeroed a reader
    H.sonioxReturns(axios, [BEGIN_EN, [2, 4, 'a b c']]);
    route([
      ['Work row by row', H.rows(['wwwwwwwwww', 'cccccccccc', 'ccccccssss', ...Array(7).fill('ssssssssss')])],
      ['LETTER IDENTIFICATION', H.items(H.rep('w', 10) + H.rep('c', 16) + H.rep('s', 74))],
    ]);
    const m = await scoreTask({ task: 'en.letters', spec: spec('en.letters'), media: media(), lang: 'en', grade: 3 });
    expect(m.stopped_by_rule).toBe(false);
    expect(m.timed.correct).toBe(16);
    expect(m.flags).toContain('first_row_unclear');
    expect(m.count_flag).toEqual(expect.objectContaining({ reason: expect.stringMatching(/first_row_unclear|prompts_disagree/) }));
  });

  test('words: one right in the first 5 → not stopped', async () => {
    H.sonioxReturns(axios, [BEGIN_UR, [2, 4, 'fw1 fw2']]);
    route([['reading aloud from a printed', H.words('wwwwc' + H.rep('c', 5) + H.rep('s', 40))]]);
    const m = await scoreTask({ task: 'ur.words', spec: spec('ur.words'), media: media(), lang: 'ur', grade: 3 });
    expect(m.stopped_by_rule).toBe(false);
    expect(m.timed.correct).toBe(6);
    expect(m.timed.attempted).toBe(10);
  });

  test('nonwords: nothing right in the first 5 → stopped', async () => {
    H.sonioxReturns(axios, [BEGIN_UR, [2, 4, 'x y']]);
    route([['reading aloud from a printed', H.words('wwwww' + 'cc' + H.rep('s', 43))]]);
    const m = await scoreTask({ task: 'ur.nonwords', spec: spec('ur.nonwords'), media: media(), lang: 'ur', grade: 3 });
    expect(m.stopped_by_rule).toBe(true);
    expect(m.timed.correct).toBe(0);
    expect(m.items[5].verdict).toBe('not_reached');
  });

  test('untimed EGMA: 4 consecutive errors stop the task; later items are not_reached (heard kept)', async () => {
    H.sonioxReturns(axios, [[1, 1, 'بڑا نمبر'], [2, 3, 'سات']]);
    route([['', H.items('cwnww' + 'ccccc')]]);
    const m = await scoreTask({ task: 'ma.discrimination', spec: spec('ma.discrimination'), media: media(), lang: 'ur', grade: 3 });
    expect(m.stopped_by_rule).toBe(true);
    expect(m.items.map((x) => x.verdict)).toEqual(['correct', 'wrong', 'none', 'wrong', 'wrong', ...Array(5).fill('not_reached')]);
    expect(m.items[6].after_stop).toBe(true);
    expect(m.score).toEqual({ correct: 1, of: 10, asked: 5 });
  });

  test('untimed EGMA: errors that are not consecutive do not stop it', () => {
    const r = C.applyConsecutiveStop(['wrong', 'wrong', 'wrong', 'correct', 'wrong', 'wrong', 'wrong', 'correct'].map((verdict) => ({ verdict })), 4);
    expect(r.stopped).toBe(false);
  });

  test('story: nothing right in line 1 → stopped_by_rule, count 0, no questions reached', async () => {
    H.sonioxReturns(axios, [BEGIN_UR, [2, 4, 'w1 w2'], [1, 70, 'بس شکریہ']]);
    route([
      ['reading aloud from a printed', H.words(H.rep('w', 10) + H.rep('c', 5) + H.rep('s', 45))],
      ['reading-comprehension', H.reply({ questions: [] })],
    ]);
    const m = await scoreTask({ task: 'ur.story', spec: spec('ur.story'), media: media(), lang: 'ur', grade: 3 });
    expect(m.stopped_by_rule).toBe(true);
    expect(m.timed.correct).toBe(0);
    expect(m.comprehension.every((q) => q.reached === false)).toBe(true);
  });
});

describe('story: story.js + comprehension with §20 reach, in the v3 shape', () => {
  test('reached questions are scored; the question beyond reach is excluded from the score and the review', async () => {
    H.sonioxReturns(axios, [BEGIN_UR, [2, 4, bank.STORY_TOKENS.slice(0, 25).join(' ')], [1, 66, 'بس شکریہ'], [1, 68, 'who went'], [2, 70, 'father'], [1, 72, 'where'], [2, 74, 'نہیں پتا']]);
    route([
      ['reading aloud from a printed', H.words(H.rep('c', 22) + 'w' + H.rep('s', 37))],
      ['reading-comprehension', H.reply({ questions: [
        { id: 'q1', asked: true, answer: 'father', verdict: 'correct', confidence: 0.95 },
        { id: 'q2', asked: true, answer: '', verdict: 'no_answer', confidence: 0.5 },
        { id: 'q3', asked: true, answer: 'hot', verdict: 'correct', confidence: 0.95 },
      ] })],
    ]);
    const m = await scoreTask({ task: 'ur.story', spec: spec('ur.story'), media: media(), lang: 'ur', grade: 3 });
    expect(m.timed.correct).toBe(22);
    expect(m.timed.attempted).toBe(23);
    expect(m.stopped_by_rule).toBe(false);
    expect(m.items).toHaveLength(60);
    expect(m.items[22].verdict).toBe('wrong');
    expect(m.items[30].verdict).toBe('not_reached');
    const byId = Object.fromEntries(m.comprehension.map((q) => [q.id, q]));
    expect(byId.q1).toEqual(expect.objectContaining({ verdict: 'correct', reached: true, asked: true }));
    expect(byId.q3.reached).toBe(false);
    expect(byId.q3.beyond_reach).toBe(true);
    expect(m.score).toEqual({ correct: 1, of: 3, asked: 2 });
    // review: the unsettled reached question, never the one beyond reach; Urdu ORF: coach confirms the count (R8 §4)
    expect(m.review).toEqual(['q:q2']);
    expect(m.count_flag).toEqual(expect.objectContaining({ reason: 'confirm_count' }));
  });
});

describe('untimed tasks: settled, review', () => {
  test('listening: the transcript grader with the questions and accepted answers (R8 arm "q")', async () => {
    H.sonioxReturns(axios, [[1, 1, 'A short story read aloud'], [1, 10, 'listening question 1'], [2, 12, 'answer 1']]);
    route([['LISTENING-comprehension', H.items('cwnscc', { conf: [0.95, 0.95, 0.5, 0.9, 0.85, 0.95] })]]);
    const m = await scoreTask({ task: 'ur.listening', spec: spec('ur.listening'), media: media(), lang: 'ur', grade: 3 });
    const p = prompts()[0];
    expect(p).toContain('listening question 1 -> answer 1');
    expect(p).toContain('TRANSCRIPT:');
    expect(H.hasAudio(mockCreate.mock.calls[0][0])).toBe(false);
    expect(m.items.map((x) => [x.verdict, x.settled])).toEqual([['correct', true], ['wrong', true], ['none', false], ['none', false], ['correct', true], ['correct', true]]);
    // Urdu listening (ai_review): unsettled or conf < 0.9
    expect(m.review).toEqual([3, 4, 5]);
    expect(m.score).toEqual({ correct: 3, of: 6, asked: 5 });
    expect(m.model_versions.comprehension).toBe('google/gemini-3-flash-preview');
  });

  test('maths untimed: Gemini audio with the items; unsettled items go to review', async () => {
    H.sonioxReturns(axios, [[1, 1, 'x']]);
    route([['', H.items('cncwn', { conf: 0.6 })]]);
    const m = await scoreTask({ task: 'ma.add2', spec: spec('ma.add2'), media: media(), lang: 'ur', grade: 3 });
    expect(H.hasAudio(mockCreate.mock.calls[0][0])).toBe(true);
    expect(prompts()[0]).toContain('4. 22+37 -> 59');
    expect(m.items.map((x) => x.settled)).toEqual([true, false, true, true, false]);
    expect(m.review).toEqual([2, 5]);
    expect(m.model_versions.counts).toBe('google/gemini-3.8-flash');
  });

  test('discrimination prompt says the child must SAY the bigger number (pointing is not scored)', async () => {
    H.sonioxReturns(axios, [[1, 1, 'x']]);
    route([['', H.items(H.rep('c', 10))]]);
    await scoreTask({ task: 'ma.discrimination', spec: spec('ma.discrimination'), media: media(), lang: 'ur', grade: 3 });
    expect(prompts()[0]).toMatch(/must SAY/);
    expect(prompts()[0]).toContain('6. Which is bigger: 146 or 153? -> 153');
  });

  test('missing number prompt shows the sequence with a blank', async () => {
    H.sonioxReturns(axios, [[1, 1, 'x']]);
    route([['', H.items(H.rep('c', 10))]]);
    await scoreTask({ task: 'ma.missing', spec: spec('ma.missing'), media: media(), lang: 'ur', grade: 3 });
    expect(prompts()[0]).toContain('1. 1, 2, __, 4 -> 3');
  });

  test('word problems: the problem text and answer are in the prompt', async () => {
    H.sonioxReturns(axios, [[1, 1, 'x']]);
    route([['', H.items(H.rep('c', 6))]]);
    const m = await scoreTask({ task: 'ma.word_problems', spec: spec('ma.word_problems'), media: media(), lang: 'ur', grade: 3 });
    expect(prompts()[0]).toContain('1. سوال 1 -> 2');
    expect(m.items[0].ref).toBe('wp1');
  });
});

describe('quality and review flags (R8 §4)', () => {
  test('en.letters: two prompt variants whose counts differ by more than 3 → the count is flagged', async () => {
    H.sonioxReturns(axios, [BEGIN_EN, [2, 4, 'a b c']]);
    route([
      ['Work row by row', H.rows(['cccccccccc', 'cccccccccc', 'cccccccccc', 'ccccssssss', ...Array(6).fill('ssssssssss')])],   // 34
      ['LETTER IDENTIFICATION', H.items(H.rep('c', 40) + H.rep('s', 60))],                                                     // 40
    ]);
    const m = await scoreTask({ task: 'en.letters', spec: spec('en.letters'), media: media(), lang: 'en', grade: 3 });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(m.timed.correct).toBe(40);
    expect(m.count_flag).toEqual({ reason: 'prompts_disagree', counts: [40, 34] });
    expect(m.review).toEqual([]);       // never per-letter flags
  });

  test('letters: the higher of the two prompt counts is the score (the model\'s failures are dropped rows; May re-measure)', async () => {
    H.sonioxReturns(axios, [BEGIN_EN, [2, 4, 'a b c']]);
    route([
      ['Work row by row', H.rows([...Array(4).fill('cccccccccc'), ...Array(6).fill('ssssssssss')])],      // 40
      ['LETTER IDENTIFICATION', H.items(H.rep('c', 30) + H.rep('s', 70))],                               // 30: a row dropped
    ]);
    const m = await scoreTask({ task: 'en.letters', spec: spec('en.letters'), media: media(), lang: 'en', grade: 3 });
    expect(m.timed.correct).toBe(40);
    expect(m.timed.attempted).toBe(40);
    expect(m.items[35].verdict).toBe('correct');
    expect(m.count_flag).toEqual({ reason: 'prompts_disagree', counts: [30, 40] });
    expect(m.second_opinion.map((x) => x.correct).sort()).toEqual([30, 40]);
  });

  test('en.letters: counts within 3 → no flag', async () => {
    H.sonioxReturns(axios, [BEGIN_EN, [2, 4, 'a b c']]);
    route([
      ['Work row by row', H.rows(['cccccccccc', 'cccccccccc', 'cccccccccc', 'cccccccsss', ...Array(6).fill('ssssssssss')])],   // 37
      ['LETTER IDENTIFICATION', H.items(H.rep('c', 40) + H.rep('s', 60))],
    ]);
    const m = await scoreTask({ task: 'en.letters', spec: spec('en.letters'), media: media(), lang: 'en', grade: 3 });
    expect(m.count_flag).toBeNull();
  });

  test('provisional tasks (ur.letters) are scored but never reviewed', async () => {
    H.sonioxReturns(axios, [BEGIN_UR, [2, 4, 'الف بے']]);
    route([
      ['Work row by row', H.rows(['cccccccccc', ...Array(9).fill('ssssssssss')])],
      ['LETTER IDENTIFICATION', H.items(H.rep('c', 30) + H.rep('n', 5) + H.rep('s', 65))],
    ]);
    const m = await scoreTask({ task: 'ur.letters', spec: spec('ur.letters'), media: media(), lang: 'ur', grade: 3 });
    expect(m.quality).toBe('provisional');
    expect(m.timed.correct).toBe(30);
    expect(m.review).toEqual([]);
    expect(m.count_flag).toBeNull();
    expect(m.flags).toContain('prompts_disagree');   // kept as a hidden audit
  });

  test('provisional untimed (en.listening): unsettled items are not sent to review', async () => {
    H.sonioxReturns(axios, [[1, 1, 'x']]);
    route([['LISTENING-comprehension', H.items('nnnccc')]]);
    const m = await scoreTask({ task: 'en.listening', spec: spec('en.listening'), media: media(), lang: 'en', grade: 3 });
    expect(m.review).toEqual([]);
  });

  test('ai tasks (add1) are not reviewed; a task the model cannot find is flagged', async () => {
    H.sonioxReturns(axios, [BEGIN_UR]);
    route([['ADDITION', H.items(H.rep('s', 20), { found: false })]]);
    const m = await scoreTask({ task: 'ma.add1', spec: spec('ma.add1'), media: media(), lang: 'ur', grade: 3 });
    expect(m.review).toEqual([]);
    expect(m.flags).toContain('task_not_found');
    expect(m.count_flag).toEqual({ reason: 'task_not_found' });
  });

  test('the bank quality is kept, never raised', async () => {
    const s = { ...spec('ma.add2'), quality: 'provisional' };
    H.sonioxReturns(axios, [[1, 1, 'x']]);
    route([['', H.items('nnnnn')]]);
    const m = await scoreTask({ task: 'ma.add2', spec: s, media: media(), lang: 'ur', grade: 3 });
    expect(m.quality).toBe('provisional');
    expect(m.review).toEqual([]);
  });
});

describe('skipped and gap tasks: no model call', () => {
  test('skipped by the coach', async () => {
    const m = await scoreTask({ task: 'ma.add2', spec: spec('ma.add2'), media: { skipped_by_coach: true }, lang: 'ur', grade: 3 });
    expect(m).toEqual(expect.objectContaining({ version: 'ai-marks-v3', task: 'ma.add2', skipped_by_coach: true, timed: null, score: null, items: [], review: [] }));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('a gap slot in the bank', async () => {
    const m = await scoreTask({ task: 'ur.nonwords', spec: { gap: true, reason: 'no official Urdu list' }, media: media(), lang: 'ur', grade: 3 });
    expect(m).toEqual(expect.objectContaining({ version: 'ai-marks-v3', skipped_by_coach: true, gap: true }));
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('item wording from the bank', () => {
  test('a fluency card that mixes + and − is named ADDITION AND SUBTRACTION (as the May RWP card)', async () => {
    H.sonioxReturns(axios, [BEGIN_UR, [2, 4, 'چار']]);
    const s = { ...spec('ma.add1'), items: [...spec('ma.add1').items.slice(0, 10), ...spec('ma.sub1').items.slice(0, 10)] };
    route([['', H.items(H.rep('c', 20))]]);
    await scoreTask({ task: 'ma.add1', spec: s, media: media(), lang: 'ur', grade: 3 });
    expect(prompts()[0]).toContain('timed EGMA ADDITION AND SUBTRACTION (level 1)');
    expect(prompts()[0]).toContain('11. 4-3 = 1');
  });

  test('an untimed item with printed text is asked in that wording; a mixed card gets the generic header', async () => {
    H.sonioxReturns(axios, [[1, 1, 'x']]);
    const s = { ...spec('ma.discrimination'), mixed: true, items: [{ id: 'identify_1a', text: 'Choose the larger number: 11 or 16', answer: '16' }, { id: 'identify_1b', text: 'What number comes next? 10, 12, 14, 16 __', answer: '18' }] };
    route([['', H.items('cc')]]);
    await scoreTask({ task: 'ma.discrimination', spec: s, media: media(), lang: 'ur', grade: 3 });
    expect(prompts()[0]).toContain('1. Choose the larger number: 11 or 16 -> 16');
    expect(prompts()[0]).toContain('is doing an EGMA maths task with');
  });
});
