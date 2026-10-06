'use strict';
/**
 * A video-bank quiz ("Watch another video") has no quizzes.language — every one of the bank's
 * quizzes on sandbox has it NULL — and the publish step chose the voice by that language, so its
 * clips were recorded as language "xx", voice "default": a second voice beside the shared lines.
 * The language now comes from the questions' own script when the row has none, a clip is never
 * recorded in no quiz voice, and a quiz already stamped audio_voice "default" is recorded again.
 *
 * Boundaries faked: supabase (an in-memory client), R2, the voice gateway, the loggers.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: false })),
  uploadBuffer: jest.fn(async () => true),
  presignKey: jest.fn(async (k) => `r2:${k}?X-Amz-Signature=x`),
  getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=x`),
  buildR2PublicUrl: jest.fn((k) => `r2:${k}`),
}));
jest.mock('../../../shared/services/tts', () => ({
  synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS-fake'), provider: 'soniox', durationSec: 1 })),
}));

const Publish = require('../../../shared/services/quiz/web-quiz-publish.service');
const tts = require('../../../shared/services/tts');

function fakeDb(quiz, questions) {
  const updates = [];
  const chain = (table) => {
    const c = {
      select() { return c; }, eq() { return c; }, order() { return Promise.resolve({ data: questions, error: null }); },
      maybeSingle() { return Promise.resolve({ data: table === 'app_settings' ? null : quiz, error: null }); },
      head: true,
      update(v) { updates.push({ table, v }); return { eq: () => Promise.resolve({ error: null }) }; },
    };
    c.then = (res) => res({ count: 0, data: [], error: null });
    return c;
  };
  return { from: chain, updates };
}
const row = (id, text, a, b) => ({ id, question_text: text, option_a: a, option_b: b, correct_option: 'A', explanation: '', option_feedback: {}, media: {}, sort_order: 1 });

afterEach(() => jest.clearAllMocks());

describe('a bank quiz with no language is spoken in the quiz voice of its own script', () => {
  test('Urdu questions → Soniox Ishita, keys tagged sx-ishita, never "default"', async () => {
    const db = fakeDb({ id: 'bank-ur', language: null, meta: {} }, [row('q1', 'مرغی انڈے سے کیسے نکلتی ہے؟', 'چوزہ', 'بلی')]);
    const out = await Publish.publishQuizAudio('bank-ur', { db });
    expect(out.ok).toBe(true);
    const calls = tts.synthesize.mock.calls.map((c) => c[0]);
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach((c) => expect(c).toMatchObject({ provider: 'soniox', voice: 'Ishita' }));
    const web = db.updates[0].v.meta.web;
    expect(web.audio_voice).toBe('sx-ishita');
    expect(JSON.stringify(web.audio)).not.toMatch(/default|\/xx\//);
  });
  test('English questions → Soniox Grace', async () => {
    const db = fakeDb({ id: 'bank-en', language: null, meta: {} }, [row('q1', 'What hatches from an egg?', 'A chick', 'A cat')]);
    await Publish.publishQuizAudio('bank-en', { db });
    tts.synthesize.mock.calls.forEach((c) => expect(c[0]).toMatchObject({ provider: 'soniox', voice: 'Grace' }));
    expect(db.updates[0].v.meta.web.audio_voice).toBe('sx-grace');
  });
});

describe('a quiz recorded as voice "default" is not current', () => {
  test('ensureQuizAudio records it again', async () => {
    const publish = jest.fn(async () => ({ ok: true }));
    const out = await Publish.ensureQuizAudio('stale-1', { meta: { web: { audio_v: Publish.AUDIO_VERSION, audio_voice: 'default' } }, publish });
    expect(publish).toHaveBeenCalled();
    expect(out.ok).toBe(true);
  });
  test('a quiz current in a real voice is left alone', async () => {
    const publish = jest.fn(async () => ({ ok: true }));
    const out = await Publish.ensureQuizAudio('fine-1', { meta: { web: { audio_v: Publish.AUDIO_VERSION, audio_voice: 'sx-grace' } }, publish });
    expect(publish).not.toHaveBeenCalled();
    expect(out.skipped).toBe('current');
  });
});
