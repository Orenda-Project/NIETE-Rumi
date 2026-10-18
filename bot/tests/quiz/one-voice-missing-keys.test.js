'use strict';
/**
 * The pre-flip check for app_settings `web_quiz_one_voice` (scripts/quiz/one-voice-missing-keys.js): under the EXACT
 * plan the switch will carry, every Jugnu challenge clip a child can be served (the warm job's own list: listening
 * stories, prompts, options, Story Time read-along clips) is looked up under the key the bot will compute, and the
 * shared-line set of each language's plan voice must exist. Read-only: no recording, no write. Prints ids, never text.
 * Faked boundaries: Supabase, R2, TTS, the LLM clients. The challenge service, the warm list and the item bank run for real.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), generateCorrelationId: () => 'test', runWithCorrelation: (_id, fn) => fn(),
}));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: false })),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key) => `https://signed.test/${key}`),
  listKeys: jest.fn(async () => []),
  deleteKey: jest.fn(async () => true),
  deleteAudio: jest.fn(async () => true),
  getPresignedUploadUrl: jest.fn(),
  getPresignedUrl: jest.fn(),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  downloadFromR2: jest.fn(),
}));
jest.mock('../../shared/services/tts', () => ({ synthesize: jest.fn() }));
jest.mock('../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../shared/services/gpt5-mini.service', () => ({ analyzePedagogy: jest.fn(), extractReflectiveCorpus: jest.fn() }));
jest.mock('@anthropic-ai/sdk', () => {
  class Anthropic { constructor() { this.messages = { create: jest.fn() }; } }
  Anthropic.default = Anthropic;
  Anthropic.APIError = class APIError extends Error {};
  return Anthropic;
}, { virtual: true });
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-used';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeFake } = require('./web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const r2 = require('../../shared/storage/r2');
const tts = require('../../shared/services/tts');
const Bank = require('../../shared/services/child-test/item-bank');
const Ch = require('../../shared/services/quiz/web-quiz-challenge');
const OneVoice = require('../../shared/services/quiz/web-quiz-one-voice-flag');
const Voice = require('../../shared/services/quiz/web-quiz-voice');
const MK = require('../../scripts/quiz/one-voice-missing-keys');

const REF = 'abcdefghijklmnopqrst';
const ENV = { SUPABASE_URL: `https://${REF}.supabase.co` };
const NOW = Date.parse('2026-10-16T06:00:00Z');
const DAY = 24 * 3600 * 1000;
const row = (id, lang, kind) => ({ passage_id: id, lang, kind, pool: 'check', band: 2, status: 'calibrated', released_at: new Date(NOW - DAY).toISOString(), withdrawn_at: null });
const V2_BELLA = { provider: 'elevenlabs', voice: 'hpp4J3VqNfWAUOO0d1Us', name: 'Bella', model: 'eleven_multilingual_v2',
  settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 0.9 } };
const SARA = { provider: 'elevenlabs', voice: '9cI5mhBtM4WtQ9Fo6jWQ', name: 'Sara', model: 'eleven_v4',
  settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } };
const PLAN = JSON.stringify({ voices: { en: V2_BELLA, ur: SARA }, kbps: 32 });

let dir;
const pointer = (id, lang, kind, v3kind) => ({ passage_id: id, lang, kind, band: 2, pool: 'check', is_reference: true, v3_ref: { lang, kind: v3kind }, questions_extra: [], bank_version: 'child-test-items-v3' });
beforeAll(() => {
  process.env.R2_BUCKET_NAME = 'r2-default';
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-voice-missing-keys-'));
  for (const p of [pointer('en.listen.2.setA', 'en', 'listen', 'listening'), pointer('ur.read.2.setA', 'ur', 'read', 'story')]) {
    fs.writeFileSync(path.join(dir, `${p.passage_id}.json`), JSON.stringify(p));
  }
  Bank._loadPassagesFrom(dir);
});
afterAll(() => { Bank._loadPassagesFrom(); fs.rmSync(dir, { recursive: true, force: true }); });

beforeEach(() => {
  // The sandbox switch itself is absent: the check computes the keys of the plan it is GIVEN, not of the live value.
  Object.assign(supabase, makeFake({ app_settings: [{ key: 'web_quiz_challenge_option_audio', value: true }],
    challenge_passages: [row('en.listen.2.setA', 'en', 'listen'), row('ur.read.2.setA', 'ur', 'read')] }));
  Ch.__reset(); OneVoice.reset(); jest.clearAllMocks();
});

async function run(argv, { env = ENV } = {}) {
  const lines = [];
  const r = await MK.main(argv, { env, print: (l) => lines.push(l), now: NOW });
  return { r, lines };
}

test('refuses another project, and a value that names no plan: nothing is read', async () => {
  expect((await run(['--expect-ref', 'zzzzzzzzzzzzzzzzzzzz', '--plan', PLAN])).r).toEqual({ refused: true });
  expect((await run(['--expect-ref', REF, '--plan', '"true"'])).r).toEqual({ refused: true });
  expect(supabase.calls.filter((c) => c.table === 'challenge_passages')).toEqual([]);
  expect(r2.headObject).not.toHaveBeenCalled();
});

test('nothing uploaded yet: every clip is missing, listed by passage and part (never its words), and nothing is recorded', async () => {
  const { r, lines } = await run(['--expect-ref', REF, '--plan', PLAN]);
  expect(r.ok).toBe(false);
  expect(r.total).toBeGreaterThan(3);
  expect(r.missing).toBe(r.total);
  // the keys are the plan's rendering (Bella on v2 at 0.9), not the live value's
  const asked = r2.headObject.mock.calls.map(([k]) => k);
  expect(asked.filter((k) => k.includes('/en/')).every((k) => k.includes('-el-bella-cff2e4-'))).toBe(true);
  expect(asked.filter((k) => k.includes('/ur/')).every((k) => k.includes('-el-sara-'))).toBe(true);
  expect(lines.filter((l) => l.startsWith('missing\t')).length).toBe(r.total);
  expect(lines.some((l) => l.startsWith('missing\ten.listen.2.setA\ten\tlisten/story'))).toBe(true);
  const p = Bank.getPassage('en.listen.2.setA');
  expect(lines.join('\n')).not.toContain(p.text.slice(0, 20));
  expect(tts.synthesize).not.toHaveBeenCalled();
  expect(r2.uploadBuffer).not.toHaveBeenCalled();
});

test('every key present and both shared-line sets exist: ok, 0 missing', async () => {
  r2.headObject.mockResolvedValue({ exists: true });
  const { r, lines } = await run(['--expect-ref', REF, '--plan', PLAN]);
  expect(r).toMatchObject({ ok: true, missing: 0, shared: { en: 'el-bella-cff2e4', ur: 'el-sara' } });
  expect(lines[lines.length - 1]).toMatch(/^SUMMARY present=\d+ total=\d+ missing=0 shared=en:el-bella-cff2e4,ur:el-sara ok=yes$/);
});

test('the rate is in the key: clips present at 64 kb/s under a 32 kb/s plan are missing (wrong rate), at 64 they are ok', async () => {
  r2.headObject.mockImplementation(async (k) => ({ exists: !/-k32-/.test(k) }));   // only 64 kb/s clips in the store
  const at32 = await run(['--expect-ref', REF, '--plan', PLAN]);
  expect(at32.r).toMatchObject({ ok: false, present: 0 });
  expect(at32.r.missing).toBe(at32.r.total);
  OneVoice.reset(); r2.headObject.mockClear();
  const at64 = await run(['--expect-ref', REF, '--plan', JSON.stringify({ voices: { en: V2_BELLA, ur: SARA }, kbps: 64 })]);
  expect(at64.r).toMatchObject({ ok: true, missing: 0 });
  expect(r2.headObject.mock.calls.some(([k]) => /-k\d+-/.test(k))).toBe(false);
});

test('a plan voice with no shared-line set is not ok, even with every clip present', async () => {
  r2.headObject.mockResolvedValue({ exists: true });
  const jessica = JSON.stringify({ voices: { en: { provider: 'elevenlabs', voice: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', model: 'eleven_v4' } } });
  const { r, lines } = await run(['--expect-ref', REF, '--plan', jessica]);
  expect(r).toMatchObject({ ok: false, missing: 0, shared: { en: null, ur: 'today' } });
  expect(lines).toContain('missing\tshared-lines\ten\tel-jessica');
});

test('a language the plan leaves out is today\'s: its clips are looked up under today\'s keys, its shared lines are today\'s', async () => {
  r2.headObject.mockResolvedValue({ exists: true });
  const reva = { provider: 'elevenlabs', voice: 'o85TqPN3F4P7dWae2paA', name: 'Reva', model: 'eleven_v4',
    settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 } };
  const { r, lines } = await run(['--expect-ref', REF, '--plan', JSON.stringify({ voices: { ur: reva } })]);
  expect(lines[0]).toMatch(/ en=today ur=el-reva-cc0c3b$/);
  expect(r).toMatchObject({ ok: true, missing: 0, shared: { en: 'today', ur: 'el-reva-cc0c3b' } });
  const asked = r2.headObject.mock.calls.map(([k]) => k);
  expect(asked.filter((k) => k.includes('/en/')).length).toBeGreaterThan(0);
  expect(asked.filter((k) => k.includes('/en/')).every((k) => k.includes(`-${Voice.voiceTag('en')}-`))).toBe(true);
  expect(asked.filter((k) => k.includes('/ur/')).every((k) => k.includes('-el-reva-cc0c3b-'))).toBe(true);
});

/*
 * --record-short: the short lines (prompts and options) are recorded BEFORE the flip by the bot's own recorder under the
 * pinned plan, each through a light gate: a clip of a plausible length for its words, and for a question of 4+ words one
 * transcription with WER ≤ 0.20 (EN) / 0.25 (UR). A clip that fails is recorded once more; failing again it is deleted
 * and listed. The long clips (listening stories, Story Time read-along) are never recorded here: they are gated takes.
 */
