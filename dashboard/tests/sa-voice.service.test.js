/**
 * sa-voice: Jugnu's voice for the self-administered runner.
 * speak() plays the clip (tried twice, then silent: never the phone's speech for a line that has a clip), uses the
 * phone's speech only for a line with no clip, and resolves even with neither.
 */
const path = require('path');

const VOICE = path.join(__dirname, '..', 'sa', 'sa-voice.js');

function load() {
  jest.resetModules();
  return require(VOICE);
}

function makeAudio(behaviour, log) {
  return class FakeAudio {
    constructor(src) { this.src = src; log.push(['audio', src]); }
    play() {
      setTimeout(() => {
        if (behaviour === 'error' && this.onerror) this.onerror(new Error('404'));
        if (behaviour === 'ok') {
          if (this.onplaying) this.onplaying();
          setTimeout(() => { if (this.onended) this.onended(); }, 5);
        }
      }, 5);
      return behaviour === 'reject' ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
    }
    pause() {}
  };
}

function makeSpeech(log, voices) {
  class Utter { constructor(text) { this.text = text; } }
  const synth = {
    getVoices: () => voices || [],
    cancel: () => log.push(['cancel']),
    speak(u) { log.push(['tts', u.text, u.lang]); setTimeout(() => u.onend && u.onend(), 5); },
  };
  return { Utter, synth };
}

afterEach(() => {
  delete global.Audio;
  delete global.speechSynthesis;
  delete global.SpeechSynthesisUtterance;
});

