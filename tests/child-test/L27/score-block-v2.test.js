'use strict';
/**
 * bd-s1oo0.46.3 (L27) — scoreBlock under the v2 switches, end to end, with ONLY the boundaries mocked
 * (Soniox + SpeechAce HTTP via axios, OpenRouter via the openai SDK, R2 via the S3 client, the ffmpeg
 * subprocess) and the L3 store injected. The real item bank (v2), AudioService, windows, scorers and
 * assembler run.
 *   CHILD_TEST_BATTERY=v2 (default): Urdu/English score story + questions (+ fallback) only.
 *   CHILD_TEST_MATHS_MODE=oral (default): maths is scored from the voice note alone.
 */

const T = require('../L5/fixtures/transcripts');
const O = require('./oral-transcripts');

// ---- R2 (S3) ----------------------------------------------------------------
jest.mock('@aws-sdk/client-s3', () => {
  class S3Client { async send() { return { Body: (async function* body() { yield Buffer.from('OggS-fake-audio'); }()) }; } }
  const cmd = () => class { constructor(input) { this.input = input; } };
  return { S3Client, GetObjectCommand: cmd(), PutObjectCommand: cmd(), DeleteObjectCommand: cmd(), HeadObjectCommand: cmd(), ListObjectsV2Command: cmd() };
});

// ---- ffmpeg subprocess ------------------------------------------------------
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  const fs = jest.requireActual('fs');
  return {
    ...actual,
    execFile: jest.fn((bin, args, opts, cb) => {
      if (args.includes('-hide_banner')) {                       // probe
        const err = new Error('no output'); cb(err, '', `  Duration: 00:01:${String(global.__noteSeconds - 60).padStart(2, '0')}.00, start: 0`); return;
      }
      fs.writeFileSync(args[args.length - 1], Buffer.from('clip')); // cut
      cb(null, '', '');
    }),
  };
});

// ---- multipart upload: consume the file stream the way the real form-data does ----------
jest.mock('form-data', () => class FormData {
  append(_k, v) { if (v && typeof v.destroy === 'function') { v.on('error', () => {}); v.destroy(); } }
  getHeaders() { return { 'content-type': 'multipart/form-data' }; }
});

// ---- OpenRouter -------------------------------------------------------------
const mockCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a) => mockCreate(...a) } }, audio: { transcriptions: { create: jest.fn(async ({ file }) => { if (file && file.destroy) { file.on('error', () => {}); file.destroy(); } throw new Error('whisper down'); }) } } })));

jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const axios = require('axios');
const { scoreBlock } = require('../../../bot/shared/services/child-test/scoring');

const reply = (obj, cost = 0.004) => ({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: { cost, prompt_tokens: 10, completion_tokens: 10 } });
const promptOf = (req) => { const c = req.messages[0].content; return typeof c === 'string' ? c : c[0].text; };
const prompts = () => mockCreate.mock.calls.map(([r]) => promptOf(r));

function sonioxReturns(script) {
  const tokens = T.tokensFrom(script);
  axios.post.mockImplementation(async (url) => {
    if (url.includes('api.soniox.com/v1/files')) return { data: { id: 'file-1' } };
    if (url.includes('api.soniox.com/v1/transcriptions')) return { data: { id: 'tr-1' } };
    return { data: {} };
  });
  axios.get.mockImplementation(async (url) => {
    if (url.endsWith('/transcript')) return { data: { text: tokens.map((t) => t.text).join(''), tokens } };
    if (url.includes('/v1/transcriptions/')) return { data: { status: 'completed' } };
    return { data: {} };
  });
  axios.delete.mockResolvedValue({ data: {} });
}

function routeModels() {
  mockCreate.mockImplementation(async (req) => {
    const p = promptOf(req);
    if (p.includes('reading aloud from a printed')) return reply({ words: Array.from({ length: 20 }, (_, i) => ({ i: i + 1, v: 'correct' })), words_correct: 0, words_attempted: 0 }, 0.009);
    if (p.includes('reading-comprehension')) {
      const ids = [...new Set(p.match(/[ue][35][AB]-q\d/g))];
      return reply({ questions: ids.map((id) => ({ id, answer: 'x', verdict: 'correct', confidence: 0.9 })) }, 0.001);
    }
    if (p.includes('FIRST SOUNDS')) return reply({ first_sounds: [], nonwords: [] }, 0.003);
    if (p.includes('maths word problem')) return reply({ answer: p.includes('بسکٹ') ? '6' : '10', verdict: 'correct', confidence: 0.8 }, 0.001);
    if (p.includes('Find where each of these sections starts')) return reply({ sections: {} }, 0.001);
    throw new Error(`unrouted prompt: ${p.slice(0, 60)}`);
  });
}

