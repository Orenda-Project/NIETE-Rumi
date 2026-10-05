/**
 * Web quiz read-aloud: one clip per question, per option and per "why" line,
 * recorded once at publish time and kept in R2; the page gets short-lived links.
 *
 * Drives the REAL publish service, the REAL voice gateway and the REAL R2
 * helper. The network is mocked at its edge only: axios (the voice vendor),
 * the S3 SDK's send (R2), and a fake Supabase client passed in as `db`.
 * Presigning is local maths, so it runs for real against test credentials.
 */

const fs = require('fs');
const path = require('path');

process.env.R2_ENDPOINT = 'https://acct.r2.example.com';
process.env.R2_ACCESS_KEY_ID = 'test-only';
process.env.R2_SECRET_ACCESS_KEY = 'test-only';
process.env.R2_BUCKET_NAME = 'test-bucket';
process.env.ELEVENLABS_API_KEY = 'test-only';
delete process.env.TTS_PROVIDER;
delete process.env.E2E_CASSETTE;

const OGG = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'tts', 'libopus-sine-1s.ogg'));

jest.mock('axios');
jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn(),
}));
const mockLogEvent = jest.fn();
jest.mock('../../shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  getCurrentCorrelationId: () => null,
}));

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation((cfg) => {
      const real = new actual.S3Client(cfg);
      real.send = (...a) => mockS3Send(...a);
      return real;
    }),
  };
});

const axios = require('axios');
const { publishQuizAudio } = require('../../shared/services/quiz/web-quiz-publish.service');
const { presignAudio, presignVideo } = require('../../shared/services/quiz/web-quiz-media');

const QUIZ_ID = '11111111-1111-4111-8111-111111111111';
const Q1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const Q2 = 'aaaaaaaa-0000-4000-8000-000000000002';

/** A Supabase-shaped client over in-memory rows; records every update. */
function fakeDb({ quiz, questions, videos = [] }) {
  const updates = [];
  function from(table) {
    const state = { table, filters: {}, patch: null };
    const rows = () => {
      if (table === 'quizzes') return [quiz].filter((r) => r && (!state.filters.id || r.id === state.filters.id));
      if (table === 'quiz_questions') return questions.filter((r) => r.quiz_id === state.filters.quiz_id);
      if (table === 'student_videos') return videos.filter((r) => r.id === state.filters.id);
      return [];
    };
    const api = {
      select() { return api; },
      eq(col, val) { state.filters[col] = val; return api; },
      order() { return api; },
      update(patch) { state.patch = patch; return api; },
      maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      single() { return api.maybeSingle(); },
      then(resolve, reject) {
        if (state.patch) {
          updates.push({ table, filters: { ...state.filters }, patch: state.patch });
          if (table === 'quizzes' && quiz && quiz.id === state.filters.id) Object.assign(quiz, state.patch);
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return { from, updates };
}

function quizRows() {
  return {
    quiz: { id: QUIZ_ID, language: 'en', meta: { share_code: 'AB12CD', web: { arm: 'web' } } },
    questions: [
      { id: Q1, quiz_id: QUIZ_ID, sort_order: 1, question_text: 'Which part of a plant takes in water?',
        option_a: 'Roots', option_b: 'Leaves', option_c: 'Flower', option_d: null,
        correct_option: 'A', option_feedback: { correct: 'A) Roots drink water from the soil.' }, explanation: null },
      { id: Q2, quiz_id: QUIZ_ID, sort_order: 2, question_text: 'What do leaves make?',
        option_a: 'Food', option_b: 'Stones', option_c: null, option_d: null,
        correct_option: 'A', option_feedback: null, explanation: 'Leaves make food from sunlight.' },
    ],
  };
}

const putKeys = () => mockS3Send.mock.calls.map(([cmd]) => cmd).filter((c) => c.constructor.name === 'PutObjectCommand').map((c) => c.input.Key);

beforeEach(() => {
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: OGG });
  mockS3Send.mockReset();
  mockLogEvent.mockReset();
});

describe('publishQuizAudio', () => {
  test('records every question, option and why line once, keyed under the quiz, and keeps other meta', async () => {
    // HEAD says nothing exists yet; PUT succeeds.
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.constructor.name === 'HeadObjectCommand') { const e = new Error('nf'); e.name = 'NotFound'; throw e; }
      return {};
    });
    const rows = quizRows();
    const db = fakeDb(rows);

    const out = await publishQuizAudio(QUIZ_ID, { db });

    // Q1: q + 3 options + why = 5; Q2: q + 2 options + why = 4
    expect(out.ok).toBe(true);
    expect(out.synthesized).toBe(9);
    expect(axios.post).toHaveBeenCalledTimes(9);
    expect(putKeys()).toEqual(expect.arrayContaining([
      `web-quiz/audio/${QUIZ_ID}/${Q1}/q.ogg`,
      `web-quiz/audio/${QUIZ_ID}/${Q1}/a.ogg`,
      `web-quiz/audio/${QUIZ_ID}/${Q1}/c.ogg`,
      `web-quiz/audio/${QUIZ_ID}/${Q1}/why.ogg`,
      `web-quiz/audio/${QUIZ_ID}/${Q2}/why.ogg`,
    ]));
    // the why line is spoken without the stored letter (the page shuffles options)
    const spoken = axios.post.mock.calls.map((c) => c[1].text);
    expect(spoken).toContain('Roots drink water from the soil.');

    const meta = rows.quiz.meta;
    expect(meta.share_code).toBe('AB12CD');
    expect(meta.web.arm).toBe('web');
    expect(meta.web.audio[Q1]).toEqual({
      q: `web-quiz/audio/${QUIZ_ID}/${Q1}/q.ogg`,
      opts: [`web-quiz/audio/${QUIZ_ID}/${Q1}/a.ogg`, `web-quiz/audio/${QUIZ_ID}/${Q1}/b.ogg`, `web-quiz/audio/${QUIZ_ID}/${Q1}/c.ogg`, null],
      why: `web-quiz/audio/${QUIZ_ID}/${Q1}/why.ogg`,
    });
    expect(mockLogEvent).toHaveBeenCalledWith('web_quiz.publish_audio', expect.objectContaining({
      quizId: QUIZ_ID, synthesized: 9, skipped: 0, failed: 0, providers: { elevenlabs: 9 },
    }));
    expect(out.estimatedCostUsd).toBeGreaterThan(0);
  });

  test('is idempotent: clips already in R2 are not recorded again', async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.constructor.name === 'HeadObjectCommand') return { ContentLength: 1000, ContentType: 'audio/ogg' };
      return {};
    });
    const db = fakeDb(quizRows());
    const out = await publishQuizAudio(QUIZ_ID, { db });
    expect(axios.post).not.toHaveBeenCalled();
    expect(putKeys()).toEqual([]);
    expect(out.skipped).toBe(9);
  });

  test('stops at the per-quiz cap and says so', async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.constructor.name === 'HeadObjectCommand') { const e = new Error('nf'); e.name = 'NotFound'; throw e; }
      return {};
    });
    const out = await publishQuizAudio(QUIZ_ID, { db: fakeDb(quizRows()), maxClips: 4 });
    expect(axios.post).toHaveBeenCalledTimes(4);
    expect(out.capped).toBe(true);
  });

  test('fails soft: a voice outage records nothing, never throws, and keeps meta intact', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('quota'), { response: { status: 429 } }));
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.constructor.name === 'HeadObjectCommand') { const e = new Error('nf'); e.name = 'NotFound'; throw e; }
      return {};
    });
    process.env.TTS_FALLBACK = 'none';
    const rows = quizRows();
    const out = await publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    delete process.env.TTS_FALLBACK;
    expect(out.ok).toBe(true);
    expect(out.failed).toBe(9);
    expect(putKeys()).toEqual([]);
    expect(rows.quiz.meta.share_code).toBe('AB12CD');
  });

  test('an unknown quiz is an answer, not a throw', async () => {
    const out = await publishQuizAudio(QUIZ_ID, { db: fakeDb({ quiz: null, questions: [] }) });
    expect(out).toEqual(expect.objectContaining({ ok: false, reason: 'quiz_not_found' }));
  });
});

