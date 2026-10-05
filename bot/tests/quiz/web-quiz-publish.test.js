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
const Publish = require('../../shared/services/quiz/web-quiz-publish.service');
const { publishQuizAudio, audioKey } = Publish;
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
      audioKey(QUIZ_ID, Q1, 'q', 'Which part of a plant takes in water?', 'en'),
      audioKey(QUIZ_ID, Q1, 'a', 'Roots', 'en'),
      audioKey(QUIZ_ID, Q1, 'c', 'Flower', 'en'),
      audioKey(QUIZ_ID, Q1, 'why', 'Roots drink water from the soil.', 'en'),
      audioKey(QUIZ_ID, Q2, 'why', 'Leaves make food from sunlight.', 'en'),
    ]));
    putKeys().forEach((k) => expect(k).toMatch(new RegExp(`^web-quiz/audio/${QUIZ_ID}/[0-9a-f-]+/(q|a|b|c|d|why)-[0-9a-f]{12}\\.ogg$`)));
    // the why line is spoken without the stored letter (the page shuffles options)
    const spoken = axios.post.mock.calls.map((c) => c[1].text);
    expect(spoken).toContain('Roots drink water from the soil.');

    const meta = rows.quiz.meta;
    expect(meta.share_code).toBe('AB12CD');
    expect(meta.web.arm).toBe('web');
    expect(meta.web.audio[Q1]).toEqual({
      q: audioKey(QUIZ_ID, Q1, 'q', 'Which part of a plant takes in water?', 'en'),
      opts: [audioKey(QUIZ_ID, Q1, 'a', 'Roots', 'en'), audioKey(QUIZ_ID, Q1, 'b', 'Leaves', 'en'), audioKey(QUIZ_ID, Q1, 'c', 'Flower', 'en'), null],
      why: audioKey(QUIZ_ID, Q1, 'why', 'Roots drink water from the soil.', 'en'),
      fbs: [null, null, null, null],
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

  test('a picture option (emoji, no letters or digits) gets no clip; the page shows the picture', async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.constructor.name === 'HeadObjectCommand') { const e = new Error('nf'); e.name = 'NotFound'; throw e; }
      return {};
    });
    const rows = quizRows();
    rows.questions = [{ ...rows.questions[0], option_a: '\u{1F338}', option_b: '\u{1F343}', option_c: '12', option_d: null }];
    const out = await publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    expect(out.synthesized).toBe(3); // q + "12" + why
    expect(axios.post.mock.calls.map((c) => c[1].text)).not.toContain('\u{1F338}');
    expect(rows.quiz.meta.web.audio[Q1].opts).toEqual([null, null, audioKey(QUIZ_ID, Q1, 'c', '12', 'en'), null]);
  });

  test('an unknown quiz is an answer, not a throw', async () => {
    const out = await publishQuizAudio(QUIZ_ID, { db: fakeDb({ quiz: null, questions: [] }) });
    expect(out).toEqual(expect.objectContaining({ ok: false, reason: 'quiz_not_found' }));
  });
});

