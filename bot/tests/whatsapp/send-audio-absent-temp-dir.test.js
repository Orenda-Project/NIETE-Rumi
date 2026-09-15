/**
 * A reflective question that never arrives, logged as sent.
 *
 * Staging, 15 Sep 2026, session 039555f2: the worker generated the reflective
 * question, ElevenLabs returned the voice, and then
 *   ❌ Error sending audio message  ENOENT … open '/app/bot/temp/audio_1789507844270.ogg'
 *   ✅ Reflective question sent
 * The teacher saw "Step 3/5" and nothing else.
 *
 * Two defects, each executed here with only the network mocked:
 *  1. sendAudio is the one sender in whatsapp.service that writes into its temp
 *     directory without creating it first, so on a worker where that directory
 *     does not exist the write throws and the voice note is never uploaded.
 *  2. The reflective question is delivered ONLY as a voice note and the caller
 *     ignores sendAudio's result, so a failed send leaves the teacher with no
 *     question at all while the log says it went out.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const fs = require('fs');
const os = require('os');
const path = require('path');

const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64, 1)]);

describe('sendAudio into a temp directory that does not exist yet', () => {
  let dir;

  beforeEach(() => {
    jest.resetModules();
    dir = path.join(os.tmpdir(), `absent-audio-dir-${process.pid}-${Date.now()}`);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('creates the directory, uploads, sends, and reports success', async () => {
    jest.doMock('axios', () => ({
      post: jest.fn(async (url) => (url.endsWith('/media')
        ? { data: { id: 'media-1' } }
        : { data: { messages: [{ id: 'wamid-1' }] } })),
      get: jest.fn(),
    }));
    jest.doMock('../../shared/utils/logger', () => ({
      ...jest.requireActual('../../shared/utils/logger'),
      logToFile: jest.fn(),
    }));
    const WhatsAppService = require('../../shared/services/whatsapp.service');
    const axios = require('axios');

    expect(fs.existsSync(dir)).toBe(false);
    const ok = await WhatsAppService.sendAudio('923001234567', OGG, dir);

    expect(ok).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[1][1]).toMatchObject({ type: 'audio', audio: { id: 'media-1' } });
  });
});

describe('the reflective question when its voice note cannot be sent', () => {
  const SESSION = 'sess-refl-1';
  const FROM = '923001234567';
  let sent;
  let logs;

  function load({ audioOk }) {
    jest.resetModules();
    sent = { text: [], audio: 0 };
    logs = [];
    const row = {
      analysis_data: {},           // no corpus → the curated fallback question, no LLM call
      conversation_state: { questions: [] },
      transcript_text: 'x',
      user_id: 'teacher-1',
    };
    const builder = {
      select: () => builder,
      eq: () => builder,
      single: async () => ({ data: row, error: null }),
    };
    jest.doMock('../../shared/config/supabase', () => ({ from: () => builder }));
    jest.doMock('../../shared/utils/logger', () => ({
      ...jest.requireActual('../../shared/utils/logger'),
      logToFile: jest.fn((msg, data, level) => logs.push({ msg, data, level })),
    }));
    jest.doMock('../../shared/utils/language-cache', () => ({ getUserLanguage: jest.fn(async () => 'en') }));
    jest.doMock('../../shared/services/gpt5-mini.service', () => ({}));
    jest.doMock('../../shared/services/coaching/reflective-acknowledgement', () => ({ generateAcknowledgement: jest.fn() }));
    jest.doMock('../../shared/services/elevenlabs.service', () => ({
      generateSpeechForLanguage: jest.fn(async () => OGG),
    }));
    jest.doMock('../../shared/services/coaching/coaching-session.service', () => ({
      updateConversationState: jest.fn(async () => true),
      updateStatus: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendAudio: jest.fn(async () => { sent.audio += 1; return audioOk; }),
      sendMessage: jest.fn(async (to, text) => { sent.text.push({ to, text }); return true; }),
    }));
    return require('../../shared/services/coaching/reflective-conversation.service');
  }

  test('a failed voice send delivers the question as text instead', async () => {
    const Service = load({ audioOk: false });
    await Service.conductReflectiveConversation(SESSION, FROM, 1);

    expect(sent.audio).toBe(1);
    expect(sent.text).toHaveLength(1);
    expect(sent.text[0].to).toBe(FROM);
    const { buildSafeFallback } = require('../../shared/services/coaching/reflective-questions/guardrails');
    const { resolveProfile } = require('../../shared/services/coaching/reflective-questions/language-profiles');
    expect(sent.text[0].text).toBe(buildSafeFallback(1, {}, resolveProfile('en')));
  });

  test('the failed voice send is logged as an error, not only as "sent"', async () => {
    const Service = load({ audioOk: false });
    await Service.conductReflectiveConversation(SESSION, FROM, 1);

    const failure = logs.find((l) => l.level === 'error' && /voice/i.test(l.msg));
    expect(failure).toBeDefined();
    expect(failure.data).toMatchObject({ coachingSessionId: SESSION, questionNumber: 1 });
  });

  test('a successful voice send does not also send the text', async () => {
    const Service = load({ audioOk: true });
    await Service.conductReflectiveConversation(SESSION, FROM, 1);

    expect(sent.audio).toBe(1);
    expect(sent.text).toHaveLength(0);
  });
});

describe('the reflection closer when its voice note cannot be sent', () => {
  const SESSION = 'sess-refl-2';
  const FROM = '923001234567';
  let sent;
  let logs;

  function load({ audioOk }) {
    jest.resetModules();
    sent = { text: [], audio: 0 };
    logs = [];
    // One question, already answered → this response completes the reflection.
    const row = {
      user_id: 'teacher-1',
      conversation_state: {
        current_state: 'REFLECTIVE_QUESTION_1',
        conversation_language: 'en',
        questions: [{ question_number: 1, question: 'What changed?', answer: null }],
      },
    };
    const builder = {
      select: () => builder,
      eq: () => builder,
      single: async () => ({ data: row, error: null }),
    };
    jest.doMock('../../shared/config/supabase', () => ({ from: () => builder }));
    jest.doMock('../../shared/utils/logger', () => ({
      ...jest.requireActual('../../shared/utils/logger'),
      logToFile: jest.fn((msg, data, level) => logs.push({ msg, data, level })),
    }));
    jest.doMock('../../shared/utils/language-cache', () => ({ getUserLanguage: jest.fn(async () => 'en') }));
    jest.doMock('../../shared/config/coaching-debrief.config', () => ({ NUM_REFLECTIVE_QUESTIONS: 1 }));
    jest.doMock('../../shared/services/gpt5-mini.service', () => ({ openai: { chat: { completions: { create: jest.fn() } } } }));
    jest.doMock('../../shared/services/coaching/reflective-acknowledgement', () => ({
      generateAcknowledgement: jest.fn(async () => 'Thank you for reflecting with me.'),
    }));
    jest.doMock('../../shared/services/elevenlabs.service', () => ({
      generateSpeechForLanguage: jest.fn(async () => OGG),
    }));
    jest.doMock('../../shared/services/coaching/coaching-session.service', () => ({
      updateConversationState: jest.fn(async () => true),
      updateStatus: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/services/coaching/coaching-job-queue.service', () => ({
      queueReport: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendAudio: jest.fn(async () => { sent.audio += 1; return audioOk; }),
      sendMessage: jest.fn(async (to, text) => { sent.text.push({ to, text }); return true; }),
    }));
    return require('../../shared/services/coaching/reflective-conversation.service');
  }

  test('a failed voice send delivers the closing line as text', async () => {
    const Service = load({ audioOk: false });
    await Service.handleReflectiveResponse(SESSION, FROM, 'I paused more', 'text', 'en');

    expect(sent.audio).toBe(1);
    expect(sent.text).toEqual([{ to: FROM, text: 'Thank you for reflecting with me.' }]);
    expect(logs.some((l) => l.level === 'error' && /closer/i.test(l.msg))).toBe(true);
  });

  test('a successful voice send sends no duplicate text', async () => {
    const Service = load({ audioOk: true });
    await Service.handleReflectiveResponse(SESSION, FROM, 'I paused more', 'text', 'en');

    expect(sent.audio).toBe(1);
    expect(sent.text).toHaveLength(0);
  });
});
