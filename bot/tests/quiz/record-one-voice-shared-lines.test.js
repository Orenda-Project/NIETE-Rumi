'use strict';
/**
 * The recorder of Jugnu's shared lines for one voice (scripts/quiz/record-one-voice-shared-lines.js): any ElevenLabs
 * voice id, model and settings get their own set, named as the switch's plan names it, with the hash the plan needs.
 * The voice provider is faked; nothing is called without --apply.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Rec = require('../../scripts/quiz/record-one-voice-shared-lines');
const Voice = require('../../shared/services/quiz/web-quiz-voice');
const OneVoice = require('../../shared/services/quiz/web-quiz-one-voice-flag');

const VOICE = { provider: 'elevenlabs', voice: 'Zx9TestVoiceId0001', name: 'Matched', model: 'eleven_multilingual_v2', settings: { stability: 0.6, speed: 0.92 } };
let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wq-voice-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ en: { right: ['Yes!', 'You got it!'], notyet: ['Not yet.'] }, ur: { right: ['جی!'] } }));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('without --apply: names the set as the plan does, prices it, and calls nothing', async () => {
  const fetchImpl = jest.fn();
  const out = [];
  const r = await Rec.run(['--lang', 'en', '--voice', JSON.stringify(VOICE)], { fetchImpl, out: (l) => out.push(l), voiceDir: dir, env: {} });
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(r.set).toBe(Voice.setIdOf(OneVoice.normalize({ voices: { en: VOICE } }).voices.en));
  expect(r.set).toMatch(/^el-matched-[0-9a-f]{6}$/);
  expect(r.path).toBe(`${r.set}-en`);   // one set per language: a voice can speak both
  expect(out[0]).toMatch(/lines=3 .*\(dry run\)/);
});

test('--apply: one call a line in that voice id, model and settings; a manifest the portal test reads; the set\'s hash', async () => {
  const fetchImpl = jest.fn(async () => ({ ok: true, arrayBuffer: async () => Buffer.alloc(2000, 7) }));
  const spend = path.join(dir, 'spend.jsonl');
  const out = [];
  const r = await Rec.run(['--lang', 'en', '--voice', JSON.stringify(VOICE), '--apply', '--spend-log', spend, '--spend-extra', '{"by":"x"}'],
    { fetchImpl, out: (l) => out.push(l), voiceDir: dir, env: { ELEVENLABS_API_KEY: 'k' } });
  expect(fetchImpl).toHaveBeenCalledTimes(3);
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toContain('/text-to-speech/Zx9TestVoiceId0001?output_format=mp3_44100_64');
  expect(JSON.parse(init.body)).toMatchObject({ model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.6, speed: 0.92 } });
  expect('language_code' in JSON.parse(init.body)).toBe(false);   // multilingual v2 refuses a language code
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'one', r.path, 'manifest.json'), 'utf8'));
  expect(m.lang).toBe('en');
  expect(Voice.setIdOf(m.voice)).toBe(r.set);
  expect(r.hash).toBe(Rec.setHash(path.join(dir, 'one', r.path)));
  expect(out.pop()).toBe(`add to web-quiz-voice.js SHARED_SETS: '${r.path}': '${r.hash}'`);
  expect(fs.readFileSync(spend, 'utf8').trim().split('\n')).toHaveLength(3);
});

test('refuses a voice that is not an ElevenLabs voice, and a run with no key', async () => {
  await expect(Rec.run(['--lang', 'en', '--voice', '{"provider":"openai","voice":"alloy"}'], { voiceDir: dir, out: () => {} })).rejects.toThrow(/ElevenLabs or Soniox/);
  await expect(Rec.run(['--lang', 'en', '--voice', JSON.stringify(VOICE), '--apply'], { voiceDir: dir, out: () => {}, env: {} })).rejects.toThrow(/ELEVENLABS_API_KEY/);
});

test('a model that takes a language code (eleven_v4) is sent one', async () => {
  const fetchImpl = jest.fn(async () => ({ ok: true, arrayBuffer: async () => Buffer.alloc(2000, 7) }));
  await Rec.run(['--lang', 'ur', '--voice', JSON.stringify({ ...VOICE, model: 'eleven_v4' }), '--apply'],
    { fetchImpl, out: () => {}, voiceDir: dir, env: { ELEVENLABS_API_KEY: 'k' } });
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ model_id: 'eleven_v4', language_code: 'ur' });
});

/*
 * A set's folder is keyed by the voice id, its rendering (model, settings) and the language: a folder whose manifest
 * names another of these, or a folder with lines and no manifest, is refused before any call (dry run too), so one
 * voice recorded for Urdu after English never reuses the English files.
 */
