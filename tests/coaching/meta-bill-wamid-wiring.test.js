'use strict';
/**
 * Meta bill cut — a reaction needs the teacher's inbound wamid, so every ack that
 * became a reaction needs its caller to hand the wamid down. EXECUTED through the
 * real webhook route / image handler; only the receiving service is a spy.
 *
 *   card_<yes|later|no>_<sid>   → handleCardButton(…, wamid)            (N2-C11)
 *   photo_more_<sid>            → handleAddAnotherPhotoTap({…, messageId}) (N2-C09)
 *   a photo sent as a document  → handlePhotoArrival({…, messageId})     (N2-C07)
 *   an image message            → handlePhotoArrival({…, messageId})     (N2-C07)
 * and the card service itself: ✅ reaction instead of the text ack, text when it
 * cannot react.
 */
const http = require('http');

const SID = '33333333-4444-4555-8666-777777777777';
const PHONE = '923001112223';
const WAMID = 'wamid.HER_TAP_OR_PHOTO';

function mockWebhookEdges() {
  jest.doMock('../../bot/shared/utils/validators', () => ({
    validateWebhookStatus: () => null,
    validateWebhookMessage: (req) => {
      const value = req.body.entry[0].changes[0].value;
      const message = value.messages[0];
      return { entry: req.body.entry[0], message, from: message.from, messageBody: '', messageType: message.type,
        messageTimestamp: message.timestamp, phoneNumberId: value.metadata.phone_number_id };
    },
    isOurPhoneNumber: () => true, isTestWebhook: () => false, isTestPhoneNumber: () => false, isWithin24Hours: () => true,
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }), get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/services/session.service', () => ({
    isProcessed: jest.fn().mockResolvedValue(false), markAsProcessed: jest.fn().mockResolvedValue(undefined), getReactionEmoji: jest.fn().mockReturnValue('👍'),
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendReaction: jest.fn().mockResolvedValue(true), showTypingIndicator: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
  }));
  jest.doMock('../../bot/shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn().mockResolvedValue({ id: 'u-1', phone_number: PHONE, preferred_language: 'ur' }),
    trackChatStart: jest.fn().mockResolvedValue(undefined),
  }));
  jest.doMock('../../bot/shared/services/conversation-resume.service', () => ({ handleResumeButton: jest.fn().mockResolvedValue(false), sweep: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => {
    const { fromMock } = require('../quiz/helpers/supabase-chain');
    return { from: fromMock({}), rpc: jest.fn().mockResolvedValue({ error: null }) };
  });
}

function envelope(message) {
  return { entry: [{ id: 'waba', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'pnid' }, messages: [message] } }] }] };
}
const tap = (id) => envelope({ id: WAMID, from: PHONE, timestamp: String(Math.floor(Date.now() / 1000)), type: 'interactive',
  interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } });
const doc = () => envelope({ id: WAMID, from: PHONE, timestamp: String(Math.floor(Date.now() / 1000)), type: 'document',
  document: { id: 'media-doc-1', mime_type: 'image/jpeg', filename: 'board.jpg', file_size: 1000 } });

async function post(app, payload) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
  } finally { await new Promise((r) => server.close(r)); }
}
async function until(fn) {
  for (let i = 0; i < 60 && !fn(); i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('webhook → the wamid reaches the services that now react', () => {
  beforeEach(() => jest.resetModules());

  test('card_yes_<sid> → handleCardButton(id, from, language, wamid)', async () => {
    mockWebhookEdges();
    const handleCardButton = jest.fn().mockResolvedValue(true);
    jest.doMock('../../bot/shared/services/coaching/coaching-card/card-response.service', () => ({ handleCardButton }));
    const { app } = require('../../bot/whatsapp-bot');
    await post(app, tap(`card_yes_${SID}`));
    await until(() => handleCardButton.mock.calls.length);
    expect(handleCardButton).toHaveBeenCalledWith(`card_yes_${SID}`, PHONE, 'ur', WAMID);
  });

  test('photo_more_<sid> → handleAddAnotherPhotoTap({ …, messageId: wamid })', async () => {
    mockWebhookEdges();
    const handleAddAnotherPhotoTap = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../bot/shared/services/coaching/classroom-photo/add-another.service', () => ({ handleAddAnotherPhotoTap }));
    const { app } = require('../../bot/whatsapp-bot');
    await post(app, tap(`photo_more_${SID}`));
    await until(() => handleAddAnotherPhotoTap.mock.calls.length);
    expect(handleAddAnotherPhotoTap).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SID, from: PHONE, messageId: WAMID }));
  });

  test('a photo sent as a document → handlePhotoArrival({ …, messageId: wamid })', async () => {
    mockWebhookEdges();
    const handlePhotoArrival = jest.fn().mockResolvedValue(true);
    jest.doMock('../../bot/shared/services/coaching/media-attach.service', () => ({ handlePhotoArrival }));
    const { app } = require('../../bot/whatsapp-bot');
    await post(app, doc());
    await until(() => handlePhotoArrival.mock.calls.length);
    expect(handlePhotoArrival).toHaveBeenCalledWith(expect.objectContaining({ mediaId: 'media-doc-1', kind: 'photo', messageId: WAMID }));
  });
});

