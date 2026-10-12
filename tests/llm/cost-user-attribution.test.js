'use strict';
/**
 * bd-b0qwk — spend has to say WHO it was spent for.
 *
 * The model work is judged on cost per child, and `api.cost.incurred` carried the job, the model,
 * the price and the correlation id, but no user: on 11 Oct none of the ~2,500 cost events that day
 * had one, so no query could turn a day's spend into spend per teacher or per child. The request
 * already knows its user (the webhook looks it up from the sender), and a queued job is queued from
 * inside that request, so the user rides the same way the correlation id already does: on the
 * request's correlation context, onto every queue envelope, back out in the worker, and onto the
 * cost event.
 *
 * Only a users.id (uuid-shaped) is ever written. A phone number, a name or any other string is
 * dropped, never logged: the logs are not a place for anything that identifies a person directly.
 *
 * Nothing under change is mocked: events are read where they leave the process, at the log sink
 * (pino, which the root suite maps to tests/__mocks__/pino.js), and the queue drivers are stubbed
 * only at the AWS / BullMQ boundary.
 */
const UID = '2a76b32c-4389-420b-b03f-7aadfba58b31';
const OTHER = 'b81f3e2a-1c4d-4e5f-9a6b-7c8d9e0f1a2b';
const PHONE = '923001234567';
const USAGE = { usage: { cost: 0.001, prompt_tokens: 10, completion_tokens: 2 } };

const sl = () => require('../../bot/shared/utils/structured-logger');
const sunk = () => sl().logger.info.mock.calls.map(([o]) => o).filter((o) => o && typeof o === 'object');
const costEvents = () => sunk().filter((o) => o.event === 'api.cost.incurred');

beforeEach(() => { sl().logger.info.mockClear(); });

describe('a cost event names the user it was spent for (bd-b0qwk)', () => {
  const record = () => require('../../bot/shared/utils/model-cost')
    .recordModelCost('openai/gpt-4.1-mini', USAGE, Date.now(), { job: 'chat.respond' });

  test('the webhook names the user once it knows them, and the cost event carries that users.id', async () => {
    await sl().runWithCorrelation('corr-a', async () => {
      sl().setCorrelationUser(UID);
      await Promise.resolve(); // across an await, as a real handler is
      record();
    });
    expect(costEvents()).toHaveLength(1);
    expect(costEvents()[0].userId).toBe(UID);
  });

  test('a user given when the context opens (a queued job in the worker) is carried the same way', async () => {
    await sl().runWithCorrelation('corr-b', async () => { record(); }, { userId: UID });
    expect(costEvents()[0].userId).toBe(UID);
  });

  test('a phone number or any non-uuid is never written', async () => {
    await sl().runWithCorrelation('corr-c', async () => {
      sl().setCorrelationUser(PHONE);
      sl().setCorrelationUser('Ayesha');
      record();
    }, { userId: PHONE });
    expect(costEvents()).toHaveLength(1);
    expect(costEvents()[0]).not.toHaveProperty('userId');
    expect(JSON.stringify(sunk())).not.toContain(PHONE);
  });

  test('outside any request there is no userId, and nothing throws', () => {
    expect(() => record()).not.toThrow();
    expect(costEvents()[0]).not.toHaveProperty('userId');
    expect(sl().getCurrentUserId()).toBeUndefined();
    expect(sl().setCorrelationUser(UID)).toBe(false); // no context to name
  });

  test('the first user named in a request is kept: a later call cannot re-attribute its spend', async () => {
    await sl().runWithCorrelation('corr-d', async () => {
      expect(sl().setCorrelationUser(UID)).toBe(true);
      expect(sl().setCorrelationUser(OTHER)).toBe(false);
      record();
    });
    expect(costEvents()[0].userId).toBe(UID);
  });

  test('a context opened inside the request (the image handler opens its own) keeps the requester', async () => {
    // handleImageMessage wraps its work in a NEW correlation context. Photo reading is ~530 calls a
    // day; without inheritance every one of them would lose the user the webhook had just named.
    await sl().runWithCorrelation('corr-outer', async () => {
      sl().setCorrelationUser(UID);
      await sl().runWithCorrelation('corr-inner', async () => { record(); });
    });
    expect(costEvents()[0].userId).toBe(UID);
  });

  test('two requests in flight at once do not leak their users into each other', async () => {
    let releaseA;
    const aWaits = new Promise((r) => { releaseA = r; });
    const a = sl().runWithCorrelation('corr-e1', async () => {
      sl().setCorrelationUser(UID);
      await aWaits;
      record();
    });
    const b = sl().runWithCorrelation('corr-e2', async () => {
      sl().setCorrelationUser(OTHER);
      record();
    });
    await b;
    releaseA();
    await a;
    expect(costEvents().map((e) => e.userId).sort()).toEqual([UID, OTHER].sort());
  });
});