function fakeStore(block) {
  const saved = []; const statuses = [];
  return {
    saved, statuses,
    getBlock: jest.fn(async () => ({ ok: true, block })),
    setAiStatus: jest.fn(async (row) => { statuses.push(row); return { ok: true }; }),
    saveAiMarks: jest.fn(async (row) => { saved.push(row); return { ok: true, block: { ...block, ai_marks: row.aiMarks } }; }),
  };
}

const realBank = require('../../../bot/shared/services/child-test/item-bank');
const STORY = realBank.getBlock(3, 'A', 'urdu').story.tokens;
const UQ = realBank.getBlock(3, 'A', 'urdu').questions;
const URDU_V2 = [
  [1, 0.5, realBank.getScript(3, 'A', 'urdu').start],
  [2, 6, STORY.slice(0, 10).join(' ')],
  [2, 20, STORY.slice(10, 20).join(' ')],
  [1, 66, 'بس شکریہ'],
  [1, 68, realBank.cue.urdu.questions],
  [1, 72, UQ[0].prompt], [2, 76, 'ابو کے ساتھ'],
  [1, 79, UQ[1].prompt], [2, 83, 'کشتی'],
  [1, 86, UQ[2].prompt], [2, 89, 'پتھر جمع کیے'],
];

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SONIOX_API_KEY = 'test-soniox';
  process.env.OPENROUTER_API_KEY = 'test-or';
  Object.assign(process.env, { R2_ENDPOINT: 'https://r2.test', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET_NAME: 'rumi-sandbox' });
  delete process.env.SPEECHACE_API_KEY;
  delete process.env.CHILD_TEST_BATTERY;
  delete process.env.CHILD_TEST_MATHS_MODE;
  routeModels();
});

describe('battery v2 (default): story, questions, fallback only', () => {
  test('Urdu: no first sounds or made-up words scored or expected, no flag for their absence; ai-marks-v2', async () => {
    global.__noteSeconds = 95;
    sonioxReturns(URDU_V2);
    const store = fakeStore({ id: 'b1', session_id: 's1', block: 'urdu', audio_r2_key: 'k', ai_marks: null });
    const res = await scoreBlock({ sessionId: 's1', block: 'urdu', grade: 3, form: 'A' }, { store });
    expect(res).toEqual({ ok: true, aiStatus: 'scored' });
    expect(prompts().some((p) => p.includes('FIRST SOUNDS'))).toBe(false);
    expect(prompts().some((p) => p.includes('Find where each of these sections starts'))).toBe(false);
    const { aiMarks, aiStatus } = store.saved[0];
    expect(aiStatus).toBe('scored');
    expect(aiMarks.version).toBe('ai-marks-v2');
    expect(aiMarks.battery).toBe('v2');
    expect(aiMarks.first_sounds).toEqual([]);
    expect(aiMarks.nonwords).toEqual([]);
    expect(aiMarks.questions.map((q) => q.id)).toEqual(['u3A-q1', 'u3A-q2', 'u3A-q3']);
    expect(aiMarks.story.words_correct).toBe(20);
    expect(aiMarks.protocol_flags).toEqual([]);
    expect(aiMarks.meta.calls.map((c) => c.job)).not.toContain('phonics');
  });

  test('English: all three questions go to the grader and come back in the marks', async () => {
    global.__noteSeconds = 90;
    const E = realBank.getBlock(3, 'A', 'english');
    sonioxReturns([[1, 0.5, realBank.getScript(3, 'A', 'english').start], [2, 5, E.story.tokens.slice(0, 20).join(' ')],
      [1, 66, 'Stop thank you'], [1, 68, realBank.cue.english.questions],
      [1, 72, E.questions[0].prompt], [2, 76, 'trees'], [1, 79, E.questions[1].prompt], [2, 83, 'plant'],
      [1, 86, E.questions[2].prompt], [2, 90, 'he did good work']]);
    const store = fakeStore({ id: 'b2', session_id: 's2', block: 'english', audio_r2_key: 'k', ai_marks: null });
    const res = await scoreBlock({ sessionId: 's2', block: 'english', grade: 3, form: 'A' }, { store });
    expect(res.ok).toBe(true);
    const comp = prompts().find((p) => p.includes('reading-comprehension'));
    for (const id of ['e3A-q1', 'e3A-q2', 'e3A-q3']) expect(comp).toContain(id);
    expect(store.saved[0].aiMarks.questions.map((q) => q.id)).toEqual(['e3A-q1', 'e3A-q2', 'e3A-q3']);
    expect(store.saved[0].aiMarks.nonwords).toEqual([]);
    expect(store.saved[0].aiStatus).toBe('scored');
  });

  test('CHILD_TEST_BATTERY=v1 keeps the v1 battery: first sounds and made-up words are scored, ai-marks-v1', async () => {
    process.env.CHILD_TEST_BATTERY = 'v1';
    global.__noteSeconds = 95;
    sonioxReturns([...URDU_V2, [1, 92, realBank.cue.urdu.first_sounds], [2, 95, 'ا']]);
    const store = fakeStore({ id: 'b3', session_id: 's3', block: 'urdu', audio_r2_key: 'k', ai_marks: null });
    await scoreBlock({ sessionId: 's3', block: 'urdu', grade: 3, form: 'A' }, { store });
    expect(prompts().some((p) => p.includes('FIRST SOUNDS'))).toBe(true);
    const { aiMarks } = store.saved[0];
    expect(aiMarks.version).toBe('ai-marks-v1');
    expect(aiMarks.first_sounds).toHaveLength(5);
    expect(aiMarks.nonwords).toHaveLength(5);
  });
});

