'use strict';
/**
 * Jugnu's welcome lines (the child's first open of the home): one clip per line and language, in the one-voice plan's
 * voice, in their own folder (dashboard/public/wq/voice/welcome/<set>-<lang>/welcome-<key>.mp3), so the shared-line
 * sets and their hashes stay as they are. The recorder's voice provider is faked; nothing is called without --apply.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Rec = require('../../scripts/quiz/record-welcome-lines');
const Voice = require('../../shared/services/quiz/web-quiz-voice');

const WELCOME_DIR = path.join(__dirname, '..', '..', '..', 'dashboard', 'public', 'wq', 'voice', 'welcome');
const KEYS = ['2', '2s', '3', '4', '4n', '5'];
const PLAN = { kbps: 32, loudness_lufs: -21, voices: { en: { provider: 'soniox', voice: 'Reyna', name: 'Reyna' }, ur: { provider: 'soniox', voice: 'Reyna', name: 'Reyna' } } };
const SET = Voice.setIdOf(PLAN.voices.en);

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wq-welcome-'));
  fs.writeFileSync(path.join(dir, 'lines.json'), JSON.stringify({ en: { 2: { text: 'Hi!' }, 3: { text: 'Here!' } }, ur: { 2: { text: 'سلام! میں جگنو ہوں۔', say: 'سلام! میں جُگنُو ہوں۔' } } }));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('without --apply: names the folder as the plan names its set, prices the lines, and calls nothing', async () => {
  const tts = { synthesize: jest.fn() };
  const out = [];
  const r = await Rec.run(['--lang', 'en', '--plan-json', JSON.stringify(PLAN)], { tts, out: (l) => out.push(l), welcomeDir: dir, env: {} });
  expect(tts.synthesize).not.toHaveBeenCalled();
  expect(r.path).toBe(`${SET}-en`);
  expect(out[0]).toMatch(/lines=2 .*\(dry run\)/);
  expect(fs.existsSync(path.join(dir, `${SET}-en`))).toBe(false);
});

test('with --apply: one call a line, the respelling is what the voice says, the page text is what the manifest keeps', async () => {
  const tts = { synthesize: jest.fn(async () => ({ audio: Buffer.alloc(2000, 1), durationSec: 1.5 })) };
  const level = jest.fn(async (a) => a);
  const spend = path.join(dir, 'spend.jsonl');
  const r = await Rec.run(['--lang', 'ur', '--plan-json', JSON.stringify(PLAN), '--apply', '--spend-log', spend], { tts, level, out: () => {}, welcomeDir: dir, env: { SONIOX_API_KEY: 'k' } });
  expect(tts.synthesize).toHaveBeenCalledTimes(1);
  expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ text: 'سلام! میں جُگنُو ہوں۔', language: 'ur', provider: 'soniox', voice: 'Reyna' });
  expect(level).toHaveBeenCalledWith(expect.any(Buffer), { lufs: -21, kbps: 32 });
  const set = path.join(dir, `${SET}-ur`);
  expect(fs.existsSync(path.join(set, 'welcome-2.mp3'))).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(set, 'manifest.json'), 'utf8'))).toEqual({ lang: 'ur', voice: PLAN.voices.ur, lines: { 2: 'سلام! میں جگنو ہوں۔' } });
  expect(fs.readFileSync(spend, 'utf8').trim().split('\n')).toHaveLength(1);
  expect(r.recorded).toBe(1);
  // a second run keeps what is on disk
  await Rec.run(['--lang', 'ur', '--plan-json', JSON.stringify(PLAN), '--apply'], { tts, level, out: () => {}, welcomeDir: dir, env: { SONIOX_API_KEY: 'k' } });
  expect(tts.synthesize).toHaveBeenCalledTimes(1);
});

test('the recorded welcome: every line in both languages, in the plan voice, under 4.5 s, the words the page shows', () => {
  const lines = JSON.parse(fs.readFileSync(path.join(WELCOME_DIR, 'lines.json'), 'utf8'));
  for (const lang of ['en', 'ur']) {
    expect(Object.keys(lines[lang]).sort()).toEqual([...KEYS].sort());
    const set = path.join(WELCOME_DIR, `${SET}-${lang}`);
    const m = JSON.parse(fs.readFileSync(path.join(set, 'manifest.json'), 'utf8'));
    expect(m.voice).toEqual(PLAN.voices[lang]);
    expect(m.lines).toEqual(Object.fromEntries(KEYS.map((k) => [k, lines[lang][k].text])));
    for (const k of KEYS) {
      const b = fs.readFileSync(path.join(set, `welcome-${k}.mp3`));
      expect(b.length).toBeGreaterThan(4000);
      expect(b.length).toBeLessThan(4.5 * 32000 / 8 + 2000);   // 32 kb/s: under 4.5 s
    }
  }
});