describe('publishQuizAudio: what the voice says (SCHEMA_v2 read text, never TeX)', () => {
  const missing = async (cmd) => {
    if (cmd.constructor.name === 'HeadObjectCommand') { const e = new Error('nf'); e.name = 'NotFound'; throw e; }
    return {};
  };
  const said = () => axios.post.mock.calls.map((c) => c[1].text);

  test('a question with a web item is voiced from read.stem and read.opts, each option clip on its slot', async () => {
    mockS3Send.mockImplementation(missing);
    const rows = quizRows();
    rows.questions = [{
      ...rows.questions[0],
      question_text: 'What is $\\frac{3}{4}$ of 8?', option_a: '$6$', option_b: '$2$', option_c: '$4$',
      media: { web: { v: 2, type: 'single', key: 'A', stem: 'What is $\\frac{3}{4}$ of 8?',
        options: [{ slot: 'A', text: '$6$' }, { slot: 'B', text: '$2$' }, { slot: 'C', text: '$4$' }],
        read: { stem: 'What is three quarters of eight?', opts: ['six', 'two', 'four'] } } },
    }];
    const out = await publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    expect(out.ok).toBe(true);
    expect(said()).toEqual(expect.arrayContaining(['What is three quarters of eight?', 'six', 'two', 'four']));
    said().forEach((t) => { expect(t).not.toMatch(/[$\\]|frac/); });
    const a = rows.quiz.meta.web.audio[Q1];
    expect(a.q).toBe(audioKey(QUIZ_ID, Q1, 'q', 'What is three quarters of eight?', 'en'));
    expect(a.opts).toEqual([audioKey(QUIZ_ID, Q1, 'a', 'six', 'en'), audioKey(QUIZ_ID, Q1, 'b', 'two', 'en'), audioKey(QUIZ_ID, Q1, 'c', 'four', 'en'), null]);
  });

  test('an order item (new options on the web) voices ITS steps, not the row\'s options', async () => {
    mockS3Send.mockImplementation(missing);
    const rows = quizRows();
    rows.questions = [{
      ...rows.questions[1],
      media: { web: { v: 2, type: 'order', key: 'B,A,C', stem: 'Put the steps in order.',
        options: [{ slot: 'A', text: 'Roast' }, { slot: 'B', text: 'Harvest' }, { slot: 'C', text: 'Temper' }],
        read: { stem: 'Put the steps in order.', opts: ['roast the beans', 'harvest the beans', 'temper the chocolate'] } } },
    }];
    await publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    expect(said()).toEqual(expect.arrayContaining(['Put the steps in order.', 'roast the beans', 'harvest the beans', 'temper the chocolate']));
    expect(said()).not.toContain('Stones'); // the row's own option is not on this page
    expect(rows.quiz.meta.web.audio[Q2].opts[2]).toBe(audioKey(QUIZ_ID, Q2, 'c', 'temper the chocolate', 'en'));
  });

  test('a row with no web item falls back to mathToText: never "dollar backslash frac"', async () => {
    mockS3Send.mockImplementation(missing);
    const rows = quizRows();
    rows.questions = [{ ...rows.questions[0], question_text: 'What is $\\frac{1}{2}$ of 8?', option_a: '$4$', option_b: '$\\frac{1}{4}$', option_c: '2',
      option_feedback: { correct: 'Half of $8$ is $4$.' } }];
    await publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    expect(said()).toEqual(expect.arrayContaining(['What is 1/2 of 8?', '4', '1/4', 'Half of 8 is 4.']));
    said().forEach((t) => { expect(t).not.toMatch(/[$\\]|frac/); });
  });

  test('re-publish after the words changed records the new words (an old clip under the old words is not reused)', async () => {
    const rows = quizRows();
    rows.questions = [{ ...rows.questions[1], question_text: 'What do $leaves$ make?' }];
    const oldKeys = new Set(['q', 'a', 'b', 'why'].map((p) => `web-quiz/audio/${QUIZ_ID}/${Q2}/${p}.ogg`));
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.constructor.name === 'HeadObjectCommand') {
        if (oldKeys.has(cmd.input.Key)) return { ContentLength: 1000, ContentType: 'audio/ogg' };
        const e = new Error('nf'); e.name = 'NotFound'; throw e;
      }
      return {};
    });
    const out = await publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    expect(said()).toContain('What do leaves make?');
    expect(out.synthesized).toBe(4);
    expect(oldKeys.has(rows.quiz.meta.web.audio[Q2].q)).toBe(false);
  });
});

