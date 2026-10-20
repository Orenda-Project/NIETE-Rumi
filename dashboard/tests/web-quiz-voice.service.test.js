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
    VLANG: 'en', // the shared lines' language (the questions' language), set at boot by the page
    SOUND: true,
    ONE_VOICE: false, // boot one_voice (web_quiz_one_voice), off as today
    GAP_PHONE: false, // boot voice_gap_phone (web_quiz_voice_gap_phone), off as today
    GAP_SLOW: false, // boot voice_gap_slow (web_quiz_voice_gap_slow), off as today
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

// web_quiz_voice_gap_phone (the boot's voice_gap_phone, default off): while one voice is on, a quiz part with no recorded
// clip (or a clip that cannot play here) is read by the phone's own voice, as before one voice, instead of left silent.
// A phone with no voice for the language keeps the big words; a slow clip ('stalled') and a refused start ('reject')
// stay as they are. Off: today's one-voice page (the big words, no phone voice).
describe('a line with no recorded clip while one voice is on (web_quiz_voice_gap_phone)', () => {
  const setup = ({ gap, lang = 'en', voices } = {}) => {
    const h = harness(), utts = [], cls = new Set();
    h.ctx.ONE_VOICE = true; h.ctx.GAP_PHONE = Boolean(gap); h.ctx.LANG = lang; h.ctx.VLANG = lang;
    h.ctx.ROOT.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c) };
    h.ctx.speechSynthesis = { speak: (u) => utts.push(u), cancel: () => {}, getVoices: () => voices || [] };
    return { h, utts, cls };
  };
  test.each([['en', 'en-US'], ['ur', 'ur-PK']])('switch on, %s, no clip: the phone reads it (%s), with the phone-voice mark, and the line ends on its own timer', (lang, ul) => {
    const { h, utts, cls } = setup({ gap: true, lang });
    let done = 0;
    h.ctx.speak('Which month comes after January?', null, () => { done += 1; }, { qid: 'q1', part: 'q' });
    expect(utts.map((u) => [u.text, u.lang])).toEqual([['Which month comes after January?', ul]]);
    expect(cls.has('wq-phonevoice')).toBe(true);
    expect(cls.has('wq-novoice')).toBe(false);
    utts[0].onend();
    expect(done).toBe(1);
    expect(h.events.filter((e) => e.name === 'audio_missing')).toHaveLength(1);
  });
  test('switch off, one voice on, no clip: today\'s page (the big words, no phone voice, let go after 4 s)', () => {
    const { h, utts, cls } = setup({ gap: false });
    let done = 0;
    h.ctx.speak('Which month comes after January?', null, () => { done += 1; }, { qid: 'q1', part: 'q' });
    expect(utts).toEqual([]);
    expect(cls.has('wq-novoice')).toBe(true);
    h.runTimers(4000);
    expect(done).toBe(1);
  });
  test('switch on, a phone with no voice for the language: the big words, as today, never a wrong-language voice', () => {
    const { h, utts, cls } = setup({ gap: true, lang: 'ur', voices: [{ lang: 'en-US' }, { lang: 'en-GB' }] });
    h.ctx.speak('یہ کیا ہے؟', null, null, { qid: 'q1', part: 'q' });
    expect(utts).toEqual([]);
    expect(cls.has('wq-novoice')).toBe(true);
    expect(cls.has('wq-phonevoice')).toBe(false);
  });
  test('switch on, a clip that errors or that this phone cannot play: the phone reads the line', async () => {
    const { h, utts } = setup({ gap: true });
    h.ctx.speak('Line one', 'https://media.example/q1.ogg', null);
    h.clips[0].onerror();
    expect(utts.map((u) => u.text)).toEqual(['Line one']);
    const s2 = setup({ gap: true });
    s2.h.ctx.document = { createElement: () => ({ canPlayType: () => '' }) };
    s2.h.ctx.speak('Line two', 'https://media.example/q2.ogg', null);
    expect(s2.utts.map((u) => u.text)).toEqual(['Line two']);
  });
  test('switch on, a slow clip (stalled) and a refused start (reject) stay as they are: no phone voice', async () => {
    const { h, utts, cls } = setup({ gap: true });
    h.ctx.speak('Slow line', 'https://media.example/q1.ogg', null);
    h.runTimers(8000);
    expect(utts).toEqual([]);
    const s2 = setup({ gap: true });
    s2.h.ctx.speak('Refused line', 'https://media.example/q2.ogg', null);
    s2.h.clips[0].rejectPlay(new Error('NotAllowedError'));
    await flush();
    expect(s2.utts).toEqual([]);
    expect(s2.cls.has('wq-tap')).toBe(true);
    expect(cls.has('wq-phonevoice')).toBe(false);
  });
  test('the page reads the switch from the boot: var GAP_PHONE = Boolean(B.voice_gap_phone)', () => {
    expect(SRC).toContain('var GAP_PHONE = Boolean(B.voice_gap_phone);');
  });
});


