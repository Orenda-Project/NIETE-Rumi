'use strict';
/**
 * Child test L24 (bd-s1oo0.42), CR-3 — the story minute is not cut short while the child reads.
 *
 * L23 scored all 185 May 2026 study children and found 24 of 370 reading blocks whose story minute
 * ended while the enumerator's timing shows the child still reading (golive/lanes/L23/short_minutes.json):
 *   - 14: the first question's TEXT, used as an anchor when the questions cue is not heard, matched
 *     the child's own reading of the passage (a question shares words with its story);
 *   - 10: the fallback labeller placed a later section inside the minute and reconcileWindows trimmed
 *     the story to it (7 with the cue minute a full 60 s, 3 where a stop cue had ended it later).
 *
 * The rule: inside the timed minute (start .. start + 60 s) neither the question-prompt anchor nor a
 * labeller section may end the story, unless a stop cue was heard first (or the child read the
 * passage's last word, so the minute was over). The cue phrases themselves still end it.
 *
 * The shapes below are L23's real blocks, by id: the cue times, where the question anchor matched, where
 * the labeller put each section, the note's length. Times and positions only, no child's words: the
 * transcripts here are built from the item bank's own text.
 */

const itemBank = require('../../../bot/shared/services/child-test/item-bank');
const { clean } = require('../../../bot/shared/services/child-test/scoring/text-norm');
const { findCueWindows, reconcileWindows } = require('../../../bot/shared/services/child-test/scoring/windows');

const COACH = '1'; const CHILD = '2';
const say = (speaker, start, text, gap = 0.4) => String(text).split(/\s+/).filter(Boolean)
  .map((raw, k) => ({ w: clean(raw), raw, start: start + k * gap, end: start + k * gap + 0.3, speaker }));

/**
 * A block in L23's shape: the coach's start cue ending at `cueEnd`; the child reading the passage one
 * word a second from just after it; at `matchAt` the child says words that match question 1 (as the
 * real reading did); the reading runs on to the end of the minute; the coach reads question 1 at
 * minute + 6 s. No questions cue and no stop cue, as in the May recordings.
 */
function readingBlock({ block, grade, cueStart, cueEnd, matchAt, extra = [] }) {
  const spec = itemBank.getForm(grade, 'A')[block];
  const cue = itemBank.cue[block];
  const q1 = spec.questions[0].prompt;
  const tokens = spec.story.tokens;
  const cueWords = String(cue.start).split(/\s+/);
  const words = say(COACH, cueStart, cue.start, Math.max(0.05, (cueEnd - 0.3 - cueStart) / Math.max(1, cueWords.length - 1)));
  let t = cueEnd + 0.4; let k = 0;
  const minuteEnd = cueEnd + 60;
  let matched = false;
  while (t < minuteEnd + 1 && k < tokens.length - 1) {     // never the passage's last word: the child is still reading
    if (!matched && t >= matchAt) { words.push(...say(CHILD, matchAt, q1)); t = matchAt + q1.split(/\s+/).length * 0.4 + 0.6; matched = true; continue; }
    words.push(...say(CHILD, t, tokens[k])); k += 1; t += 1.0;
  }
  words.push(...say(COACH, minuteEnd + 6, q1));
  words.push(...extra);
  words.sort((a, b) => a.start - b.start);
  return { words, spec, cue, q1At: minuteEnd + 6 };
}

// [id, block, bank grade, start-cue start, start-cue end, question anchor matched at, note seconds]
const QUESTION_ANCHOR_INSIDE = [
  ['AA_05ebc0d7', 'urdu', 3, 0, 0.9, 24.2, 106.5],
  ['AA_0d43f0f6', 'english', 3, 0.1, 1.1, 23.3, 102.8],
  ['AA_271887cf', 'english', 3, 0.1, 1, 12.2, 105.1],
  ['AA_284e5d4b', 'english', 5, 0.2, 1.2, 14.3, 112.6],
  ['AA_7e0f11d6', 'english', 3, 0.2, 1.2, 7.3, 115.3],
  ['AA_977bf4d2', 'english', 5, 0.1, 1, 9.6, 108.6],
  ['AA_aaf90938', 'urdu', 5, 0.2, 1, 22, 92.2],
  ['AA_b11dfafb', 'urdu', 3, 0, 0.9, 43.8, 115.5],
  ['AA_bf842fbd', 'urdu', 3, 0, 0.9, 40, 115.5],
  ['AA_d897830f', 'english', 3, 0.2, 1.2, 6.3, 92.1],
  ['AA_de08d551', 'english', 3, 0.2, 1.2, 9.1, 101.1],
  ['AA_e754feee', 'english', 3, 0.1, 1, 8, 109.6],
  ['AA_eaf07843', 'english', 3, 0.2, 1.2, 10.5, 122.6],
  ['AA_eb788e8a', 'english', 3, 0.1, 1, 14.7, 106.7],
];

