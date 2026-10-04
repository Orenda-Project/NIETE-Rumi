'use strict';
/**
 * Child test L24 (bd-s1oo0.42) — CR-2 and CR-3 through scoreBlock, the path the WhatsApp bot and the app
 * both run. Only the boundaries are mocked (L5/L18's harness): Soniox and SpeechAce HTTP, OpenRouter,
 * R2, ffmpeg, the store. The transcripts are the item bank's own text; no child's words.
 */

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

jest.mock('form-data', () => class FormData {
  append(_k, v) { if (v && typeof v.destroy === 'function') { v.on('error', () => {}); v.destroy(); } }
  getHeaders() { return { 'content-type': 'multipart/form-data' }; }
});

// ---- OpenRouter -------------------------------------------------------------
const mockCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a) => mockCreate(...a) } }, audio: { transcriptions: { create: jest.fn(async () => { throw new Error('whisper down'); }) } } })));

jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const axios = require('axios');
const T = require('../L5/fixtures/transcripts');
const bank = require('../../../bot/shared/services/child-test/item-bank');
const { scoreBlock } = require('../../../bot/shared/services/child-test/scoring');

function sonioxReturns(script, gap) {
  const tokens = T.tokensFrom(script, gap);
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

const json = (obj, cost = 0.004) => ({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: { cost } });
const textOf = (req) => { const c = req.messages[0].content; return typeof c === 'string' ? c : c[0].text; };

function fakeStore(block) {
  const saved = [];
  return {
    saved,
    getBlock: jest.fn(async () => ({ ok: true, block })),
    setAiStatus: jest.fn(async () => ({ ok: true })),
    saveAiMarks: jest.fn(async (row) => { saved.push(row); return { ok: true, block: { ...block, ai_marks: row.aiMarks } }; }),
  };
}

/** Route each model job; record which ran. `story` is the story reply's per-word verdict for word i (0-based). */
function routeModels({ story, labeller = {} }) {
  const jobs = [];
  mockCreate.mockImplementation(async (req) => {
    const p = textOf(req);
    if (p.includes('reading aloud from a printed')) {
      jobs.push('story');
      const tokens = [...p.matchAll(/(\d+):(\S+)/g)].map((m) => m[2]);
      return json({ words: tokens.map((w, i) => ({ i: i + 1, w, v: story(i) })), notes: '' });
    }
    if (p.includes('Find where each of these sections starts')) { jobs.push('labeller'); return json({ sections: labeller }, 0.0005); }
    if (p.includes('could not read the first line')) { jobs.push('fallback'); return json({ letters: [{ i: 1, v: 'correct' }], words: [{ i: 1, v: 'correct' }] }, 0.006); }
    if (p.includes('oral reading-comprehension')) { jobs.push('comprehension'); return json({ questions: [] }, 0.001); }
    if (p.includes('two short')) { jobs.push('phonics'); return json({ first_sounds: [], nonwords: [] }, 0.002); }
    throw new Error(`unrouted prompt: ${p.slice(0, 60)}`);
  });
  return jobs;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SONIOX_API_KEY = 'test-soniox';
  process.env.OPENROUTER_API_KEY = 'test-or';
  Object.assign(process.env, { R2_ENDPOINT: 'https://r2.test', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET_NAME: 'rumi-sandbox' });
  delete process.env.SPEECHACE_API_KEY;
});

const itemBank = { getForm: (g, f) => bank.getForm(g, f), cue: bank.cue, version: bank.version };

describe('CR-2 through scoreBlock: a reader whose line 1 came back `skipped` keeps the story count', () => {
  test('53 right with words 1–3 skipped (AA_bd035dbb\'s shape): no letters + words fallback is scored', async () => {
    global.__noteSeconds = 75;
    const tokens = bank.getForm(3, 'A').english.story.tokens;
    // the coach's cue, then the child reads all 60 printed words in 59 s (one line of 0.98-s words)
    sonioxReturns([[1, 0.1, bank.cue.english.start], [2, 1.5, tokens.join(' ')]], 0.98);
    const jobs = routeModels({ story: (i) => (i < 3 ? 'skipped' : (i < 56 ? 'correct' : 'wrong')) });
    const store = fakeStore({ id: 'blk-24a', block: 'english', audio_r2_key: 'k', ai_marks: null });

    const res = await scoreBlock({ sessionId: 'sess-24a', block: 'english', grade: 3, form: 'A' }, { store, itemBank });

    expect(res.ok).toBe(true);
    const { aiMarks } = store.saved[0];
    expect(aiMarks.story.words_correct).toBe(53);
    expect(aiMarks.fallback).toBeFalsy();
    expect(jobs).not.toContain('fallback');
  });

  test('a child who could not read line 1 still gets the letters + words fallback', async () => {
    global.__noteSeconds = 75;
    // battery v2 (L32): the switch is the coach's, so the coach says the bank's switch line after line 1
    sonioxReturns([[1, 0.1, bank.cue.english.start], [2, 2, 'the'], [1, 8, bank.getScript(3, 'A', 'english').fallback], [1, 50, bank.cue.english.stop]]);
    const jobs = routeModels({ story: (i) => (i === 0 ? 'correct' : 'skipped') });
    const store = fakeStore({ id: 'blk-24b', block: 'english', audio_r2_key: 'k', ai_marks: null });

    await scoreBlock({ sessionId: 'sess-24b', block: 'english', grade: 3, form: 'A' }, { store, itemBank });

    expect(jobs).toContain('fallback');
    expect(store.saved[0].aiMarks.fallback).toBeTruthy();
  });
});

describe('CR-3 through scoreBlock: the labeller cannot end the story inside the minute', () => {
  test('questions labelled inside the minute (AA_2d306c3b\'s shape): the story window stays the 60-s minute', async () => {
    global.__noteSeconds = 87;
    const tokens = bank.getForm(3, 'A').urdu.story.tokens;
    sonioxReturns([[1, 0, bank.cue.urdu.start], [2, 1.5, tokens.slice(0, 55).join(' ')]], 1.0);
    const jobs = routeModels({ story: (i) => (i < 50 ? 'correct' : 'skipped'), labeller: { questions: { start_s: 5, end_s: 86.5, confidence: 0.4 } } });
    const store = fakeStore({ id: 'blk-24c', block: 'urdu', audio_r2_key: 'k', ai_marks: null });

    await scoreBlock({ sessionId: 'sess-24c', block: 'urdu', grade: 3, form: 'A' }, { store, itemBank });

    expect(jobs).toContain('labeller');
    const w = store.saved[0].aiMarks.meta.windows;
    expect(w.story.end - w.story.start).toBeCloseTo(60, 1);
    expect(w.questions.start).toBe(5);                      // the questions keep the labeller's place
  });
});
