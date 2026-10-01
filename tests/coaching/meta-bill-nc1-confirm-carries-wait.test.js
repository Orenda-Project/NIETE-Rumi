'use strict';
/**
 * Meta bill cut NC1 (N2-C01) — the "up to 15 minutes" wait rides on the
 * "I detected a recording" prompt; the Yes tap gets a ⏳ reaction instead of the
 * billed "🔄 Step 1/5: Transcribing…" text.
 *
 * Before: [buttons] "I detected a 41-minute audio recording… analyze?"  →  tap Yes
 *         → text "🔄 Step 1/5: Transcribing your classroom audio. For a full lesson
 *           this can take up to 15 minutes — no need to wait here, I'll message you
 *           as each step finishes."
 * After:  [buttons] the same question, ending with the same wait sentence → tap Yes
 *         → ⏳ reaction on the tap. Two billed bubbles → one.
 *
 * The signal is never dropped: no wamid, or a reaction the pacer skipped, and the
 * transcription job sends Step 1/5 exactly as before. The observe (coach) path
 * queues its own transcription without the flag, so it is untouched here.
 *
 * The network boundary (whatsapp.service, the SQS queue) is mocked; the
 * orchestrator, the transcription processor and the webhook router run for real.
 */
const http = require('http');

const SID = '0b5a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const PHONE = '923001112223';
const WAMID = 'wamid.THE_YES_TAP';

const WAIT_EN = "For a full lesson this can take up to 15 minutes — no need to wait here, I'll message you as each step finishes.";
const WAIT_UR = 'مکمل سبق کے لیے اس میں 15 منٹ تک لگ سکتے ہیں — یہیں انتظار کرنے کی ضرورت نہیں، ہر مرحلہ مکمل ہونے پر اطلاع دی جائے گی۔';

describe('NC1 — the confirm prompt carries the wait (catalog)', () => {
  const { getCoachingMessage } = jest.requireActual('../../bot/shared/config/coaching-messages');

  test.each([['en', WAIT_EN], ['ur', WAIT_UR]])('[%s] the prompt ends with the same wait sentence Step 1/5 carried', (lang, wait) => {
    const step1 = getCoachingMessage('step1_transcribing', lang);
    const confirm = getCoachingMessage('coaching_confirmAudio', lang);
    // presence on BOTH operands first — the wait really is Step 1's sentence…
    expect(step1).toContain(wait);
    // …and the prompt now carries it, after the question it already asked.
    expect(confirm).toContain(wait);
    expect(confirm.indexOf(wait)).toBeGreaterThan(confirm.indexOf('{minutes}'));
  });

  test.each(['en', 'ur'])('[%s] the body stays under the 1,024 code-point cap even for a long recording', (lang) => {
    const body = getCoachingMessage('coaching_confirmAudio', lang).replace('{minutes}', '999');
    expect([...body].length).toBeLessThanOrEqual(1024);
  });
});

describe('NC1 — the Yes tap reacts ⏳ and tells the job Step 1 is already said', () => {
  let Orchestrator; let WA; let Session; let Queue;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendReaction: jest.fn(async () => true),
      sendMessage: jest.fn(async () => true),
      sendInteractiveButtons: jest.fn(async () => true),
    }));
    jest.doMock('../../bot/shared/services/coaching/coaching-session.service', () => ({
      handleConfirmation: jest.fn(async () => ({ confirmed: true, session: { id: SID, audio_id: 'aud-1' } })),
    }));
    jest.doMock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
      queueTranscription: jest.fn(async () => 'm-1'),
    }));
    Orchestrator = require('../../bot/shared/services/coaching-orchestrator.service');
    WA = require('../../bot/shared/services/whatsapp.service');
    Session = require('../../bot/shared/services/coaching/coaching-session.service');
    Queue = require('../../bot/shared/services/coaching/coaching-job-queue.service');
  });

  test('with the tap wamid: ⏳ on the tap, and the job is told Step 1/5 is already said', async () => {
    await Orchestrator.handleConfirmation(SID, PHONE, true, WAMID);
    expect(WA.sendReaction).toHaveBeenCalledWith(PHONE, WAMID, '⏳');
    expect(Queue.queueTranscription).toHaveBeenCalledWith(SID, { from: PHONE, audioId: 'aud-1', step1Announced: true });
    expect(WA.sendMessage).not.toHaveBeenCalled();
  });

  test('no wamid → no reaction and NO flag: the job sends Step 1/5 as before', async () => {
    await Orchestrator.handleConfirmation(SID, PHONE, true);
    expect(WA.sendReaction).not.toHaveBeenCalled();
    expect(Queue.queueTranscription).toHaveBeenCalledWith(SID, { from: PHONE, audioId: 'aud-1' });
  });

  test('a reaction the pacer skipped → NO flag: the signal is never dropped', async () => {
    WA.sendReaction.mockResolvedValueOnce(false);
    await Orchestrator.handleConfirmation(SID, PHONE, true, WAMID);
    expect(Queue.queueTranscription).toHaveBeenCalledWith(SID, { from: PHONE, audioId: 'aud-1' });
  });

  test('a "No" tap queues nothing and reacts nothing', async () => {
    Session.handleConfirmation.mockResolvedValueOnce({ confirmed: false, session: null });
    await Orchestrator.handleConfirmation(SID, PHONE, false, WAMID);
    expect(WA.sendReaction).not.toHaveBeenCalled();
    expect(Queue.queueTranscription).not.toHaveBeenCalled();
  });
});

