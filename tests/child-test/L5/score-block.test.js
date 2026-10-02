'use strict';
/**
 * scoreBlock end to end with ONLY the boundaries mocked: Soniox + SpeechAce HTTP (axios),
 * OpenRouter (the openai SDK), R2 (the S3 client), the ffmpeg subprocess (child_process),
 * and the L3 store (injected — its module is another lane's and not merged yet).
 * The real AudioService, windows, scorers and assembler all run.
 */

const bank = require('./fixtures/item-bank.fixture.json');
const T = require('./fixtures/transcripts');

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

describe('scoreBlock (L4 → L5 contract)', () => {
  test('english block: Soniox in English, SpeechAce + Gemini both score, a chip both agree on is pre-ticked', async () => {
    global.__noteSeconds = 62;
    process.env.SPEECHACE_API_KEY = 'test-sa';
    sonioxReturns(T.ENGLISH_BLOCK);
    const sa = [];
    axios.post.mockImplementation(async (url) => {
      if (url.includes('api.soniox.com/v1/files')) return { data: { id: 'file-1' } };
      if (url.includes('api.soniox.com/v1/transcriptions')) return { data: { id: 'tr-1' } };
      if (url.includes('speechace')) {
        sa.push(url);
        const story = ['imran', 'woke', 'up', 'early', 'for', 'school', 'today', 'his', 'class', 'was', 'planting', 'trees'];
        const list = sa.length === 1 && url.includes('scoring/text')
          ? story.map((w, i) => ({ word: w, quality_score: i === 3 ? 10 : 90 }))
          : [{ word: 'lat', quality_score: 90 }, { word: 'mip', quality_score: 20 }];
        return { data: { status: 'success', text_score: { word_score_list: list } } };
      }
      return { data: {} };
    });
    mockCreate.mockImplementation(async (req) => {
      const p = prompt(req);
      if (p.includes('reading aloud from a printed')) {
        return reply({ words: Array.from({ length: 12 }, (_, i) => ({ i: i + 1, v: i === 3 ? 'wrong' : 'correct' })) }, 0.009);
      }
      if (p.includes('reading-comprehension')) return reply({ questions: [{ id: 'e3A-q1', answer: 'trees', verdict: 'correct', confidence: 0.9 }, { id: 'e3A-q2', answer: 'for school', verdict: 'correct', confidence: 0.9 }] });
      if (p.includes('MADE-UP WORDS')) return reply({ first_sounds: [], nonwords: [{ id: 'e3A-nw1', heard: 'lat', verdict: 'correct', confidence: 0.6 }, { id: 'e3A-nw2', heard: 'mop', verdict: 'wrong', confidence: 0.6 }] });
      throw new Error(`unrouted: ${p.slice(0, 50)}`);
    });
    const store = fakeStore({ id: 'blk-e', session_id: 'sess-e', block: 'english', audio_r2_key: 'k', ai_marks: null });

    const res = await scoreBlock({ sessionId: 'sess-e', block: 'english', grade: 3, form: 'A' }, { store, itemBank });

    expect(res).toEqual({ ok: true, aiStatus: 'scored' });
    const create = axios.post.mock.calls.find(([u]) => u.endsWith('/v1/transcriptions'));
    expect(create[1].language_hints).toEqual(['en']);
    const m = store.saved[0].aiMarks;
    expect(m.story).toMatchObject({ words_correct: 11, words_attempted: 12, finished_early: true });
    // Gemini, the STT alignment ("only" for "early") and SpeechAce all flag word 3: pre-tick bar cleared
    expect(m.story.flagged).toEqual([expect.objectContaining({ idx: 3, verdict: 'wrong' })]);
    expect(m.story.flagged[0].confidence).toBeGreaterThanOrEqual(0.7);
    expect(m.meta.calls.map((c) => c.job)).toEqual(expect.arrayContaining(['speechace', 'speechace_nonwords']));
    // SpeechAce agreeing with Gemini on a made-up word raises its confidence above Gemini's own
    expect(m.nonwords.find((n) => n.id === 'e3A-nw2')).toMatchObject({ verdict: 'wrong', confidence: 0.75 });
    expect(m.first_sounds).toEqual([]);
  });

  test('urdu block: transcribes in Urdu, cuts the windows, scores story + questions + phonics, writes ai_marks once', async () => {
    global.__noteSeconds = 112;
    sonioxReturns(T.URDU_BLOCK);
    // the child read words 1-20 with word 7 wrong; 21-23 never reached
    const verdicts = Array.from({ length: 23 }, (_, i) => (i >= 20 ? 'skipped' : (i === 6 ? 'wrong' : 'correct')));
    routeModels({ storyVerdicts: verdicts });
    const store = fakeStore({ id: 'blk-1', session_id: 'sess-1', block: 'urdu', audio_r2_key: 'child-test/sandbox/sch/sess-1/urdu.ogg', ai_marks: null });

    const res = await scoreBlock({ sessionId: 'sess-1', block: 'urdu', grade: 3, form: 'A' }, { store, itemBank });

    expect(res).toEqual({ ok: true, aiStatus: 'scored' });
    // Soniox was asked for Urdu only, with diarization
    const create = axios.post.mock.calls.find(([u]) => u.endsWith('/v1/transcriptions'));
    expect(create[1].language_hints).toEqual(['ur']);
    expect(create[1].enable_speaker_diarization).toBe(true);

    expect(store.getBlock).toHaveBeenCalledWith('sess-1', 'urdu');
    expect(store.statuses[0]).toMatchObject({ aiStatus: 'scoring' });
    expect(store.saveAiMarks).toHaveBeenCalledTimes(1);
    const { aiMarks, aiStatus, transcript } = store.saved[0];
    expect(transcript.words.length).toBeGreaterThan(10);
    expect(aiStatus).toBe('scored');
    expect(aiMarks.version).toBe('ai-marks-v1');
    expect(aiMarks.story).toMatchObject({ words_correct: 19, words_attempted: 20, finished_early: false });
    expect(aiMarks.story.flagged).toEqual([expect.objectContaining({ idx: 6, verdict: 'wrong' })]);
    expect(aiMarks.questions.map((q) => q.verdict)).toEqual(['correct', 'wrong', 'correct']);
    expect(aiMarks.first_sounds.every((f) => f.hint_only)).toBe(true);
    expect(aiMarks.nonwords.map((n) => n.verdict)).toEqual(['correct', 'correct']);
    expect(aiMarks.model_versions).toMatchObject({ counts: 'google/gemini-3.8-flash', comprehension: 'google/gemini-3-flash-preview' });
    expect(aiMarks.model_versions.stt).toMatch(/^soniox:/);
    // per-call cost + latency recorded; total under the per-block budget
    expect(aiMarks.meta.calls.map((c) => c.job)).toEqual(expect.arrayContaining(['stt', 'story', 'comprehension', 'phonics']));
    expect(aiMarks.meta.cost_usd).toBeGreaterThan(0);
    expect(aiMarks.meta.seconds).toBeGreaterThanOrEqual(0);
    // no child name or phone ever goes to a model: only item text, transcript, audio
    for (const [req] of mockCreate.mock.calls) expect(JSON.stringify(req)).not.toMatch(/displayName|phone_number/);
  });

  test('a missing start cue falls back to the labeller and flags no_cue_phrase', async () => {
    global.__noteSeconds = 112;
    sonioxReturns(T.URDU_BLOCK_NO_CUE);
    routeModels({ storyVerdicts: Array.from({ length: 23 }, (_, i) => (i < 20 ? 'correct' : 'skipped')) });
    const store = fakeStore({ id: 'blk-2', session_id: 'sess-2', block: 'urdu', audio_r2_key: 'k', ai_marks: null });

    const res = await scoreBlock({ sessionId: 'sess-2', block: 'urdu', grade: 3, form: 'A' }, { store, itemBank });

    expect(res.ok).toBe(true);
    const labeller = mockCreate.mock.calls.find(([r]) => prompt(r).includes('Find where each of these sections starts'));
    expect(labeller[0].model).toBe('google/gemini-3-flash-preview');
    expect(store.saved[0].aiMarks.protocol_flags).toContain('no_cue_phrase');
    expect(store.saved[0].aiMarks.story.words_correct).toBe(20);
  });

  test('one scorer failing gives partial, not a throw', async () => {
    global.__noteSeconds = 112;
    sonioxReturns(T.URDU_BLOCK);
    routeModels({ storyVerdicts: Array.from({ length: 23 }, () => 'correct'), failComprehension: true });
    const store = fakeStore({ id: 'blk-3', session_id: 'sess-3', block: 'urdu', audio_r2_key: 'k', ai_marks: null });

    const res = await scoreBlock({ sessionId: 'sess-3', block: 'urdu', grade: 3, form: 'A' }, { store, itemBank });

    expect(res).toMatchObject({ ok: true, aiStatus: 'partial' });
    expect(store.saved[0].aiMarks.questions.every((q) => q.verdict === 'none' && q.confidence === 0)).toBe(true);
    expect(store.saved[0].aiMarks.meta.errors).toEqual(expect.arrayContaining([expect.objectContaining({ job: 'comprehension' })]));
  });

  test('ai_marks are written once: a block that already has them is not re-scored', async () => {
    const store = fakeStore({ id: 'blk-4', session_id: 'sess-4', block: 'urdu', audio_r2_key: 'k', ai_status: 'scored', ai_marks: { version: 'ai-marks-v1' } });
    const res = await scoreBlock({ sessionId: 'sess-4', block: 'urdu', grade: 3, form: 'A' }, { store, itemBank });
    expect(res).toEqual({ ok: true, aiStatus: 'scored', reason: 'already_scored' });
    expect(store.saveAiMarks).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('never throws: store failure and Soniox outage both come back as failed with a reason', async () => {
    const broken = { getBlock: jest.fn(async () => ({ ok: false, error: 'db down' })), saveAiMarks: jest.fn() };
    await expect(scoreBlock({ sessionId: 's', block: 'urdu', grade: 3, form: 'A' }, { store: broken, itemBank })).resolves.toMatchObject({ ok: false, aiStatus: 'failed', reason: 'block_read_failed' });

    global.__noteSeconds = 112;
    axios.post.mockRejectedValue(new Error('soniox 503'));
    const store = fakeStore({ id: 'blk-5', session_id: 'sess-5', block: 'urdu', audio_r2_key: 'k', ai_marks: null });
    const res = await scoreBlock({ sessionId: 'sess-5', block: 'urdu', grade: 3, form: 'A' }, { store, itemBank });
    expect(res).toMatchObject({ ok: false, aiStatus: 'failed' });
    expect(['stt_failed', 'stt_no_timestamps']).toContain(res.reason);
    // the failure is persisted with its reason (ai_marks stay empty, so a retry is allowed)
    expect(store.saveAiMarks).not.toHaveBeenCalled();
    expect(store.statuses[store.statuses.length - 1]).toEqual({ sessionId: 'sess-5', block: 'urdu', aiStatus: 'failed', reason: res.reason });
  });

  test('maths: waits for both the voice note and the strip photo, then scores spoken + written once', async () => {
    global.__noteSeconds = 96;
    sonioxReturns(T.MATHS_BLOCK);
    routeModels({});
    const onlyAudio = fakeStore({ id: 'blk-m', session_id: 'sess-m', block: 'maths', audio_r2_key: 'a', photo_r2_key: null, ai_marks: null });
    const first = await scoreBlock({ sessionId: 'sess-m', block: 'maths', grade: 3, form: 'A' }, { store: onlyAudio, itemBank });
    expect(first).toEqual({ ok: true, aiStatus: 'pending', reason: 'awaiting_photo' });
    expect(onlyAudio.saveAiMarks).not.toHaveBeenCalled();

    const both = fakeStore({ id: 'blk-m', session_id: 'sess-m', block: 'maths', audio_r2_key: 'a', photo_r2_key: 'p', ai_marks: null });
    const res = await scoreBlock({ sessionId: 'sess-m', block: 'maths', grade: 3, form: 'A' }, { store: both, itemBank });
    expect(res).toEqual({ ok: true, aiStatus: 'scored' });
    const m = both.saved[0].aiMarks.maths;
    expect(m.numbers.map((n) => n.verdict)).toEqual(['correct', 'correct', 'wrong', 'correct']);
    expect(m.quick_sums).toMatchObject({ correct: 3, attempted: 4 });
    expect(m.written.map((w) => [w.read_answer, w.verdict])).toEqual([['62', 'correct'], ['44', 'wrong'], ['', 'blank'], ['', 'unreadable']]);
    expect(m.word_problem).toMatchObject({ verdict: 'correct', read_answer: '9' });
    expect(both.saved[0].aiMarks.meta.photo).toEqual({ form_code: 'G3-A', form_code_ok: true, expected_code: 'G3-A' });
    // the vision model is told the printed sums, never the answers
    const vision = mockCreate.mock.calls.find(([r]) => prompt(r).includes('answer strip'))[0];
    expect(vision.model).toBe('google/gemini-3.1-pro-preview');
    expect(prompt(vision)).not.toMatch(/= 62|answer is 62/);
  });

  test('maths with force:true scores what is there when the photo never comes', async () => {
    global.__noteSeconds = 96;
    sonioxReturns(T.MATHS_BLOCK);
    routeModels({});
    const store = fakeStore({ id: 'blk-m2', session_id: 'sess-m2', block: 'maths', audio_r2_key: 'a', photo_r2_key: null, ai_marks: null });
    const res = await scoreBlock({ sessionId: 'sess-m2', block: 'maths', grade: 3, form: 'A', force: true }, { store, itemBank });
    expect(res).toEqual({ ok: true, aiStatus: 'partial' });
    expect(store.saved[0].aiMarks.maths.written.every((w) => w.verdict === 'unreadable' && w.confidence === 0)).toBe(true);
  });
});
