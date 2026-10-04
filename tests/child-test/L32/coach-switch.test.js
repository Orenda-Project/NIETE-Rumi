'use strict';
/**
 * Child test L32 (bd-s1oo0.46.9): in battery v2 the non-reader path is the coach's decision, not a guess.
 *
 * Sandbox, 3 Oct 23:57 UTC (126088f1, after L30's cap fix), session 0e07251a, English block of the
 * v2-g3-struggling fixture (key 6 of 10, no fallback): the AI scored the story right (6 correct of 9
 * attempted) and then ALSO set `fallback`, because `needsFallback` inferred it from line 1 (3 of 6 right).
 * The coach never switched (no switch line anywhere in the note), so the coach's results showed "English
 * letters 0 of 10, words 1 of 10" for letters the child never read.
 *
 * v2 rule: `fallback` is scored only if the item bank's switch line (`script.fallback`) is heard in the
 * recording, found by the window finder's own phrase matcher. Heard: letters + words as before, and the
 * story counts only what was read before the switch. Not heard: never a fallback; the story is scored.
 * Battery v1 keeps the inference.
 *
 * Only the boundaries are mocked (L24's harness): Soniox HTTP, OpenRouter, R2, ffmpeg, the store.
 * The sandbox transcript is the stored one (fixtures/), which holds no child's name.
 */

// ---- R2 (S3) ----------------------------------------------------------------
jest.mock('@aws-sdk/client-s3', () => {
  class S3Client { async send() { return { Body: (async function* body() { yield Buffer.from('OggS-fake-audio'); }()) }; } }
  const cmd = () => class { constructor(input) { this.input = input; } };
  return { S3Client, GetObjectCommand: cmd(), PutObjectCommand: cmd(), DeleteObjectCommand: cmd(), HeadObjectCommand: cmd(), ListObjectsV2Command: cmd() };
});

