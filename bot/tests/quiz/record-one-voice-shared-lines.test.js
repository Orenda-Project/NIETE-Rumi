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
  expect(JSON.parse(init.body)).toMatchObject({ model_id: 'eleven_multilingual_v2', language_code: 'en', voice_settings: { stability: 0.6, speed: 0.92 } });
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'one', r.set, 'manifest.json'), 'utf8'));
  expect(m.lang).toBe('en');
  expect(Voice.setIdOf(m.voice)).toBe(r.set);
  expect(r.hash).toBe(Rec.setHash(path.join(dir, 'one', r.set)));
  expect(out.pop()).toBe(`add to web-quiz-voice.js SHARED_SETS: '${r.set}': '${r.hash}'`);
  expect(fs.readFileSync(spend, 'utf8').trim().split('\n')).toHaveLength(3);
});

test('refuses a voice that is not an ElevenLabs voice, and a run with no key', async () => {
  await expect(Rec.run(['--lang', 'en', '--voice', '{"provider":"soniox","voice":"Grace"}'], { voiceDir: dir, out: () => {} })).rejects.toThrow(/ElevenLabs/);
  await expect(Rec.run(['--lang', 'en', '--voice', JSON.stringify(VOICE), '--apply'], { voiceDir: dir, out: () => {}, env: {} })).rejects.toThrow(/ELEVENLABS_API_KEY/);
});
