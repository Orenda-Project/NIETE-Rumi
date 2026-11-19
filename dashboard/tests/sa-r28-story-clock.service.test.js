'use strict';
/**
 * Round 28 E-3 (sa_r28_story_clock; the engine reads opts.story_clock, from battery.ui.r28_story_clock): the story's
 * clock stops at Done (the recorder stops there), not at the last-word tap. Today the last-word screen (coach-led: up
 * to 30 s of hint polling) counts as reading time. With the option, time_used_ms ends at Done; elapsed_ms stays the
 * real elapsed. The time-up path is unchanged either way. Without the option the result is as before.
 */
const core = require('../sa/sa-core');

const STORY = () => ({
  id: 'en.story_w3', subtask: 'oral_reading_fluency', lang: 'en', response: 'record', time_limit_s: 60,
  passage: { text: 'a cat sat on a mat' },
  items: ['a', 'cat', 'sat', 'on', 'a', 'mat'].map((w, k) => ({ id: `en.story_w3.w${k + 1}`, target: w, line: 1 })),
});

function run({ storyClock, doneAt, tapAt, timeUp = false }) {
  let t = 0;
  const opts = { battery: { battery_id: 'b', tasks: [STORY()] }, now: () => t, mic: () => 'ok', manual: true };
  if (storyClock !== undefined) opts.story_clock = storyClock;
  const r = core.createRunner(opts);
  r.start(); r.instructionDone(); r.begin();
  if (timeUp) { t = doneAt; r.tick(); } else { t = doneAt; r.done(); }
  expect(r.view().phase).toBe('last_word');
  t = tapAt; r.lastWord(3);
  return r.view().result;
}

describe('the story clock (sa_r28_story_clock)', () => {
  test('ON: Done at 30 s, the last word tapped at 45 s → time_used_ms 30000, elapsed_ms 45000', () => {
    const res = run({ storyClock: true, doneAt: 30000, tapAt: 45000 });
    expect(res.stop_reason).toBe('complete');
    expect(res.time_used_ms).toBe(30000);
    expect(res.time_left_ms).toBe(30000);
    expect(res.elapsed_ms).toBe(45000);
  });
  test('OFF (option absent or false): 45000 as today', () => {
    for (const c of [undefined, false]) {
      const res = run({ storyClock: c, doneAt: 30000, tapAt: 45000 });
      expect(res.time_used_ms).toBe(45000);
      expect(res.elapsed_ms).toBe(45000);
    }
  });
  test('time up at 60 s, the last word tapped at 70 s: 60000 either way', () => {
    for (const c of [true, undefined]) {
      const res = run({ storyClock: c, doneAt: 60000, tapAt: 70000, timeUp: true });
      expect(res.stop_reason).toBe('time_up');
      expect(res.time_used_ms).toBe(60000);
      expect(res.elapsed_ms).toBe(70000);
    }
  });
});