describe('oral maths (default): one voice note, no photo', () => {
  test('scored straight after the voice note: compare, sums and both word problems, with heard + confidence', async () => {
    global.__noteSeconds = 90;
    sonioxReturns(O.G3A_MIXED);
    const store = fakeStore({ id: 'm1', session_id: 'sm', block: 'maths', audio_r2_key: 'a', photo_r2_key: null, ai_marks: null });
    const res = await scoreBlock({ sessionId: 'sm', block: 'maths', grade: 3, form: 'A' }, { store });
    expect(res).toEqual({ ok: true, aiStatus: 'scored' });
    expect(store.saveAiMarks).toHaveBeenCalledTimes(1);
    const { aiMarks } = store.saved[0];
    expect(aiMarks.version).toBe('ai-marks-v2');
    expect(aiMarks.maths_mode).toBe('oral');
    const o = aiMarks.maths.oral;
    expect(o.compare.map((r) => r.verdict)).toEqual(['correct', 'correct', 'correct', 'correct']);
    expect(o.sums.map((r) => r.verdict)).toEqual(['correct', 'correct', 'correct', 'none']);
    expect(o.word_problems).toEqual([
      { id: 'm3A-owp1', verdict: 'correct', heard: '6', confidence: 0.85 },
      { id: 'm3A-owp2', verdict: 'wrong', heard: '10', confidence: 0.85 },
    ]);
    for (const r of [...o.compare, ...o.sums, ...o.word_problems]) {
      expect(Object.keys(r).sort()).toEqual(['confidence', 'heard', 'id', 'verdict']);
    }
    // nothing from the strip design is expected
    expect(aiMarks.maths.written).toEqual([]);
    expect(aiMarks.maths.numbers).toEqual([]);
    expect(aiMarks.meta.photo).toBeUndefined();
    expect(aiMarks.model_versions.word_problem).toBe('google/gemini-3-flash-preview');
  });

  test('an all-silent note (the coach moves on every time): every item is no answer, no model is asked', async () => {
    global.__noteSeconds = 96;
    sonioxReturns(O.G3A_SILENT);
    const store = fakeStore({ id: 'm2', session_id: 'sm2', block: 'maths', audio_r2_key: 'a', photo_r2_key: null, ai_marks: null });
    const res = await scoreBlock({ sessionId: 'sm2', block: 'maths', grade: 3, form: 'A' }, { store });
    expect(res).toEqual({ ok: true, aiStatus: 'scored' });
    expect(mockCreate).not.toHaveBeenCalled();
    const o = store.saved[0].aiMarks.maths.oral;
    const all = [...o.compare, ...o.sums, ...o.word_problems];
    expect(all).toHaveLength(10);
    expect(all.every((r) => r.verdict === 'none' && r.heard === '')).toBe(true);
    expect(store.saved[0].aiMarks.protocol_flags).toEqual([]);
  });

  test('CHILD_TEST_MATHS_MODE=strip keeps v1: the voice note alone waits for the photo', async () => {
    process.env.CHILD_TEST_MATHS_MODE = 'strip';
    const store = fakeStore({ id: 'm3', session_id: 'sm3', block: 'maths', audio_r2_key: 'a', photo_r2_key: null, ai_marks: null });
    const res = await scoreBlock({ sessionId: 'sm3', block: 'maths', grade: 3, form: 'A' }, { store });
    expect(res).toEqual({ ok: true, aiStatus: 'pending', reason: 'awaiting_photo' });
  });

  test('oral mode with no voice note: failed with no_media, never pending on a photo', async () => {
    const store = fakeStore({ id: 'm4', session_id: 'sm4', block: 'maths', audio_r2_key: null, photo_r2_key: null, ai_marks: null });
    const res = await scoreBlock({ sessionId: 'sm4', block: 'maths', grade: 3, form: 'A' }, { store });
    expect(res).toEqual({ ok: false, aiStatus: 'failed', reason: 'no_media' });
  });
});