describe('sa-voice speak()', () => {
  test('plays the clip from base + audioObj[lang] and resolves when it ends', async () => {
    const log = [];
    global.Audio = makeAudio('ok', log);
    const sp = makeSpeech(log);
    global.speechSynthesis = sp.synth;
    global.SpeechSynthesisUtterance = sp.Utter;
    const v = load().create({ lang: 'ur', base: '/audio/' });
    await v.speak({ en: 'Hello', ur: 'سلام' }, { en: 'hi.mp3', ur: 'salam.mp3' });
    expect(log).toEqual([['audio', '/audio/salam.mp3']]);
  });

  test('a clip that fails to load is tried again in the page language, never handed to speech', async () => {
    const log = [];
    global.Audio = makeAudio('error', log);
    const sp = makeSpeech(log);
    global.speechSynthesis = sp.synth;
    global.SpeechSynthesisUtterance = sp.Utter;
    const v = load().create({ lang: 'ur', base: '/a/', pause_ms: 10 });
    await v.speak({ en: 'Hello', ur: 'سلام' }, { ur: 'missing.mp3' });
    expect(log).toEqual([['audio', '/a/missing.mp3'], ['audio', '/a/missing.mp3']]);
  });

  test('speaks with no clip given', async () => {
    const log = [];
    const sp = makeSpeech(log);
    global.speechSynthesis = sp.synth;
    global.SpeechSynthesisUtterance = sp.Utter;
    const v = load().create({ lang: 'en' });
    await v.speak({ en: 'Tap it' });
    expect(log.find((x) => x[0] === 'tts')).toEqual(['tts', 'Tap it', 'en-US']);
  });

  test('skips speech when the phone has voices but none for the language', async () => {
    const log = [];
    const sp = makeSpeech(log, [{ lang: 'en-US' }, { lang: 'fr-FR' }]);
    global.speechSynthesis = sp.synth;
    global.SpeechSynthesisUtterance = sp.Utter;
    const v = load().create({ lang: 'ur', pause_ms: 10 });
    await v.speak({ ur: 'سلام' });
    expect(log.some((x) => x[0] === 'tts')).toBe(false);
  });

  test('resolves with neither Audio nor speechSynthesis, and never throws', async () => {
    const v = load().create({ lang: 'ur', pause_ms: 10 });
    await expect(v.speak({ ur: 'سلام' }, { ur: 'a.mp3' })).resolves.toBeUndefined();
    await expect(v.speak(null, null)).resolves.toBeUndefined();
    await expect(v.speak(undefined)).resolves.toBeUndefined();
  });

  test('a throwing Audio constructor still resolves', async () => {
    global.Audio = function () { throw new Error('boom'); };
    const v = load().create({ lang: 'en', pause_ms: 10 });
    await expect(v.speak({ en: 'x' }, { en: 'a.mp3' })).resolves.toBeUndefined();
  });

  test('muted resolves without playing anything', async () => {
    const log = [];
    global.Audio = makeAudio('ok', log);
    const v = load().create({ lang: 'en', muted: true, pause_ms: 10 });
    await v.speak({ en: 'x' }, { en: 'a.mp3' });
    expect(log).toEqual([]);
  });

  test('a new speak() cuts the one before and resolves it', async () => {
    global.Audio = class { play() { return new Promise(() => {}); } pause() {} };
    const v = load().create({ lang: 'en', load_ms: 100000 });
    const first = v.speak({ en: 'a' }, { en: 'a.mp3' });
    v.stop();
    await expect(first).resolves.toBeUndefined();
  });

  test('onSpeak reports start and stop around the words', async () => {
    const log = [], seen = [];
    const sp = makeSpeech(log);
    global.speechSynthesis = sp.synth;
    global.SpeechSynthesisUtterance = sp.Utter;
    const v = load().create({ lang: 'en', onSpeak: (e) => seen.push(e) });
    await v.speak({ en: 'Hi' });
    expect(seen).toEqual([{ speaking: true, text: 'Hi' }, { speaking: false, text: 'Hi' }]);
  });

  test('a line in the task language ({text, lang}) is spoken with that language, its own audio used', async () => {
    const log = [];
    global.Audio = makeAudio('error', log);
    const sp = makeSpeech(log);
    global.speechSynthesis = sp.synth;
    global.SpeechSynthesisUtterance = sp.Utter;
    const v = load().create({ lang: 'ur', base: '/b/' });
    await v.speak({ text: 'Why did Imran wake up early?', lang: 'en', audio: 'sa/v1/en/q.mp3' });
    expect(log.find((x) => x[0] === 'audio')).toEqual(['audio', '/b/sa/v1/en/q.mp3']);
    expect(log.some((x) => x[0] === 'tts')).toBe(false);
    log.length = 0;
    await v.speak({ text: 'Why did Imran wake up early?', lang: 'en' });
    expect(log.find((x) => x[0] === 'tts')).toEqual(['tts', 'Why did Imran wake up early?', 'en-US']);
  });

  test('a battery line {en, ur, audio:{en, ur}} plays the page language clip', async () => {
    const log = [];
    global.Audio = makeAudio('ok', log);
    const v = load().create({ lang: 'ur', base: '/b/' });
    await v.speak({ en: 'Hello', ur: 'سلام', from: 'x', audio: { en: 'e.mp3', ur: 'u.mp3' } });
    expect(log).toEqual([['audio', '/b/u.mp3']]);
  });

  // RULING #31 c, d / #33 (the tester's A07, A09): a line that has a clip is never said by the phone's own voice.
  test('a clip that fails is retried once, then the line resolves silently: no browser speech', async () => {
    const log = [], silent = [];
    global.Audio = makeAudio('error', log);
    const sp = makeSpeech(log, [{ lang: 'en-US' }]);
    global.speechSynthesis = sp.synth;
    global.SpeechSynthesisUtterance = sp.Utter;
    const v = load().create({ lang: 'en', base: '/a/', pause_ms: 10, onSilent: (e) => silent.push(e) });
    await v.speak({ en: 'Good effort, let us go on.' }, { en: 'sa/v1/en/after.mp3' });
    expect(log.filter((x) => x[0] === 'audio')).toEqual([['audio', '/a/sa/v1/en/after.mp3'], ['audio', '/a/sa/v1/en/after.mp3']]);
    expect(log.some((x) => x[0] === 'tts')).toBe(false);
    expect(silent).toEqual([{ text: 'Good effort, let us go on.', lang: 'en' }]);
  });

  test('a clip refused by autoplay or never loading is not handed to browser speech', async () => {
    const log = [];
    global.Audio = makeAudio('reject', log);
    const sp = makeSpeech(log, [{ lang: 'en-IN' }]);
    global.speechSynthesis = sp.synth;
    global.SpeechSynthesisUtterance = sp.Utter;
    const v = load().create({ lang: 'en', pause_ms: 10 });
    await v.speak({ en: 'Hello' }, { en: 'x.mp3' });
    expect(log.filter((x) => x[0] === 'audio').length).toBe(2);
    expect(log.some((x) => x[0] === 'tts')).toBe(false);

    const log2 = [];
    global.Audio = class { constructor(src) { log2.push(['audio', src]); } play() { return new Promise(() => {}); } pause() {} };
    const v2 = load().create({ lang: 'en', pause_ms: 10, load_ms: 20 });
    await v2.speak({ en: 'Hello' }, { en: 'slow.mp3' });
    expect(log2.length).toBe(2);
    expect(log.some((x) => x[0] === 'tts')).toBe(false);
  });

  test('the retry that plays is heard once, and the line ends with it', async () => {
    const log = [];
    let n = 0;
    const ok = makeAudio('ok', log), bad = makeAudio('error', log);
    global.Audio = function (src) { n += 1; return n === 1 ? new bad(src) : new ok(src); };
    const sp = makeSpeech(log);
    global.speechSynthesis = sp.synth;
    global.SpeechSynthesisUtterance = sp.Utter;
    const v = load().create({ lang: 'ur', base: '/a/' });
    await v.speak({ ur: 'سلام' }, { ur: 's.mp3' });
    expect(log).toEqual([['audio', '/a/s.mp3'], ['audio', '/a/s.mp3']]);
  });

  test('browser speech (a form with no clips) uses only a South Asian, UK or US English voice', async () => {
    const log = [];
    const sp = makeSpeech(log, [{ lang: 'en-SG' }, { lang: 'en-HK' }, { lang: 'zh-CN' }]);
    global.speechSynthesis = sp.synth;
    global.SpeechSynthesisUtterance = sp.Utter;
    const mod = load();
    expect(mod.voiceFor(sp.synth, 'en')).toEqual({ ok: false, voice: null });
    const v = mod.create({ lang: 'en', pause_ms: 10 });
    await v.speak({ en: 'Tap it' });
    expect(log.some((x) => x[0] === 'tts')).toBe(false);

    const pk = makeSpeech(log, [{ lang: 'en-SG' }, { lang: 'en-US' }, { lang: 'en_IN' }]);
    expect(mod.voiceFor(pk.synth, 'en').voice).toEqual({ lang: 'en_IN' });
    const uk = makeSpeech(log, [{ lang: 'en-AU' }, { lang: 'en-GB' }]);
    expect(mod.voiceFor(uk.synth, 'en').voice).toEqual({ lang: 'en-GB' });
    const ur = makeSpeech(log, [{ lang: 'ur-IN' }]);
    expect(mod.voiceFor(ur.synth, 'ur')).toEqual({ ok: true, voice: { lang: 'ur-IN' } });
  });

  test('browser speech says the line in the chosen voice language', async () => {
    const log = [];
    const sp = makeSpeech(log, [{ lang: 'en-SG' }, { lang: 'en-PK' }]);
    global.speechSynthesis = sp.synth;
    global.SpeechSynthesisUtterance = sp.Utter;
    const v = load().create({ lang: 'en' });
    await v.speak({ en: 'Tap it' });
    expect(log.find((x) => x[0] === 'tts')).toEqual(['tts', 'Tap it', 'en-PK']);
  });
});
