'use strict';
/**
 * bd-07cjd — the head-of-school broadcast template carries two QUICK_REPLY
 * buttons, "Lesson Plans video" and "Teacher Training video". A tap must reply
 * with that video. Without its own branch the tap falls through to the text
 * path, where "Lesson Plans video" reads as a lesson-plan request.
 *
 * The webhook cases drive the real /webhook route; only the network boundary
 * is stubbed (WhatsApp, Supabase, redis, the queue).
 */
const http = require('http');
const { makeDb } = require('../quiz/helpers/memory-db');

const HEAD_PHONE = '923330000009';
const LP_URL = 'https://assets.example/hos-lp.mp4';
const TRAINING_URL = 'https://assets.example/hos-training.mp4';
const HEAD = { id: 'head-1', role: 'principal', phone_number: HEAD_PHONE, preferred_language: 'en' };
const later = (ms) => new Promise((r) => setTimeout(r, ms));

describe('matchHosVideoButton', () => {
  const { matchHosVideoButton } = require('../../bot/shared/handlers/hos-broadcast-video');

  test('matches each button by its text, as Meta delivers it', () => {
    expect(matchHosVideoButton({ buttonText: 'Lesson Plans video' })).toBe('lp');
    expect(matchHosVideoButton({ buttonText: 'Teacher Training video' })).toBe('training');
  });

  test('matches an explicit payload when the text is missing', () => {
    expect(matchHosVideoButton({ buttonPayload: 'hos_video_lp' })).toBe('lp');
    expect(matchHosVideoButton({ buttonPayload: 'hos_video_training' })).toBe('training');
  });

  test('ignores case and surrounding whitespace', () => {
    expect(matchHosVideoButton({ buttonText: '  lesson plans VIDEO ' })).toBe('lp');
  });

  test('does not claim other template buttons', () => {
    // The K-5 LP broadcast button must keep reaching the LP intent matcher.
    expect(matchHosVideoButton({ buttonText: 'Lesson Plans & Assessment' })).toBeNull();
    expect(matchHosVideoButton({ buttonText: 'Select Video' })).toBeNull();
    expect(matchHosVideoButton({ buttonText: 'Lesson Plans' })).toBeNull();
    expect(matchHosVideoButton({})).toBeNull();
    expect(matchHosVideoButton()).toBeNull();
  });
});

describe('sendHosVideo', () => {
  const { sendHosVideo } = require('../../bot/shared/handlers/hos-broadcast-video');
  const env = { HOS_VIDEO_LP_URL: LP_URL, HOS_VIDEO_TRAINING_URL: TRAINING_URL };
  let deps;
  beforeEach(() => {
    deps = {
      sendVideoByLink: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue(true),
      env,
      log: jest.fn(),
    };
  });

  test('sends the video configured for the tapped button', async () => {
    await expect(sendHosVideo('training', HEAD_PHONE, deps)).resolves.toBe(true);
    expect(deps.sendVideoByLink).toHaveBeenCalledWith(HEAD_PHONE, TRAINING_URL);
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith('hos.video.sent', expect.objectContaining({ kind: 'training' }));
  });

  test('an unset URL sends an apology, not a broken video', async () => {
    deps.env = { HOS_VIDEO_TRAINING_URL: TRAINING_URL };
    await expect(sendHosVideo('lp', HEAD_PHONE, deps)).resolves.toBe(false);
    expect(deps.sendVideoByLink).not.toHaveBeenCalled();
    expect(deps.sendMessage).toHaveBeenCalledWith(HEAD_PHONE, expect.stringMatching(/try again/i));
    expect(deps.log).toHaveBeenCalledWith('hos.video.unconfigured', expect.objectContaining({ kind: 'lp' }));
  });

  test('signs the stored link at tap time, so a private-bucket video never expires', async () => {
    deps.resolveUrl = jest.fn(async (u) => `${u}?X-Amz-Signature=fresh`);
    await sendHosVideo('lp', HEAD_PHONE, deps);
    expect(deps.resolveUrl).toHaveBeenCalledWith(LP_URL);
    expect(deps.sendVideoByLink).toHaveBeenCalledWith(HEAD_PHONE, `${LP_URL}?X-Amz-Signature=fresh`);
  });

  test('a link that cannot be signed apologises instead of throwing', async () => {
    deps.resolveUrl = jest.fn().mockRejectedValue(new Error('r2 down'));
    await expect(sendHosVideo('lp', HEAD_PHONE, deps)).resolves.toBe(false);
    expect(deps.sendVideoByLink).not.toHaveBeenCalled();
    expect(deps.sendMessage).toHaveBeenCalledWith(HEAD_PHONE, expect.stringMatching(/try again/i));
    expect(deps.log).toHaveBeenCalledWith('hos.video.failed', expect.objectContaining({ kind: 'lp' }));
  });

  test('a failed send also apologises, so the tap never goes silent', async () => {
    deps.sendVideoByLink.mockResolvedValue(false);
    await expect(sendHosVideo('lp', HEAD_PHONE, deps)).resolves.toBe(false);
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith('hos.video.failed', expect.objectContaining({ kind: 'lp' }));
  });
});

