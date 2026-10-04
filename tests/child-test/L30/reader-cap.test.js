'use strict';
/**
 * Child test L30 (bd-s1oo0.46.6) — real readers sent to the letters + words fallback.
 *
 * Sandbox, 3 Oct (fed3884d): skipper Urdu 2 vs key 46, struggling Urdu 1 vs 10, struggling English 2 vs 7.
 * Gemini heard each child right (raw 46/47, 10/13, 7/9 offline on the same transcripts), but `capAttempted`
 * capped the count at the words Soniox gave the CHILD + 2, and Soniox had lost the child: in the skipper's
 * note every word of the minute was diarised onto the coach's speaker (52 of 52), in the struggling child's
 * notes Soniox heard 2 words (Urdu) and 0 (English) of halting speech. 2 attempted -> the stop rule fired.
 *
 * Only the boundaries are mocked (L24's harness): Soniox and SpeechAce HTTP, OpenRouter, R2, ffmpeg, the
 * store. The transcripts are the sandbox shapes rebuilt from the item bank's own text; no child's words.
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

const { capAttempted } = require('../../../bot/shared/services/child-test/scoring/story');

/** Gemini's verdicts by index: `right` correct, `wrong` wrong, the rest skipped. */
const verdictsFor = (n, { right = [], wrong = [] }) => {
  const r = new Set(right); const w = new Set(wrong);
  return (i) => (r.has(i) ? 'correct' : (w.has(i) ? 'wrong' : 'skipped'));
};
const range = (a, b) => Array.from({ length: b - a }, (_, k) => a + k);

describe('capAttempted: Soniox losing the child does not erase words Gemini heard read correctly', () => {
  test('skipper shape: 46 heard correct, Soniox gave the child 0 words -> the 46 stand', () => {
    const f = verdictsFor(60, { right: range(0, 47).filter((i) => i !== 33), wrong: [33] });
    const v = capAttempted(Array.from({ length: 60 }, (_, i) => f(i)), 0);
    expect(v.filter((x) => x === 'correct')).toHaveLength(46);
    expect(v.slice(47).every((x) => x === 'skipped')).toBe(true);
  });
  test('L5\'s case still holds: unreached words marked wrong are capped at the words spoken + 2', () => {
    const v = capAttempted(['correct', 'correct', 'correct', ...new Array(57).fill('wrong')], 3);
    expect(v.filter((x) => x !== 'skipped')).toHaveLength(5);
  });
  test('wrong verdicts after the last word heard correctly are still capped', () => {
    const v = capAttempted([...new Array(10).fill('correct'), ...new Array(50).fill('wrong')], 0);
    expect(v.filter((x) => x !== 'skipped')).toHaveLength(10);
  });
});

describe('through scoreBlock: the sandbox shapes keep their story count and get no fallback', () => {
  test('Urdu, child diarised onto the coach\'s speaker (skipper, cd8d79a5): 46 right, no letters + words', async () => {
    global.__noteSeconds = 116;
    const tokens = bank.getForm(3, 'A').urdu.story.tokens;
    // one speaker for everything: the cue, the child's minute, the stop
    sonioxReturns([[1, 0.2, bank.cue.urdu.start], [1, 1.5, tokens.slice(0, 52).join(' ')], [1, 66, bank.cue.urdu.stop]], 1.1);
    const jobs = routeModels({ story: verdictsFor(60, { right: range(0, 47).filter((i) => i !== 33), wrong: [33] }) });
    const store = fakeStore({ id: 'blk-30a', block: 'urdu', audio_r2_key: 'k', ai_marks: null });

    const res = await scoreBlock({ sessionId: 'sess-30a', block: 'urdu', grade: 3, form: 'A' }, { store, itemBank });

    expect(res.ok).toBe(true);
    const { aiMarks } = store.saved[0];
    expect(aiMarks.story.words_correct).toBe(46);
    expect(aiMarks.story.words_attempted).toBe(47);
    expect(aiMarks.fallback).toBeFalsy();
    expect(jobs).not.toContain('fallback');
  });

  test('Urdu, halting reading Soniox barely heard (struggling, f88b9e04): 10 right of 13, no letters + words', async () => {
    global.__noteSeconds = 124;
    sonioxReturns([[1, 0.2, bank.cue.urdu.start], [1, 6.6, 'بلال بلال'], [1, 66, bank.cue.urdu.stop]], 0.4);
    const jobs = routeModels({ story: verdictsFor(60, { right: range(0, 13).filter((i) => ![3, 7, 11].includes(i)), wrong: [3, 7, 11] }) });
    const store = fakeStore({ id: 'blk-30b', block: 'urdu', audio_r2_key: 'k', ai_marks: null });

    await scoreBlock({ sessionId: 'sess-30b', block: 'urdu', grade: 3, form: 'A' }, { store, itemBank });

    const { aiMarks } = store.saved[0];
    expect(aiMarks.story.words_correct).toBe(10);
    expect(aiMarks.story.words_attempted).toBe(13);
    expect(aiMarks.fallback).toBeFalsy();
    expect(jobs).not.toContain('fallback');
  });

  test('English, Soniox heard none of the child (struggling, f88b9e04): 7 right of 9, no letters + words', async () => {
    global.__noteSeconds = 107;
    sonioxReturns([[1, 0.1, bank.cue.english.start], [1, 66.5, bank.cue.english.stop]], 0.3);
    const jobs = routeModels({ story: verdictsFor(60, { right: [0, 1, 2, 3, 4, 6, 8], wrong: [5, 7] }) });
    const store = fakeStore({ id: 'blk-30c', block: 'english', audio_r2_key: 'k', ai_marks: null });

    await scoreBlock({ sessionId: 'sess-30c', block: 'english', grade: 3, form: 'A' }, { store, itemBank });

    const { aiMarks } = store.saved[0];
    expect(aiMarks.story.words_correct).toBe(7);
    expect(aiMarks.story.words_attempted).toBe(9);
    expect(aiMarks.fallback).toBeFalsy();
    expect(jobs).not.toContain('fallback');
  });

  test('a non-reader is still sent to letters + words: Gemini marks the passage wrong, nothing right', async () => {
    global.__noteSeconds = 90;
    // battery v2 (L32): the coach switches the child to letters + words, aloud
    sonioxReturns([[1, 0.2, bank.cue.urdu.start], [2, 3, 'ب ل'], [1, 10, bank.getScript(3, 'A', 'urdu').fallback], [1, 20, bank.cue.urdu.stop]], 0.6);
    const jobs = routeModels({ story: () => 'wrong' });
    const store = fakeStore({ id: 'blk-30d', block: 'urdu', audio_r2_key: 'k', ai_marks: null });

    await scoreBlock({ sessionId: 'sess-30d', block: 'urdu', grade: 3, form: 'A' }, { store, itemBank });

    const { aiMarks } = store.saved[0];
    expect(aiMarks.story.words_correct).toBe(0);
    expect(aiMarks.story.words_attempted).toBeLessThanOrEqual(4);
    expect(jobs).toContain('fallback');
    expect(aiMarks.fallback).toBeTruthy();
  });
});
