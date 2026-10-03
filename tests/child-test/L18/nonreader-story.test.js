'use strict';
/**
 * Child test L18 (bd-s1oo0.24) — a child who barely reads gets marks, not a failed English block.
 *
 * Root cause (lanes/L18/REPORT.md): the story prompt asks Gemini to echo every printed word as
 * {"i":n,"w":"<word>","v":"…"}. For a near-non-reader nearly every entry is "skipped", and in that
 * long run of identical objects the model drops the "w" key ({"i":4,"early","v":"skipped"}) —
 * offline, 29 of 71 story replies (41%) on five near-non-reader fixtures, every one that shape,
 * finish_reason "stop", which jsonrepair cannot mend. Both attempts failing lost the story, and with
 * no questions or made-up words in the note (the coach moved to the letters card) nothing was left,
 * so the block went `failed` and the coach typed all 12 fields.
 *
 * Fix: the story call sends the reply's JSON schema as a strict `response_format`, so the decoder
 * cannot drop a key; the prompt stays the study's, word for word. The OpenRouter mock below
 * replays the captured malformed shape (printed-text words only — never a child's) unless the
 * request carries that schema, which is what the live model did (0 of 50 malformed with it).
 *
 * Harness: L5's score-block test (only the boundaries mocked: Soniox/SpeechAce HTTP, OpenRouter,
 * R2, ffmpeg, the store).
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


// The English note of a near-non-reader: the cue, two attempted words, a long silence, the stop
// cue. No questions and no made-up words: the coach moved to the letters card (EGRA stop rule).
const ENGLISH_NONREADER = [
  [1, 1.0, 'read the story please start'],
  [2, 4.0, 'im wo'],
  [1, 50.0, 'thank you'],
];

const TOKENS = bank.grades['3'].forms.A.english.story.tokens;

// what the live model returned on a no_json, word for word in structure: the "w" key dropped
// from one entry deep in the run of skipped words (the words are the printed text's)
function malformedStoryReply() {
  const parts = TOKENS.map((w, i) => {
    const v = i === 0 ? 'wrong' : (i === 1 ? 'correct' : 'skipped');
    return i === 3 ? `{"i":${i + 1},"${w}","v":"${v}"}` : `{"i":${i + 1},"w":"${w}","v":"${v}"}`;
  });
  const text = '```json\n{"words":[' + parts.join(',') + '],"words_correct":1,"words_attempted":2,"notes":"stopped after two words"}\n```';
  return { choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { cost: 0.006, completion_tokens: 1463, completion_tokens_details: { reasoning_tokens: 651 } } };
}

function validStoryReply() {
  const words = TOKENS.map((w, i) => ({ i: i + 1, w, v: i === 0 ? 'wrong' : (i === 1 ? 'correct' : 'skipped') }));
  return { choices: [{ message: { content: JSON.stringify({ words, words_correct: 1, words_attempted: 2, notes: 'stopped after two words' }) }, finish_reason: 'stop' }], usage: { cost: 0.006, completion_tokens: 900 } };
}

const storyRequests = [];
function routeModels() {
  mockCreate.mockImplementation(async (req) => {
    const p = prompt(req);
    if (p.includes('reading aloud from a printed')) {
      storyRequests.push(req);
      const rf = req.response_format;
      const strict = rf && rf.type === 'json_schema' && rf.json_schema && rf.json_schema.strict === true;
      return strict ? validStoryReply() : malformedStoryReply();
    }
    if (p.includes('Find where each of these sections starts')) {
      return { choices: [{ message: { content: '{"sections":{"questions":null,"nonwords":null}}' } }], usage: { cost: 0.0003 } };
    }
    if (p.includes('could not read the first line')) {
      return { choices: [{ message: { content: JSON.stringify({ letters: [{ i: 1, v: 'correct' }], words: [{ i: 1, v: 'none' }] }) } }], usage: { cost: 0.01 } };
    }
    throw new Error(`unrouted prompt: ${p.slice(0, 60)}`);
  });
}

beforeEach(() => { storyRequests.length = 0; });

// This file tests the v1 battery (first sounds, made-up words) and the v1 strip maths; v2 is the default
// since bd-s1oo0.46.3 (CONTRACT §19), so the v1 switches are pinned for this file only.
const PINNED_SWITCHES = { CHILD_TEST_BATTERY: process.env.CHILD_TEST_BATTERY, CHILD_TEST_MATHS_MODE: process.env.CHILD_TEST_MATHS_MODE };
beforeAll(() => { process.env.CHILD_TEST_BATTERY = 'v1'; process.env.CHILD_TEST_MATHS_MODE = 'strip'; });
afterAll(() => { for (const [k, v] of Object.entries(PINNED_SWITCHES)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

describe('L18: a near-non-reader English block is marked, not failed', () => {
  test('the story is scored from a strict-schema reply; questions and made-up words arrive empty for the coach', async () => {
    global.__noteSeconds = 62;
    sonioxReturns(ENGLISH_NONREADER);
    routeModels();
    const store = fakeStore({ id: 'blk-e18', session_id: 'sess-e18', block: 'english', audio_r2_key: 'child-test/sandbox/sch/sess-e18/english.ogg', ai_marks: null });

    const res = await scoreBlock({ sessionId: 'sess-e18', block: 'english', grade: 3, form: 'A' }, { store, itemBank });

    expect(res).toEqual({ ok: true, aiStatus: 'partial' });
    const { aiMarks } = store.saved[0];
    expect(aiMarks.story).toMatchObject({ words_correct: 1, words_attempted: 2 });
    expect(aiMarks.story.flagged.map((f) => [f.idx, f.verdict])).toEqual([[0, 'wrong']]);
    expect(aiMarks.questions.map((q) => [q.verdict, q.confidence])).toEqual([['none', 0], ['none', 0]]);
    expect(aiMarks.nonwords.every((n) => n.verdict === 'none' && n.confidence === 0)).toBe(true);
    expect(aiMarks.meta.errors.map((e) => e.job)).toEqual(['comprehension', 'phonics']);   // no window: not in the note
    expect(storyRequests).toHaveLength(1);                          // first attempt parsed
  });

  test('the story request carries the reply schema as a strict response_format; the prompt is unchanged', async () => {
    global.__noteSeconds = 62;
    sonioxReturns(ENGLISH_NONREADER);
    routeModels();
    const store = fakeStore({ id: 'blk-e19', session_id: 'sess-e19', block: 'english', audio_r2_key: 'k', ai_marks: null });

    await scoreBlock({ sessionId: 'sess-e19', block: 'english', grade: 3, form: 'A' }, { store, itemBank });

    const req = storyRequests[0];
    expect(req.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    const schema = req.response_format.json_schema.schema;
    expect(schema.required).toEqual(expect.arrayContaining(['words']));
    expect(schema.properties.words.items.required).toEqual(['i', 'w', 'v']);
    expect(schema.properties.words.items.properties.v.enum).toEqual(['correct', 'wrong', 'skipped']);
    const prompts = require('../../../bot/shared/services/child-test/scoring/prompts');
    expect(prompt(req)).toBe(prompts.STORY({ lang: 'english', tokens: TOKENS }));
  });

  test('the comprehension grader, a text call, is sent no response_format (only the story job changes)', async () => {
    const { chatJSON } = require('../../../bot/shared/services/child-test/scoring/llm');
    mockCreate.mockImplementation(async () => ({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} }));
    await chatJSON({ model: 'm', prompt: 'p', job: 'child_test.comprehension' });
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('response_format');
  });
});