describe('the user rides on every queued job (bd-b0qwk)', () => {
  const sent = [];
  function loadSqs() {
    jest.resetModules();
    sent.length = 0;
    jest.doMock('aws-sdk', () => ({
      config: { update: () => {} },
      SQS: function SQS() {
        return { sendMessage: (params) => ({ promise: async () => { sent.push(params); return { MessageId: `m${sent.length}` }; } }) };
      },
    }), { virtual: true });
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({ get: async () => null, set: async () => {} }), { virtual: true });
    process.env.SQS_QUEUE_URL = 'https://sqs/main.fifo';
    process.env.SQS_VIDEO_QUEUE_URL = 'https://sqs/video.fifo';
    return {
      q: require('../../bot/shared/services/queue/sqs-queue.service'),
      sl: require('../../bot/shared/utils/structured-logger'),
    };
  }
  afterEach(() => { delete process.env.SQS_QUEUE_URL; delete process.env.SQS_VIDEO_QUEUE_URL; });

  const bodies = () => sent.map((p) => JSON.parse(p.MessageBody));

  test('SQS: coaching, video and generic envelopes carry the requester next to the correlation id', async () => {
    const { q, sl } = loadSqs();
    await sl.runWithCorrelation('corr-q', async () => {
      sl.setCorrelationUser(UID);
      await q.queueCoachingJob('s1', 'analysis', {});
      await q.queueVideoJob('v1', 'video_generate', {});
      await q.queueJob('g1', 'quiz_generate', {});
    });
    expect(bodies()).toHaveLength(3);
    for (const b of bodies()) {
      expect(b.correlationId).toBe('corr-q');
      expect(b.userId).toBe(UID);
    }
  });

  test('SQS: with no user known, the envelope has no userId field at all', async () => {
    const { q, sl } = loadSqs();
    await sl.runWithCorrelation('corr-r', async () => { await q.queueJob('g2', 'lp_generate', {}); });
    expect(bodies()[0]).not.toHaveProperty('userId');
  });

  test('BullMQ: the same three envelopes carry it (driver parity)', async () => {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({ set: async () => {} }), { virtual: true });
    const bull = require('../../bot/shared/services/queue/bullmq-queue.service');
    const sl = require('../../bot/shared/utils/structured-logger');
    const added = [];
    bull._add = async (queue, envelope) => { added.push(envelope); return `j${added.length}`; };
    await sl.runWithCorrelation('corr-b', async () => {
      sl.setCorrelationUser(UID);
      await bull.queueCoachingJob('s1', 'analysis', {});
      await bull.queueVideoJob('v1', 'video_generate', {});
      await bull.queueJob('g1', 'quiz_generate', {});
    });
    expect(added).toHaveLength(3);
    for (const e of added) expect(e.userId).toBe(UID);
  });
});

