/**
 * Two teachers' voice notes in the same millisecond are each transcribed — and answered —
 * from their OWN audio. (bd-x74wv)
 *
 * voice-message.handler.js wrote every inbound voice note to a temp file named by the clock
 * alone — `audio_${Date.now()}.ogg`, `audio_${Date.now()}.wav`, `comprehension_${Date.now()}.ogg`
 * — and AudioService.convertToWav staged its input the same way (`input_${Date.now()}.ogg`).
 * The transcoder and the Soniox upload read those files some time after they were written. Two
 * voice notes on one container in the same millisecond share every one of those paths: the
 * second write overwrites the first, and the first teacher is transcribed — and answered, and
 * scored — from the second teacher's voice. No error anywhere.
 *
 * Same shape as tests/whatsapp/send-temp-collision.test.js (bd-c00np): the REAL handler, the
 * REAL WhatsAppService (download), the REAL AudioService (convert + Soniox upload) and the REAL
 * R2 helper run; Date.now is pinned so the two notes collide on the clock; only the network is
 * faked (axios for WhatsApp + Soniox, the S3 client for R2) and the transcoder process (a fake
 * ffmpeg that, like the real one, opens its input a little after it is started). The Soniox
 * upload waits 200 ms before it reads the stream it was given, as a real upload does.
 *
 * Everything AFTER the transcript (intent, the model's answer, the voice reply) is stubbed as
 * in the neighbouring voice-handler suites — the answer simply echoes which question it heard,
 * so "who was answered about what" is visible.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.R2_ENDPOINT = 'https://r2.example';
process.env.R2_ACCESS_KEY_ID = 'r2-key';
process.env.R2_SECRET_ACCESS_KEY = 'r2-secret';
process.env.R2_BUCKET_NAME = 'voice-bucket';
delete process.env.E2E_CASSETTE;

jest.mock('../../bot/shared/utils/constants', () => {
  const os = require('os');
  const nodeFs = require('fs');
  const nodePath = require('path');
  return {
    ...jest.requireActual('../../bot/shared/utils/constants'),
    TEMP_DIR: nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'voice-temp-collision-')),
    WHATSAPP_TOKEN: 'test-token',
    PHONE_NUMBER_ID: 'test-phone-id',
    SONIOX_API_KEY: 'sk-test',
    ATTENDANCE_MARKING_FLOW_ID: 'flow-attendance',
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), LOGS_DIR: '/tmp',
}));

// ── The process + network boundary ───────────────────────────────────────────
// ffmpeg is a separate process: it opens its input some time after it is started, and
// writes its output some time after that. ffprobe likewise.
jest.mock('fluent-ffmpeg', () => {
  const nodeFs = require('fs');
  const later = (ms) => new Promise((r) => setTimeout(r, ms));
  function command(input) {
    const on = {};
    let out = null;
    const c = {};
    for (const m of ['toFormat', 'audioFrequency', 'audioChannels', 'audioCodec', 'format',
      'setStartTime', 'setDuration', 'inputOptions', 'outputOptions', 'noVideo']) c[m] = () => c;
    c.output = (p) => { out = p; return c; };
    c.on = (ev, fn) => { on[ev] = fn; return c; };
    const go = () => {
      (async () => {
        await later(40);
        try {
          const bytes = nodeFs.readFileSync(input);
          await later(10);
          nodeFs.writeFileSync(out, Buffer.concat([Buffer.from('RIFF'), bytes]));
          if (on.end) on.end();
        } catch (e) {
          if (on.error) on.error(e);
        }
      })();
      return c;
    };
    c.save = (p) => { out = p; return go(); };
    c.run = () => go();
    return c;
  }
  const ffmpeg = jest.fn(command);
  ffmpeg.setFfmpegPath = jest.fn();
  ffmpeg.setFfprobePath = jest.fn();
  ffmpeg.ffprobe = jest.fn((p, cb) => setTimeout(() => {
    try { cb(null, { format: { duration: nodeFs.statSync(p).size } }); } catch (e) { cb(e); }
  }, 40));
  return ffmpeg;
});
jest.mock('form-data', () => class RecordingFormData {
  constructor() { this.parts = []; }
  append(name, value, options) { this.parts.push({ name, value, options }); }
  getHeaders() { return { 'content-type': 'multipart/form-data; boundary=x' }; }
});
const mockR2Puts = [];
const mockR2 = { fail: false };
jest.mock('@aws-sdk/client-s3', () => {
  const command = (name) => class { constructor(input) { this.input = input; this.name = name; } };
  return {
    S3Client: class { async send(cmd) {
      if (mockR2.fail) throw new Error('R2 unavailable');
      if (cmd.name === 'PutObjectCommand') mockR2Puts.push({ key: cmd.input.Key, body: Buffer.from(cmd.input.Body) });
      return {};
    } },
    PutObjectCommand: command('PutObjectCommand'),
    GetObjectCommand: command('GetObjectCommand'),
    DeleteObjectCommand: command('DeleteObjectCommand'),
    HeadObjectCommand: command('HeadObjectCommand'),
    ListObjectsV2Command: command('ListObjectsV2Command'),
  };
});
// Whisper is Soniox's last resort; in these tests it is down too (after a round trip).
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  audio: {
    transcriptions: { create: jest.fn(() => new Promise((_, reject) => setTimeout(() => reject(new Error('whisper down')), 20))) },
    speech: { create: jest.fn(() => Promise.reject(new Error('no speech'))) },
  },
  chat: { completions: { create: jest.fn(() => Promise.reject(new Error('unused'))) } },
})));
jest.mock('../../bot/shared/services/llm-client', () => ({
  getDefaultModel: () => 'test-model',
  getClient: () => ({ chat: { completions: { create: jest.fn(async ({ job }) => ({
    choices: [{ message: { content: job === 'reading.evaluateAnswer'
      ? JSON.stringify({ correct: true, confidence: 0.9, explanation: 'ok' })
      : '[]' } }],
  })) } } }),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));

// ── After the transcript: stubbed as in tests/handlers/voice-reply-tts-gateway.test.js ──
jest.mock('../../bot/shared/services/openai.service', () => ({
  detectIntent: jest.fn(() => Promise.resolve({ type: 'general' })),
  // The answer says which question it was asked, so a swap shows in the reply.
  getResponseWithFormat: jest.fn(async (...args) => {
    const asked = JSON.stringify(args);
    if (asked.includes('fractions')) return 'Answer about fractions';
    if (asked.includes('photosynthesis')) return 'Answer about photosynthesis';
    return 'Answer about nothing heard';
  }),
}));
jest.mock('../../bot/shared/services/tts', () => ({
  synthesize: jest.fn(() => Promise.reject(new Error('no voice in this test'))),
}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(), getOrCreateSession: jest.fn(() => Promise.resolve('sess-1')),
  updateSessionType: jest.fn(), storeConversation: jest.fn(), storeAudioSession: jest.fn(), storeLessonPlan: jest.fn(),
}));
jest.mock('../../bot/shared/services/observe/observe-audio-router', () => ({
  ...jest.requireActual('../../bot/shared/services/observe/observe-audio-router'),
  routeLeaderAudio: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('../../bot/shared/services/feature-registration.service', () => ({ isPendingName: jest.fn(() => Promise.resolve(false)) }));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({
  getState: jest.fn(() => Promise.resolve(null)), clearState: jest.fn(), setState: jest.fn(),
}));
jest.mock('../../bot/shared/services/language-detector.service', () => ({
  getConfirmedLanguage: jest.fn(() => Promise.resolve('en')), detectLanguage: jest.fn(() => 'en'),
}));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(() => Promise.resolve('en')), setUserLanguage: jest.fn(), DEFAULT_LANGUAGE: 'en',
}));
jest.mock('../../bot/shared/services/lp-context.service', () => ({ injectLpContext: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({
  handleReflectiveResponse: jest.fn(() => Promise.resolve()), initiateCoachingSession: jest.fn(),
}));
jest.mock('../../bot/shared/services/redis-comprehension.service', () => ({
  findActiveFlowByUser: jest.fn(() => Promise.resolve(null)),
  abandonUserFlows: jest.fn(() => Promise.resolve()),
  recordAnswer: jest.fn(), clearFlow: jest.fn(),
}));
// Loaded by comprehension.service at module scope for picture questions; not on this path, and on
// some branches it requires a bot-only SDK the root suite cannot resolve.
jest.mock('../../bot/shared/services/reading/vocabulary-image.service', () => ({}));
jest.mock('../../bot/shared/services/reading-assessment.service', () => ({ handleAudioReceipt: jest.fn(() => Promise.resolve()) }));
jest.mock('../../bot/shared/services/voice-attendance.service', () => ({
  ...jest.requireActual('../../bot/shared/services/voice-attendance.service'),
  armed: jest.fn(() => Promise.resolve(null)),
  stashResult: jest.fn(() => Promise.resolve()),
  disarm: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/routes/attendance-marking-endpoint', () => ({
  loadSubject: jest.fn(() => Promise.resolve({ people: [{ id: 't-1', name: 'Ayesha Khan' }], label: 'Staff' })),
}));
let mockDb = () => ({ data: null, error: null });
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const q = { table, filters: {} };
    const chain = {};
    const result = () => Promise.resolve(mockDb(q));
    for (const m of ['select', 'neq', 'or', 'order', 'limit', 'update', 'insert', 'upsert', 'gte', 'lte', 'in', 'is', 'delete']) chain[m] = jest.fn(() => chain);
    chain.eq = jest.fn((k, v) => { q.filters[k] = v; return chain; });
    chain.single = jest.fn(result);
    chain.maybeSingle = jest.fn(result);
    chain.then = (res, rej) => result().then(res, rej);
    return chain;
  }),
}));

const axios = require('axios'); // mapped stub — the network boundary
const { TEMP_DIR } = require('../../bot/shared/utils/constants');
const CoachingService = require('../../bot/shared/services/coaching-orchestrator.service');
const RedisComprehensionService = require('../../bot/shared/services/redis-comprehension.service');
const VoiceAttendance = require('../../bot/shared/services/voice-attendance.service');
const { handleVoiceMessage } = require('../../bot/shared/handlers/voice-message.handler');

const sha12 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PINNED = Date.parse('2026-10-05T09:00:00.000Z');

const TEACHER_A = { phone: '923000000201', user: { id: 'u-teacher-a', role: 'teacher', preferred_language: 'en' } };
const TEACHER_B = { phone: '923000000202', user: { id: 'u-teacher-b', role: 'teacher', preferred_language: 'en' } };
// What each voice note says. The fake Soniox "hears" the topic from the bytes it was sent.
const TOPIC = { 'media-a': 'fractions', 'media-b': 'photosynthesis' };
const AUDIO = {
  'media-a': Buffer.concat([Buffer.from('OggS'), Buffer.from('-voice-note-about-fractions-'.repeat(64))]),
  'media-b': Buffer.concat([Buffer.from('OggS'), Buffer.from('-voice-note-about-photosynthesis-'.repeat(64))]),
};
const wavOf = (mediaId) => Buffer.concat([Buffer.from('RIFF'), AUDIO[mediaId]]);
const heard = (bytes) => {
  const s = bytes.toString('latin1');
  if (s.includes('fractions')) return 'Please help me teach fractions';
  if (s.includes('photosynthesis')) return 'Please help me teach photosynthesis';
  return '';
};
const note = (mediaId) => ({ id: `wamid.${mediaId}`, audio: { id: mediaId, mime_type: 'audio/ogg; codecs=opus', voice: true } });

let soniox; // { uploads: [Buffer], files: Map, tx: Map }
let sent; // [{to, text}]
let sonioxDown;

function leftovers(dir = TEMP_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return fs.statSync(p).isDirectory() ? leftovers(p) : [path.relative(TEMP_DIR, p)];
  });
}
const textsTo = (phone) => sent.filter((s) => s.to === phone && s.text).map((s) => s.text);

beforeEach(() => {
  jest.clearAllMocks();
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  jest.spyOn(Date, 'now').mockReturnValue(PINNED); // both notes land in the same millisecond
  soniox = { uploads: [], files: new Map(), tx: new Map() };
  sent = [];
  sonioxDown = false;
  mockR2Puts.length = 0;
  mockR2.fail = false;
  mockDb = () => ({ data: null, error: null });
  // Routing state: nothing armed, no comprehension flow — each describe opts into its own branch.
  RedisComprehensionService.findActiveFlowByUser.mockReset().mockResolvedValue(null);
  RedisComprehensionService.recordAnswer.mockReset();
  VoiceAttendance.armed.mockReset().mockResolvedValue(null);
  let n = 0;

  axios.get.mockReset();
  axios.get.mockImplementation(async (url) => {
    let m;
    if ((m = url.match(/graph\.facebook\.com\/[^/]+\/(media-[a-z]+)$/))) {
      return { status: 200, data: { url: `https://lookaside.fbsbx.com/whatsapp/${m[1]}`, mime_type: 'audio/ogg; codecs=opus', file_size: 30_000 } };
    }
    if ((m = url.match(/lookaside\.fbsbx\.com\/whatsapp\/(media-[a-z]+)$/))) {
      await sleep(5);
      return { status: 200, data: AUDIO[m[1]] };
    }
    if ((m = url.match(/api\.soniox\.com\/v1\/transcriptions\/(tx-\d+)\/transcript$/))) {
      return { status: 200, data: { text: heard(soniox.tx.get(m[1])), language: 'en' } };
    }
    if ((m = url.match(/api\.soniox\.com\/v1\/transcriptions\/(tx-\d+)$/))) {
      return { status: 200, data: { status: 'completed' } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
  axios.post.mockReset();
  axios.post.mockImplementation(async (url, body) => {
    if (url === 'https://api.soniox.com/v1/files') {
      if (sonioxDown) { // a failed request still takes a round trip
        await sleep(20);
        throw Object.assign(new Error('Soniox 503'), { response: { status: 503 } });
      }
      const id = `file-${++n}`;
      await sleep(200); // the upload connects before it streams the body
      const file = body.parts.find((p) => p.name === 'file').value;
      const chunks = [];
      for await (const chunk of file) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      soniox.uploads.push(bytes);
      soniox.files.set(id, bytes);
      return { status: 200, data: { id } };
    }
    if (url === 'https://api.soniox.com/v1/transcriptions') {
      const id = `tx-${++n}`;
      soniox.tx.set(id, soniox.files.get(body.file_id));
      return { status: 200, data: { id } };
    }
    if (/graph\.facebook\.com\/.*\/messages$/.test(url)) {
      if (body && body.type === 'text') sent.push({ to: body.to, text: body.text.body });
      return { status: 200, data: { messages: [{ id: 'wamid.out' }] } };
    }
    throw new Error(`unexpected POST ${url}`);
  });
  // WhatsAppService.sendMessage posts with fetch, not axios.
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (!/graph\.facebook\.com\/.*\/messages$/.test(String(url))) throw new Error(`unexpected fetch ${url}`);
    const body = JSON.parse((init && init.body) || 'null');
    if (body && body.type === 'text') sent.push({ to: body.to, text: body.text.body });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.out' }] }) };
  });
  axios.delete.mockReset();
  axios.delete.mockResolvedValue({ status: 200, data: {} });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe('general voice note (handler: audio.ogg → R2, audio.wav → Soniox; AudioService.convertToWav)', () => {
  it('two teachers in one millisecond are each transcribed and answered from their own voice note', async () => {
    await Promise.all([
      handleVoiceMessage(note('media-a'), TEACHER_A.phone, TEACHER_A.user),
      handleVoiceMessage(note('media-b'), TEACHER_B.phone, TEACHER_B.user),
    ]);

    // Each transcription request carried one teacher's own audio, once each.
    expect(soniox.uploads.map(sha12).sort()).toEqual([sha12(wavOf('media-a')), sha12(wavOf('media-b'))].sort());
    // …and each teacher was answered about their own question.
    expect(textsTo(TEACHER_A.phone)).toContain('Answer about fractions');
    expect(textsTo(TEACHER_A.phone)).not.toContain('Answer about photosynthesis');
    expect(textsTo(TEACHER_B.phone)).toContain('Answer about photosynthesis');
    expect(textsTo(TEACHER_B.phone)).not.toContain('Answer about fractions');
    // The R2 copy of each note is that teacher's own audio.
    const r2For = (phone) => mockR2Puts.filter((p) => p.key.startsWith(`audio/${phone}/`)).map((p) => sha12(p.body));
    expect(r2For(TEACHER_A.phone)).toEqual([sha12(AUDIO['media-a'])]);
    expect(r2For(TEACHER_B.phone)).toEqual([sha12(AUDIO['media-b'])]);
    expect(leftovers()).toEqual([]);
  });

  it('when transcription fails, no audio is left behind on disk', async () => {
    sonioxDown = true;

    await handleVoiceMessage(note('media-a'), TEACHER_A.phone, TEACHER_A.user);

    expect(leftovers()).toEqual([]);
  });
});

describe('reflective answer to a coaching question (handler: coaching audio.ogg)', () => {
  beforeEach(() => {
    mockDb = (q) => (q.table === 'coaching_sessions' && q.filters.status === 'conducting_conversation'
      ? { data: { id: `cs-${q.filters.user_id}`, user_id: q.filters.user_id, status: 'conducting_conversation', conversation_state: {} }, error: null }
      : { data: null, error: null });
  });

  it("two teachers' reflective answers in one millisecond each reach their own coaching session", async () => {
    await Promise.all([
      handleVoiceMessage(note('media-a'), TEACHER_A.phone, TEACHER_A.user),
      handleVoiceMessage(note('media-b'), TEACHER_B.phone, TEACHER_B.user),
    ]);

    expect(soniox.uploads.map(sha12).sort()).toEqual([sha12(AUDIO['media-a']), sha12(AUDIO['media-b'])].sort());
    const answers = Object.fromEntries(CoachingService.handleReflectiveResponse.mock.calls.map((c) => [c[0], c]));
    expect(answers[`cs-${TEACHER_A.user.id}`]).toEqual([`cs-${TEACHER_A.user.id}`, TEACHER_A.phone, 'Please help me teach fractions', 'voice', 'en']);
    expect(answers[`cs-${TEACHER_B.user.id}`]).toEqual([`cs-${TEACHER_B.user.id}`, TEACHER_B.phone, 'Please help me teach photosynthesis', 'voice', 'en']);
    expect(leftovers()).toEqual([]);
  });

  it('when transcription fails, no audio is left behind on disk', async () => {
    sonioxDown = true;

    await handleVoiceMessage(note('media-a'), TEACHER_A.phone, TEACHER_A.user);

    expect(leftovers()).toEqual([]);
  });
});

describe('comprehension answer (handler: comprehension.ogg)', () => {
  beforeEach(() => {
    const question = (id) => ({ id, type: 'literal', question: `Question ${id}?`, expected_answer: 'x', acceptable_variations: [] });
    RedisComprehensionService.findActiveFlowByUser.mockImplementation(async (userId) => ({
      assessment_id: `ra-${userId}`, current_question_index: 0, questions: [question('q1'), question('q2')], answers: [],
    }));
    RedisComprehensionService.recordAnswer.mockImplementation(async (_id, evaluation) => ({ current_question_index: 1, answers: [evaluation] }));
    mockDb = (q) => (q.table === 'reading_assessments' && q.filters.id ? { data: { language: 'en' }, error: null } : { data: null, error: null });
  });

  it("two teachers' children's answers in one millisecond are each scored from their own voice note", async () => {
    await Promise.all([
      handleVoiceMessage(note('media-a'), TEACHER_A.phone, TEACHER_A.user),
      handleVoiceMessage(note('media-b'), TEACHER_B.phone, TEACHER_B.user),
    ]);

    expect(soniox.uploads.map(sha12).sort()).toEqual([sha12(AUDIO['media-a']), sha12(AUDIO['media-b'])].sort());
    const recorded = Object.fromEntries(RedisComprehensionService.recordAnswer.mock.calls.map(([id, ev]) => [id, ev.studentAnswer]));
    expect(recorded).toEqual({
      [`ra-${TEACHER_A.user.id}`]: 'Please help me teach fractions',
      [`ra-${TEACHER_B.user.id}`]: 'Please help me teach photosynthesis',
    });
    expect(leftovers()).toEqual([]);
  });

  it('when transcription fails, no audio is left behind on disk', async () => {
    sonioxDown = true;

    await handleVoiceMessage(note('media-a'), TEACHER_A.phone, TEACHER_A.user);

    expect(leftovers()).toEqual([]);
  });
});

describe('voice attendance roll call (handler: attendance.wav)', () => {
  beforeEach(() => {
    VoiceAttendance.armed.mockResolvedValue({ subject: 'teacher', targetId: 'school-1' });
  });

  it('two voice notes from one principal in one millisecond are each heard from their own audio', async () => {
    // Same user id, so the old name (attendance_<userId>_<ms>.wav) is shared too.
    await Promise.all([
      handleVoiceMessage(note('media-a'), TEACHER_A.phone, TEACHER_A.user),
      handleVoiceMessage(note('media-b'), TEACHER_A.phone, TEACHER_A.user),
    ]);

    expect(soniox.uploads.map(sha12).sort()).toEqual([sha12(wavOf('media-a')), sha12(wavOf('media-b'))].sort());
    expect(VoiceAttendance.stashResult.mock.calls.map(([, r]) => r.transcript).sort())
      .toEqual(['Please help me teach fractions', 'Please help me teach photosynthesis']);
    expect(leftovers()).toEqual([]);
  });
});

describe('reading assessment recording (handler: reading.ogg → R2)', () => {
  beforeEach(() => {
    mockDb = (q) => (q.table === 'reading_assessments' && q.filters.status === 'passage_generated'
      ? { data: {
        id: `ra-${q.filters.user_id}`, user_id: q.filters.user_id, status: 'passage_generated', audio_url: null,
        student_identifier: 'Student 1', language: 'en', grade_level: 3, created_at: new Date(PINNED).toISOString(),
      }, error: null }
      : { data: null, error: null });
  });

  it("two teachers' recordings in one millisecond are each stored as their own audio", async () => {
    await Promise.all([
      handleVoiceMessage(note('media-a'), TEACHER_A.phone, TEACHER_A.user),
      handleVoiceMessage(note('media-b'), TEACHER_B.phone, TEACHER_B.user),
    ]);

    const r2For = (userId) => mockR2Puts.filter((p) => p.key.startsWith(`audio/${userId}/`)).map((p) => sha12(p.body));
    expect(r2For(TEACHER_A.user.id)).toEqual([sha12(AUDIO['media-a'])]);
    expect(r2For(TEACHER_B.user.id)).toEqual([sha12(AUDIO['media-b'])]);
    expect(leftovers()).toEqual([]);
  });

  it('when the R2 upload fails, no audio is left behind on disk', async () => {
    mockR2.fail = true;

    await handleVoiceMessage(note('media-a'), TEACHER_A.phone, TEACHER_A.user);

    expect(leftovers()).toEqual([]);
  });
});
