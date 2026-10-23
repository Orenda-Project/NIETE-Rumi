'use strict';
/**
 * bd-s1oo0.50.11 on the STORY path. Sandbox run 4 (2026-10-05, drop 14 live): the strong synthetic child read all
 * 60 words of the Urdu story and stopped ~14 s early (key: time_remaining 14.0, 65 a minute); the coach's results
 * said 42.7 s left and 176.9 a minute. Drop 14 fixed the grids' timedSummary, but the story takes its time from
 * story.js, which ended the reading at the latest «تھا» on the child's speaker: the passage's final «تھا» was heard
 * as «اج», so a «تھا» from the middle of the passage, 17 s in, was taken as the end.
 *
 * The transcript is the bot's own Soniox output for the synthetic note (computer voice, no child). Only the network
 * boundary is mocked, as in L37: OpenRouter (openai SDK), Soniox (axios), ffmpeg (child_process).
 */

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  const fs = jest.requireActual('fs');
  return {
    ...actual,
    execFile: jest.fn((bin, args, opts, cb) => {
      if (args.includes('-hide_banner')) { const e = new Error('no output'); cb(e, '', '  Duration: 00:01:27.73, start: 0'); return; }
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

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const H = require('../L37/harness');
const itemBank = require('../../../bot/shared/services/child-test/item-bank');
const { scoreTask } = require('../../../bot/shared/services/child-test/scoring');
const { script } = require('./fixtures/ur-story-strong.transcript.json');

const AUDIO = path.join(os.tmpdir(), 'l40-story-note.ogg');
fs.writeFileSync(AUDIO, 'OggS');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SONIOX_API_KEY = 'test-soniox';
  process.env.OPENROUTER_API_KEY = 'test-or';
  delete process.env.SPEECHACE_API_KEY;
});

function route(map) {
  mockCreate.mockImplementation(async (req) => {
    const p = H.promptOf(req);
    for (const [needle, r] of map) if (p.includes(needle)) return r;
    throw new Error(`unrouted prompt: ${p.slice(0, 80)}`);
  });
}

test('a finished reader: the time left comes from where the passage ends, not from a mid-passage «تھا»', async () => {
  H.sonioxReturns(axios, script);
  // the counts model hears every word read (51 right, 9 wrong): the child reached the last word
  route([
    ['reading aloud from a printed', H.words(H.rep('c', 25) + H.rep('w', 5) + H.rep('c', 26) + H.rep('w', 4))],
    ['reading-comprehension', H.reply({ questions: [] })],
  ]);
  const spec = itemBank.getTaskSpec({ grade: 3, set: 'A', task: 'ur.story' });
  const m = await scoreTask({ task: 'ur.story', spec, media: { file: AUDIO, durationSec: 87.7 }, lang: 'ur', grade: 3 });

  expect(m.timed.attempted).toBe(60);
  expect(m.timed.correct).toBe(51);
  expect(m.timed.clock).toBe('cue');
  // the last words «خوش بھی» are heard at ~46.4–46.8 s and the begin line ends at 2.5 s: ~44 s used, ~16 s left
  // (the synthetic child was scripted to finish with 14.0 s left). Before the fix: 42.7 s left.
  expect(m.timed.time_remaining).toBeGreaterThan(12);
  expect(m.timed.time_remaining).toBeLessThan(18);
  expect(m.timed.rate).toBeGreaterThan(60);
  expect(m.timed.rate).toBeLessThan(75);
});

test('a reader who did not finish keeps no time remaining', async () => {
  H.sonioxReturns(axios, script);
  route([
    ['reading aloud from a printed', H.words(H.rep('c', 40) + H.rep('s', 20))],
    ['reading-comprehension', H.reply({ questions: [] })],
  ]);
  const spec = itemBank.getTaskSpec({ grade: 3, set: 'A', task: 'ur.story' });
  const m = await scoreTask({ task: 'ur.story', spec, media: { file: AUDIO, durationSec: 87.7 }, lang: 'ur', grade: 3 });
  expect(m.timed.attempted).toBe(40);
  expect(m.timed.time_remaining).toBe(0);
});
