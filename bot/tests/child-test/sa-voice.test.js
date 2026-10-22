'use strict';

/**
 * Jugnu's SA lines: the manifest names every clip a battery points at, once, and the recorder voices only what is
 * missing, logs one spend line per call and stops at its cap.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');
const { run, loadBank } = require('../../scripts/child-test/record-sa-voice');

const bank = loadBank();
const manifest = voiceManifest(bank);

function audioKeys(x, out = new Set()) {
  if (typeof x === 'string') { if (/^sa\/v1\/(en|ur)\/[0-9a-f]{12}\.mp3$/.test(x)) out.add(x); }
  else if (Array.isArray(x)) x.forEach((v) => audioKeys(v, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((v) => audioKeys(v, out));
  return out;
}

describe('SA voice manifest', () => {
  // RULING #31a addendum: a line naming an other-language item lives only as its chain, so no clip mixes the two.
  test('no English row holds an Arabic-script code point, and no Urdu row a Latin letter', () => {
    const ARABIC = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;
    const LATIN = /[A-Za-z]/;
    expect(manifest.filter((r) => r.lang === 'en' && ARABIC.test(r.text)).map((r) => `${r.key} ${r.text}`)).toEqual([]);
    expect(manifest.filter((r) => r.lang === 'ur' && LATIN.test(r.text)).map((r) => `${r.key} ${r.text}`)).toEqual([]);
  });
  test('every clip key in the bank is in the manifest, once', () => {
    const keys = manifest.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    const want = [...audioKeys(bank)].sort();
    expect(keys.filter((k) => want.includes(k)).sort()).toEqual(want);
  });

  test('a clip is in the language of its folder and has words', () => {
    for (const r of manifest) {
      expect(r.key.startsWith(`sa/v1/${r.lang}/`)).toBe(true);
      expect(r.text.trim()).not.toBe('');
    }
  });

  test('letter names, made-up words and words are marked for a listen by ear', () => {
    const ear = manifest.filter((r) => r.ear_check).map((r) => r.text);
    expect(ear).toEqual(expect.arrayContaining(['بے', 'fut']));
  });

  test('every clip in the manifest is on disk under dashboard/, as an mp3 with sound', () => {
    const dash = path.join(__dirname, '..', '..', '..', 'dashboard');
    const missing = manifest.filter((r) => {
      const f = path.join(dash, r.key);
      if (!fs.existsSync(f) || fs.statSync(f).size <= 500) return true;
      const head = fs.readFileSync(f).subarray(0, 3);
      return !(head.toString('latin1') === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0));
    }).map((r) => r.key);
    expect(missing).toEqual([]);
  });
});

describe('record-sa-voice', () => {
  const env = { SONIOX_API_KEY: 'test' };
  const tts = { synthesize: jest.fn(async () => ({ audio: Buffer.alloc(800, 1), durationSec: 2 })) };
  const level = jest.fn(async (a) => a);

  beforeEach(() => { tts.synthesize.mockClear(); level.mockClear(); });

  test('a dry run calls nothing', async () => {
    const r = await run(['--lang', 'ur'], { tts, level, out: () => {}, env });
    expect(r.recorded).toBe(0);
    expect(r.lines).toBe(manifest.filter((m) => m.lang === 'ur').length);
    expect(tts.synthesize).not.toHaveBeenCalled();
  });

  test('voices missing clips in Reyna, keeps clips on disk, logs each call and stops at the cap', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-voice-'));
    const spend = path.join(outDir, 'spend.jsonl');
    const first = manifest.find((m) => m.lang === 'en' && m.role === 'battery');
    fs.mkdirSync(path.dirname(path.join(outDir, first.key)), { recursive: true });
    fs.writeFileSync(path.join(outDir, first.key), Buffer.alloc(900, 1));
    const usdPerCall = 2 * 0.722 / 3600;
    const r = await run(['--lang', 'en', '--only', 'battery', '--apply', '--max-usd', String(usdPerCall * 3), '--spend-log', spend,
      '--spend-extra', '{"lane":"m-sa-content"}'], { tts, level, out: () => {}, env, outDir });
    expect(r.recorded).toBe(3);
    expect(r.stopped).toBe('max_usd');
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ provider: 'soniox', voice: 'Reyna', language: 'en' });
    expect(tts.synthesize.mock.calls.map((c) => c[0].text)).not.toContain(first.text);
    const lines = fs.readFileSync(spend, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ lane: 'm-sa-content', provider: 'soniox', units: 2 });
  });

  test('--set v2 voices English in Priya and Urdu in Ishita into sa/v2, the key\'s name unchanged', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-voice-'));
    for (const [lang, voice] of [['en', 'Priya'], ['ur', 'Ishita']]) {
      tts.synthesize.mockClear();
      const row = manifest.find((m) => m.lang === lang && m.role === 'battery');
      const r = await run(['--lang', lang, '--only', 'battery', '--set', 'v2', '--apply', '--max-usd', '0.0000001'],
        { tts, level, out: () => {}, env, outDir });
      expect(r.recorded).toBe(1);
      expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ provider: 'soniox', voice, language: lang });
      expect(fs.existsSync(path.join(outDir, row.key.replace('sa/v1/', 'sa/v2/')))).toBe(true);
      expect(fs.existsSync(path.join(outDir, row.key))).toBe(false);
    }
  });

  test('--extra adds lines the bank does not carry yet (same key rule), once', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-voice-'));
    const extra = path.join(outDir, 'extra.json');
    const known = manifest.find((m) => m.lang === 'en');
    fs.writeFileSync(extra, JSON.stringify([
      { key: 'sa/v1/en/000000000abc.mp3', lang: 'en', text: 'All done!', role: 'copy' },
      { key: 'sa/v1/ur/000000000abd.mp3', lang: 'ur', text: 'سب ہو گیا!', role: 'copy' },
      known,
    ]));
    const r = await run(['--lang', 'en', '--extra', extra], { tts, level, out: () => {}, env });
    expect(r.lines).toBe(manifest.filter((m) => m.lang === 'en').length + 1);
  });
});
