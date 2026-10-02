'use strict';
const bank = require('./fixtures/item-bank.fixture.json');
const T = require('./fixtures/transcripts');
const { wordsFromTokens } = require('../../../bot/shared/services/child-test/scoring/text-norm');
const { findCueWindows, findPhrase } = require('../../../bot/shared/services/child-test/scoring/windows');

const form = bank.grades['3'].forms.A;
const words = (script) => wordsFromTokens(T.tokensFrom(script));

describe('child-test window cutter', () => {
  test('findPhrase locates a multi-word coach line by fuzzy order match', () => {
    const w = words(T.URDU_BLOCK);
    const hit = findPhrase(w, 'بلال کس کے ساتھ گیا', { after: 60 });
    expect(hit.start).toBeCloseTo(72.0, 1);
    expect(hit.speaker).toBe('1');
  });

  test('Urdu block: story is 60 s from the start cue, then questions, first sounds, made-up words', () => {
    const r = findCueWindows({ words: words(T.URDU_BLOCK), block: 'urdu', form, cue: bank.cue.urdu, durationSec: 112 });
    expect(r.missing).toEqual([]);
    expect(r.coachSpeaker).toBe('1');
    expect(r.windows.story.start).toBeCloseTo(4.4, 1);          // end of «شروع»
    expect(r.windows.story.end).toBeCloseTo(r.windows.story.start + 60, 1);
    expect(r.windows.questions.start).toBeCloseTo(72.0, 1);
    expect(r.windows.first_sounds.start).toBeGreaterThan(90);
    expect(r.windows.first_sounds.start).toBeLessThan(93);
    expect(r.windows.nonwords.start).toBeCloseTo(104.0, 1);
    expect(r.windows.nonwords.end).toBe(112);
    expect(r.flags).toEqual([]);
  });

  test('a missing start cue is reported as missing + no_cue_phrase', () => {
    const r = findCueWindows({ words: words(T.URDU_BLOCK_NO_CUE), block: 'urdu', form, cue: bank.cue.urdu, durationSec: 112 });
    expect(r.missing).toContain('story');
    expect(r.flags).toContain('no_cue_phrase');
    expect(r.windows.questions.start).toBeCloseTo(72.0, 1); // the rest is still cut from its own anchors
  });

  test('coach speech inside the timed minute raises prompting_during_timed_minute', () => {
    const r = findCueWindows({ words: words(T.URDU_BLOCK_PROMPTING), block: 'urdu', form, cue: bank.cue.urdu, durationSec: 112 });
    expect(r.flags).toContain('prompting_during_timed_minute');
  });

  test('maths block: numbers window, then a timed quick-sums minute from its cue, then the word problem', () => {
    const r = findCueWindows({ words: words(T.MATHS_BLOCK), block: 'maths', form, cue: bank.cue.maths, durationSec: 96 });
    expect(r.missing).toEqual([]);
    expect(r.windows.numbers.start).toBeLessThan(4);
    expect(r.windows.numbers.end).toBeCloseTo(16.0, 1);         // the quick-sums «شروع»
    expect(r.windows.quick_sums.start).toBeGreaterThan(16);
    expect(r.windows.quick_sums.end).toBeCloseTo(r.windows.quick_sums.start + 60, 1);
    expect(r.windows.word_problem.start).toBeCloseTo(82.0, 1);
  });

  test('timer_problem when the next section starts well before 60 s and the child was still reading', () => {
    const short = T.URDU_BLOCK.map((l) => (l[1] >= 70 ? [l[0], l[1] - 40, l[2]] : l));
    const r = findCueWindows({ words: words(short), block: 'urdu', form, cue: bank.cue.urdu, durationSec: 72 });
    expect(r.windows.story.end).toBeLessThan(31);
    expect(r.flags).toContain('timer_problem');
  });
});

describe('child-test window cutter — L1 cue shape (alt_start / alt_stop)', () => {
  const cueL1 = { start: 'اب شروع کریں', stop: 'بس، شکریہ', alt_start: ['شروع کریں', 'چلیں شروع کریں'], alt_stop: ['بس', 'شکریہ'] };

  test('an alternate start cue opens the timed minute when the main cue is not said', () => {
    const script = [[1, 1.0, 'بیٹا یہ کہانی پڑھیں چلیں شروع کریں'], ...T.URDU_BLOCK.slice(1)];
    const r = findCueWindows({ words: words(script), block: 'urdu', form, cue: cueL1, durationSec: 112 });
    expect(r.missing).not.toContain('story');
    expect(r.flags).not.toContain('no_cue_phrase');
    expect(r.windows.story.start).toBeGreaterThan(3);
    expect(r.windows.story.start).toBeLessThan(5);
  });

  test('a stop word said by the CHILD does not end the minute; the coach saying it does', () => {
    const base = [[1, 1.0, 'بیٹا یہ کہانی پڑھیں اب شروع کریں'], ...T.URDU_BLOCK.slice(1)];
    const childSaysBas = base.slice(0, 2).concat([[2, 15.0, 'بس']], base.slice(2));
    const r = findCueWindows({ words: words(childSaysBas), block: 'urdu', form, cue: cueL1, durationSec: 112 });
    expect(r.windows.story.end - r.windows.story.start).toBeCloseTo(60, 0);
    const coachSaysBas = base.slice(0, 3).concat([[1, 40.0, 'بس']], base.slice(3));
    const r2 = findCueWindows({ words: words(coachSaysBas), block: 'urdu', form, cue: cueL1, durationSec: 112 });
    expect(r2.windows.story.end).toBeCloseTo(40, 0);
  });
});