describe('a template tap through the real /webhook', () => {
  let mockDb;
  let mockWa;
  const saved = {};

  function body(message) {
    return {
      entry: [{
        id: 'waba',
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'pnid' },
            messages: [{ from: HEAD_PHONE, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
          },
        }],
      }],
    };
  }

  function mockBoundaries() {
    jest.doMock('../../bot/shared/utils/validators', () => ({
      validateWebhookStatus: () => null,
      validateWebhookMessage: (req) => {
        const value = req.body.entry[0].changes[0].value;
        const message = value.messages[0];
        return {
          entry: req.body.entry[0], message, from: message.from, messageBody: '',
          messageType: message.type, messageTimestamp: message.timestamp,
          phoneNumberId: value.metadata.phone_number_id,
        };
      },
      isOurPhoneNumber: () => true,
      isTestWebhook: () => false,
      isTestPhoneNumber: () => false,
      isWithin24Hours: () => true,
    }));
    const store = new Map();
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
      set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
      setexWithCeiling: jest.fn(async (k, _t, v) => { store.set(k, typeof v === 'string' ? JSON.parse(v) : v); return true; }),
      delete: jest.fn(async (k) => { store.delete(k); return true; }),
      setNX: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../bot/shared/services/session.service', () => ({
      isProcessed: jest.fn().mockResolvedValue(false),
      markAsProcessed: jest.fn().mockResolvedValue(undefined),
      getReactionEmoji: jest.fn().mockReturnValue('👍'),
    }));
    mockWa = {
      sendReaction: jest.fn().mockResolvedValue(true),
      showTypingIndicator: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue(true),
      sendInteractiveButtons: jest.fn().mockResolvedValue(true),
      sendVideoByLink: jest.fn().mockResolvedValue(true),
    };
    jest.doMock('../../bot/shared/services/whatsapp.service', () => mockWa);
    jest.doMock('../../bot/shared/database/bot-helpers', () => ({
      getOrCreateUser: jest.fn(async () => HEAD),
      trackChatStart: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('../../bot/shared/services/conversation-resume.service', () => ({
      handleResumeButton: jest.fn().mockResolvedValue(false),
      sweep: jest.fn(),
    }));
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: (...a) => mockDb.from(...a),
      rpc: (...a) => mockDb.rpc(...a),
    }));
    // The storage boundary: signing is R2's job, the router must ask for it.
    jest.doMock('../../bot/shared/storage/r2', () => ({
      getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=fresh`),
    }));
  }

  async function tap(text) {
    const { app } = require('../../bot/whatsapp-bot');
    const drain = require('../../bot/shared/utils/web-drain');
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body({ id: 'wamid.tap', type: 'button', button: { text, payload: text } })),
      });
      expect(res.status).toBe(200);
      await later(20);
      const deadline = Date.now() + 5000;
      while (drain.inFlightCount() !== 0 && Date.now() < deadline) await later(10);
    } finally {
      server.close();
    }
  }

  beforeAll(() => {
    saved.lp = process.env.HOS_VIDEO_LP_URL;
    saved.training = process.env.HOS_VIDEO_TRAINING_URL;
    process.env.HOS_VIDEO_LP_URL = LP_URL;
    process.env.HOS_VIDEO_TRAINING_URL = TRAINING_URL;
  });
  afterAll(() => {
    for (const [k, v] of [['HOS_VIDEO_LP_URL', saved.lp], ['HOS_VIDEO_TRAINING_URL', saved.training]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  beforeEach(() => {
    jest.resetModules();
    mockDb = makeDb({ users: [HEAD] });
    mockBoundaries();
  });

  test.each([
    ['Lesson Plans video', LP_URL],
    ['Teacher Training video', TRAINING_URL],
  ])('"%s" is answered with its video', async (text, url) => {
    await tap(text);
    expect(mockWa.sendVideoByLink).toHaveBeenCalledTimes(1);
    expect(mockWa.sendVideoByLink).toHaveBeenCalledWith(HEAD_PHONE, `${url}?X-Amz-Signature=fresh`);
  });
});
