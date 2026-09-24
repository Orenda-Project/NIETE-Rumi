/**
 * The per-recipient reservation script, run against a REAL Redis.
 *
 * send-pacing.test.js exercises the WhatsApp service and the pacer against a fake of the Redis
 * boundary. This suite proves the Lua script itself: the arithmetic, the atomicity across separate
 * connections (the bot and every worker replica each hold their own), and that the key expires.
 *
 * It needs a Redis to talk to, so it runs only when REDIS_TEST_URL is set, e.g.
 *   redis-server --port 6390 --save '' --daemonize yes
 *   REDIS_TEST_URL=redis://127.0.0.1:6390 npm run test:raw -- tests/whatsapp/send-pacing.redis.test.js
 * Nothing else in the suite depends on it.
 */

const URL = process.env.REDIS_TEST_URL;
const maybe = URL ? describe : describe.skip;

maybe('the per-recipient reservation script on a real Redis', () => {
  const Redis = require('ioredis');
  const pacer = require('../../bot/shared/services/whatsapp-send-pacer');
  const INTERVAL = 200;
  const BURST = 8;
  const clients = [];
  let phoneSeq = 0;
  const newPhone = () => `92300${process.pid}${Date.now() % 100000}${(phoneSeq += 1)}`;

  const reserveWith = async (client, phone, mode, { maxWait = 60000, penalty = 0 } = {}) => {
    const [delay, granted] = await client.eval(
      pacer.RESERVE_LUA, 1, pacer.pairKey(phone), INTERVAL, BURST, maxWait, mode, penalty,
    );
    return { delay: Number(delay), granted: Number(granted) === 1 };
  };

  beforeAll(() => {
    for (let i = 0; i < 10; i += 1) clients.push(new Redis(URL));
  });
  afterAll(async () => { await Promise.all(clients.map((c) => c.quit())); });

  test('a quiet phone takes BURST sends with no wait; the next one waits one interval', async () => {
    const phone = newPhone();
    const delays = [];
    for (let i = 0; i < BURST + 1; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      delays.push((await reserveWith(clients[0], phone, 'wait')).delay);
    }
    expect(delays.slice(0, BURST).every((d) => d === 0)).toBe(true);
    expect(delays[BURST]).toBeGreaterThan(INTERVAL - 50);
    expect(delays[BURST]).toBeLessThanOrEqual(INTERVAL);
  });

  test('twenty concurrent sends from ten separate connections get twenty DIFFERENT slots', async () => {
    const phone = newPhone();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => reserveWith(clients[i % clients.length], phone, 'wait')),
    );
    const delays = results.map((r) => r.delay).sort((a, b) => a - b);
    expect(results.every((r) => r.granted)).toBe(true);
    expect(delays.filter((d) => d === 0)).toHaveLength(BURST);
    // Past the burst, each send is one interval after the previous one — never two in one slot.
    const tail = delays.slice(BURST);
    for (let i = 1; i < tail.length; i += 1) {
      expect(tail[i] - tail[i - 1]).toBeGreaterThanOrEqual(INTERVAL - 5);
    }
    expect(tail[tail.length - 1]).toBeGreaterThanOrEqual((20 - BURST) * INTERVAL - 50);
  });

  test("'try' does not reserve when there is no room, so it cannot delay the next real send", async () => {
    const phone = newPhone();
    for (let i = 0; i < BURST; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await reserveWith(clients[0], phone, 'wait');
    }
    const tried = await reserveWith(clients[0], phone, 'try');
    expect(tried.granted).toBe(false);
    const next = await reserveWith(clients[0], phone, 'wait');
    expect(next.delay).toBeLessThanOrEqual(INTERVAL);
  });

  test('a penalty pushes the next send back by at least the penalty', async () => {
    const phone = newPhone();
    await reserveWith(clients[0], phone, 'wait');
    await reserveWith(clients[0], phone, 'penalize', { penalty: 1000 });
    const next = await reserveWith(clients[1], phone, 'wait');
    expect(next.delay).toBeGreaterThan(950);
    expect(next.delay).toBeLessThanOrEqual(1000);
  });

  test('a send that would wait past max_wait is refused and takes no slot', async () => {
    const phone = newPhone();
    for (let i = 0; i < BURST; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await reserveWith(clients[0], phone, 'wait');
    }
    const refused = await reserveWith(clients[0], phone, 'wait', { maxWait: 50 });
    expect(refused.granted).toBe(false);
    const next = await reserveWith(clients[0], phone, 'wait');
    expect(next.delay).toBeLessThanOrEqual(INTERVAL);
  });

  test('the schedule key expires once its time has passed', async () => {
    const phone = newPhone();
    await reserveWith(clients[0], phone, 'wait');
    const ttl = await clients[0].pttl(pacer.pairKey(phone));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(INTERVAL + 1000);
  });

  test('the pacer reaches Redis through the shared client wrapper (evalScript)', async () => {
    process.env.REDIS_URL = URL;
    jest.resetModules();
    const wrapper = require('../../bot/shared/services/cache/railway-redis.service');
    for (let i = 0; i < 50 && !wrapper.isAvailable(); i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 20));
    }
    const freshPacer = require('../../bot/shared/services/whatsapp-send-pacer');
    const cfg = { ...freshPacer.config(), intervalMs: INTERVAL, burst: 1 };
    const phone = newPhone();
    const first = await freshPacer.reserve(phone, 'wait', cfg);
    const second = await freshPacer.reserve(phone, 'wait', cfg);
    expect(first).toEqual({ delayMs: 0, granted: true });
    expect(second.granted).toBe(true);
    expect(second.delayMs).toBeGreaterThan(INTERVAL - 50);
    await wrapper.close();
  });
});