// ---- ffmpeg subprocess ------------------------------------------------------
const mockCuts = [];
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  const fs = jest.requireActual('fs');
  return {
    ...actual,
    execFile: jest.fn((bin, args, opts, cb) => {
      if (args.includes('-hide_banner')) {                       // probe
        const s = global.__noteSeconds; const mm = String(Math.floor(s / 60)).padStart(2, '0'); const ss = (s % 60).toFixed(2).padStart(5, '0');
        const err = new Error('no output'); cb(err, '', `  Duration: 00:${mm}:${ss}, start: 0`); return;
      }
      const ssAt = args.indexOf('-ss'); const toAt = args.indexOf('-to'); const tAt = args.indexOf('-t');
      mockCuts.push({ ss: ssAt >= 0 ? Number(args[ssAt + 1]) : null, to: toAt >= 0 ? Number(args[toAt + 1]) : null, t: tAt >= 0 ? Number(args[tAt + 1]) : null, out: args[args.length - 1] });
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
const { findSwitchLine } = require('../../../bot/shared/services/child-test/scoring/windows');
const { wordsFromTokens } = require('../../../bot/shared/services/child-test/scoring/text-norm');
const review = require('../../../bot/shared/services/child-test/check-flow/review-view');
const SANDBOX = require('./fixtures/sandbox-0e07251a-english.json');

/** Stored [raw, start, end, speaker] words → Soniox tokens (one per word, leading space). */
const tokensOfWords = (words) => words.map(([raw, s, e, sp]) => ({ text: ` ${raw}`, start_ms: Math.round(s * 1000), end_ms: Math.round(e * 1000), speaker: String(sp), language: 'en' }));

function sonioxReturns(tokens) {
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

/** Route each model job; record which ran. `story(i)` is the story reply's verdict for word i (0-based). */
function routeModels({ story }) {
  const jobs = [];
  mockCreate.mockImplementation(async (req) => {
    const p = textOf(req);
    if (p.includes('reading aloud from a printed')) {
      jobs.push('story');
      const tokens = [...p.matchAll(/(\d+):(\S+)/g)].map((m) => m[2]);
      return json({ words: tokens.map((w, i) => ({ i: i + 1, w, v: story(i) })), notes: '' });
    }
    if (p.includes('Find where each of these sections starts')) { jobs.push('labeller'); return json({ sections: {} }, 0.0005); }
    if (p.includes('could not read the first line')) {
      jobs.push('fallback');
      return json({ letters: [1, 2, 3, 4, 5, 6].map((i) => ({ i, v: 'correct' })), words: [1, 2].map((i) => ({ i, v: 'correct' })) }, 0.006);
    }
    if (p.includes('oral reading-comprehension')) { jobs.push('comprehension'); return json({ questions: [] }, 0.001); }
    if (p.includes('two short')) { jobs.push('phonics'); return json({ first_sounds: [], nonwords: [] }, 0.002); }
    throw new Error(`unrouted prompt: ${p.slice(0, 60)}`);
  });
  return jobs;
}

const itemBank = { getForm: (g, f) => bank.getForm(g, f), cue: bank.cue, version: bank.version };

/** The stored reply on this block: words 1, 2, 5, 7, 8, 9 right; 3, 4, 6 wrong (stored `flagged`). */
const SANDBOX_STORY = (i) => ({ 0: 'correct', 1: 'correct', 2: 'wrong', 3: 'wrong', 4: 'correct', 5: 'wrong', 6: 'correct', 7: 'correct', 8: 'correct' }[i] || 'skipped');
const NOTHING_READ = () => 'skipped';

const EN_SWITCH = bank.getScript(3, 'A', 'english').fallback;     // "That's okay. Read these letters, then these words."
const UR_SWITCH = bank.getScript(3, 'A', 'urdu').fallback;        // «کوئی بات نہیں۔ اب یہ حروف پڑھیں، پھر یہ الفاظ پڑھیں۔»
const EN_FB = bank.getForm(3, 'A').english.fallback;

/** The sandbox words with extra [raw, start, end, speaker] words spliced in at their times. */
function withWords(base, extra) {
  return [...base, ...extra].sort((a, b) => a[1] - b[1]);
}
const said = (text, at, speaker = '1', gap = 0.3) => String(text).split(/\s+/).filter(Boolean).map((w, k) => [w, at + k * gap, at + k * gap + 0.2, speaker]);

async function run({ block = 'english', words, story, battery = 'v2', seconds = SANDBOX.duration_sec, grade = 3 }) {
  process.env.CHILD_TEST_BATTERY = battery;
  global.__noteSeconds = seconds;
  sonioxReturns(tokensOfWords(words));
  const jobs = routeModels({ story });
  const store = fakeStore({ id: `blk-${block}`, block, audio_r2_key: 'k', ai_marks: null });
  const res = await scoreBlock({ sessionId: `sess-L32-${block}`, block, grade, form: 'A' }, { store, itemBank });
  return { res, jobs, aiMarks: store.saved[0] && store.saved[0].aiMarks };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCuts.length = 0;
  process.env.SONIOX_API_KEY = 'test-soniox';
  process.env.OPENROUTER_API_KEY = 'test-or';
  Object.assign(process.env, { R2_ENDPOINT: 'https://r2.test', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET_NAME: 'rumi-sandbox' });
  delete process.env.SPEECHACE_API_KEY;
});
afterAll(() => { delete process.env.CHILD_TEST_BATTERY; });

describe('the sandbox block (0e07251a English, v2-g3-struggling): the coach never switched', () => {
  test('the stored transcript holds no switch line', () => {
    const words = wordsFromTokens(tokensOfWords(SANDBOX.words));
    expect(findSwitchLine(words, EN_SWITCH)).toBeNull();
    // what the sandbox stored at 126088f1: the story right, and a fallback the coach never gave
    expect(SANDBOX.stored.story).toMatchObject({ words_correct: 6, words_attempted: 9 });
    expect(SANDBOX.stored.fallback.letters.correct).toBe(0);
  });

  test('v2: story 6 of 9, no fallback, the letters + words model never runs', async () => {
    const { res, jobs, aiMarks } = await run({ words: SANDBOX.words, story: SANDBOX_STORY });
    expect(res.ok).toBe(true);
    expect(aiMarks.story.words_correct).toBe(6);
    expect(aiMarks.story.words_attempted).toBe(9);
    expect(aiMarks.fallback).toBeNull();
    expect(jobs).not.toContain('fallback');
    expect(aiMarks.meta.fallback_switch).toMatchObject({ heard: false, inferred: true });
  });

  test('v1 keeps the inference: the same note still falls back (unchanged)', async () => {
    const { aiMarks, jobs } = await run({ words: SANDBOX.words, story: SANDBOX_STORY, battery: 'v1' });
    expect(aiMarks.story.words_correct).toBe(6);
    expect(jobs).toContain('fallback');
    expect(aiMarks.fallback).not.toBeNull();
    expect(aiMarks.meta.fallback_switch).toBeUndefined();
  });
});

describe('v2: the switch line heard → letters + words, the story is what came before it', () => {
  test('the bank line said at 20 s: fallback scored on the clip from the line; the story minute stops at the line', async () => {
    const words = withWords(SANDBOX.words.filter((w) => w[1] < 20 || w[1] > 46), [
      ...said(EN_SWITCH, 20),
      ...said(EN_FB.letters.slice(0, 6).join(' '), 24, '2', 1.2),
      ...said(EN_FB.words.slice(0, 2).join(' '), 33, '2', 1.5),
    ]);
    const { jobs, aiMarks } = await run({ words, story: SANDBOX_STORY });
    expect(jobs).toContain('fallback');
    expect(aiMarks.fallback).toMatchObject({ letters: { correct: 6, of: 10 }, words: { correct: 2, of: 10 } });
    expect(aiMarks.meta.fallback_switch).toMatchObject({ heard: true });
    expect(aiMarks.meta.fallback_switch.start).toBeCloseTo(20, 1);
    expect(aiMarks.meta.windows.story.end).toBeCloseTo(20, 1);
    expect(aiMarks.story.seconds).toBeLessThan(20);
    // the fallback clip starts at the switch (0.5 s lead), not at the start of the story
    const fbCut = mockCuts[mockCuts.length - 1];
    expect(fbCut.ss).toBeGreaterThan(19);
  });

  test('a close variant ("That\'s okay. Now read these letters, then these words.") counts', async () => {
    const words = withWords(SANDBOX.words.filter((w) => w[1] < 20 || w[1] > 46), said("That's okay. Now read these letters, then these words.", 20));
    const { jobs, aiMarks } = await run({ words, story: SANDBOX_STORY });
    expect(jobs).toContain('fallback');
    expect(aiMarks.fallback).not.toBeNull();
  });

  test('"That\'s okay" alone, or "go on", is not the switch', async () => {
    const words = withWords(SANDBOX.words, said("That's okay.", 20));
    const { jobs, aiMarks } = await run({ words, story: SANDBOX_STORY });
    expect(jobs).not.toContain('fallback');
    expect(aiMarks.fallback).toBeNull();
  });
});

describe('v2, Urdu non-reader', () => {
  const tokens = bank.getForm(3, 'A').urdu.story.tokens;
  const UR_FB = bank.getForm(3, 'A').urdu.fallback;
  const base = [
    ...said(bank.getScript(3, 'A', 'urdu').start, 1),
    ...said(tokens.slice(0, 2).join(' '), 6, '2', 3),
  ];

  test('switch line heard: letters + words; the summary shows letters, the questions are skipped', async () => {
    const words = withWords(base, [
      ...said(UR_SWITCH, 14),
      ...said(UR_FB.letters.slice(0, 6).join(' '), 19, '2', 1.2),
      ...said(UR_FB.words.slice(0, 2).join(' '), 28, '2', 1.5),
    ]);
    const { jobs, aiMarks } = await run({ block: 'urdu', words, story: (i) => (i < 2 ? 'wrong' : 'skipped'), seconds: 75 });
    expect(jobs).toContain('fallback');
    expect(aiMarks.fallback).not.toBeNull();
    expect(aiMarks.meta.fallback_switch.heard).toBe(true);
    const entry = { session: { id: 's1' }, child: {}, blocks: { urdu: { ai_marks: aiMarks } } };
    expect(review.questionsSkipped(aiMarks)).toBe(true);
    expect(review.candidates(entry).filter((c) => c.block === 'urdu')).toHaveLength(0);
    expect(review.summaryText('en', [entry])).toContain('Urdu letters 6 of 10');
  });

  test('never switched and read nothing: story 0, no fallback, the summary says "Urdu 0 words/min"', async () => {
    const words = withWords(said(bank.getScript(3, 'A', 'urdu').start, 1), said(bank.cue.urdu.stop, 63));
    const { jobs, aiMarks } = await run({ block: 'urdu', words, story: NOTHING_READ, seconds: 75 });
    expect(jobs).not.toContain('fallback');
    expect(aiMarks.fallback).toBeNull();
    expect(aiMarks.story.words_correct).toBe(0);
    const entry = { session: { id: 's1' }, child: {}, blocks: { urdu: { ai_marks: aiMarks } } };
    expect(review.questionsSkipped(aiMarks)).toBe(false);
    expect(review.summaryText('en', [entry])).toContain('Urdu 0 words/min');
  });
});

describe('review follows ai_marks.fallback on the sandbox block', () => {
  test('no switch → the English questions stay review candidates and the summary shows words/min, not letters', async () => {
    const { aiMarks } = await run({ words: SANDBOX.words, story: SANDBOX_STORY });
    aiMarks.questions = aiMarks.questions.map((q) => ({ ...q, verdict: 'none', confidence: 0.5 }));
    const entry = { session: { id: 's1' }, child: {}, blocks: { english: { ai_marks: aiMarks } } };
    expect(review.questionsSkipped(aiMarks)).toBe(false);
    expect(review.candidates(entry).filter((c) => c.block === 'english').length).toBe(aiMarks.questions.length);
    const line = review.summaryText('en', [entry]);
    expect(line).toContain('English 6 words/min');
    expect(line).not.toContain('letters');
  });
});

describe('findSwitchLine', () => {
  const W = (pairs) => wordsFromTokens(tokensOfWords(pairs));
  test('the Urdu line and its letters clause are found; the start and go-on lines are not', () => {
    expect(findSwitchLine(W(said(UR_SWITCH, 10)), UR_SWITCH)).toMatchObject({ start: 10 });
    expect(findSwitchLine(W(said('اب یہ حروف پڑھیں', 10)), UR_SWITCH)).toMatchObject({ start: 10 });
    expect(findSwitchLine(W(said('یہ کہانی اونچی آواز میں پڑھیں۔ اب شروع کریں آگے پڑھیں', 10)), UR_SWITCH)).toBeNull();
    expect(findSwitchLine(W(said('کوئی بات نہیں', 10)), UR_SWITCH)).toBeNull();
  });
  test('only after `after`', () => {
    expect(findSwitchLine(W(said(EN_SWITCH, 10)), EN_SWITCH, { after: 12 })).toBeNull();
  });
  test('no line in the bank → null', () => {
    expect(findSwitchLine(W(said(EN_SWITCH, 10)), null)).toBeNull();
  });
});