describe('NC1 — the transcription job skips Step 1/5 only when told', () => {
  const sent = [];
  let TP; let getCoachingMessage;

  beforeEach(() => {
    jest.resetModules();
    sent.length = 0;
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async (to, text) => { sent.push(text); return true; }),
      sendSticker: jest.fn(async () => true),
      sendInteractiveButtons: jest.fn(async () => true),
      downloadMedia: jest.fn(async () => Buffer.from('')),
    }));
    jest.doMock('../../bot/shared/services/audio.service', () => ({}));
    jest.doMock('../../bot/shared/storage/r2', () => ({ uploadClassroomAudio: jest.fn(async () => ({})) }));
    jest.doMock('../../bot/shared/services/coaching/coaching-session.service', () => ({
      updateStatus: jest.fn(async () => ({})),
      updateConversationState: jest.fn(async () => ({})),
      markAsFailed: jest.fn(async () => ({})),
    }));
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: () => {
        const b = {};
        ['select', 'eq', 'order', 'limit', 'not', 'in', 'is', 'neq', 'update'].forEach((m) => { b[m] = () => b; });
        const row = { data: { id: SID, user_id: 'u-1', status: 'confirmed', users: { phone_number: PHONE, name: 'T', preferred_language: 'ur' } }, error: null };
        b.single = async () => row;
        b.maybeSingle = async () => row;
        b.then = (ok, ko) => Promise.resolve(row).then(ok, ko);
        return b;
      },
    }));
    TP = require('../../bot/shared/services/coaching/transcription-processor.service');
    ({ getCoachingMessage } = require('../../bot/shared/config/coaching-messages'));
  });

  // No audioId: the job stops right after the Step 1/5 point, which is all this needs.
  test('step1Announced → Step 1/5 is NOT sent', async () => {
    await TP.processTranscription(SID, { from: PHONE, step1Announced: true }).catch(() => {});
    expect(sent).not.toContain(getCoachingMessage('step1_transcribing', 'ur'));
  });

  test('CONTROL — no flag → Step 1/5 goes out exactly as before', async () => {
    await TP.processTranscription(SID, { from: PHONE }).catch(() => {});
    expect(sent).toContain(getCoachingMessage('step1_transcribing', 'ur'));
  });
});

describe('NC1 — the webhook hands the tap wamid to the confirmation', () => {
  function body(buttonId) {
    return {
      entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: 'pnid' },
        messages: [{
          id: WAMID, from: PHONE, timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'Yes' } },
        }],
      } }] }],
    };
  }
  async function post(app, payload) {
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    try {
      await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
    } finally { await new Promise((r) => server.close(r)); }
  }

  test('coaching_confirm_<sid> → handleConfirmation(sid, from, true, wamid)', async () => {
    jest.resetModules();
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
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }), get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn(),
    }));
    jest.doMock('../../bot/shared/services/session.service', () => ({
      isProcessed: jest.fn().mockResolvedValue(false), markAsProcessed: jest.fn().mockResolvedValue(undefined), getReactionEmoji: jest.fn().mockReturnValue('👍'),
    }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendReaction: jest.fn().mockResolvedValue(true), showTypingIndicator: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../bot/shared/database/bot-helpers', () => ({
      getOrCreateUser: jest.fn().mockResolvedValue({ id: 'u-1', phone_number: PHONE, preferred_language: 'en' }),
      trackChatStart: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('../../bot/shared/services/conversation-resume.service', () => ({ handleResumeButton: jest.fn().mockResolvedValue(false), sweep: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => {
      const { fromMock } = require('../quiz/helpers/supabase-chain');
      return { from: fromMock({}), rpc: jest.fn().mockResolvedValue({ error: null }) };
    });
    const handleConfirmation = jest.fn().mockResolvedValue({ confirmed: true, session: {} });
    jest.doMock('../../bot/shared/services/coaching-orchestrator.service', () => ({ handleConfirmation }));

    const { app } = require('../../bot/whatsapp-bot');
    await post(app, body(`coaching_confirm_${SID}`));
    for (let i = 0; i < 40 && !handleConfirmation.mock.calls.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(handleConfirmation).toHaveBeenCalledWith(SID, PHONE, true, WAMID);
  });
});
