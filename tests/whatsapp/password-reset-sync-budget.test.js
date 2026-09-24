'use strict';
/**
 * The portal's password-reset call is answered inside its 10 s client timeout even when the
 * teacher's phone has no pacing slot free.
 *
 * POST /api/internal/send-password-reset AWAITS the OTP template send and answers the portal with
 * its result; the portal gives up after 10 s (dashboard/services/password-reset.service.js). Pacing
 * would hold that send for the phone's next slot (6 s per message once its burst is spent), and a
 * 131056 retry would add 6-9 s more — the portal would show "could not send" for a code that then
 * arrives. The code IS the deliverable, so it is never skipped: past the budget it goes out now,
 * unpaced, and is never retried inside the request.
 *
 * Drives the REAL Express app, route, WhatsApp service and pacer over real HTTP; faked are the
 * network boundaries (the axios stub for Graph, supabase, the Redis boundary).
 */
const http = require('http');

const PHONE = '923001110006';
const KEY = 'test-internal-key';

function mockBoundaries() {
  jest.doMock('../../bot/shared/utils/constants', () => ({
    ...jest.requireActual('../../bot/shared/utils/constants'),
    WHATSAPP_TOKEN: 'test-token',
    PHONE_NUMBER_ID: 'test-phone-id',
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => {
    const { FakePairStore } = require('./helpers/fake-pair-store');
    const store = new FakePairStore();
    return {
      __store: store,
      isAvailable: () => store.isAvailable(),
      evalScript: (...a) => store.evalScript(...a),
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn(),
    };
  });
  jest.doMock('../../bot/shared/config/supabase', () => {
    const { fromMock } = require('../quiz/helpers/supabase-chain');
    return { from: fromMock({}), rpc: jest.fn().mockResolvedValue({ error: null }) };
  });
}

describe('POST /api/internal/send-password-reset', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = KEY;
    process.env.WA_PAIR_INTERVAL_MS = '6000';
    process.env.WA_PAIR_BURST = '8';
  });
  afterAll(() => {
    delete process.env.INTERNAL_API_KEY;
    delete process.env.WA_PAIR_INTERVAL_MS;
    delete process.env.WA_PAIR_BURST;
  });

  test('a phone with no free slot still gets its code, and the portal its answer, well inside 10 s', async () => {
    mockBoundaries();
    const axios = require('axios');
    axios.post.mockReset();
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.OTP' }] }, status: 200 });
    const redis = require('../../bot/shared/services/cache/railway-redis.service');
    const pacer = require('../../bot/shared/services/whatsapp-send-pacer');
    await redis.__store.fill(pacer.pairKey(PHONE));
    const { app } = require('../../bot/whatsapp-bot');

    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    try {
      const started = Date.now();
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/internal/send-password-reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': KEY },
        body: JSON.stringify({ phoneNumber: PHONE, code: '123456', language: 'en' }),
      });
      const elapsed = Date.now() - started;

      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);
      // The slot was 6 s away; the budget lets it wait at most 1.5 s, and past that it goes now.
      expect(elapsed).toBeLessThan(1500);
      const sent = axios.post.mock.calls.filter((c) => /\/messages$/.test(c[0]) && c[1].type === 'template');
      expect(sent).toHaveLength(1);
      expect(sent[0][1].to).toBe(PHONE);
    } finally {
      server.close();
    }
  }, 20000);
});
