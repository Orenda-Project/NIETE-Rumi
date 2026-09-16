/**
 * The guidance reaches the teacher through the REAL voice handler, and the chat
 * answer still goes out.
 *
 * Nothing here refuses anything: every tier still gets its chat reply. What
 * changes is that a recording which looks like an attempted lesson is told, in
 * her own language, what length a full analysis needs — instead of the assistant
 * inventing a number.
 *
 * Drives `handleVoiceMessage` with the network boundary mocked: media download,
 * transcription, the LLM and the speech synthesiser. The branch under test is
 * the sub-threshold fall-through, so it executes for real.
 */

jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

// ── the network boundary ──────────────────────────────────────────────────────
const mockSendMessage = jest.fn(() => Promise.resolve());
const mockSendAudio = jest.fn(() => Promise.resolve());
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
  getMediaInfo: jest.fn(() => Promise.resolve(global.__SR_MEDIA)),
  downloadMedia: jest.fn(() => Promise.resolve(Buffer.from('audio-bytes'))),
  sendMessage: (...a) => mockSendMessage(...a),
  sendAudio: (...a) => mockSendAudio(...a),
  sendSticker: jest.fn(() => Promise.resolve()),
}));

const mockGetResponse = jest.fn(() => Promise.resolve('یہ آپ کے سوال کا جواب ہے۔'));
jest.mock('../../bot/shared/services/openai.service', () => ({
  detectIntent: jest.fn(() => Promise.resolve({ type: 'general' })),
  getResponseWithFormat: (...a) => mockGetResponse(...a),
}));

jest.mock('../../bot/shared/services/audio.service', () => ({
  getAudioDuration: jest.fn(() => Promise.resolve(global.__SR_PROBED_SECONDS)),
  convertToWav: jest.fn(() => Promise.resolve()),
  transcribeWithLanguagePreference: jest.fn(() => Promise.resolve({
    text: global.__SR_TRANSCRIPT, language: 'ur', engine: 'soniox',
  })),
  transcribeAudio: jest.fn(() => Promise.resolve(global.__SR_TRANSCRIPT)),
  generateSpeechForLanguage: jest.fn(() => Promise.resolve(Buffer.from('mp3'))),
  getASREngine: jest.fn(() => 'soniox'),
}));

// ── everything else the handler touches, stubbed so the branch can run ───────
jest.mock('fs', () => ({
  writeFileSync: jest.fn(), unlinkSync: jest.fn(), existsSync: jest.fn(() => false),
  readFileSync: jest.requireActual('fs').readFileSync,
  readdirSync: jest.requireActual('fs').readdirSync,
  statSync: jest.requireActual('fs').statSync,
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadAudio: jest.fn(() => Promise.resolve('https://r2.example/a.ogg')),
}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(), getOrCreateSession: jest.fn(() => Promise.resolve('sess-1')),
  updateSessionType: jest.fn(), storeConversation: jest.fn(),
  storeAudioSession: jest.fn(), storeLessonPlan: jest.fn(),
}));
jest.mock('../../bot/shared/services/observe/observe-audio-router', () => {
  const actual = jest.requireActual('../../bot/shared/services/observe/observe-audio-router');
  return { ...actual, routeLeaderAudio: jest.fn(() => Promise.resolve(false)) };
});
jest.mock('../../bot/shared/services/feature-registration.service', () => ({
  isPendingName: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({
  getState: jest.fn(() => Promise.resolve(null)), clearState: jest.fn(),
}));
jest.mock('../../bot/shared/services/language-detector.service', () => ({
  getConfirmedLanguage: jest.fn(() => Promise.resolve('ur')),
}));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(() => Promise.resolve('ur')),
  setUserLanguage: jest.fn(),
  DEFAULT_LANGUAGE: 'en',
}));
jest.mock('../../bot/shared/services/lp-context.service', () => ({
  injectLpContext: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({
  handleReflectiveResponse: jest.fn(), initiateCoachingSession: jest.fn(),
}));
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'or', 'order', 'limit', 'update', 'insert', 'single']) {
    chain[m] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  chain.then = (resolve) => resolve({ data: null, error: null });
  return { from: jest.fn(() => chain) };
});

const { handleVoiceMessage } = require('../../bot/shared/handlers/voice-message.handler');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { CLASSROOM_AUDIO_THRESHOLD } = require('../../bot/shared/config/classroom-audio.config');

const FROM = '923001234567';
const TEACHER = { id: 'u1', role: 'teacher', preferred_language: 'ur' };
const COACH = { id: 'u3', role: 'coach', preferred_language: 'ur' };
const declared = (user) => ({
  ...user,
  conversation_state: { flow: 'coaching', step: 'AWAITING_CLASSROOM_AUDIO' },
  conversation_state_expires_at: new Date(Date.now() + 3600_000).toISOString(),
});

const voiceNote = () => ({ id: 'wamid.1', audio: { id: 'media-1', mime_type: 'audio/ogg' } });

/** Every message body the handler sent, in order. */
const sentBodies = () => mockSendMessage.mock.calls.map((c) => c[1]);
const guidanceSent = () => sentBodies().filter((b) => /تجزیے|تجزیہ|analysis/i.test(String(b)));

beforeEach(() => {
  jest.clearAllMocks();
  global.__SR_MEDIA = { mime_type: 'audio/ogg', file_size: 30_000 };
  global.__SR_PROBED_SECONDS = 0;
  global.__SR_TRANSCRIPT = 'میڈم ایک سوال ہے۔';
});

