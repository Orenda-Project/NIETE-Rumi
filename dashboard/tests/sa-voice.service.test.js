/**
 * sa-voice: Jugnu's voice for the self-administered runner.
 * speak() plays the clip, falls back to the phone's speech when the clip fails, and resolves even with neither.
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

  test('falls back to speech in the right language when the clip fails to load', async () => {
    const log = [];
    global.Audio = makeAudio('error', log);
    const sp = makeSpeech(log);
    global.speechSynthesis = sp.synth;
    global.SpeechSynthesisUtterance = sp.Utter;
    const v = load().create({ lang: 'ur', base: '/a/' });
    await v.speak({ en: 'Hello', ur: 'سلام' }, { ur: 'missing.mp3' });
    expect(log.find((x) => x[0] === 'audio')).toEqual(['audio', '/a/missing.mp3']);
    expect(log.find((x) => x[0] === 'tts')).toEqual(['tts', 'سلام', 'ur-PK']);
  });

  test('falls back to speech when play() is refused (autoplay)', async () => {
    const log = [];
    global.Audio = makeAudio('reject', log);
    const sp = makeSpeech(log);
    global.speechSynthesis = sp.synth;
    global.SpeechSynthesisUtterance = sp.Utter;
    const v = load().create({ lang: 'en' });
    await v.speak({ en: 'Hello' }, { en: 'x.mp3' });
    expect(log.find((x) => x[0] === 'tts')).toEqual(['tts', 'Hello', 'en-US']);
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
    expect(log.find((x) => x[0] === 'tts')).toEqual(['tts', 'Why did Imran wake up early?', 'en-US']);
  });

  test('a battery line {en, ur, audio:{en, ur}} plays the page language clip', async () => {
    const log = [];
    global.Audio = makeAudio('ok', log);
    const v = load().create({ lang: 'ur', base: '/b/' });
    await v.speak({ en: 'Hello', ur: 'سلام', from: 'x', audio: { en: 'e.mp3', ur: 'u.mp3' } });
    expect(log).toEqual([['audio', '/b/u.mp3']]);
  });
});