describe('presignAudio / presignVideo', () => {
  test('turns stored keys into signed links per question, nulls kept', async () => {
    const meta = { web: { audio: { [Q1]: { q: `web-quiz/audio/${QUIZ_ID}/${Q1}/q.ogg`, opts: [`web-quiz/audio/${QUIZ_ID}/${Q1}/a.ogg`, null], why: null } } } };
    const out = await presignAudio(meta);
    expect(out[Q1].q).toMatch(new RegExp(`/web-quiz/audio/${QUIZ_ID}/${Q1}/q\\.ogg\\?.*X-Amz-Signature=`));
    expect(out[Q1].opts[0]).toMatch(/X-Amz-Expires=21600/);
    expect(out[Q1].opts[1]).toBeNull();
    expect(out[Q1].why).toBeNull();
  });

  test('no audio in meta -> empty map (page falls back to the phone voice)', async () => {
    expect(await presignAudio({})).toEqual({});
    expect(await presignAudio(null)).toEqual({});
  });

  test('video-bank quiz -> signed video link with bytes; other quizzes -> null', async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.constructor.name === 'HeadObjectCommand') {
        if (cmd.input.Key.endsWith('.mp4')) return { ContentLength: 3500000, ContentType: 'video/mp4' };
        const e = new Error('nf'); e.name = 'NotFound'; throw e;
      }
      return {};
    });
    const db = fakeDb({ quiz: null, questions: [], videos: [
      { id: 'v1', r2_url: 'https://acct.r2.example.com/test-bucket/student-videos/g3/plants.mp4', migration_status: 'done' },
    ] });
    const v = await presignVideo({ id: QUIZ_ID, video_id: 'v1' }, { db });
    expect(v.url).toMatch(/student-videos\/g3\/plants\.mp4\?.*X-Amz-Signature=/);
    expect(v.bytes).toBe(3500000);
    expect(v.poster).toBeUndefined();
    expect(await presignVideo({ id: QUIZ_ID, video_id: null }, { db })).toBeNull();
  });
});
