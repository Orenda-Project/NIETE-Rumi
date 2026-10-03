'use strict';
/**
 * bd-s1oo0.21 (L16) — every Urdu made-up-word confidence came back exactly 0.6, under its 0.65 bar, so
 * the field could never pre-fill (L14 REPORT Finding 1). Cause: phonics.js capped every made-up word at
 * 0.6, and only English had a second scorer (SpeechAce) to lift it. Urdu's second scorer is the Soniox
 * transcript of the same window — the hearer the story chips already vote with.
 *
 * Harness copied from L5's score-block.test.js: scoreBlock end to end with ONLY the boundaries mocked: Soniox + SpeechAce HTTP (axios),
 * OpenRouter (the openai SDK), R2 (the S3 client), the ffmpeg subprocess (child_process),
 * and the L3 store (injected — its module is another lane's and not merged yet).
 * The real AudioService, windows, scorers and assembler all run.
 */

const bank = require('../L5/fixtures/item-bank.fixture.json');
const T = require('../L5/fixtures/transcripts');

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

function sonioxReturns(script) {
  const tokens = T.tokensFrom(script);
  axios.post.mockImplementation(async (url) => {
    if (url.includes('api.soniox.com/v1/files')) return { data: { id: 'file-1' } };
    if (url.includes('api.soniox.com/v1/transcriptions')) return { data: { id: 'tr-1' } };
    if (url.includes('speechace')) return { data: { status: 'success', text_score: { word_score_list: [] } } };
    return { data: {} };
  });
  axios.get.mockImplementation(async (url) => {
    if (url.endsWith('/transcript')) return { data: { text: tokens.map((t) => t.text).join(''), tokens } };
    if (url.includes('/v1/transcriptions/')) return { data: { status: 'completed' } };
    return { data: {} };
  });
  axios.delete.mockResolvedValue({ data: {} });
}

const reply = (obj, cost = 0.004) => ({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: { cost, prompt_tokens: 10, completion_tokens: 10 } });
const prompt = (req) => {
  const c = req.messages[0].content;
  return typeof c === 'string' ? c : c[0].text;
};

function routeModels({ storyVerdicts, failComprehension = false } = {}) {
  mockCreate.mockImplementation(async (req) => {
    const p = prompt(req);
    if (p.includes('reading aloud from a printed')) {
      return reply({ words: storyVerdicts.map((v, i) => ({ i: i + 1, v })), words_correct: 0, words_attempted: 0 }, 0.009);
    }
    if (p.includes('reading-comprehension')) {
      if (failComprehension) throw new Error('502 upstream');
      return reply({ questions: [
        { id: 'u3A-q1', answer: 'ابو کے ساتھ', verdict: 'correct', confidence: 0.9 },
        { id: 'u3A-q2', answer: 'گرم', verdict: 'wrong', confidence: 0.85 },
        { id: 'u3A-q3', answer: 'آہستہ', verdict: 'correct', confidence: 0.9 },
      ] }, 0.001);
    }
    if (p.includes('FIRST SOUNDS')) {
      return reply({ first_sounds: [{ id: 'u3A-fs1', heard: 'ا', verdict: 'correct', confidence: 0.9 }, { id: 'u3A-fs2', heard: 'ب', verdict: 'correct', confidence: 0.9 }],
        nonwords: [{ id: 'u3A-nw1', heard: 'تمال', verdict: 'correct', confidence: 0.7 }, { id: 'u3A-nw2', heard: 'سوپک', verdict: 'correct', confidence: 0.7 }] }, 0.003);
    }
    if (p.includes('maths word problem')) return reply({ answer: '9', verdict: 'correct', confidence: 0.8 }, 0.001);
    if (p.includes('answer strip')) {
      return reply({ form_code: 'G3-A', items: [
        { id: 'm3A-w1', read: '62', status: 'written', confidence: 0.95 }, { id: 'm3A-w2', read: '44', status: 'written', confidence: 0.9 },
        { id: 'm3A-w3', read: '', status: 'blank', confidence: 0.9 }, { id: 'm3A-w4', read: '', status: 'unreadable', confidence: 0.3 },
        { id: 'm3A-wp', read: '9', status: 'written', confidence: 0.9 }] }, 0.02);
    }
    if (p.includes('Find where each of these sections starts')) {
      return reply({ sections: { story: { start_s: 4.0, end_s: 64.0, confidence: 0.8 } } }, 0.001);
    }
    throw new Error(`unrouted prompt: ${p.slice(0, 60)}`);
  });
}

// L3's published store API (lanes/L3/STORE_API.md): never throws, { ok, ... } results.
function fakeStore(block) {
  const saved = []; const statuses = [];
  return {
    saved, statuses,
    getBlock: jest.fn(async () => ({ ok: true, block })),
    setAiStatus: jest.fn(async (row) => { statuses.push(row); return { ok: true }; }),
    saveAiMarks: jest.fn(async (row) => { saved.push(row); return { ok: true, block: { ...block, ai_marks: row.aiMarks } }; }),
  };
}

