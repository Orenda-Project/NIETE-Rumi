'use strict';
/**
 * selectRoundItems(questions, { studentId }) — the hook shuffle's sitting seam calls for an evening round: the 5 lesson
 * items + the 2 recall items whose originals THIS child missed (else the class's most-missed). Pure: the children who
 * missed each original ride on the item as one-way keys, so the seam needs no read. Anything that is not a round comes
 * back as the same array (today's quizzes untouched). Also: the round's events from its served set, and the reading
 * mark's two homes (media.self_read; media.web.read.self on a web item).
 */
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { logEvent } = require('../../shared/utils/structured-logger');
const Round = require('../../shared/services/quiz/web-quiz-evening-round');
const Recall = require('../../shared/services/quiz/web-quiz-evening-round-recall');

const KEY = 'c1a55000-0000-4000-8000-0000000000e1|2026-11-24';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const ALI = 'c0000001-0000-4000-8000-0000000000e2';
const SANA = 'c0000001-0000-4000-8000-0000000000e3';
const REF = { cl: 'K7Q2MXTRAB', rc: 'RND234' };
const lesson = (n) => ({ id: `L${n}`, sort_order: n, external_id: `tq:q:S1:${n}`, question_text: `Lesson ${n}`, media: { round: 'lesson', round_key: KEY, round_ref: REF } });
const recall = (rank, kids) => ({
  id: `R${rank}`, sort_order: 100 + rank, external_id: `tq:rc${rank}:recall:x`, question_text: `Recall ${rank}`,
  media: { round: 'recall', round_key: KEY, round_ref: REF, recall: { of: `O${rank}`, rank, kids: kids.map((k) => Recall.kidKey(KEY, k)), chips: [] } },
});
const ROUND = [...[1, 2, 3, 4, 5, 6, 7, 8].map(lesson), recall(1, [ZARA, ALI]), recall(2, [ZARA]), recall(3, [ALI]), recall(4, [SANA]), recall(5, [SANA]), recall(6, [])];

test('a quiz that is not a round comes back as the SAME array, untouched', () => {
  const plain = [{ id: 'a', sort_order: 1 }, { id: 'b', sort_order: 2, media: { figure: {} } }];
  expect(Round.selectRoundItems(plain, { studentId: ZARA })).toBe(plain);
  expect(Round.selectRoundItems([], {})).toEqual([]);
  expect(Round.selectRoundItems(null, {})).toBe(null);
});

test('each child: the first 5 lesson items, then the 2 recall items whose originals THIS child missed', () => {
  const ids = (kid) => Round.selectRoundItems(ROUND, { studentId: kid }).map((q) => q.id);
  expect(ids(ZARA)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'R1', 'R2']);
  expect(ids(ALI)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'R1', 'R3']);
  expect(ids(SANA)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'R4', 'R5']);
});

test('a child who missed nothing (or an unnamed sitting) gets the class\'s two most-missed', () => {
  const ids = (who) => Round.selectRoundItems(ROUND, who).map((q) => q.id);
  expect(ids({ studentId: 'c0000001-0000-4000-8000-0000000000ff' })).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'R1', 'R2']);
  expect(ids({})).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'R1', 'R2']);
});

test('a child who missed one original: theirs first, then the class\'s most-missed of the rest', () => {
  const pool = [...ROUND.slice(0, 8), recall(1, [ZARA]), recall(2, [ALI]), recall(3, [SANA])];
  expect(Round.selectRoundItems(pool, { studentId: SANA }).map((q) => q.id).slice(5)).toEqual(['R3', 'R1']);
});

