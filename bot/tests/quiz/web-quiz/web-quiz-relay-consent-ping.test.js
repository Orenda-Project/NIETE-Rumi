'use strict';
/**
 * The page relay (web-quiz.service.js cleanEvent, events v2 on): two lines.
 *   - any name starting sample_ping_ is server-written: a page-posted one is dropped, as a page class_round_* is;
 *   - ch_audio_consent's v is name-scoped to the consent values plus notice_shown; any other value is stripped.
 * Faked boundaries only: Supabase, R2, speech, the LLM client, Redis, WhatsApp, the logger transport.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key) => `https://r2.test/put/${key}?X-Amz-Signature=x`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' })),
  downloadFromR2: jest.fn(),
  getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=x`),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key) => `https://signed.test/${key}`),
  deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true),
  listKeys: jest.fn(async () => []),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true), sendCtaUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const Svc = require('../../../shared/services/quiz/web-quiz.service');

describe('sample_ping_* is server-only', () => {
  test('a page-posted sample_ping_* never passes the relay with v2 on, the way a page class_round_* does', () => {
    for (const n of ['sample_ping_sent', 'sample_ping_opened', 'class_round_started']) {
      expect(Svc.cleanEvent({ n, w: 's' }, { v2: true })).toBeNull();
    }
    expect(Svc.cleanEvent({ n: 'sample_window', w: 's' }, { v2: true })).toBeNull();
    expect(Svc.cleanEvent({ n: 'sample_pingx' }, { v2: true }).props.w).toBe('p');
    // v2 off: the relay is as today
    expect(Svc.cleanEvent({ n: 'sample_ping_sent' })).not.toBeNull();
  });
});

describe('ch_audio_consent v', () => {
  const v = (val, v2 = true) => (Svc.cleanEvent({ n: 'ch_audio_consent', v: val }, { v2 }) || {}).props.v;
  test('admits notice_shown beside the consent values; anything else is stripped', () => {
    for (const ok of ['kept_ok', 'kept_no', 'not_asked', 'notice_shown']) expect(v(ok)).toBe(ok);
    for (const bad of ['notice_hidden', 'a1', 'Sana', 0, 1]) expect(v(bad)).toBeUndefined();
  });
  test('other names keep their own v rule', () => {
    expect(Svc.cleanEvent({ n: 'invite_ask', v: 'notice_shown' }, { v2: true }).props.v).toBeUndefined();
    expect(Svc.cleanEvent({ n: 'invite_ask', v: 'a1' }, { v2: true }).props.v).toBe('a1');
  });
});
