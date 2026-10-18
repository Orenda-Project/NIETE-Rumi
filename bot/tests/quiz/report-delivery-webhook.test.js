'use strict';
/**
 * quiz_report_send_checked, the webhook half: a teacher's class report WhatsApp accepted and then failed to deliver.
 *
 * Driven through the REAL status handler of the bot (whatsapp-bot.js handleBroadcastStatusWebhook, captured from the
 * POST /webhook route), with supabase, Redis, the queue and the WhatsApp client doubled; every supabase and Redis call
 * is recorded in one call log.
 *
 * Switch on (JSON true only), a `failed` status for a report's message id (`report_msg:<id>` in Redis):
 *  - the report is un-stamped (the share code's report_sent_at back to null, only while it is still that report's
 *    stamp; a chat quiz's `quiz_report_sent:<quiz id>` deleted);
 *  - `quiz_report_delivery_failed` / `story_report_delivery_failed` / `chat_quiz_report_delivery_failed`
 *    {code, code_h, tk, tries} is logged, with no phone and no message id in clear;
 *  - it counts toward the same 3 tries as a refused send;
 *  - a transient code (130429, 131000, 131016) is tried again in 15 min; 131047 (outside the 24 h window) and 131026
 *    (undeliverable) are not tried again and mark `report_needs_template:<code id>` in Redis (7 days).
 * A failed status that is not a report: one Redis GET, nothing else. delivered / read / sent: no lookup at all.
 * Switch off (absent, false, "true", "\"true\"", 1, {}): the handler's calls are the base's, byte for byte, once the
 * switch has been read in the last 30 s; cold, a failed status costs the one cached settings read (no Redis call).
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.WEB_QUIZ_TOKEN_SECRET = 'test-token-secret-for-the-send-check-0123456789';
process.env.WEB_QUIZ_KID_KEY = 'test-kid-key-for-the-send-check-0123456789abcdef';

const KEY = 'quiz_report_send_checked';
const SC = '6b1c0f0e-0000-4000-8000-0000000005c2';
const QUIZ = '7c2d1f1f-0000-4000-8000-0000000000a1';
const TEACHER = '8d3e2a2a-0000-4000-8000-0000000000b1';
const STAMP = '2026-10-17T13:25:31.678Z';
const REPORT_ID = 'wamid.HBgMREPORTTEST01';
const OTHER_ID = 'wamid.HBgMOTHERTEST02';
const BCAST_ID = 'wamid.HBgMBCASTTEST03';

/** A supabase double that records every call: [table, method, ...args]. */
function recordingDb(tables, log) {
  const from = (table) => {
    log.push(['from', table]);
    let rows = tables[table] || [];
    let patch = null;
    const chain = {};
    const rec = (m, args) => log.push([table, m, ...args]);
    chain.select = (...a) => { rec('select', a); return chain; };
    chain.eq = (...a) => { rec('eq', a); const [f, v] = a; rows = rows.filter((r) => r[f] === v); return chain; };
    chain.in = (...a) => { rec('in', a); const [f, vs] = a; rows = rows.filter((r) => vs.includes(r[f])); return chain; };
    chain.lte = (...a) => { rec('lte', a); const [f, v] = a; rows = rows.filter((r) => r[f] != null && String(r[f]) <= String(v)); return chain; };
    chain.update = (...a) => { rec('update', a); patch = a[0]; return chain; };
    chain.maybeSingle = async () => { rec('maybeSingle', []); return { data: rows[0] ? { ...rows[0] } : null, error: null }; };
    chain.single = async () => { rec('single', []); return { data: rows[0] ? { ...rows[0] } : null, error: rows[0] ? null : { message: 'none' } }; };
    chain.then = (res, rej) => {
      if (patch) rows.forEach((r) => Object.assign(r, JSON.parse(JSON.stringify(patch))));
      return Promise.resolve({ data: patch ? null : rows.map((r) => ({ ...r })), error: null }).then(res, rej);
    };
    return chain;
  };
  return { from, rpc: async (...a) => { log.push(['rpc', ...a]); return { data: null, error: null }; }, tables };
}