describe('the worker restores the requester for the job it runs (bd-b0qwk)', () => {
  function loadWorker() {
    jest.resetModules();
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: () => ({}), rpc: () => ({}) }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
    jest.doMock('../../bot/shared/services/queue', () => ({
      completeJob: async () => {}, completeVideoJob: async () => {}, completeQuizJob: async () => {},
    }));
    return {
      W: require('../../bot/workers/sqs-worker').SQSCoachingWorker,
      sl: require('../../bot/shared/utils/structured-logger'),
    };
  }

  async function runJob(body) {
    const { W, sl } = loadWorker();
    const worker = new W('w-test');
    let seen = 'not run';
    worker.executeJob = async () => { seen = sl.getCurrentUserId(); };
    worker.handleJobFailure = async () => {};
    await worker.processJob({ receiptHandle: 'rh', body, sourceQueue: 'main', messageId: 'm1' });
    await new Promise((r) => setImmediate(r));
    return seen;
  }

  test('from the envelope', async () => {
    expect(await runJob({ sessionId: 's', jobType: 'analysis', payload: {}, correlationId: 'c', userId: UID })).toBe(UID);
  });

  test('from a uuid payload.userId / payload.user_id when the envelope predates this change', async () => {
    expect(await runJob({ groupId: 'g', jobType: 'x', payload: { userId: UID }, correlationId: 'c' })).toBe(UID);
    expect(await runJob({ groupId: 'g', jobType: 'x', payload: { user_id: OTHER }, correlationId: 'c' })).toBe(OTHER);
  });

  test('never from a phone number', async () => {
    expect(await runJob({ groupId: 'g', jobType: 'x', payload: { phone: PHONE, userId: PHONE }, correlationId: 'c' })).toBeUndefined();
  });
});

describe('the webhook names the sender on its request (bd-b0qwk)', () => {
  // Driven through the real route in bot/whatsapp-bot.js (the harness of
  // tests/lp-v8/lp-day-button-routing.test.js): every boundary is mocked, the structured logger is
  // not, and the first owner a tap reaches records which user its request context names.
  const http = require('http');

  async function postWebhook(app, body) {
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const { port } = server.address();
    try {
      await fetch(`http://127.0.0.1:${port}/webhook`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  function tap(buttonId) {
    return {
      entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: 'pnid' },
        messages: [{
          id: `wamid.${buttonId}.${Date.now()}`, from: PHONE, timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'x' } },
        }],
      } }] }],
    };
  }

  function loadApp(userRow, seen) {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/validators', () => ({
      validateWebhookStatus: () => null,
      validateWebhookMessage: (req) => {
        const value = req.body.entry[0].changes[0].value;
        const message = value.messages[0];
        return {
          entry: req.body.entry[0], message, from: message.from, messageBody: '',
          messageType: message.type, messageTimestamp: message.timestamp, phoneNumberId: value.metadata.phone_number_id,
        };
      },
      isOurPhoneNumber: () => true, isTestWebhook: () => false, isTestPhoneNumber: () => false, isWithin24Hours: () => true,
    }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn(),
    }));
    jest.doMock('../../bot/shared/services/session.service', () => ({
      isProcessed: jest.fn().mockResolvedValue(false),
      markAsProcessed: jest.fn().mockResolvedValue(undefined),
      getReactionEmoji: jest.fn().mockReturnValue('👍'),
    }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendReaction: jest.fn().mockResolvedValue(true), showTypingIndicator: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../bot/shared/database/bot-helpers', () => ({
      getOrCreateUser: jest.fn().mockResolvedValue(userRow),
      trackChatStart: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('../../bot/shared/config/supabase', () => {
      const { fromMock } = require('../quiz/helpers/supabase-chain');
      return { from: fromMock({}), rpc: jest.fn().mockResolvedValue({ error: null }) };
    });
    // The first branch of the button router: it owns `resume_(yes|no):<flow>`.
    jest.doMock('../../bot/shared/services/conversation-resume.service', () => ({
      handleResumeButton: jest.fn(async () => {
        seen.push(require('../../bot/shared/utils/structured-logger').getCurrentUserId());
        return true;
      }),
      sweep: jest.fn(),
    }));
    return require('../../bot/whatsapp-bot').app;
  }

  test('a tap is handled inside a request that names its sender\'s users.id', async () => {
    const seen = [];
    const app = loadApp({ id: UID, phone_number: PHONE, preferred_language: 'en' }, seen);
    await postWebhook(app, tap('resume_yes:coaching'));
    expect(seen).toEqual([UID]);
  });

  test('a user row without a uuid id names nobody (and the phone never becomes the user)', async () => {
    const seen = [];
    const app = loadApp({ id: PHONE, phone_number: PHONE, preferred_language: 'en' }, seen);
    await postWebhook(app, tap('resume_yes:coaching'));
    expect(seen).toEqual([undefined]);
  });
});
