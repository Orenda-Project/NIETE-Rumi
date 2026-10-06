/**
 * Web quiz page voice (public/wq/wq.js speak/stopVoice/speakTts).
 *
 * The page is a browser script with no exports, so this runs the page's OWN
 * voice block — cut from the shipped file between its markers — in a vm with
 * the browser's audio boundary faked (Audio, speechSynthesis, timers).
 *
 * The bug: a child taps an answer before the question's recorded clip has
 * started. The next screen's speak() stops the clip, the clip's pending play()
 * then rejects (and its 2 s "stalled" timer fires), and the fallback read the
 * OLD line aloud with the phone's voice over the new screen.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const START = SRC.indexOf('  var player = null;');
const END = SRC.indexOf('  /* ---------------- tiny DOM helpers');

function harness() {
  const spoken = [];
  const events = [];
  const timers = [];
  const clips = [];
  class FakeAudio {
    constructor(url) {
      this.url = url; this.paused = true; this.listeners = {};
      clips.push(this);
    }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    play() {
      this.paused = false;
      return new Promise((resolve, reject) => { this.resolvePlay = resolve; this.rejectPlay = reject; });
    }
    pause() { this.paused = true; }
  }
  const ctx = {
    LANG: 'en',
    SOUND: true,
    ROOT: { classList: { add() {}, remove() {} } },
    speakable: (t) => /[A-Za-z0-9\u0600-\u06FF]/.test(String(t || '')),
    ev: (name, data) => events.push({ name, data }),
    document: { createElement: () => ({ canPlayType: () => 'probably' }) },
    Audio: FakeAudio,
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
    speechSynthesis: { speak: (u) => spoken.push(u.text), cancel: () => {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${SRC.slice(START, END)}\nthis.speak = speak; this.stopVoice = stopVoice;`, ctx);
  const runTimers = (ms) => timers.filter((t) => t.ms === ms).forEach((t) => t.fn());
  return { ctx, spoken, events, clips, runTimers };
}

const flush = () => new Promise((r) => setImmediate(r));

test('the voice block is still where this test cuts it from', () => {
  expect(START).toBeGreaterThan(0);
  expect(END).toBeGreaterThan(START);
});

test('a clip stopped before it started never reads its old line on the next screen', async () => {
  const h = harness();
  h.ctx.speak('Which part of a plant takes in water?', 'https://media.example/q1.ogg', null);
  const q1 = h.clips[0];
  // The child taps before the clip starts: the feedback screen speaks with the phone's voice.
  h.ctx.speak('Well done!', null, null);
  q1.rejectPlay(new Error('The play() request was interrupted by a call to pause()'));
  await flush();
  h.runTimers(2000); // the old clip's "slow" timer
  h.runTimers(8000); // and its "stalled" timer
  expect(h.spoken).toEqual(['Well done!']);
  expect(h.events.filter((e) => e.name === 'audio_fallback')).toEqual([]);
});

test('a clip superseded by another clip does not fall back either', async () => {
  const h = harness();
  h.ctx.speak('Old line', 'https://media.example/q1.ogg', null);
  h.ctx.speak('New line', 'https://media.example/q2.ogg', null);
  h.clips[0].rejectPlay(new Error('interrupted'));
  await flush();
  expect(h.spoken).toEqual([]);
  expect(h.events).toEqual([]);
});

test('a clip the browser refuses to start (autoplay before a tap) is not read by the phone voice: the speaker asks for a tap', async () => {
  const h = harness();
  h.ctx.speak('Read me', 'https://media.example/q1.ogg', null);
  h.clips[0].rejectPlay(new Error('NotAllowedError'));
  await flush();
  expect(h.spoken).toEqual([]);
  expect(h.events).toEqual([{ name: 'audio_fallback', data: { reason: 'reject' } }]);
});

test('a clip that stalls on the current screen is given up once, after 8 s, without a second voice', async () => {
  const h = harness();
  h.ctx.speak('Read me', 'https://media.example/q1.ogg', null);
  h.runTimers(2000);
  expect(h.events).toEqual([]); // slow is not missing: still loading at 2 s
  h.runTimers(8000);
  expect(h.spoken).toEqual([]); // one voice: the phone does not read a line the clip was meant to say
  expect(h.events.map((e) => e.data.reason)).toEqual(['stalled']);
});

test('a phone-voice line that was stopped does not run its "done" (no old options read on the next screen)', () => {
  const h = harness();
  const done = jest.fn();
  h.ctx.speak('Which part of a plant takes in water?', null, done); // the question; done reads the options
  h.ctx.speak('Well done!', null, null);                            // the child answered
  h.runTimers(Math.min(20000, 3000 + 'Which part of a plant takes in water?'.length * 110));
  expect(done).not.toHaveBeenCalled();
});

test('a line that finishes on its own screen still runs its "done"', () => {
  const h = harness();
  const done = jest.fn();
  h.ctx.speak('Read me', null, done);
  h.runTimers(Math.min(20000, 3000 + 'Read me'.length * 110));
  expect(done).toHaveBeenCalledTimes(1);
});