/** A Redis double that records get/set/delete. */
function recordingRedis(log) {
  const m = new Map();
  const api = {
    _map: m,
    isAvailable: () => true,
    get: async (k) => { log.push(['redis.get', k]); return m.has(k) ? m.get(k) : null; },
    set: async (k, v, ttl) => { log.push(['redis.set', k, ttl]); m.set(k, v); return true; },
    setex: async (k, ttl, v) => { log.push(['redis.setex', k, ttl]); m.set(k, v); return true; },
    setNX: async (k, v) => { log.push(['redis.setNX', k]); if (m.has(k)) return false; m.set(k, v); return true; },
    delete: async (k) => { log.push(['redis.delete', k]); m.delete(k); return true; },
    del: async (k) => { log.push(['redis.del', k]); m.delete(k); return true; },
  };
  return new Proxy(api, { get: (t, p) => (p in t ? t[p] : async () => null) });
}

const world = {};
let handler = null;
let log = [];
let events = [];
let Flag = null;

function freshTables(setting, { source = 'video', meta = {} } = {}) {
  const t = world.db.tables;
  t.app_settings = setting === undefined ? [] : [{ key: KEY, value: setting }];
  t.quiz_share_codes = [{ id: SC, code: 'TST7AB', quiz_id: QUIZ, teacher_user_id: TEACHER, report_sent_at: STAMP }];
  t.quizzes = [{ id: QUIZ, teacher_id: TEACHER, status: 'report_sent', quiz_source: source === 'story' ? 'story' : 'transcript', meta: JSON.parse(JSON.stringify(meta)) }];
  t.broadcast_messages = [{ id: 'bm-1', broadcast_id: 'b-1', status: 'sent', message_id: BCAST_ID }];
}

beforeAll(async () => {
  jest.resetModules();
  const db = recordingDb({}, { push: (e) => log.push(e) });
  const redis = recordingRedis({ push: (e) => log.push(e) });
  world.db = db;
  world.redis = redis;
  jest.doMock('../../shared/config/supabase', () => db);
  jest.doMock('../../shared/services/cache/railway-redis.service', () => redis);
  jest.doMock('../../shared/services/queue/sqs-queue.service', () => ({
    queueJob: async (...a) => { log.push(['queueJob', ...a]); return { MessageId: 'm1' }; },
  }));
  jest.doMock('../../shared/utils/web-drain', () => ({
    trackWebhookWork: (w) => Promise.resolve(w), installWebDrain: () => {}, inFlightCount: () => 0, waitForIdle: async () => true,
  }));
  jest.doMock('../../shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn(async () => true), sendTemplate: jest.fn(async () => true), markAsRead: jest.fn(async () => true),
  }));
  const actualLogger = jest.requireActual('../../shared/utils/structured-logger');
  jest.doMock('../../shared/utils/structured-logger', () => ({
    ...actualLogger,
    logEvent: (name, fields) => { events.push([name, fields]); },
  }));
  jest.doMock('../../shared/services/whatsapp-status-pricing', () => ({
    pricedFields: () => ({}), logPricedStatuses: async () => {},
    handleStatusWebhook: async (_sv, fn) => { handler = fn; },
  }));
  const { app } = require('../../whatsapp-bot');
  Flag = require('../../shared/services/quiz/report-send-check');
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const payload = { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: ['1555', '0000000'].join(''), phone_number_id: '111' },
    statuses: [{ id: 'wamid.boot', status: 'sent', timestamp: '1792230000' }],
  } }] }] };
  const res = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  expect(res.status).toBe(200);
  await new Promise((r) => server.close(r));
  expect(typeof handler).toBe('function');
}, 60000);

