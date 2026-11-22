'use strict';
/**
 * A FAILED read of the reminder switch must never remove the reminder worker from a phone (OFF is destructive there:
 * sw-off.js unregisters itself, and the page unregisters on {off:true}).
 *  - the edge relays the bot's 404 {off:true} as {off:true}; any other 404 stays {error:'not_found'} (not an off);
 *  - /sw.js serves sw-off.js only on a real read of off; before any read has landed (the first read failed) it answers
 *    503, so the browser keeps the worker it has; after a good read a failed one keeps that answer.
 * The router with a fake bot and a fake settings client (the network boundaries). Invented values.
 */
const http = require('http');
const express = require('express');
const { createPushRemindRouter } = require('../routes/push-remind.routes');

const flag = (v, st) => Object.assign(() => v, { state: () => st, ready: async () => {} });

function start({ bot = () => ({ status: 404, body: { off: true } }), on, flagDb, flagNow, logEvent = () => {} } = {}) {
  const fetchImpl = async () => {
    const r = bot();
    return { status: r.status, headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(r.body || {}) };
  };
  const app = express();
  app.use(createPushRemindRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl, logEvent, ...(on ? { on } : {}), ...(flagDb ? { flagDb } : {}), ...(flagNow ? { flagNow } : {}) }));
  app.use((req, res) => res.status(404).send('portal'));
  const server = http.createServer(app);
  return new Promise((r) => server.listen(0, () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
let s;
afterEach(() => new Promise((r) => (s ? s.server.close(() => { s = null; r(); }) : r())));
const get = async (p) => { const r = await fetch(`${s.base}${p}`); return { status: r.status, text: await r.text() }; };

describe('the relay keeps "off" distinct from "missing" and "down"', () => {
  test('the bot\'s 404 {off:true} reaches the page as {off:true}', async () => {
    s = await start({ on: flag(true, 'fresh') });
    expect(await get('/api/wqpush/key?code=AB12CD')).toEqual({ status: 404, text: JSON.stringify({ off: true }) });
  });
  test('any other 404 is not an off', async () => {
    s = await start({ on: flag(true, 'fresh'), bot: () => ({ status: 404, body: { err: 'nope' } }) });
    expect(await get('/api/wqpush/key?code=AB12CD')).toEqual({ status: 404, text: JSON.stringify({ error: 'not_found' }) });
  });
  test('the bot\'s 503 (switch unread) passes as 503', async () => {
    s = await start({ on: flag(true, 'fresh'), bot: () => ({ status: 503, body: { err: 'unavailable' } }) });
    expect((await get('/api/wqpush/key?code=AB12CD')).status).toBe(503);
  });
});

describe('/sw.js serves the kill-switch worker only on a real off', () => {
  test('no read has landed (the first one failed): 503, never sw-off.js', async () => {
    s = await start({ on: flag(false, 'unread') });
    const r = await get('/sw.js');
    expect(r.status).toBe(503);
    expect(r.text).not.toContain('unregister()');
  });
  test('the last read failed after a good on: the live worker', async () => {
    s = await start({ on: flag(true, 'held') });
    const r = await get('/sw.js');
    expect(r.status).toBe(200);
    expect(r.text).toContain("addEventListener('push'");
  });
  test('a real read of off: sw-off.js, as before', async () => {
    s = await start({ on: flag(false, 'fresh') });
    const r = await get('/sw.js');
    expect(r.status).toBe(200);
    expect(r.text).toContain('unregister()');
  });
  test('the router\'s own switch keeps a good on through a failed read', async () => {
    const db = { up: true };
    let t = 1000000;
    const flagDb = () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (db.up ? { data: { value: true }, error: null } : { data: null, error: { message: 'down' } }) }) }) }) });
    s = await start({ flagDb, flagNow: () => t });
    expect((await get('/sw.js')).text).toContain("addEventListener('push'");
    db.up = false;
    t += 31000;
    await get('/sw.js');                       // starts the failing read
    await new Promise((r) => setTimeout(r, 20)); // it lands
    const r = await get('/sw.js');
    expect(r.status).toBe(200);
    expect(r.text).toContain("addEventListener('push'");
  });
});

// The props ride inside data_json (a new top-level log field can collide with the nightly page pull's aliases).
const sw = (evs) => evs.filter(([e]) => e === 'web_quiz.push_sw_switch').map(([, d]) => { expect(Object.keys(d)).toEqual(['data_json']); return JSON.parse(d.data_json); });
describe('a /sw.js answered from a failed read is counted (the portal swallowed it before)', () => {
  test('held or unread: one web_quiz.push_sw_switch event per minute at most; fresh: none', async () => {
    const events = [];
    s = await start({ on: flag(true, 'held'), logEvent: (e, d) => events.push([e, d]) });
    await get('/sw.js'); await get('/sw.js');
    expect(sw(events)).toEqual([{ state: 'held', served: 'sw' }]);
    await new Promise((r) => s.server.close(r)); s = null;
    const ev2 = [];
    s = await start({ on: flag(false, 'unread'), logEvent: (e, d) => ev2.push([e, d]) });
    await get('/sw.js');
    expect(sw(ev2)).toEqual([{ state: 'unread', served: '503' }]);
    await new Promise((r) => s.server.close(r)); s = null;
    const ev3 = [];
    s = await start({ on: flag(true, 'fresh'), logEvent: (e, d) => ev3.push([e, d]) });
    await get('/sw.js');
    expect(sw(ev3)).toEqual([]);
  });
});