describe('tier 1 — she tapped Classroom Coaching, then sent something short', () => {
  test('she is told the length rule, and still gets her chat answer', async () => {
    await handleVoiceMessage(voiceNote(), FROM, declared(TEACHER));

    expect(sentBodies()).toContain(
      resolveUx('coachingRecordingTooShortUnknownLength', {
        language: 'ur', params: { min: CLASSROOM_AUDIO_THRESHOLD / 60 },
      }),
    );
    expect(mockGetResponse).toHaveBeenCalledTimes(1);
    expect(mockSendAudio).toHaveBeenCalled();
  });

  test('with a probed length the message quotes it', async () => {
    global.__SR_MEDIA = { mime_type: 'audio/ogg', file_size: 900_000 };
    global.__SR_PROBED_SECONDS = 300;

    await handleVoiceMessage(voiceNote(), FROM, declared(TEACHER));

    expect(sentBodies()).toContain(
      resolveUx('coachingRecordingTooShort', {
        language: 'ur', params: { minutes: 5, min: CLASSROOM_AUDIO_THRESHOLD / 60 },
      }),
    );
  });
});

describe('tier 2 — it sounds like a lesson', () => {
  test('a probed 700-second recording gets the softer wording', async () => {
    global.__SR_MEDIA = { mime_type: 'audio/ogg', file_size: 900_000 };
    global.__SR_PROBED_SECONDS = 700;

    await handleVoiceMessage(voiceNote(), FROM, TEACHER);

    expect(sentBodies()).toContain(
      resolveUx('coachingRecordingLooksShort', {
        language: 'ur', params: { minutes: 12, min: CLASSROOM_AUDIO_THRESHOLD / 60 },
      }),
    );
    expect(mockGetResponse).toHaveBeenCalledTimes(1);
  });

  test('a small file with a long transcript still gets it — no probe ever ran', async () => {
    global.__SR_MEDIA = { mime_type: 'audio/ogg', file_size: 80_000 };
    global.__SR_TRANSCRIPT = 'السلام علیکم بچو۔ '.repeat(300);

    await handleVoiceMessage(voiceNote(), FROM, TEACHER);

    expect(guidanceSent()).toHaveLength(1);
    expect(sentBodies()).toContain(
      resolveUx('coachingRecordingLooksShortUnknownLength', {
        language: 'ur', params: { min: CLASSROOM_AUDIO_THRESHOLD / 60 },
      }),
    );
  });
});

describe('tier 3 — a teacher asking a question is left alone', () => {
  test('a 20-second voice question gets the chat answer and nothing else', async () => {
    await handleVoiceMessage(voiceNote(), FROM, TEACHER);

    expect(guidanceSent()).toHaveLength(0);
    expect(mockGetResponse).toHaveBeenCalledTimes(1);
    expect(mockSendAudio).toHaveBeenCalled();
  });

  test('a 600-character aside gets nothing either', async () => {
    global.__SR_TRANSCRIPT = 'ا'.repeat(600);

    await handleVoiceMessage(voiceNote(), FROM, TEACHER);

    expect(guidanceSent()).toHaveLength(0);
  });
});

describe("a coach's own debrief recording", () => {
  test('is never told it needs the classroom minimum', async () => {
    global.__SR_MEDIA = { mime_type: 'audio/ogg', file_size: 900_000 };
    global.__SR_PROBED_SECONDS = 700;
    global.__SR_TRANSCRIPT = 'Thank you so much for letting me observe your class. '.repeat(40);

    await handleVoiceMessage(voiceNote(), FROM, COACH);

    expect(guidanceSent()).toHaveLength(0);
    expect(mockGetResponse).toHaveBeenCalledTimes(1);
  });
});

describe('the guidance is sent once, before the answer', () => {
  test('exactly one guidance message per recording', async () => {
    global.__SR_MEDIA = { mime_type: 'audio/ogg', file_size: 900_000 };
    global.__SR_PROBED_SECONDS = 700;

    await handleVoiceMessage(voiceNote(), FROM, TEACHER);

    expect(guidanceSent()).toHaveLength(1);
  });

  test('and it goes out before the assistant is asked anything', async () => {
    global.__SR_MEDIA = { mime_type: 'audio/ogg', file_size: 900_000 };
    global.__SR_PROBED_SECONDS = 700;
    const order = [];
    mockSendMessage.mockImplementation(() => { order.push('guidance'); return Promise.resolve(); });
    mockGetResponse.mockImplementation(() => { order.push('llm'); return Promise.resolve('جواب'); });

    await handleVoiceMessage(voiceNote(), FROM, TEACHER);

    expect(order).toEqual(['guidance', 'llm']);
  });
});

describe('the audio-DOCUMENT path is covered by the same emit', () => {
  test('the synthetic message the document branch builds gets the guidance too', async () => {
    // A phone recorder app delivers a lesson as a FILE, so the document branch
    // is a normal way a recording arrives. It builds this exact object and
    // re-enters handleVoiceMessage, which is why one emit covers both entries.
    global.__SR_MEDIA = { mime_type: 'audio/aac', file_size: 900_000 };
    global.__SR_PROBED_SECONDS = 700;
    const synthetic = { audio: { id: 'media-doc-1' }, from: FROM, type: 'audio' };

    await handleVoiceMessage(synthetic, FROM, TEACHER);

    expect(guidanceSent()).toHaveLength(1);
  });
});

describe('the leader audio router still wins', () => {
  test('when observe handles the audio, nothing downstream runs at all', async () => {
    const router = require('../../bot/shared/services/observe/observe-audio-router');
    router.routeLeaderAudio.mockResolvedValueOnce(true);
    global.__SR_MEDIA = { mime_type: 'audio/ogg', file_size: 900_000 };
    global.__SR_PROBED_SECONDS = 700;

    await handleVoiceMessage(voiceNote(), FROM, TEACHER);

    expect(guidanceSent()).toHaveLength(0);
    expect(mockGetResponse).not.toHaveBeenCalled();
  });
});