const RECIPIENT = ['92', '300', 'FIXTURE9'].join('');
const failed = (id, code) => ({ id, status: 'failed', timestamp: '1792230213', recipient_id: RECIPIENT, errors: [{ code, title: 'Test error', message: '' }] });
const plain = (id, status) => ({ id, status, timestamp: '1792230213', recipient_id: RECIPIENT });
const reportRecord = (kind = 'quiz') => (kind === 'chat_quiz' ? { kind, quiz_id: QUIZ, at: STAMP } : { kind, share_code_id: SC, quiz_id: QUIZ, at: STAMP });

/** Seed Redis, settle the switch's cache as asked, then run the handler over `statuses`; → the call log. */
async function run(statuses, { setting, seed = true, kind = 'quiz', warm = true, source = 'video', meta = {} } = {}) {
  log = [];   // a fresh array: the log an earlier run returned is never appended to
  freshTables(setting, { source, meta });
  world.redis._map.clear();
  if (seed) world.redis._map.set(`report_msg:${REPORT_ID}`, reportRecord(kind));
  if (kind === 'chat_quiz') world.redis._map.set(`quiz_report_sent:${QUIZ}`, '1');
  Flag.reset();
  // warm: another caller in the process read the switch within the last 30 s
  if (warm) await Flag.on();
  log = [];
  events = [];
  await handler(statuses);
  return log;
}

const ALL = () => [failed(REPORT_ID, 131026), failed(OTHER_ID, 131000), plain(REPORT_ID, 'delivered'), plain(REPORT_ID, 'read'), plain(REPORT_ID, 'sent'), plain(BCAST_ID, 'delivered'), failed(BCAST_ID, 131049)];

// The handler's call log on the base, for ALL(): this row's `l`, written out (JSON, 1-space indent) on the product files
// before this change, where it does not depend on the switch.
const GOLDEN = require('./report-delivery-webhook.golden.json');

const reportEvents = () => events.filter(([n]) => /_report_delivery_failed$/.test(n));
const queued = () => log.filter((e) => e[0] === 'queueJob');
const sansGet = (l) => l.filter((e) => !(e[0] === 'redis.get'));
const settingsReads = (l) => l.filter((e) => e[0] === 'from' && e[1] === 'app_settings').length;

describe('switch off: the handler\'s calls are the base\'s, byte for byte', () => {
  test.each([['absent', undefined], ['JSON false', false], ['the string "true"', 'true'], ['the string "\\"true\\""', '"true"'], ['1', 1], ['{}', {}]])(
    '%s (switch read within 30 s): call log == the base golden, report still stamped, nothing logged',
    async (_n, setting) => {
      const l = await run(ALL(), { setting });
      expect(JSON.stringify(l)).toBe(JSON.stringify(GOLDEN));
      expect(world.db.tables.quiz_share_codes[0].report_sent_at).toBe(STAMP);
      expect(reportEvents()).toHaveLength(0);
      expect(world.redis._map.has(`report_msg:${REPORT_ID}`)).toBe(true);
    },
  );

  test('switch cold: the only extra call is one settings read, on the first failed status, then none for 30 s', async () => {
    const l = await run(ALL(), { setting: false, warm: false });
    expect(settingsReads(l)).toBe(1);
    const withoutRead = l.filter((e) => !(e[0] === 'app_settings' || (e[0] === 'from' && e[1] === 'app_settings')));
    expect(JSON.stringify(withoutRead)).toBe(JSON.stringify(GOLDEN));
    freshTables(false);   // the broadcast row back to 'sent'; the switch's reading stays cached
    log = []; await handler(ALL());
    expect(JSON.stringify(log)).toBe(JSON.stringify(GOLDEN));
  });

  test('switch cold, only delivered / read / sent statuses: no settings read at all', async () => {
    const l = await run([plain(REPORT_ID, 'delivered'), plain(REPORT_ID, 'read'), plain(REPORT_ID, 'sent')], { setting: false, warm: false });
    expect(settingsReads(l)).toBe(0);
    expect(l.filter((e) => e[0] === 'redis.get')).toHaveLength(0);
  });
});

