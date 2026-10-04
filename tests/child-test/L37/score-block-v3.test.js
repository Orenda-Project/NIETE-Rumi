'use strict';
/**
 * L37 (bd-s1oo0.50.3) — the job runner's path for a v3 task row: conversation/recovery.js runScoring →
 * scoring.scoreBlock({ block: '<task id>' }) → scoreTask → store.saveAiMarks(ai-marks-v3).
 * Boundaries mocked: R2 (S3 client), ffmpeg, Soniox (axios), OpenRouter (openai SDK); the store is injected.
 */

jest.mock('@aws-sdk/client-s3', () => {
  class S3Client { async send() { return { Body: (async function* body() { yield Buffer.from('OggS-fake-audio'); }()) }; } }
  const cmd = () => class { constructor(input) { this.input = input; } };
  return { S3Client, GetObjectCommand: cmd(), PutObjectCommand: cmd(), DeleteObjectCommand: cmd(), HeadObjectCommand: cmd(), ListObjectsV2Command: cmd() };
});
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  const fs = jest.requireActual('fs');
  return {
    ...actual,
    execFile: jest.fn((bin, args, opts, cb) => {
      if (args.includes('-hide_banner')) { const e = new Error('no output'); cb(e, '', '  Duration: 00:01:10.00, start: 0'); return; }
      fs.writeFileSync(args[args.length - 1], Buffer.from('clip'));
      cb(null, '', '');
    }),
  };
});
jest.mock('form-data', () => class FormData {
  append(_k, v) { if (v && typeof v.destroy === 'function') { v.on('error', () => {}); v.destroy(); } }
  getHeaders() { return { 'content-type': 'multipart/form-data' }; }
});
const mockCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a) => mockCreate(...a) } }, audio: { transcriptions: { create: jest.fn(async () => { throw new Error('whisper down'); }) } } })));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const axios = require('axios');
const H = require('./harness');
const bank = require('./fixtures/bank-v3');
const { scoreBlock } = require('../../../bot/shared/services/child-test/scoring');