// web_quiz_voice_gap_slow (the boot's voice_gap_slow, default off; on only beside voice_gap_phone): a clip that is
// there but will not play is read by the phone's own voice too. A play() that aborts (AbortError: the file will not
// load) is read at once; a clip still not started at 5 s is read then, instead of 8 s and the page moving on in silence. The
// 2 s mark stays the big words only, so a slow clip that does start is never talked over. A refused start
// (NotAllowedError, before the child's first tap) keeps the tap; a line stopped by the next screen stays quiet.
describe('a clip that will not play while one voice is on (web_quiz_voice_gap_slow)', () => {
  const setup = ({ slow, gap = true } = {}) => {
    const h = harness(), utts = [], cls = new Set();
    h.ctx.ONE_VOICE = true; h.ctx.GAP_PHONE = Boolean(gap); h.ctx.GAP_SLOW = Boolean(gap && slow);
    h.ctx.ROOT.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c) };
    h.ctx.speechSynthesis = { speak: (u) => utts.push(u), cancel: () => {}, getVoices: () => [] };
    return { h, utts, cls };
  };
  const abort = () => Object.assign(new Error('The play() request was interrupted because the media was removed'), { name: 'AbortError' });
  const refuse = () => Object.assign(new Error('play() failed because the user did not interact first'), { name: 'NotAllowedError' });

  test('on: a clip whose play() aborts is read by the phone at once, and the line ends on the phone voice', async () => {
    const { h, utts, cls } = setup({ slow: true });
    let done = 0;
    h.ctx.speak('Option C', 'https://media.example/c.ogg', () => { done += 1; });
    h.clips[0].rejectPlay(abort());
    await flush();
    expect(utts.map((u) => u.text)).toEqual(['Option C']);
    expect(cls.has('wq-phonevoice')).toBe(true);
    expect(cls.has('wq-tap')).toBe(false);
    expect(h.clips[0].paused).toBe(true);
    utts[0].onend();
    expect(done).toBe(1);
    expect(h.events.filter((e) => e.name === 'audio_fallback').map((e) => e.data.reason)).toEqual(['reject']);
  });
  test('on: a clip not started at 2 s shows the big words only; at 5 s the phone reads it', () => {
    const { h, utts, cls } = setup({ slow: true });
    h.ctx.speak('Option A', 'https://media.example/a.ogg', null);
    h.runTimers(2000);
    expect(utts).toEqual([]);
    expect(cls.has('wq-novoice')).toBe(true);
    h.runTimers(8000);
    expect(utts).toEqual([]); // no 8 s timer with the switch on
    h.runTimers(5000);
    expect(utts.map((u) => u.text)).toEqual(['Option A']);
    expect(h.clips[0].paused).toBe(true);
  });
  test('on: a refused start (NotAllowedError) keeps the tap, never the phone voice', async () => {
    const { h, utts, cls } = setup({ slow: true });
    h.ctx.speak('Read me', 'https://media.example/q.ogg', null);
    h.clips[0].rejectPlay(refuse());
    await flush();
    expect(utts).toEqual([]);
    expect(cls.has('wq-tap')).toBe(true);
  });
  test('on: a clip stopped by the next screen still never reads its old line', async () => {
    const { h, utts } = setup({ slow: true });
    h.ctx.speak('Old line', 'https://media.example/q1.ogg', null);
    h.ctx.speak('New line', 'https://media.example/q2.ogg', null);
    h.clips[0].rejectPlay(abort());
    await flush();
    h.runTimers(5000);
    h.runTimers(8000);
    expect(utts.map((u) => u.text)).not.toContain('Old line');
  });
  test.each([[{ slow: false }], [{ slow: true, gap: false }]])('off (%p): an aborted clip and a stalled clip stay as today (no phone voice)', async (o) => {
    const { h, utts, cls } = setup(o);
    h.ctx.speak('Aborted', 'https://media.example/a.ogg', null);
    h.clips[0].rejectPlay(abort());
    await flush();
    expect(cls.has('wq-tap')).toBe(true);
    const s2 = setup(o);
    s2.h.ctx.speak('Stalled', 'https://media.example/b.ogg', null);
    s2.h.runTimers(8000);
    expect([...utts, ...s2.utts]).toEqual([]);
  });
  test('the page reads the switch from the boot, only beside the gap switch', () => {
    expect(SRC).toContain('var GAP_SLOW = GAP_PHONE && Boolean(B.voice_gap_slow);');
  });
});

test('gap slow on: a slow clip that starts at 4 s plays as recorded, never talked over', () => {
  const h = harness(), utts = [];
  h.ctx.ONE_VOICE = true; h.ctx.GAP_PHONE = true; h.ctx.GAP_SLOW = true;
  h.ctx.speechSynthesis = { speak: (u) => utts.push(u), cancel: () => {}, getVoices: () => [] };
  h.ctx.speak('Option B', 'https://media.example/b.ogg', null);
  h.runTimers(2000);
  h.clips[0].listeners.playing();
  h.runTimers(5000);
  expect(utts).toEqual([]);
  expect(h.clips[0].paused).toBe(false);
});

test('gap slow on: a refused play() names its error in the fallback event (which rejects a phone gives); off, the event is today\'s', async () => {
  const run = async (slow) => {
    const h = harness();
    h.ctx.ONE_VOICE = true; h.ctx.GAP_PHONE = true; h.ctx.GAP_SLOW = slow;
    h.ctx.speechSynthesis = { speak: () => {}, cancel: () => {}, getVoices: () => [] };
    h.ctx.speak('Read me', 'https://media.example/q.ogg', null);
    h.clips[0].rejectPlay(Object.assign(new Error('no gesture'), { name: 'NotAllowedError' }));
    await flush();
    return h.events.filter((e) => e.name === 'audio_fallback').map((e) => e.data);
  };
  expect(await run(true)).toEqual([{ reason: 'reject', err: 'notallowederror' }]);
  expect(await run(false)).toEqual([{ reason: 'reject' }]);
});