test('no recall pool (nothing missed 2-3 days ago): the 5 lesson items alone', () => {
  expect(Round.selectRoundItems(ROUND.slice(0, 8), { studentId: ZARA }).map((q) => q.id)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5']);
});

test('the same child gets the same set at start, answers and finish (deterministic, order of the input irrelevant)', () => {
  const a = Round.selectRoundItems(ROUND, { studentId: ALI }).map((q) => q.id);
  const b = Round.selectRoundItems([...ROUND].reverse(), { studentId: ALI }).map((q) => q.id);
  expect(b).toEqual(a);
});

test('the page chip on the round\'s code picks like the id (k)', () => {
  const pool = [...ROUND.slice(0, 8), { ...recall(1, []), media: { ...recall(1, []).media, recall: { of: 'O1', rank: 1, kids: [], chips: ['abcd'] } } }, recall(2, []), recall(3, [])];
  pool[10].media.recall.chips = ['chip-k'];
  expect(Round.selectRoundItems(pool, { k: 'chip-k' }).map((q) => q.id).slice(5)).toEqual(['R3', 'R1']);
});

test('round_started / round_done carry the link code, the round code, the counts — no name, no id', () => {
  const set = Round.selectRoundItems(ROUND, { studentId: ZARA });
  expect(Round.noteRound('started', set)).toBe(true);
  expect(Round.noteRound('done', set)).toBe(true);
  expect(logEvent).toHaveBeenCalledWith('web_quiz.round_started', { class_link_code: 'K7Q2MXTRAB', round_code: 'RND234', n_items: 7, n_recall: 2 });
  expect(logEvent).toHaveBeenCalledWith('web_quiz.round_done', { class_link_code: 'K7Q2MXTRAB', round_code: 'RND234', n_items: 7, n_recall: 2 });
  expect(Round.noteRound('done', [{ id: 'x' }])).toBe(false);
});

describe('reading items: shown, not spoken', () => {
  test('a language item that asks the child to read is a reading item; maths and plain vocabulary are not', () => {
    expect(Recall.isReadingItem({ question_text: 'Read the sentence: "The cat sat on the mat." Where did the cat sit?' }, 'english')).toBe(true);
    expect(Recall.isReadingItem({ question_text: 'یہ جملہ پڑھیں: «بلی چھت پر بیٹھی ہے۔» بلی کہاں ہے؟' }, 'urdu')).toBe(true);
    expect(Recall.isReadingItem({ question_text: 'What is "the big red ball game" about?' }, 'english')).toBe(true);
    expect(Recall.isReadingItem({ question_text: 'Which word is a colour?' }, 'english')).toBe(false);
    expect(Recall.isReadingItem({ question_text: 'Read the number: 24 + 3?' }, 'maths')).toBe(false);
  });
  test('markReading: media.self_read, and on a web item media.web.read.self (the page\'s read.self)', () => {
    const plain = Recall.markReading({ question_text: 'x', media: {} });
    expect(plain.media.self_read).toBe(true);
    const web = Recall.markReading({ question_text: 'x', media: { web: { v: 2, type: 'single', read: { stem: 'x', opts: ['a'] } } } });
    expect(web.media.web.read).toEqual({ stem: 'x', opts: ['a'], self: true });
  });
  test('a recall item as a web item carries read.self only when it is a reading item', () => {
    const r = Round.asWebItem({ question_text: 'Q', option_a: 'a', option_b: 'b', correct_option: 'A', explanation: 'why', media: { self_read: true } });
    expect(r.media.web).toMatchObject({ v: 2, type: 'single', key: 'A', read: { self: true } });
    expect(Round.asWebItem({ question_text: 'Q', option_a: 'a', option_b: 'b', correct_option: 'A', media: {} }).media.web.read.self).toBeUndefined();
  });
});

describe('the recall rewrite: never the same item', () => {
  const orig = { question: { id: 'O1', question_text: 'Which word is a colour?', option_a: 'red', option_b: 'run', correct_option: 'A' }, quiz: { subject: 'english', grade: '3' }, missedBy: [ZARA], n: 1 };
  test('a reply that repeats the original stem, has a bad key, duplicate options or a picture is dropped alone', () => {
    expect(Recall.checkItem({ question: 'Which word is a colour?', options: ['blue', 'sit'], correct: 'A' }, orig)).toBeNull();
    expect(Recall.checkItem({ question: 'Pick the colour.', options: ['blue', 'sit'], correct: 'C' }, orig)).toBeNull();
    expect(Recall.checkItem({ question: 'Pick the colour.', options: ['blue', 'blue'], correct: 'A' }, orig)).toBeNull();
    expect(Recall.checkItem({ question: 'Look at the picture: which is blue?', options: ['sky', 'sit'], correct: 'A' }, orig)).toBeNull();
    expect(Recall.checkItem({ question: 'Pick the colour word.', options: ['blue', 'sit', 'cup'], correct: 'A', explanation: 'Blue is a colour.' }, orig))
      .toEqual({ question: 'Pick the colour word.', options: ['blue', 'sit', 'cup'], correct: 'A', explanation: 'Blue is a colour.', reading: false });
  });
  test('one call for the whole pool; a failed call is no items (the round still goes out)', async () => {
    const complete = jest.fn().mockResolvedValue({ json: { items: [{ i: 0, question: 'Pick the colour word.', options: ['blue', 'sit'], correct: 'A' }] }, costUsd: 0.001, model: 'm' });
    const r = await Recall.rewrite({ originals: [orig, { ...orig, question: { ...orig.question, id: 'O2' } }], language: 'en', complete });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(r.items).toHaveLength(1);
    expect(r.dropped).toBe(1);
    const bad = await Recall.rewrite({ originals: [orig], complete: jest.fn().mockRejectedValue(new Error('down')) });
    expect(bad.items).toEqual([]);
  });
  test('the Urdu prompt asks for Nastaliq and Urdu digits', () => {
    expect(Recall.buildPrompt([orig], 'ur')).toMatch(/Nastaliq/);
    expect(Recall.buildPrompt([orig], 'ur')).toMatch(/۰۱۲۳/);
  });
});