function fakeStore(row) {
  const saved = []; const statuses = [];
  return {
    saved, statuses,
    getBlock: jest.fn(async () => ({ ok: true, block: row })),
    setAiStatus: jest.fn(async (r) => { statuses.push(r); return { ok: true }; }),
    saveAiMarks: jest.fn(async (r) => { saved.push(r); return { ok: true, block: { ...row, ai_marks: r.aiMarks } }; }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SONIOX_API_KEY = 'test-soniox';
  process.env.OPENROUTER_API_KEY = 'test-or';
  Object.assign(process.env, { R2_ENDPOINT: 'https://r2.test', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET_NAME: 'rumi-sandbox' });
});

test('a v3 task row is scored by scoreTask and saved as ai-marks-v3 with its transcript', async () => {
  H.sonioxReturns(axios, [[1, 2, bank.BEGIN.ur], [2, 4, 'چار پانچ']]);
  mockCreate.mockImplementation(async () => H.items(H.rep('c', 15) + H.rep('s', 5)));
  const store = fakeStore({ id: 't1', session_id: 's1', block: 'ma.add1', audio_r2_key: 'child-test/local/x/s1/ma.add1.ogg', ai_marks: null });
  const res = await scoreBlock({ sessionId: 's1', block: 'ma.add1', grade: 3, form: 'A' }, { store, itemBank: bank });
  expect(res).toEqual({ ok: true, aiStatus: 'scored' });
  expect(store.statuses[0]).toEqual(expect.objectContaining({ block: 'ma.add1', aiStatus: 'scoring' }));
  const { aiMarks, block, transcript } = store.saved[0];
  expect(block).toBe('ma.add1');
  expect(aiMarks.version).toBe('ai-marks-v3');
  expect(aiMarks.timed.correct).toBe(15);
  expect(aiMarks.meta.item_bank_version).toBe(bank.version);
  expect(aiMarks.meta.calls.map((c) => c.job)).toEqual(['stt', 'add1']);
  expect(transcript.words.length).toBeGreaterThan(0);
});

test('a row the coach skipped: { skipped_by_coach: true }, no download, no model call', async () => {
  const store = fakeStore({ id: 't2', session_id: 's2', block: 'ma.add2', audio_r2_key: null, ai_reason: 'skipped_by_coach', ai_marks: null });
  const res = await scoreBlock({ sessionId: 's2', block: 'ma.add2', grade: 3, form: 'A' }, { store, itemBank: bank });
  expect(res).toEqual({ ok: true, aiStatus: 'scored' });
  expect(store.saved[0].aiMarks).toEqual(expect.objectContaining({ version: 'ai-marks-v3', task: 'ma.add2', skipped_by_coach: true }));
  expect(store.saved[0].reason).toBe('skipped_by_coach');
  expect(mockCreate).not.toHaveBeenCalled();
  expect(axios.post).not.toHaveBeenCalled();
});

test('a gap task in the bank: skipped marks, no model call, even without audio', async () => {
  const gapBank = { ...bank, getTaskSpec: () => ({ gap: true, reason: 'no official list' }) };
  const store = fakeStore({ id: 't3', session_id: 's3', block: 'ur.nonwords', audio_r2_key: null, ai_marks: null });
  const res = await scoreBlock({ sessionId: 's3', block: 'ur.nonwords', grade: 3, form: 'A' }, { store, itemBank: gapBank });
  expect(res.ok).toBe(true);
  expect(store.saved[0].aiMarks).toEqual(expect.objectContaining({ skipped_by_coach: true, gap: true }));
  expect(mockCreate).not.toHaveBeenCalled();
});

test('a task row without audio (and not skipped) fails no_media and records it', async () => {
  const store = fakeStore({ id: 't4', session_id: 's4', block: 'ur.words', audio_r2_key: null, ai_marks: null });
  const res = await scoreBlock({ sessionId: 's4', block: 'ur.words', grade: 3, form: 'A' }, { store, itemBank: bank });
  expect(res).toEqual({ ok: false, aiStatus: 'failed', reason: 'no_media' });
  expect(store.statuses).toEqual([expect.objectContaining({ aiStatus: 'failed', reason: 'no_media' })]);
});

test('a model failure is retryable: failed with the task reason, nothing saved', async () => {
  H.sonioxReturns(axios, [[1, 2, bank.BEGIN.ur], [2, 4, 'چار']]);
  mockCreate.mockRejectedValue(new Error('upstream 503'));
  const store = fakeStore({ id: 't5', session_id: 's5', block: 'ma.sub1', audio_r2_key: 'k', ai_marks: null });
  const res = await scoreBlock({ sessionId: 's5', block: 'ma.sub1', grade: 3, form: 'A' }, { store, itemBank: bank });
  expect(res).toEqual({ ok: false, aiStatus: 'failed', reason: 'sub1_failed' });
  expect(store.saveAiMarks).not.toHaveBeenCalled();
});

test('the item bank without getTaskSpec (v3 bank not loaded): form_not_found, terminal', async () => {
  const store = fakeStore({ id: 't6', session_id: 's6', block: 'ma.add1', audio_r2_key: 'k', ai_marks: null });
  const res = await scoreBlock({ sessionId: 's6', block: 'ma.add1', grade: 3, form: 'A' }, { store, itemBank: { version: 'v2' } });
  expect(res.reason).toBe('form_not_found');
});

test('already scored: nothing is redone', async () => {
  const store = fakeStore({ id: 't7', session_id: 's7', block: 'ma.add1', audio_r2_key: 'k', ai_marks: { version: 'ai-marks-v3' }, ai_status: 'scored' });
  const res = await scoreBlock({ sessionId: 's7', block: 'ma.add1', grade: 3, form: 'A' }, { store, itemBank: bank });
  expect(res).toEqual({ ok: true, aiStatus: 'scored', reason: 'already_scored' });
  expect(mockCreate).not.toHaveBeenCalled();
});