describe('switch on (JSON true)', () => {
  test('a failed report message (transient 131000): un-stamped, 1 try, the event, tried again in 15 min', async () => {
    const l = await run([failed(REPORT_ID, 131000)], { setting: true });
    const t = world.db.tables;
    expect(t.quiz_share_codes[0].report_sent_at).toBeNull();
    expect(t.quizzes[0].meta.report_send_failures).toEqual({ [SC]: 1 });
    expect(world.redis._map.has(`report_needs_template:${SC}`)).toBe(false);
    const ev = reportEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0][0]).toBe('quiz_report_delivery_failed');
    expect(ev[0][1]).toMatchObject({ code: 131000, code_h: expect.stringMatching(/^[0-9a-f]{12}$/), tk: expect.stringMatching(/^[0-9a-f]{16}$/), tries: 1 });
    expect(JSON.stringify(events)).not.toMatch(/FIXTURE|TST7AB|HBgM/);
    expect(JSON.stringify(log.filter((e) => e[0] === 'queueJob'))).not.toMatch(/FIXTURE|HBgM/);
    expect(queued()).toHaveLength(1);
    expect(queued()[0][1]).toBe(SC);
    expect(queued()[0][2]).toBe('quiz_video_report');
    expect(queued()[0][4]).toEqual({ delaySeconds: 900, deduplicationId: `${SC}-quiz_video_report-retry-1` });
    // handled once: a repeated webhook for the same id finds nothing
    expect(world.redis._map.has(`report_msg:${REPORT_ID}`)).toBe(false);
    // the broadcast lookup that follows is today's
    expect(l.filter((e) => e[0] === 'from' && e[1] === 'broadcast_messages')).toHaveLength(1);
  });

  test('a storybook report: story_report_delivery_failed', async () => {
    await run([failed(REPORT_ID, 131016)], { setting: true, kind: 'story', source: 'story' });
    expect(reportEvents().map((e) => e[0])).toEqual(['story_report_delivery_failed']);
    expect(world.db.tables.quiz_share_codes[0].report_sent_at).toBeNull();
    expect(queued()).toHaveLength(1);
  });

  test.each([[130429], [131000], [131016]])('transient %s: tried again in 900 s', async (code) => {
    await run([failed(REPORT_ID, code)], { setting: true });
    expect(queued()).toHaveLength(1);
    expect(queued()[0][4].delaySeconds).toBe(900);
    expect(world.redis._map.has(`report_needs_template:${SC}`)).toBe(false);
  });

  test.each([[131047], [131026]])('%s: un-stamped and counted, NOT tried again, report_needs_template set', async (code) => {
    await run([failed(REPORT_ID, code)], { setting: true });
    const t = world.db.tables;
    expect(t.quiz_share_codes[0].report_sent_at).toBeNull();
    expect(t.quizzes[0].meta.report_send_failures).toEqual({ [SC]: 1 });
    expect(world.redis._map.get(`report_needs_template:${SC}`)).toMatchObject({ code, kind: 'quiz', at: expect.any(String) });
    expect(log.find((e) => e[0] === 'redis.set' && e[1] === `report_needs_template:${SC}`)[2]).toBe(7 * 24 * 60 * 60);
    expect(queued()).toHaveLength(0);
    expect(reportEvents()[0][1]).toMatchObject({ code, tries: 1 });
  });

  test('the third failure (two refusals before it): report_gave_up, nothing tried again', async () => {
    await run([failed(REPORT_ID, 131000)], { setting: true, meta: { report_send_failures: { [SC]: 2 } } });
    expect(reportEvents()[0][1].tries).toBe(3);
    expect(events.filter(([n]) => n === 'report_gave_up')).toHaveLength(1);
    expect(queued()).toHaveLength(0);
  });

  test('a failed status that is not a report: one Redis GET, nothing else', async () => {
    const off = await run([failed(OTHER_ID, 131000)], { setting: false });
    const on = await run([failed(OTHER_ID, 131000)], { setting: true });
    expect(on.filter((e) => e[0] === 'redis.get')).toEqual([['redis.get', `report_msg:${OTHER_ID}`]]);
    expect(JSON.stringify(sansGet(on))).toBe(JSON.stringify(off));
    expect(reportEvents()).toHaveLength(0);
  });

  test('delivered / read / sent for a report message: no lookup, the calls are the base\'s', async () => {
    const statuses = [plain(REPORT_ID, 'delivered'), plain(REPORT_ID, 'read'), plain(REPORT_ID, 'sent')];
    const off = await run(statuses, { setting: false });
    const on = await run(statuses, { setting: true });
    expect(on.filter((e) => e[0] === 'redis.get')).toHaveLength(0);
    expect(JSON.stringify(on)).toBe(JSON.stringify(off));
    expect(world.db.tables.quiz_share_codes[0].report_sent_at).toBe(STAMP);
  });

  test('the broadcast rows are today\'s with the switch on too', async () => {
    const off = await run([plain(BCAST_ID, 'delivered'), failed(BCAST_ID, 131049)], { setting: false });
    const on = await run([plain(BCAST_ID, 'delivered'), failed(BCAST_ID, 131049)], { setting: true });
    expect(JSON.stringify(sansGet(on))).toBe(JSON.stringify(off));
  });
  test('a later report re-stamped the code: the old message\'s failure leaves the new stamp alone (still counted)', async () => {
    const later = '2026-10-17T20:00:00.000Z';
    await run([], { setting: true });   // tables, the record, the switch read
    world.db.tables.quiz_share_codes[0].report_sent_at = later;
    await handler([failed(REPORT_ID, 131000)]);
    expect(world.db.tables.quiz_share_codes[0].report_sent_at).toBe(later);
    expect(world.db.tables.quizzes[0].meta.report_send_failures).toEqual({ [SC]: 1 });
    expect(reportEvents()).toHaveLength(1);
  });

  test('a chat quiz report: its sent flag deleted, counted on the quiz, chat_quiz_report_delivery_failed, quiz_report again in 15 min', async () => {
    await run([failed(REPORT_ID, 131000)], { setting: true, kind: 'chat_quiz' });
    expect(world.redis._map.has(`quiz_report_sent:${QUIZ}`)).toBe(false);
    expect(world.db.tables.quizzes[0].meta.report_send_failures).toEqual({ [QUIZ]: 1 });
    expect(world.db.tables.quiz_share_codes[0].report_sent_at).toBe(STAMP);
    expect(reportEvents().map((e) => e[0])).toEqual(['chat_quiz_report_delivery_failed']);
    expect(reportEvents()[0][1]).toMatchObject({ code: 131000, tries: 1, tk: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(queued()).toHaveLength(1);
    expect(queued()[0].slice(1, 3)).toEqual([QUIZ, 'quiz_report']);
    expect(queued()[0][4]).toEqual({ delaySeconds: 900, deduplicationId: `${QUIZ}-quiz_report-retry-1` });
  });

  test('a chat quiz report, 131047: no retry, report_needs_template on the quiz', async () => {
    await run([failed(REPORT_ID, 131047)], { setting: true, kind: 'chat_quiz' });
    expect(queued()).toHaveLength(0);
    expect(world.redis._map.get(`report_needs_template:${QUIZ}`)).toMatchObject({ code: 131047, kind: 'chat_quiz' });
  });

  test('a failed report reads the switch at most once per 30 s (cold on: one settings read, then the cache)', async () => {
    const l = await run([failed(REPORT_ID, 131000), failed(OTHER_ID, 131000)], { setting: true, warm: false });
    expect(settingsReads(l)).toBe(1);
  });
});
