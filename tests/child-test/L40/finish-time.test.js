/**
 * bd-s1oo0.50.11, from v3 sandbox e2e run 3 (drop 13): the strong child read all 60 Urdu story words and
 * stopped about 14 s early (key: time_remaining 14.0, 65 words/min). Diarization put most of the reading on
 * the coach's speaker, so "the child's last word" (speaker-based) came at ~20 s: time_remaining 42.7 and a
 * rate of 183.8 per minute on the coach's results. A finished child's end is where the LAST WORDS OF THE
 * PASSAGE are heard; speaker labels are only the fallback.
 */
const { clean } = require('../../../bot/shared/services/child-test/scoring/text-norm');
const C = require('../../../bot/shared/services/child-test/scoring/tasks/common');

const say = (text, start, step, speaker) => text.split(/\s+/).filter(Boolean).map((raw, k) => ({
  w: clean(raw), raw, start: start + k * step, end: start + k * step + 0.25, speaker,
}));

test('a finished reader: the end is the passage\'s last words, not the last word on the "child" speaker', () => {
  const passage = Array.from({ length: 60 }, (_, k) => `لفظ${k}`);
  const rows = passage.map((ref, i) => ({ i: i + 1, ref, verdict: 'correct' }));
  const begin = 2.5;
  // child reads 60 words from 3.0 s to 46.6 s; diarization gives the first 12 to speaker 2, the rest to the coach's speaker 1
  const reading = [...say(passage.slice(0, 12).join(' '), 3, 0.74, '2'), ...say(passage.slice(12).join(' '), 3 + 12 * 0.74, 0.74, '1')];
  const words = [...say('شروع کریں', 1.5, 0.5, '1'), ...reading, ...say('بس شکریہ', 62, 0.4, '1')];
  const s = C.timedSummary({ rows, clock: { begin_at_s: begin, clock: 'cue', coachSpeaker: '1' }, words, durationSec: 64, stopped: false });
  const lastEnd = reading[reading.length - 1].end;
  expect(s.time_remaining).toBeCloseTo(60 - (lastEnd - begin), 0);
  expect(s.rate).toBeGreaterThan(60);
  expect(s.rate).toBeLessThan(90);
});

test('the ending not heard: the speaker-based fallback still applies', () => {
  const rows = ['a', 'b', 'c'].map((ref, i) => ({ i: i + 1, ref, verdict: 'correct' }));
  const words = [...say('go', 1, 0.4, '1'), ...say('x y z', 3, 1, '2')];
  const s = C.timedSummary({ rows, clock: { begin_at_s: 1.5, clock: 'cue', coachSpeaker: '1' }, words, durationSec: 64, stopped: false });
  expect(s.time_remaining).toBeGreaterThan(0);
});
