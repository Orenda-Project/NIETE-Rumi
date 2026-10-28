'use strict';

/**
 * record-sa-voice.js --set v4: the whole bank again in one picked voice, into sa/v4/<lang>/ under the same keys, called
 * the way the reviewers' samples were made (sa-voice-providers.js): Soniox at a child's pace with the Urdu respellings,
 * ElevenLabs and Uplift without them; tashdeed for every provider's Urdu narration; a mood tag on instructions only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, loadBank } = require('../../scripts/child-test/record-sa-voice');
const P = require('../../scripts/child-test/sa-voice-providers');
const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');
const { voicedWithTashdeed } = require('../../shared/services/child-test/sa/ur-tashdeed');
const Voice = require('../../shared/services/quiz/web-quiz-voice');

const manifest = voiceManifest(loadBank());

async function record(argv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4-'));
  const sent = [];
  const res = await run([...argv, '--apply', '--max-usd', '100'], {
    outDir: dir, out: () => {},
    synth: async (job) => { sent.push(job); return { audio: Buffer.alloc(2000, 1), chars: job.text.length }; },
    level: async (b) => Buffer.concat([b, Buffer.alloc(4000)]),
  });
  return { dir, sent, res };
}

test('v4 Urdu in Soniox: every Urdu line, into sa/v4/ur/ under its own key, at 0.85, respelled, tashdeed on the narration', async () => {
  const { dir, sent, res } = await record(['--set', 'v4', '--lang', 'ur', '--provider', 'soniox']);
  const ur = manifest.filter((r) => r.lang === 'ur');
  expect(res.recorded).toBe(ur.length);
  for (const r of ur) expect(fs.existsSync(path.join(dir, r.key.replace('sa/v1/', 'sa/v4/')))).toBe(true);
  expect(sent.every((j) => j.provider === 'soniox' && j.voice === 'Ishita' && j.speed === 0.85 && j.lang === 'ur')).toBe(true);
  const t = voicedWithTashdeed(manifest)[0];
  expect(t).toBeTruthy();
  const want = Voice.sayAs(t.say, 'ur', { voice: 'Ishita' });
  expect(sent.some((j) => j.text === want || j.text === `[warm] ${want}`)).toBe(true);
});

test('the default is the reviewers\' pick: ElevenLabs Chutki in both languages, its own pace, [cheerfully] on instructions, no respelling', async () => {
  for (const lang of ['en', 'ur']) {
    const { sent, res } = await record(['--set', 'v4', '--lang', lang]);
    const rows = manifest.filter((r) => r.lang === lang);
    expect(res.recorded).toBe(rows.length);
    expect(sent.every((j) => j.provider === 'elevenlabs' && j.voice === 'CNKl99QEbWm8RQ4D8GfC' && j.speed === null && j.lang === lang)).toBe(true);
    const roleOf = new Map(rows.map((r) => [r.key.replace('sa/v1/', ''), r.role]));
    for (const j of sent) expect(j.text.startsWith('[cheerfully] ')).toBe(/^\[cheerfully\] /.test(j.text) && rows.some((r) => ['battery', 'instruction'].includes(r.role)));
    expect(sent.some((j) => j.text.startsWith('[cheerfully] '))).toBe(true);
    expect(sent.some((j) => !j.text.startsWith('['))).toBe(true);
    expect(roleOf.size).toBeGreaterThan(0);
  }
  const t = voicedWithTashdeed(manifest).find((r) => Voice.sayAs(r.say, 'ur', { voice: 'Ishita' }) !== r.say);
  if (t) {
    const { sent } = await record(['--set', 'v4', '--lang', 'ur']);
    expect(sent.some((j) => j.text === t.say || j.text === `[cheerfully] ${t.say}`)).toBe(true);
  }
});

test('a mood tag goes on battery and task lines only, never on an item, an answer or a passage', async () => {
  const { sent } = await record(['--set', 'v4', '--lang', 'en', '--provider', 'soniox']);
  const byText = new Map(manifest.filter((r) => r.lang === 'en').map((r) => [r.text, r.role]));
  for (const j of sent) {
    const tagged = j.text.startsWith('[warm] ');
    const role = byText.get(tagged ? j.text.slice(7) : j.text);
    expect([j.text, tagged]).toEqual([j.text, ['battery', 'instruction'].includes(role)]);
  }
  expect(sent.every((j) => j.voice === 'Priya')).toBe(true);
});

test('ElevenLabs: the picked voice, no respelling, tashdeed kept; Uplift: no speed and no tag', async () => {
  const el = await record(['--set', 'v4', '--lang', 'ur', '--provider', 'elevenlabs', '--voice', 'VOICE1', '--speed', '0.9']);
  expect(el.sent.every((j) => j.voice === 'VOICE1' && j.speed === 0.9)).toBe(true);
  const t = voicedWithTashdeed(manifest).find((r) => Voice.sayAs(r.say, 'ur', { voice: 'Ishita' }) !== r.say);
  if (t) expect(el.sent.some((j) => j.text === t.say || j.text === `[warmly] ${t.say}`)).toBe(true);
  const up = await record(['--set', 'v4', '--lang', 'ur', '--provider', 'uplift', '--voice', 'v_x', '--only', 'battery']);
  expect(up.sent.length).toBeGreaterThan(0);
  expect(up.sent.every((j) => j.speed === null && !j.text.startsWith('['))).toBe(true);
});

test('a clip already on disk is kept; the spend cap stops before the next line', async () => {
  const first = await record(['--set', 'v4', '--lang', 'en', '--only', 'battery']);
  const again = await run(['--set', 'v4', '--lang', 'en', '--only', 'battery', '--apply'], {
    outDir: first.dir, out: () => {}, synth: async () => { throw new Error('should not be called'); }, level: async (b) => b });
  expect(again.recorded).toBe(0);
  const capped = await run(['--set', 'v4', '--lang', 'en', '--apply', '--max-usd', '0'], {
    outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4-')), out: () => {}, synth: async () => ({ audio: Buffer.alloc(9000) }), level: async (b) => b });
  expect(capped.recorded).toBe(0);
  expect(capped.stopped).toBe('max_usd');
});

test('the provider requests are the samples\' settings', () => {
  const s = P.requestFor({ provider: 'soniox', voice: 'Ishita', speed: 0.85, lang: 'ur', text: 'x' }, 'k');
  expect(s.url).toBe('https://tts-rt.soniox.com/tts');
  expect(s.body).toMatchObject({ model: 'tts-rt-v2', voice: 'Ishita', language: 'ur', speed: 0.85, audio_format: 'mp3' });
  const e = P.requestFor({ provider: 'elevenlabs', voice: 'V', speed: 1, lang: 'ur', text: 'x' }, 'k');
  expect(e.body).toEqual({ text: 'x', model_id: 'eleven_v3', voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0, use_speaker_boost: true } });
  expect(P.requestFor({ provider: 'elevenlabs', voice: 'V', speed: 0.9, lang: 'ur', text: 'x' }, 'k').body.voice_settings.speed).toBe(0.9);
  const u = P.requestFor({ provider: 'uplift', voice: 'v_x', lang: 'ur', text: 'x' }, 'k');
  expect(u.body).toEqual({ voiceId: 'v_x', text: 'x', outputFormat: 'MP3_22050_128' });
});

test('the synthesizer posts the request and returns the mp3 bytes; a 4xx fails at once', async () => {
  const calls = [];
  const ok = await P.synthesize({ provider: 'uplift', voice: 'v', lang: 'ur', text: 'abc' }, {
    env: { UPLIFT_API_KEY: 'k' }, sleep: async () => {},
    fetchImpl: async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { status: 200, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => new Uint8Array(1000).buffer }; } });
  expect(ok.audio.length).toBe(1000);
  expect(calls[0][1].voiceId).toBe('v');
  let n = 0;
  await expect(P.synthesize({ provider: 'uplift', voice: 'v', lang: 'ur', text: 'abc' }, {
    env: { UPLIFT_API_KEY: 'k' }, sleep: async () => {},
    fetchImpl: async () => { n += 1; return { status: 401, headers: { get: () => 'application/json' }, arrayBuffer: async () => Buffer.from('{"e":1}') }; } })).rejects.toThrow(/401/);
  expect(n).toBe(1);
});

test('ElevenLabs is given an Urdu line\'s numbers as Urdu words (it reads «۶» as Persian); Soniox keeps the digits', async () => {
  expect(P.spellUrduNumbers('۶ ضرب ۶')).toBe('چھ ضرب چھ');
  expect(P.spellUrduNumbers('۶۴ منفی ۲۶')).toBe('چونسٹھ منفی چھبیس');
  expect(P.spellUrduNumbers('۵۱۳۷')).toBe('پانچ ہزار ایک سو سینتیس');
  expect(P.spellUrduNumbers('۱۰۰ اور ۳۰۰')).toBe('سو اور تین سو'.replace(/^سو/, 'ایک سو'));
  expect(P.spellUrduNumbers('آگے کیا آئے گا؟ ۲، ۲، ۱')).toBe('آگے کیا آئے گا؟ دو، دو، ایک');
  expect(P.spellUrduNumbers('۴ ۰۱۰')).toBe('چار ہزار دس');
  expect(P.spellUrduNumbers('۹۹ ۰۰۶')).toBe('ننانوے ہزار چھ');
  expect(P.spellUrduNumbers('۰.۰۹')).toBe('صفر اعشاریہ صفر نو');
  expect(P.spellUrduNumbers('۱۲۵ ۰۰۰')).toBe('ایک لاکھ پچیس ہزار');
  const digit = manifest.find((r) => r.lang === 'ur' && /[۰-۹]/.test(r.text) && r.role === 'item');
  expect(digit).toBeTruthy();
  const el = await record(['--set', 'v4', '--lang', 'ur', '--only', 'item']);
  const sent = el.sent.find((j) => j.text.includes(P.spellUrduNumbers(digit.text).split(' ')[0]) && !/[۰-۹]/.test(j.text));
  expect(sent).toBeTruthy();
  expect(el.sent.filter((j) => /[۰-۹0-9]/.test(j.text)).map((j) => j.text)).toEqual([]);
  const sx = await record(['--set', 'v4', '--lang', 'ur', '--only', 'item', '--provider', 'soniox']);
  expect(sx.sent.some((j) => /[۰-۹]/.test(j.text))).toBe(true);
});

test('ElevenLabs is given an English line\'s numbers as English words (a bare «4» can come out in another language)', async () => {
  expect(P.spellEnglishNumbers('4')).toBe('four');
  expect(P.spellEnglishNumbers('4 010')).toBe('four thousand ten');
  expect(P.spellEnglishNumbers('99 006')).toBe('ninety-nine thousand six');
  expect(P.spellEnglishNumbers('368')).toBe('three hundred sixty-eight');
  expect(P.spellEnglishNumbers('0.09')).toBe('zero point zero nine');
  expect(P.spellEnglishNumbers('What comes next? 2, 2, 1')).toBe('What comes next? two, two, one');
  expect(P.spellEnglishNumbers('What number is this? 1,000 + 300')).toBe('What number is this? one thousand + three hundred');
  const { sent } = await record(['--set', 'v4', '--lang', 'en', '--only', 'item']);
  expect(sent.filter((j) => /\d/.test(j.text)).map((j) => j.text)).toEqual([]);
  const sx = await record(['--set', 'v4', '--lang', 'en', '--only', 'item', '--provider', 'soniox']);
  expect(sx.sent.some((j) => /\d/.test(j.text))).toBe(true);
});
