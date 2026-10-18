'use strict';
/**
 * The replay slice (story-replay.js): one sentence or one word of a page, as a time slice of the page's own take,
 * read from the page's timing record (pNN.json). Records here are invented; nothing is fetched or played.
 */
const { replaySlice } = require('../../../shared/services/quiz/story-replay');

const at = (ts) => ts.map(([t, s, e], i) => ({ i, t, s_ms: s, e_ms: e }));
const EN = { n: 1, lang: 'en', audio: { url: 'take-1a2b3c4d.ogg', ms: 5200 },
  words: at([['The', 200, 380], ['sun', 420, 700], ['is', 760, 880], ['up.', 900, 1300], ['"Wake', 1700, 2000], ['up!"', 2050, 2400], ['said', 2500, 2800], ['the', 2850, 2950], ['bird', 3000, 3500]]) };
const UR = { n: 2, lang: 'ur', audio: { url: 'take-ur.ogg', ms: 4000 }, words: at([['بارش', 200, 700], ['ہوئی۔', 760, 1300], ['سب', 1600, 1900], ['خوش؟', 1950, 2600]]) };

test('a sentence: from its first word\'s start to its last word\'s end, in the same take', () => {
  expect(replaySlice(EN, { sentence: 0 })).toEqual({ clip: 'take-1a2b3c4d.ogg', s_ms: 200, e_ms: 1300 });
  // a closing quote after the stop still ends the sentence; the last sentence needs no stop
  expect(replaySlice(EN, { sentence: 1 })).toEqual({ clip: 'take-1a2b3c4d.ogg', s_ms: 1700, e_ms: 2400 });
  expect(replaySlice(EN, { sentence: 2 })).toEqual({ clip: 'take-1a2b3c4d.ogg', s_ms: 2500, e_ms: 3500 });
  expect(replaySlice(UR, { sentence: 0 })).toEqual({ clip: 'take-ur.ogg', s_ms: 200, e_ms: 1300 });
  expect(replaySlice(UR, { sentence: 1 })).toEqual({ clip: 'take-ur.ogg', s_ms: 1600, e_ms: 2600 });
});

test('a word: its own start and end, found by its index i', () => {
  expect(replaySlice(EN, { word: 1 })).toEqual({ clip: 'take-1a2b3c4d.ogg', s_ms: 420, e_ms: 700 });
  const shuffled = { ...EN, words: [...EN.words].reverse() };
  expect(replaySlice(shuffled, { word: 8 })).toEqual({ clip: 'take-1a2b3c4d.ogg', s_ms: 3000, e_ms: 3500 });
  expect(replaySlice({ ...EN, audio: { key: 'story/x/a01.ogg' } }, { word: 0 })).toEqual({ clip: 'story/x/a01.ogg', s_ms: 200, e_ms: 380 });
});

test('nothing to play gives null: no such sentence or word, no clip, broken times, or no index', () => {
  expect(replaySlice(EN, { sentence: 3 })).toBeNull();
  expect(replaySlice(EN, { sentence: -1 })).toBeNull();
  expect(replaySlice(EN, { word: 9 })).toBeNull();
  expect(replaySlice(EN, { word: 1.5 })).toBeNull();
  expect(replaySlice(EN, {})).toBeNull();
  expect(replaySlice(EN)).toBeNull();
  expect(replaySlice(null, { word: 0 })).toBeNull();
  expect(replaySlice({ ...EN, audio: {} }, { word: 0 })).toBeNull();
  expect(replaySlice({ ...EN, words: at([['Up.', 900, 300]]) }, { word: 0 })).toBeNull();
  expect(replaySlice({ ...EN, words: [{ i: 0, t: 'Up.' }] }, { sentence: 0 })).toBeNull();
});