describe('CR-3a: a question\'s text heard inside the minute does not end the story', () => {
  test.each(QUESTION_ANCHOR_INSIDE)('%s (%s): the minute runs 60 s and the questions start at the coach\'s question',
    (id, block, grade, cueStart, cueEnd, matchAt, durationSec) => {
      const { words, spec, cue, q1At } = readingBlock({ block, grade, cueStart, cueEnd, matchAt });
      const r = findCueWindows({ words, block, form: { [block]: spec }, cue, durationSec });
      expect(r.windows.story.start).toBeCloseTo(cueEnd, 1);
      expect(r.windows.story.end).toBeCloseTo(cueEnd + 60, 1);
      expect(r.anchors.questions.start).toBeCloseTo(q1At, 1);
      expect(r.flags).not.toContain('timer_problem');
    });

  test('a stop cue heard before the match: the match stands and the story ends at the stop cue', () => {
    const block = 'english';
    const cue = itemBank.cue[block];
    const stop = say(COACH, 30, cue.stop);
    const { words, spec } = readingBlock({ block, grade: 3, cueStart: 0.1, cueEnd: 1.1, matchAt: 33, extra: stop });
    // the child's reading after the stop cue is not reading any more: drop it, as a coach would stop the child
    const cut = words.filter((w) => !(w.speaker === CHILD && w.start > 30 && w.start < 33));
    const r = findCueWindows({ words: cut, block, form: { [block]: spec }, cue, durationSec: 110 });
    expect(r.windows.story.end).toBeCloseTo(30, 1);
    expect(r.anchors.questions.start).toBeCloseTo(33, 1);
  });

  test('the child read the passage\'s last word: the minute is over, and the coach\'s question 1 inside it stands', () => {
    const block = 'english'; const grade = 3;
    const spec = itemBank.getForm(grade, 'A')[block];
    const cue = itemBank.cue[block];
    const words = [...say(COACH, 0.1, cue.start), ...spec.story.tokens.flatMap((tok, k) => say(CHILD, 1.5 + k * 0.5, tok)),
      ...say(COACH, 33, spec.questions[0].prompt)];
    const r = findCueWindows({ words, block, form: { [block]: spec }, cue, durationSec: 80 });
    expect(r.anchors.questions.start).toBeCloseTo(33, 1);
    expect(r.windows.story.end).toBeCloseTo(33, 1);
  });

  test('the child finished the passage, then talk before question 1 (28 fluent L23 readers): question 1 stands', () => {
    const block = 'urdu'; const grade = 3;
    const spec = itemBank.getForm(grade, 'A')[block];
    const cue = itemBank.cue[block];
    // the whole passage in 36 s, then 15 words of other talk (taken from the passage's opening, so nothing new), then question 1
    const chatter = spec.story.tokens.slice(0, 15).join(' ');
    const words = [...say(COACH, 0, cue.start), ...spec.story.tokens.flatMap((tok, k) => say(CHILD, 1.5 + k * 0.6, tok)),
      ...say('3', 38, chatter), ...say('3', 46, spec.questions[0].prompt)];
    const r = findCueWindows({ words, block, form: { [block]: spec }, cue, durationSec: 90 });
    expect(r.anchors.questions.start).toBeCloseTo(46, 1);
  });

  test('the questions CUE said inside the minute still ends the story (only the text-match is held back)', () => {
    const block = 'english';
    const cue = itemBank.cue[block];
    const { words, spec } = readingBlock({ block, grade: 3, cueStart: 0.1, cueEnd: 1.1, matchAt: 200, extra: say(COACH, 40, cue.questions) });
    const r = findCueWindows({ words: words.filter((w) => !(w.speaker === CHILD && w.start >= 40 && w.start < 44)), block, form: { [block]: spec }, cue, durationSec: 110 });
    expect(r.anchors.questions.start).toBeCloseTo(40, 1);
    expect(r.windows.story.end).toBeCloseTo(40, 1);
  });
});