describe('image handler → the wamid reaches both photo gates', () => {
  test.each(['photo', 'hold'])('kind %s carries messageId', async (kind) => {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })), sendMessage: jest.fn().mockResolvedValue(true),
    }));
    // Answer only at the gate under test, so the call for that kind is the one that lands.
    const handlePhotoArrival = jest.fn(async (args) => args.kind === kind);
    jest.doMock('../../bot/shared/services/coaching/media-attach.service', () => ({
      handlePhotoArrival, handleLessonPlanMediaArrival: jest.fn().mockResolvedValue(false),
    }));
    jest.doMock('../../bot/shared/handlers/exam-checker.handler', () => ({ handleExamImage: jest.fn().mockResolvedValue({ handled: false }) }));
    const { handleImageMessage } = require('../../bot/shared/handlers/image-message.handler');
    await handleImageMessage({ id: WAMID, image: { id: 'img-9', mime_type: 'image/jpeg' } }, PHONE, { id: 'u-1', preferred_language: 'en' });
    const call = handlePhotoArrival.mock.calls.map((c) => c[0]).find((a) => a.kind === kind);
    expect(call).toMatchObject({ mediaId: 'img-9', messageId: WAMID });
  });
});

describe('N2-C11 — the commit-card tap is acknowledged with a ✅ reaction', () => {
  const sends = [];
  function load(reactionOk = true) {
    jest.resetModules();
    // The webhook block above doMock'ed this module; a doMock outlives resetModules.
    jest.dontMock('../../bot/shared/services/coaching/coaching-card/card-response.service');
    sends.length = 0;
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async (to, text) => { sends.push({ kind: 'text', text }); return true; }),
      sendReaction: jest.fn(async (to, id, emoji) => { sends.push({ kind: 'reaction', id, emoji }); return reactionOk; }),
    }));
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: () => {
        const c = {};
        ['select', 'eq'].forEach((m) => { c[m] = () => c; });
        c.single = async () => ({ data: { prioritized_action: { action: 'a' } }, error: null });
        c.update = () => c;
        c.then = (ok) => Promise.resolve({ data: null, error: null }).then(ok);
        return c;
      },
    }));
    return require('../../bot/shared/services/coaching/coaching-card/card-response.service');
  }

  test('with the wamid → ✅ on their tap, no text', async () => {
    const svc = load();
    expect(await svc.handleCardButton(`card_yes_${SID}`, PHONE, 'ur', WAMID)).toBe(true);
    expect(sends).toEqual([{ kind: 'reaction', id: WAMID, emoji: '✅' }]);
  });

  test('FALLBACK — no wamid → the text ack, as before', async () => {
    const svc = load();
    await svc.handleCardButton(`card_later_${SID}`, PHONE, 'en');
    expect(sends.map((s) => s.kind)).toEqual(['text']);
  });

  test('FALLBACK — the reaction did not go out → the text ack', async () => {
    const svc = load(false);
    await svc.handleCardButton(`card_no_${SID}`, PHONE, 'en', WAMID);
    expect(sends.map((s) => s.kind)).toEqual(['reaction', 'text']);
  });
});