describe('publishQuizAudio: the why clip is the reason, never praise (it is played after a WRONG answer too)', () => {
  const missing = async (cmd) => {
    if (cmd.constructor.name === 'HeadObjectCommand') { const e = new Error('nf'); e.name = 'NotFound'; throw e; }
    return {};
  };
  const said = () => axios.post.mock.calls.map((c) => c[1].text);
  const PRAISE = /well done|great job|correct!|شاباش|بہت خوب|زبردست/i;

  test.each([
    ['en', 'Well done!', 'Roots grow under the soil and drink up water for the whole plant.'],
    ['ur', 'شاباش!', 'جڑیں مٹی کے نیچے ہوتی ہیں اور پورے پودے کے لیے پانی لیتی ہیں۔'],
  ])('%s: option_feedback.correct "%s" is not the why; the explanation is', async (lang, praise, explanation) => {
    mockS3Send.mockImplementation(missing);
    const rows = quizRows();
    rows.quiz.language = lang;
    rows.questions = [{ ...rows.questions[0], option_feedback: { correct: praise, wrong: { 1: 'Leaves make food.' } }, explanation }];
    await publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    expect(said()).toContain(explanation);
    said().forEach((t) => expect(t).not.toMatch(PRAISE));
    expect(rows.quiz.meta.web.audio[Q1].why).toBe(audioKey(QUIZ_ID, Q1, 'why', explanation, lang));
  });

  test('praise in front of a reason is cut off; the reason is kept', async () => {
    mockS3Send.mockImplementation(missing);
    const rows = quizRows();
    rows.questions = [{ ...rows.questions[0], option_feedback: { correct: 'Well done! Roots drink water from the soil.' }, explanation: null }];
    await publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    expect(said()).toContain('Roots drink water from the soil.');
    said().forEach((t) => expect(t).not.toMatch(PRAISE));
  });

  test('SCHEMA_v2: the item\'s why is voiced, not its fb_right', async () => {
    mockS3Send.mockImplementation(missing);
    const rows = quizRows();
    rows.questions = [{
      ...rows.questions[0], option_feedback: { correct: 'Well done!' }, explanation: 'Roots take in water.',
      media: { web: { v: 2, type: 'single', key: 'A', stem: 'Which part takes in water?', fb_right: 'Great job!',
        why: 'Roots take in water from the soil.',
        options: [{ slot: 'A', text: 'Roots' }, { slot: 'B', text: 'Leaves' }], read: { stem: 'Which part takes in water?', opts: ['Roots', 'Leaves'] } } },
    }];
    await publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    expect(said()).toContain('Roots take in water from the soil.');
    said().forEach((t) => expect(t).not.toMatch(PRAISE));
  });
});

describe('publishQuizAudio: the feedback for each wrong option is recorded too (the page says it after that pick)', () => {
  const missing = async (cmd) => {
    if (cmd.constructor.name === 'HeadObjectCommand') { const e = new Error('nf'); e.name = 'NotFound'; throw e; }
    return {};
  };
  const said = () => axios.post.mock.calls.map((c) => c[1].text);

  test('a row\'s option_feedback.wrong lines get clips on their option\'s slot (fbs), praise never', async () => {
    mockS3Send.mockImplementation(missing);
    const rows = quizRows();
    rows.questions = [{ ...rows.questions[0], option_feedback: { correct: 'Well done!', wrong: { 1: 'Leaves make food from sunlight.', 2: 'Flowers make seeds.' } },
      explanation: 'Roots drink water.' }];
    await publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    expect(said()).toEqual(expect.arrayContaining(['Leaves make food from sunlight.', 'Flowers make seeds.']));
    expect(rows.quiz.meta.web.audio[Q1].fbs).toEqual([null, audioKey(QUIZ_ID, Q1, 'xb', 'Leaves make food from sunlight.', 'en'),
      audioKey(QUIZ_ID, Q1, 'xc', 'Flowers make seeds.', 'en'), null]);
  });

  test('a video-bank feedback line is recorded cleaned (no letters, no "correct answer", no praise), as the page shows it', async () => {
    mockS3Send.mockImplementation(missing);
    const rows = quizRows();
    rows.questions = [{ ...rows.questions[0], option_feedback: { wrong: { 1: 'B) Good try! Leaves make food. The correct answer is A) Roots, because roots drink water. Keep going!' } }, explanation: 'Roots drink water.' }];
    await publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    expect(said()).toContain('Leaves make food. Roots drink water.');
    said().forEach((t) => expect(t).not.toMatch(/Good try|Keep going|correct answer|\b[A-D]\)/));
  });

  test('SCHEMA_v2: each option\'s own fb is recorded on that option\'s slot', async () => {
    mockS3Send.mockImplementation(missing);
    const rows = quizRows();
    rows.questions = [{ ...rows.questions[1], media: { web: { v: 2, type: 'order', key: 'B,A', stem: 'Put them in order.', why: 'Seeds come first.',
      options: [{ slot: 'A', text: 'Plant', fb: 'A plant grows from a seed.' }, { slot: 'B', text: 'Seed' }], read: { stem: 'Put them in order.', opts: ['plant', 'seed'] } } } }];
    await publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    expect(rows.quiz.meta.web.audio[Q2].fbs).toEqual([audioKey(QUIZ_ID, Q2, 'xa', 'A plant grows from a seed.', 'en'), null, null, null]);
  });

  test('a complete publish stamps the voice version, so it is not redone; a partial one does not', async () => {
    mockS3Send.mockImplementation(missing);
    const rows = quizRows();
    await publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    expect(rows.quiz.meta.web.audio_v).toBe(2);
    const rows2 = quizRows();
    axios.post.mockReset(); axios.post.mockRejectedValue(new Error('vendor down'));
    await publishQuizAudio(QUIZ_ID, { db: fakeDb(rows2) });
    expect(rows2.quiz.meta.web.audio_v).toBeUndefined();
  });
});