describe('--record-short', () => {
  const ok = (text) => ({ audio: Buffer.from('OggS'), provider: 'elevenlabs', voice: 'v', durationSec: Math.max(0.6, [...String(text)].length / 15) });
  const echo = async (_audio, _lang, text) => text;   // a transcription that hears exactly the words
  async function rec(argv, deps = {}) {
    const lines = [];
    const r = await MK.main(argv, { env: ENV, print: (l) => lines.push(l), now: NOW, ...deps });
    return { r, lines };
  }
  const isLong = (k) => /\/story-/.test(k);
  beforeEach(() => { r2.headObject.mockResolvedValue({ exists: false }); });   // nothing in the store yet

  test('records every missing prompt and option in the plan voice, never a story; each passes the gate', async () => {
    tts.synthesize.mockImplementation(async ({ text }) => ok(text));
    const stt = jest.fn(async (a, l, text) => text);
    const { r, lines } = await rec(['--expect-ref', REF, '--plan', PLAN, '--record-short', '--max-usd', '5'], { stt: (a, l, t) => stt(a, l, t) });
    const keys = r2.uploadBuffer.mock.calls.map(([, k]) => k);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some(isLong)).toBe(false);
    expect(keys.filter((k) => k.includes('/en/')).every((k) => k.includes('-el-bella-cff2e4-'))).toBe(true);
    tts.synthesize.mock.calls.forEach(([a]) => { if (a.language === 'en') expect(a).toMatchObject({ model: 'eleven_multilingual_v2', outputFormat: 'opus_48000_32' }); });
    expect(r.recorded).toBe(keys.length);
    expect(r.gateFailed).toBe(0);
    expect(stt).toHaveBeenCalled();                                      // the questions of 4+ words were heard
    expect(lines.some((l) => /^SPEND usd=\d+\.\d+ chars=\d+$/.test(l))).toBe(true);
    expect(lines.filter((l) => l.startsWith('recorded\t')).length).toBe(keys.length);
  });

  test('a question heard wrong is recorded once more, then deleted and listed (never kept, never dropped)', async () => {
    // The long clips are already in the store, and so is one short line: only the failed takes can be missing.
    let kept = null;
    r2.headObject.mockImplementation(async (k) => {
      if (!kept && /\/q\d+(-opt)?-(?:sx|el|oa)-/.test(k)) kept = k;
      return { exists: isLong(k) || k === kept };
    });
    tts.synthesize.mockImplementation(async ({ text }) => ok(text));
    const { r, lines } = await rec(['--expect-ref', REF, '--plan', PLAN, '--record-short', '--max-usd', '5'],
      { stt: async (_a, _l, text) => (String(text).split(/\s+/).length >= 4 ? 'something else entirely here today' : text) });
    expect(r.gateFailed).toBeGreaterThan(0);
    const failed = lines.filter((l) => l.startsWith('gate_failed\t'));
    expect(failed.length).toBe(r.gateFailed);
    expect(failed[0]).toMatch(/\twer=/);
    expect(r2.deleteKey.mock.calls.length).toBe(r.gateFailed * 2);   // each failed take removed, both times
    // a deleted take is missing at the end, whatever this process remembers: never ok
    expect(r).toMatchObject({ ok: false, missing: r.gateFailed });
    const missing = new Set(lines.filter((l) => l.startsWith('missing\t')).map((l) => l.split('\t').slice(1, 4).join('\t')));
    failed.forEach((l) => expect(missing.has(l.split('\t').slice(1, 4).join('\t'))).toBe(true));
    // a short line already in the store is never recorded again
    expect(kept).toBeTruthy();
    expect(r2.uploadBuffer.mock.calls.filter(([, k]) => k === kept)).toEqual([]);
  });

  test('a clip far too long or short for its words fails the length gate the same way', async () => {
    tts.synthesize.mockImplementation(async ({ text }) => ({ ...ok(text), durationSec: 40 }));
    const { r, lines } = await rec(['--expect-ref', REF, '--plan', PLAN, '--record-short', '--max-usd', '5'], { stt: echo });
    expect(r.recorded).toBe(0);
    expect(lines.find((l) => l.startsWith('gate_failed\t'))).toMatch(/\tlength=/);
  });

  test('stops before the next clip once the spend reaches --max-usd', async () => {
    tts.synthesize.mockImplementation(async ({ text }) => ok(text));
    const { r, lines } = await rec(['--expect-ref', REF, '--plan', PLAN, '--record-short', '--max-usd', '0.001'], { stt: echo });
    expect(r.recorded).toBe(1);
    expect(lines[lines.length - 1]).toMatch(/stopped=max_usd/);
  });
});
