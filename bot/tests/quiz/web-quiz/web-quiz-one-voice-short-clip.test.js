'use strict';
/**
 * A plan's `loudness_lufs` levels every clip it records, short ones too (one voice per quiz, app_settings
 * `web_quiz_one_voice`, default off).
 *
 * ffmpeg's loudnorm cannot keep one gain for a clip under 3 seconds whose peak would pass the ceiling: it falls back
 * to its dynamic mode, which on a clip that short leaves a one-word option ("an ant", «پکا») far below the plan's
 * loudness, quieter even than it came. A short clip is levelled with one plain gain from the same measure, toward the
 * plan's loudness and held under the same true-peak ceiling (-1.5 dB): as loud as that ceiling lets it be.
 *
 * Boundaries faked: supabase (in-memory), R2 + the voice gateway, the loggers. ffmpeg runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: false })),
  uploadBuffer: jest.fn(async () => true),
  getPresignedUrl: jest.fn(async (u) => u),
}));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { makeFake } = require('./fake-supabase');
const Publish = require('../../../shared/services/quiz/web-quiz-publish.service');
const OneVoice = require('../../../shared/services/quiz/web-quiz-one-voice-flag');
const tts = require('../../../shared/services/tts');
const r2 = require('../../../shared/storage/r2');

const ffmpeg = (() => { try { return require('@ffmpeg-installer/ffmpeg').path; } catch (_) { return 'ffmpeg'; } })();
const QUIZ = '33333333-3333-4333-8333-333333333333';
const QID = '99999992-9999-4999-8999-999999999999';
const tmp = (ext) => path.join(os.tmpdir(), `wq-short-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}.${ext}`);

// A quiet Ogg Opus clip of `sec` seconds: a tone with a pause, as a one-word answer might come back from the voice.
const quietClip = (sec) => {
  const f = tmp('ogg');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${sec}`,
    '-af', `volume=-30dB,apad=pad_dur=0.2`, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg', f]);
  const b = fs.readFileSync(f); fs.unlinkSync(f); return b;
};
// A quiet tone with one sharp click (a plosive): its peak stops one gain short of the plan's loudness.
const peakyClip = (sec) => {
  const f = tmp('ogg');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${sec}`,
    '-f', 'lavfi', '-i', 'sine=frequency=2000:duration=0.01', '-filter_complex',
    '[0]volume=-30dB[a];[1]volume=0dB,adelay=300[b];[a][b]amix=inputs=2:normalize=0,apad=pad_dur=0.2',
    '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg', f]);
  const b = fs.readFileSync(f); fs.unlinkSync(f); return b;
};
const measure = (buf) => {
  const f = tmp('ogg'); fs.writeFileSync(f, buf);
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', f, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  fs.unlinkSync(f);
  const m = JSON.parse(r.stderr.match(/\{[^{}]*\}/g).pop());
  return { i: Number(m.input_i), tp: Number(m.input_tp) };
};

const row = () => ({
  id: QID, quiz_id: QUIZ, external_id: `vb:${QID}`, sort_order: 1, question_text: 'Which one is small?',
  option_a: 'an ant', option_b: 'uncle', option_c: null, option_d: null, correct_option: 'A',
  explanation: null, option_feedback: null, media: {}, render_pattern: 'P6a',
});
const seed = () => makeFake({
  quizzes: [{ id: QUIZ, topic: 'Small things', grade: '3', subject: 'English', language: 'en', meta: {}, quiz_source: 'video' }],
  quiz_questions: [row()], app_settings: [],
});

// A plan (a plan names voices, a bank or kbps) with a loudness: the switch's one voice at the bank's level.
const PLAN = () => {
  const plan = OneVoice.normalize({ kbps: 64, loudness_lufs: -21 });
  expect(plan).toMatchObject({ loudness_lufs: -21 });
  return plan;
};

beforeEach(() => { OneVoice.reset(); tts.synthesize.mockReset(); r2.uploadBuffer.mockClear(); });

describe('a plan\'s loudness: a clip under 3 seconds is levelled like a long one', () => {
  test.each([0.8, 1.5, 2.5])('a %s s clip at about -40 LUFS is stored within 3 LU of -21, true peak under -1 dB', async (sec) => {
    const quiet = quietClip(sec);
    expect(measure(quiet).i).toBeLessThan(-30);
    tts.synthesize.mockImplementation(async ({ provider, voice }) => ({ audio: quiet, provider, voice, durationSec: sec }));
    const fake = seed();
    const out = await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from }, oneVoice: PLAN() });
    expect(out.ok).toBe(true);
    expect(out.failed).toBe(0);
    const calls = r2.uploadBuffer.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach((c) => {
      expect(c[0].slice(0, 4).toString()).toBe('OggS');
      const m = measure(c[0]);
      expect(Math.abs(m.i + 21)).toBeLessThan(3);
      expect(m.tp).toBeLessThan(-1);
    });
  }, 60000);

  test('a 2.5 s clip with a sharp peak takes one gain up to the ceiling: as loud as -1.5 dB true peak lets it be', async () => {
    const clip = peakyClip(2.5);
    const m = measure(clip);
    const gain = Math.min(-21 - m.i, -1.5 - m.tp);
    expect(gain).toBeGreaterThan(5);   // the clip needs raising, and the peak stops it short of -21
    tts.synthesize.mockImplementation(async ({ provider, voice }) => ({ audio: clip, provider, voice, durationSec: 2.5 }));
    const fake = seed();
    const out = await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from }, oneVoice: PLAN() });
    expect(out.failed).toBe(0);
    expect(r2.uploadBuffer.mock.calls.length).toBeGreaterThan(0);
    r2.uploadBuffer.mock.calls.forEach((c) => {
      const o = measure(c[0]);
      expect(Math.abs(o.i - (m.i + gain))).toBeLessThan(1.5);
      expect(o.tp).toBeLessThan(-1);
    });
  }, 60000);

  test('a clip of 4 s keeps the two-pass levelling: within 1 LU of -21', async () => {
    const quiet = quietClip(4);
    tts.synthesize.mockImplementation(async ({ provider, voice }) => ({ audio: quiet, provider, voice, durationSec: 4 }));
    const fake = seed();
    const out = await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from }, oneVoice: PLAN() });
    expect(out.failed).toBe(0);
    expect(r2.uploadBuffer.mock.calls.length).toBeGreaterThan(0);
    r2.uploadBuffer.mock.calls.forEach((c) => expect(Math.abs(measure(c[0]).i + 21)).toBeLessThan(1));
  }, 60000);

  test('a loud short clip is held under the true-peak ceiling (one gain, never a clipped clip)', async () => {
    const f = tmp('ogg');
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1', '-af', 'volume=-1dB',
      '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg', f]);
    const loud = fs.readFileSync(f); fs.unlinkSync(f);
    tts.synthesize.mockImplementation(async ({ provider, voice }) => ({ audio: loud, provider, voice, durationSec: 1 }));
    const fake = seed();
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from }, oneVoice: PLAN() });
    expect(r2.uploadBuffer.mock.calls.length).toBeGreaterThan(0);
    r2.uploadBuffer.mock.calls.forEach((c) => expect(measure(c[0]).tp).toBeLessThan(-1));
  }, 60000);
});