const itemBank = { getForm: (g, f) => bank.grades[String(g)].forms[f], cue: bank.cue, version: bank.version };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SONIOX_API_KEY = 'test-soniox';
  process.env.OPENROUTER_API_KEY = 'test-or';
  Object.assign(process.env, { R2_ENDPOINT: 'https://r2.test', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET_NAME: 'rumi-sandbox' });
  delete process.env.SPEECHACE_API_KEY;
});


function urduPhonics(nonwords) {
  mockCreate.mockImplementation(async (req) => {
    const p = prompt(req);
    if (p.includes('reading aloud from a printed')) return reply({ words: Array.from({ length: 23 }, (_, i) => ({ i: i + 1, v: i < 20 ? 'correct' : 'skipped' })) }, 0.009);
    if (p.includes('reading-comprehension')) return reply({ questions: [{ id: 'u3A-q1', answer: 'ابو کے ساتھ', verdict: 'correct', confidence: 0.9 }] });
    if (p.includes('FIRST SOUNDS')) return reply({ first_sounds: [{ id: 'u3A-fs1', heard: 'ا', verdict: 'correct', confidence: 0.9 }], nonwords }, 0.003);
    if (p.includes('Find where each of these sections starts')) return reply({ sections: {} });
    throw new Error(`unrouted prompt: ${p.slice(0, 60)}`);
  });
}

async function urduNonwords(nonwords) {
  global.__noteSeconds = 112;
  sonioxReturns(T.URDU_BLOCK);            // the child says «تمال سوپک» in the made-up-words window
  urduPhonics(nonwords);
  const store = fakeStore({ id: 'blk-u', session_id: 'sess-u', block: 'urdu', audio_r2_key: 'child-test/sandbox/sch/sess-u/urdu.ogg', ai_marks: null });
  const res = await scoreBlock({ sessionId: 'sess-u', block: 'urdu', grade: 3, form: 'A' }, { store, itemBank });
  expect(res.ok).toBe(true);
  return store.saved[0].aiMarks.nonwords;
}

// This file tests the v1 battery (first sounds, made-up words) and the v1 strip maths; v2 is the default
// since bd-s1oo0.46.3 (CONTRACT §19), so the v1 switches are pinned for this file only.
const PINNED_SWITCHES = { CHILD_TEST_BATTERY: process.env.CHILD_TEST_BATTERY, CHILD_TEST_MATHS_MODE: process.env.CHILD_TEST_MATHS_MODE };
beforeAll(() => { process.env.CHILD_TEST_BATTERY = 'v1'; process.env.CHILD_TEST_MATHS_MODE = 'strip'; });
afterAll(() => { for (const [k, v] of Object.entries(PINNED_SWITCHES)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

describe('Urdu made-up words: a real per-item confidence (L16)', () => {
  test('the model and the transcript hear the same word: confident enough to pre-fill (>= the 0.65 bar)', async () => {
    const nw = await urduNonwords([
      { id: 'u3A-nw1', heard: 'تمال', verdict: 'correct', confidence: 0.95 },
      { id: 'u3A-nw2', heard: 'سوپک', verdict: 'correct', confidence: 0.95 },
    ]);
    const { barFor } = require('../../../bot/shared/services/child-test/scoring/thresholds');
    for (const n of nw) expect(n.confidence).toBeGreaterThanOrEqual(barFor('nonwords', 'urdu'));
  });

  test('the two hearers disagree on what was said: below the bar, so the coach checks it', async () => {
    const nw = await urduNonwords([
      { id: 'u3A-nw1', heard: 'تمال', verdict: 'correct', confidence: 0.95 },
      { id: 'u3A-nw2', heard: 'سوبک', verdict: 'wrong', confidence: 0.95 },   // Soniox heard «سوپک»
    ]);
    const { barFor } = require('../../../bot/shared/services/child-test/scoring/thresholds');
    expect(nw[0].confidence).toBeGreaterThanOrEqual(barFor('nonwords', 'urdu'));
    expect(nw[1].confidence).toBeLessThan(barFor('nonwords', 'urdu'));
    expect(new Set(nw.map((n) => n.confidence)).size).toBe(2);   // not one constant
  });

  test('the model itself unsure (< 0.9): stays below the bar even when the transcript agrees', async () => {
    const nw = await urduNonwords([
      { id: 'u3A-nw1', heard: 'تمال', verdict: 'correct', confidence: 0.8 },
      { id: 'u3A-nw2', heard: 'سوپک', verdict: 'correct', confidence: 0.95 },
    ]);
    expect(nw[0].confidence).toBeLessThan(0.65);
    expect(nw[1].confidence).toBeGreaterThanOrEqual(0.65);
  });

  test('no attempt heard: unchanged (capped at 0.6, the coach marks it)', async () => {
    const nw = await urduNonwords([
      { id: 'u3A-nw1', heard: 'تمال', verdict: 'correct', confidence: 0.95 },
      { id: 'u3A-nw2', heard: '', verdict: 'none', confidence: 0.9 },
    ]);
    expect(nw[1]).toMatchObject({ verdict: 'none', confidence: 0.6 });
  });
});