describe('ensureQuizAudio: a quiz gets its clips the first time its page is opened, once', () => {
  test('publishes a quiz whose clips are missing or older than this voice version, once even when asked twice at once', async () => {
    const publish = jest.fn().mockResolvedValue({ ok: true });
    const a = Publish.ensureQuizAudio('quiz-1', { meta: { web: { audio: {} } }, publish });
    const b = Publish.ensureQuizAudio('quiz-1', { meta: {}, publish });
    await Promise.all([a, b]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('quiz-1', expect.any(Object));
  });

  test('a quiz already at this voice version is left alone', async () => {
    const publish = jest.fn().mockResolvedValue({ ok: true });
    await Publish.ensureQuizAudio('quiz-2', { meta: { web: { audio_v: Publish.AUDIO_VERSION } }, publish });
    expect(publish).not.toHaveBeenCalled();
  });

  test('never throws, and does not retry a failing quiz on every page open', async () => {
    const publish = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(Publish.ensureQuizAudio('quiz-3', { meta: {}, publish })).resolves.toBeDefined();
    await Publish.ensureQuizAudio('quiz-3', { meta: {}, publish });
    expect(publish).toHaveBeenCalledTimes(1);
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

  test('signs the wrong-option feedback clips (fbs) too', async () => {
    const meta = { web: { audio: { [Q1]: { q: null, opts: [], why: null, fbs: [null, `web-quiz/audio/${QUIZ_ID}/${Q1}/xb-abc.ogg`] } } } };
    const out = await presignAudio(meta);
    expect(out[Q1].fbs[0]).toBeNull();
    expect(out[Q1].fbs[1]).toMatch(/xb-abc\.ogg\?.*X-Amz-Signature=/);
  });

  test('no audio in meta -> empty map (page falls back to the phone voice)', async () => {
    expect(await presignAudio({})).toEqual({});
    expect(await presignAudio(null)).toEqual({});
  });

  test('video-bank quiz -> signed video link with bytes; other quizzes -> null', async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.constructor.name === 'HeadObjectCommand') {
        // Only the original exists here (no lighter _web.mp4 copy beside it).
        if (cmd.input.Key.endsWith('.mp4') && !cmd.input.Key.endsWith('_web.mp4')) return { ContentLength: 3500000, ContentType: 'video/mp4' };
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

  test('a lighter web copy (<key>_web.mp4, same video, smaller audio) is served when it exists; the poster stays the original\'s', async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.constructor.name === 'HeadObjectCommand') {
        if (cmd.input.Key === 'student-videos/g3/plants.mp4') return { ContentLength: 9700000, ContentType: 'video/mp4' };
        if (cmd.input.Key === 'student-videos/g3/plants_web.mp4') return { ContentLength: 7400000, ContentType: 'video/mp4' };
        if (cmd.input.Key === 'student-videos/g3/plants_poster.jpg') return { ContentLength: 6000, ContentType: 'image/jpeg' };
        const e = new Error('nf'); e.name = 'NotFound'; throw e;
      }
      return {};
    });
    const db = fakeDb({ quiz: null, questions: [], videos: [
      { id: 'v5', r2_url: 'https://acct.r2.example.com/test-bucket/student-videos/g3/plants.mp4', migration_status: 'done' },
    ] });
    const v = await presignVideo({ id: QUIZ_ID, video_id: 'v5' }, { db });
    expect(v.url).toMatch(/student-videos\/g3\/plants_web\.mp4\?.*X-Amz-Signature=/);
    expect(v.bytes).toBe(7400000);
    expect(v.poster).toMatch(/plants_poster\.jpg\?/);
  });

  // A deployment whose bucket differs from the one the video bank's rows name
  // (the rows were migrated once, with path-style URLs on the same R2 account).
  const OTHER_BUCKET_URL = 'https://acct.r2.example.com/video-bank-bucket/student-videos/g3/hen.mp4';

  test('row names another bucket on our R2 endpoint, key present in ours -> signed link to OUR copy', async () => {
    const heads = [];
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.constructor.name === 'HeadObjectCommand') {
        heads.push(`${cmd.input.Bucket}/${cmd.input.Key}`);
        if (cmd.input.Key === 'student-videos/g3/hen.mp4') return { ContentLength: 3170403, ContentType: 'video/mp4' };
        const e = new Error('nf'); e.name = 'NotFound'; throw e;
      }
      return {};
    });
    const db = fakeDb({ quiz: null, questions: [], videos: [{ id: 'v2', r2_url: OTHER_BUCKET_URL, migration_status: 'done' }] });
    const v = await presignVideo({ id: QUIZ_ID, video_id: 'v2' }, { db });
    expect(v).not.toBeNull();
    expect(v.url).toMatch(/\/test-bucket\/student-videos\/g3\/hen\.mp4\?.*X-Amz-Signature=|test-bucket\..*\/student-videos\/g3\/hen\.mp4\?.*X-Amz-Signature=/);
    expect(v.bytes).toBe(3170403);
    expect(heads).toContain('test-bucket/student-videos/g3/hen.mp4');
  });

  test('row names another bucket and the key is NOT in ours -> null, with the warn', async () => {
    const { logWarn } = require('../../shared/utils/logger');
    logWarn.mockClear();
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.constructor.name === 'HeadObjectCommand') { const e = new Error('nf'); e.name = 'NotFound'; throw e; }
      return {};
    });
    const db = fakeDb({ quiz: null, questions: [], videos: [{ id: 'v3', r2_url: OTHER_BUCKET_URL, migration_status: 'done' }] });
    expect(await presignVideo({ id: QUIZ_ID, video_id: 'v3' }, { db })).toBeNull();
    expect(logWarn).toHaveBeenCalledWith('web_quiz.presign_video.failed', expect.objectContaining({ quizId: QUIZ_ID }));
  });

  test('row on a host that is not our R2 endpoint -> null (never signs a foreign host)', async () => {
    mockS3Send.mockImplementation(async () => ({ ContentLength: 10, ContentType: 'video/mp4' }));
    const db = fakeDb({ quiz: null, questions: [], videos: [
      { id: 'v4', r2_url: 'https://elsewhere.example.org/video-bank-bucket/student-videos/g3/hen.mp4', migration_status: 'done' },
    ] });
    expect(await presignVideo({ id: QUIZ_ID, video_id: 'v4' }, { db })).toBeNull();
  });
});