describe('the set\'s folder is the voice id, rendering and language it names, or the run is refused before any call', () => {
  const setDir = (lang = 'en') => path.join(dir, 'one', `${Voice.setIdOf(OneVoice.normalize({ voices: { en: VOICE } }).voices.en)}-${lang}`);
  const seedSet = (manifest, { lines = true, lang = 'en' } = {}) => {
    fs.mkdirSync(setDir(lang), { recursive: true });
    if (lines) fs.writeFileSync(path.join(setDir(lang), 'right-0.mp3'), Buffer.alloc(2000, 1));
    if (manifest) fs.writeFileSync(path.join(setDir(lang), 'manifest.json'), JSON.stringify(manifest));
  };
  const voiced = { ...VOICE, settings: { ...VOICE.settings } };
  test.each([
    ['another language', () => seedSet({ lang: 'en', voice: voiced, lines: {} }, { lang: 'ur' }), 'ur'],
    ['another voice id under the same name', () => seedSet({ lang: 'en', voice: { ...voiced, voice: 'Other0VoiceId0002' }, lines: {} }), 'en'],
    ['another rendering', () => seedSet({ lang: 'en', voice: { ...voiced, settings: { stability: 0.1 } }, lines: {} }), 'en'],
    ['lines with no manifest', () => seedSet(null), 'en'],
  ])('%s: refused, nothing called, with and without --apply', async (_, arrange, lang) => {
    arrange();
    const fetchImpl = jest.fn(async () => ({ ok: true, arrayBuffer: async () => Buffer.alloc(2000, 7) }));
    const base = ['--lang', lang, '--voice', JSON.stringify(VOICE)];
    await expect(Rec.run(base, { fetchImpl, out: () => {}, voiceDir: dir, env: {} })).rejects.toThrow(/set folder/);
    await expect(Rec.run([...base, '--apply'], { fetchImpl, out: () => {}, voiceDir: dir, env: { ELEVENLABS_API_KEY: 'k' } })).rejects.toThrow(/set folder/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('its own manifest: the run goes on and keeps the lines already there', async () => {
    seedSet({ lang: 'en', voice: OneVoice.normalize({ voices: { en: VOICE } }).voices.en, lines: {} });
    const fetchImpl = jest.fn(async () => ({ ok: true, arrayBuffer: async () => Buffer.alloc(2000, 7) }));
    await Rec.run(['--lang', 'en', '--voice', JSON.stringify(VOICE), '--apply'], { fetchImpl, out: () => {}, voiceDir: dir, env: { ELEVENLABS_API_KEY: 'k' } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);   // right-0 kept
  });

  test('the manifest is written before the first call, so a stopped run\'s folder still names its language', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('network'); });
    await expect(Rec.run(['--lang', 'en', '--voice', JSON.stringify(VOICE), '--apply'], { fetchImpl, out: () => {}, voiceDir: dir, env: { ELEVENLABS_API_KEY: 'k' } })).rejects.toThrow();
    expect(JSON.parse(fs.readFileSync(path.join(setDir(), 'manifest.json'), 'utf8')).lang).toBe('en');
  });
});

/*
 * A Soniox voice (the plan's `voices`), one set per language: the same voice for English and Urdu records two sets.
 * An Urdu line goes to the voice through the shared Urdu spelling list (web-quiz-ur-say.js); the manifest keeps the
 * line as the page shows it. With a plan's loudness and bitrate, every line is levelled before it is kept.
 */
describe('a Soniox voice from a plan file: one set per language, the Urdu spelling list, levelled lines', () => {
  const REYNA = { provider: 'soniox', voice: 'Reyna', name: 'Reyna' };
  const PLAN = { voices: { en: REYNA, ur: REYNA }, kbps: 32, loudness_lufs: -21 };
  let planFile;
  beforeEach(() => {
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ en: { right: ['Yes!'] }, ur: { right: ['جی!', 'ساتھ چلو!'] } }));
    planFile = path.join(dir, 'plan.json');
    fs.writeFileSync(planFile, JSON.stringify(PLAN));
  });
  const fakeTts = () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS-raw'), provider: 'soniox', durationSec: 2 })) });
  const fakeLevel = () => jest.fn(async () => Buffer.alloc(3000, 9));

  test('without --apply: the set is named per language as the plan names the voice, and priced; nothing called', async () => {
    const tts = fakeTts();
    const out = [];
    const r = await Rec.run(['--lang', 'ur', '--plan', planFile], { tts, out: (l) => out.push(l), voiceDir: dir, env: {} });
    expect(r.set).toBe(Voice.setIdOf(OneVoice.normalize(PLAN).voices.ur));
    expect(r.set).toBe('sx-reyna-68567f');
    expect(r.path).toBe('sx-reyna-68567f-ur');
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(out[0]).toMatch(/set=sx-reyna-68567f-ur lang=ur lines=2 chars=\d+ usd≈\d+\.\d{3} .*\(dry run\)/);
  });

  test('--apply, Urdu: a ruled word reaches the voice respelled, the manifest keeps the line as written; levelled to the plan', async () => {
    const tts = fakeTts();
    const level = fakeLevel();
    const spend = path.join(dir, 'spend.jsonl');
    const r = await Rec.run(['--lang', 'ur', '--plan', planFile, '--apply', '--spend-log', spend, '--spend-extra', '{"lane":"x"}'],
      { tts, level, out: () => {}, voiceDir: dir, env: { SONIOX_API_KEY: 'k' } });
    expect(tts.synthesize).toHaveBeenCalledTimes(2);
    const said = tts.synthesize.mock.calls.map(([a]) => a);
    said.forEach((a) => expect(a).toMatchObject({ provider: 'soniox', voice: 'Reyna', language: 'ur' }));
    expect(said[1].text).toBe('साथ چلو!');
    expect(said[1].text).toBe(require('../../shared/services/quiz/web-quiz-ur-say').sayOf('ساتھ چلو!', { voice: 'Reyna' }));
    expect(level).toHaveBeenCalledWith(Buffer.from('OggS-raw'), { lufs: -21, kbps: 32 });
    const setDir = path.join(dir, 'one', 'sx-reyna-68567f-ur');
    expect(fs.readFileSync(path.join(setDir, 'right-1.mp3'))).toEqual(Buffer.alloc(3000, 9));
    const m = JSON.parse(fs.readFileSync(path.join(setDir, 'manifest.json'), 'utf8'));
    expect(m).toMatchObject({ lang: 'ur', voice: REYNA, lines: { right: ['جی!', 'ساتھ چلو!'] } });
    expect(r.hash).toBe(Rec.setHash(setDir));
    const rows = fs.readFileSync(spend, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ lane: 'x', provider: 'soniox', units: 2 });
    expect(rows[0].usd).toBeCloseTo(2 * 0.722 / 3600, 6);
  });

  test('the same voice for English after Urdu: its own set, not refused, English as written', async () => {
    const tts = fakeTts();
    await Rec.run(['--lang', 'ur', '--plan', planFile, '--apply'], { tts, level: fakeLevel(), out: () => {}, voiceDir: dir, env: { SONIOX_API_KEY: 'k' } });
    const r = await Rec.run(['--lang', 'en', '--plan', planFile, '--apply'], { tts, level: fakeLevel(), out: () => {}, voiceDir: dir, env: { SONIOX_API_KEY: 'k' } });
    expect(r.path).toBe('sx-reyna-68567f-en');
    expect(tts.synthesize.mock.calls[2][0]).toMatchObject({ text: 'Yes!', language: 'en', voice: 'Reyna' });
    expect(fs.existsSync(path.join(dir, 'one', 'sx-reyna-68567f-ur', 'right-1.mp3'))).toBe(true);
  });

  test('a Soniox run with no key is refused before any call', async () => {
    const tts = fakeTts();
    await expect(Rec.run(['--lang', 'en', '--plan', planFile, '--apply'], { tts, out: () => {}, voiceDir: dir, env: {} })).rejects.toThrow(/SONIOX_API_KEY/);
    expect(tts.synthesize).not.toHaveBeenCalled();
  });
});

test('an ElevenLabs Urdu line goes to the voice through the shared spelling list too', async () => {
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ur: { right: ['ساتھ چلو!'] } }));
  const fetchImpl = jest.fn(async () => ({ ok: true, arrayBuffer: async () => Buffer.alloc(2000, 7) }));
  await Rec.run(['--lang', 'ur', '--voice', JSON.stringify(VOICE), '--apply'], { fetchImpl, out: () => {}, voiceDir: dir, env: { ELEVENLABS_API_KEY: 'k' } });
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body).text).toBe('साथ چلو!');
});
