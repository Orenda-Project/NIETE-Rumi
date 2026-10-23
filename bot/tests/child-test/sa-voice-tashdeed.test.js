'use strict';

/**
 * The Urdu narrations voiced with tashdeed (switch sa_voice_tashdeed): the voice is given each line with its doubled
 * letters marked, the screen keeps the line as written, and the clip keeps the line's key under sa/v3/ur/.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');
const { tashdeedOf, voicedWithTashdeed } = require('../../shared/services/child-test/sa/ur-tashdeed');
const { run, loadBank } = require('../../scripts/child-test/record-sa-voice');

const manifest = voiceManifest(loadBank());
const MARKS = /[ً-ٰٟ]/gu;
const bare = (s) => String(s).replace(MARKS, '');

describe('tashdeedOf', () => {
  test('marks the doubled letter in the narrations\' words', () => {
    expect(tashdeedOf('السلام علیکم!')).toBe('السّلام علیکم!');
    expect(tashdeedOf('ایک بس میں ۴ بچے ہیں۔')).toBe('ایک بس میں ۴ بچّے ہیں۔');
    expect(tashdeedOf('اس لیے یہ حصہ چھوڑ رہے ہیں')).toBe('اس لیے یہ حصّہ چھوڑ رہے ہیں');
    expect(tashdeedOf('ہجے نہ کریں')).toBe('ہجّے نہ کریں');
    expect(tashdeedOf('یہ اردو حروفِ تہجی کا صفحہ ہے۔')).toBe('یہ اردو حروفِ تہجّی کا صفحہ ہے۔');
  });

  test('whole words only, and a word already marked stays as it is', () => {
    expect(tashdeedOf('بچوں')).toBe('بچّوں');
    expect(tashdeedOf('بچّے')).toBe('بچّے');
    expect(tashdeedOf('بلیاں')).toBe('بلیاں');
  });

  test('a short verb that reads two ways gets its vowel in its phrase only', () => {
    expect(tashdeedOf('رک جائیں۔')).toBe('رُک جائیں۔');
    expect(tashdeedOf('بس میں کل کتنی گاڑیاں ہیں؟')).toBe('بس میں کُل کتنی گاڑیاں ہیں؟');
    expect(tashdeedOf('کل عائشہ کے اسکول میں')).toBe('کل عائشہ کے اسکول میں');
  });

  test('on every Urdu line, only marks are added: the letters are the line\'s own', () => {
    for (const r of manifest.filter((m) => m.lang === 'ur')) expect(bare(tashdeedOf(r.text))).toBe(bare(r.text));
  });

  test('the narrations it changes are the ones with a listed word, not items or passages', () => {
    const changed = voicedWithTashdeed(manifest);
    expect(changed.length).toBeGreaterThanOrEqual(10);
    for (const r of changed) {
      expect(r.lang).toBe('ur');
      expect(['battery', 'instruction', 'feedback', 'question', 'problem', 'check']).toContain(r.role);
      expect(r.say).not.toBe(r.text);
    }
    expect(changed.map((r) => r.text)).toEqual(expect.arrayContaining(['بلی']));
  });
});

describe('record-sa-voice --set v3', () => {
  const env = { SONIOX_API_KEY: 'test' };
  const tts = { synthesize: jest.fn(async () => ({ audio: Buffer.alloc(800, 1), durationSec: 2 })) };
  const level = jest.fn(async (a) => a);

  test('voices only the changed Urdu lines, in Ishita, with tashdeed, under sa/v3/ur with the line\'s own key', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-voice-'));
    const want = voicedWithTashdeed(manifest);
    const r = await run(['--lang', 'ur', '--set', 'v3', '--apply', '--max-usd', '1'], { tts, level, out: () => {}, env, outDir });
    expect(r.lines).toBe(want.length);
    expect(r.recorded).toBe(want.length);
    const calls = tts.synthesize.mock.calls.map((c) => c[0]);
    expect(calls.every((c) => c.voice === 'Ishita' && c.language === 'ur')).toBe(true);
    expect(calls.filter((c) => c.text.startsWith('السّلام علیکم! جگنو')).length).toBeGreaterThan(0);
    expect(calls.some((c) => /السلام/.test(c.text))).toBe(false);
    for (const w of want) expect(fs.existsSync(path.join(outDir, w.key.replace('sa/v1/', 'sa/v3/')))).toBe(true);
  });

  test('--set v3 is Urdu only', async () => {
    await expect(run(['--lang', 'en', '--set', 'v3'], { tts, level, out: () => {}, env })).rejects.toThrow(/v3/);
  });
});

describe('the tashdeed clips', () => {
  test('every changed Urdu narration has its clip on disk under sa/v3/ur, an mp3 with sound', () => {
    const dash = path.join(__dirname, '..', '..', '..', 'dashboard');
    const missing = voicedWithTashdeed(manifest).map((r) => r.key.replace('sa/v1/', 'sa/v3/')).filter((k) => {
      const f = path.join(dash, k);
      if (!fs.existsSync(f) || fs.statSync(f).size <= 500) return true;
      const head = fs.readFileSync(f).subarray(0, 3);
      return !(head.toString('latin1') === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0));
    });
    expect(missing).toEqual([]);
  });
});