// [id, block, story window from the cues {start, end, sectionEnd}, labeller sections {name: [start, end]}, note seconds]
const LABELLER_INSIDE = [
  ['AA_0b2fc30d', 'urdu', { start: 0.9, end: 60.9, sectionEnd: 114.7 }, { questions: [70, 114.7], nonwords: [3, 114.7] }, 114.7],
  ['AA_2d306c3b', 'urdu', { start: 0.9, end: 60.9, sectionEnd: 86.5 }, { questions: [2, 86.5] }, 86.5],
  ['AA_3b6b6972', 'urdu', { start: 0.9, end: 60.9, sectionEnd: 64.5 }, { nonwords: [32, 115.5] }, 115.5],
  ['AA_51a660bb', 'urdu', { start: 0.9, end: 60.9, sectionEnd: 86.2 }, { questions: [40, 86.2] }, 86.2],
  ['AA_86da0dbc', 'urdu', { start: 1, end: 61, sectionEnd: 112.8 }, { questions: [26, 112.8] }, 112.8],
  ['AA_94917b5c', 'urdu', { start: 1, end: 61, sectionEnd: 94.3 }, { questions: [63, 112.4], nonwords: [9, 112.4] }, 112.4],
  ['AA_fb785d2a', 'english', { start: 1.1, end: 61.1, sectionEnd: 109.8 }, { questions: [45, 109.8] }, 109.8],
  // the stop cue had already ended the minute; the labeller's section inside it must not cut it further
  ['AA_52be51a8', 'urdu', { start: 1, end: 27.9, sectionEnd: 29.1 }, { nonwords: [3, 29.1] }, 29.1],
  ['AA_b68b3349', 'english', { start: 1.2, end: 38.5, sectionEnd: 39.1 }, { nonwords: [3, 39.1] }, 39.1],
  ['AA_ece27ef7', 'urdu', { start: 1, end: 32.8, sectionEnd: 34.1 }, { nonwords: [5, 34.1] }, 34.1],
];

describe('CR-3b: a labeller section inside the minute does not trim the story', () => {
  test.each(LABELLER_INSIDE)('%s (%s): the story keeps the end its cues gave it', (id, block, story, labelled, durationSec) => {
    const windows = { story: { ...story } };
    for (const [s, [a, b]] of Object.entries(labelled)) windows[s] = { start: a, end: b, source: 'labeller' };
    if (id === 'AA_3b6b6972') windows.questions = { start: 64.5, end: 115.5 };     // its questions anchor, found after the minute
    reconcileWindows(block, windows, durationSec);
    expect(windows.story.end).toBeCloseTo(story.end, 5);
    expect(windows.story.sectionEnd).toBeGreaterThanOrEqual(windows.story.end);   // the fallback window is never shorter than the minute
  });

  test('a section found by its cue inside the minute still ends the story', () => {
    const windows = { story: { start: 1, end: 61, sectionEnd: 90 }, questions: { start: 40, end: 90 } };
    reconcileWindows('english', windows, 90);
    expect(windows.story.end).toBe(40);
  });

  test('a labeller section after the minute still bounds the section end (the fallback window)', () => {
    const windows = { story: { start: 1, end: 61, sectionEnd: 110 }, questions: { start: 75, end: 110, source: 'labeller' } };
    reconcileWindows('urdu', windows, 110);
    expect(windows.story.end).toBe(61);
    expect(windows.story.sectionEnd).toBe(75);
  });

  test('quick sums keep today\'s rule (CR-3 is about the story minute)', () => {
    const windows = { numbers: { start: 0, end: 20 }, quick_sums: { start: 20, end: 80, sectionEnd: 100 }, word_problem: { start: 50, end: 100, source: 'labeller' } };
    reconcileWindows('maths', windows, 100);
    expect(windows.quick_sums.end).toBe(50);
  });
});
