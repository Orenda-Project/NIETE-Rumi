/**
 * The portal relays carry the bot's security headers (app_settings quiz_edge_security_headers, default OFF).
 *
 * Every relay is driven through its REAL router and the REAL bot client with a fake bot that sends its CSP, nosniff,
 * X-Frame-Options and Referrer-Policy (tests/edge-relay-harness.js).
 *   ON  → the relayed answer carries CSP + nosniff + X-Frame-Options; the edge's own Referrer-Policy stays (one value);
 *         nothing else the bot sent; the bytes are unchanged; redirects unchanged.
 *   OFF → every row's status, headers and bytes equal the golden recorded on the base (before this change).
 *   The switch is ON only for the JSON boolean true ('true', '"true"', 1, {}, no row, a failed read → OFF).
 *   The bot's header policy agrees with the page's own <meta> policy (same script/style/connect; adds frame-ancestors),
 *   so the page runs exactly as it does today under both.
 */
// The teacher home's page builder reaches the bot's database module (its chat link); no database here.
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const GOLDEN = require('./fixtures/edge-security-headers-off.golden.json');
const { ROWS, REDIRECT_ROWS, BOT_SECURITY, run } = require('./edge-relay-harness');
const { createBotClient } = require('../routes/web-quiz.routes');
const { KEY, securityOf, carryBotSecurity, createEdgeSecurityFlag } = require('../routes/edge-security-headers');

const ON = () => true;
const OFF = () => false;
const CARRIED = {
  'content-security-policy': BOT_SECURITY['content-security-policy'],
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

describe('ON: every relay carries the bot\'s security headers', () => {
  test.each(ROWS.filter((r) => !REDIRECT_ROWS.has(r[0])).map((r) => [r[0], r]))('%s', async (name, row) => {
    const got = await run(row, { routerOpts: { securityOn: ON } });
    const off = GOLDEN[name];
    expect(got.headers['content-security-policy']).toBe(CARRIED['content-security-policy']);
    expect(got.headers['x-frame-options']).toBe('DENY');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    // exactly today's headers plus the three; the edge's own Referrer-Policy kept (never the bot's, never two values)
    expect(got.headers).toEqual({ ...off.headers, ...CARRIED });
    expect(got.headers['referrer-policy']).toBe(off.headers['referrer-policy']);
    expect(got.headers['set-cookie'] || []).not.toEqual(expect.arrayContaining([expect.stringContaining('bot_side')]));
    expect(got.headers['x-bot-only']).toBeUndefined();
    expect([got.status, got.sha, got.length]).toEqual([off.status, off.sha, off.length]);
  });

  test('a redirect is passed on unchanged', async () => {
    const row = ROWS.find((r) => r[0] === 'teacher.send');
    expect(await run(row, { routerOpts: { securityOn: ON } })).toEqual(GOLDEN['teacher.send']);
  });

  test('a bot answer with no security header: ON changes nothing (the switch is not even asked)', async () => {
    const asked = jest.fn(() => true);
    for (const row of ROWS) {
      expect(await run(row, { security: false, routerOpts: { securityOn: asked } })).toEqual(await run(row, { security: false, routerOpts: { securityOn: OFF } }));
    }
    expect(asked).not.toHaveBeenCalled();
  });
});

describe('OFF: every relay is byte-identical to the base (golden recorded before the change)', () => {
  test('the golden covers every row', () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(ROWS.map((r) => r[0]).sort());
  });
  test.each(ROWS.map((r) => [r[0], r]))('%s: switch off', async (name, row) => {
    expect(await run(row, { routerOpts: { securityOn: OFF } })).toEqual(GOLDEN[name]);
  });
  test.each(ROWS.map((r) => [r[0], r]))('%s: the switch reader throws → off', async (name, row) => {
    expect(await run(row, { routerOpts: { securityOn: () => { throw new Error('x'); } } })).toEqual(GOLDEN[name]);
  });
});

describe('the switch: only the JSON boolean true', () => {
  const dbWith = (answer) => () => ({ from: (t) => ({ select: () => ({ eq: (k, v) => ({ maybeSingle: async () => {
    expect([t, k, v]).toEqual(['app_settings', 'key', KEY]);
    if (answer instanceof Error) throw answer;
    return answer;
  } }) }) }) });
  async function flagWith(answer) {
    const on = createEdgeSecurityFlag({ db: dbWith(answer), now: () => 0 });
    on();
    await on.ready();
    return on;
  }
  const page = ROWS.find((r) => r[0] === 'teacher.page');

  test('true → ON (the relayed page carries the bot\'s CSP)', async () => {
    const on = await flagWith({ data: { value: true }, error: null });
    expect(on()).toBe(true);
    const got = await run(page, { routerOpts: { securityOn: on } });
    expect(got.headers['content-security-policy']).toBe(CARRIED['content-security-policy']);
  });
  test.each([
    ['the string true', { data: { value: 'true' }, error: null }],
    ['the quoted string', { data: { value: '"true"' }, error: null }],
    ['1', { data: { value: 1 }, error: null }],
    ['{}', { data: { value: {} }, error: null }],
    ['{enabled:true}', { data: { value: { enabled: true } }, error: null }],
    ['false', { data: { value: false }, error: null }],
    ['no row', { data: null, error: null }],
    ['a read error', { data: null, error: { message: 'x' } }],
    ['a thrown read', new Error('down')],
  ])('%s → OFF (golden headers)', async (_, answer) => {
    const on = await flagWith(answer);
    expect(on()).toBe(false);
    expect(await run(page, { routerOpts: { securityOn: on } })).toEqual(GOLDEN['teacher.page']);
  });
  test('no database client → OFF', async () => {
    const on = createEdgeSecurityFlag({ db: () => null, now: () => 0 });
    on();
    await on.ready();
    expect(on()).toBe(false);
  });
  test('read at most once per 30 s, never per request', async () => {
    let reads = 0;
    let t = 0;
    const on = createEdgeSecurityFlag({ db: () => { reads += 1; return dbWith({ data: { value: true }, error: null })(); }, now: () => t });
    on(); await on.ready();
    for (let i = 0; i < 50; i += 1) on();
    t = 29999; on();
    expect(reads).toBe(1);
    t = 30000; on(); await on.ready();
    expect(reads).toBe(2);
  });
});

describe('the bot client and the allowlist', () => {
  const fakeFetch = (headers) => async () => new Response('<p>x</p>', { status: 200, headers: { 'content-type': 'text/html', ...headers } });
  const req = { get: () => null, ip: '1.2.3.4' };

  test('a raw answer carries only the allowlisted security headers', async () => {
    const call = createBotClient({ botUrl: 'http://bot', apiKey: 'k', fetchImpl: fakeFetch({ ...BOT_SECURITY, 'set-cookie': 'a=1', server: 'bot', 'cache-control': 'no-store' }), logEvent: () => {} });
    const out = await call('GET', '/p', req, null, { raw: true });
    expect(out.security).toEqual(BOT_SECURITY);
  });
  test('no security header → no `security` field (the answer is today\'s shape)', async () => {
    const call = createBotClient({ botUrl: 'http://bot', apiKey: 'k', fetchImpl: fakeFetch({ 'cache-control': 'no-store' }), logEvent: () => {} });
    const out = await call('GET', '/p', req, null, { raw: true });
    expect(Object.keys(out).sort()).toEqual(['bytes', 'contentType', 'location', 'status']);
  });
  test('a JSON (non-raw) answer is unchanged', async () => {
    const call = createBotClient({ botUrl: 'http://bot', apiKey: 'k', fetchImpl: async () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json', ...BOT_SECURITY } }), logEvent: () => {} });
    expect(await call('GET', '/p', req, null)).toEqual({ status: 200, body: { a: 1 }, location: null });
  });
  test('securityOf: an over-long value is dropped', () => {
    expect(securityOf(new Headers({ 'x-frame-options': 'DENY', 'content-security-policy': 'a'.repeat(5000) }))).toEqual({ 'x-frame-options': 'DENY' });
    expect(securityOf(new Headers({}))).toBeNull();
    expect(securityOf(null)).toBeNull();
  });
  test('Referrer-Policy: the bot\'s only when the edge set none', () => {
    const fakeRes = (init) => { const h = { ...init }; return { h, get: (k) => h[k], set: (k, v) => { h[k] = v; } }; };
    const none = fakeRes({});
    carryBotSecurity(none, { security: { 'referrer-policy': 'strict-origin' } }, ON);
    expect(none.h).toEqual({ 'Referrer-Policy': 'strict-origin' });
    const own = fakeRes({ 'Referrer-Policy': 'no-referrer' });
    carryBotSecurity(own, { security: { 'referrer-policy': 'strict-origin' } }, ON);
    expect(own.h).toEqual({ 'Referrer-Policy': 'no-referrer' });
    const off = fakeRes({});
    carryBotSecurity(off, { security: BOT_SECURITY }, OFF);
    expect(off.h).toEqual({});
  });
});

describe('the bot\'s header policy agrees with the page\'s own <meta> policy (the page runs under both)', () => {
  const unesc = (s) => s.replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const metaOf = (html) => { const m = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html); return m ? unesc(m[1]) : null; };
  const TOKEN = `eyJrIjoidGgifQ.${'A'.repeat(22)}`;
  const pages = [
    ['teacher home', () => require('../../bot/shared/services/first-touch/teacher-home.page').buildShell({ token: TOKEN, lang: 'en' })],
    ['teacher home (ur)', () => require('../../bot/shared/services/first-touch/teacher-home.page').buildShell({ token: TOKEN, lang: 'ur' })],
    ['quiz maker', () => require('../../bot/shared/services/first-touch/maker.page').buildMakerPage({ token: TOKEN, lang: 'en' })],
    ['one door', () => require('../../bot/shared/services/first-touch/go.page').buildRolePage({ t: TOKEN, lang: 'bi' })],
  ];
  test.each(pages)('%s: header = the meta policy + frame-ancestors \'none\'', (_, build) => {
    const { html, csp } = build();
    const meta = metaOf(html);
    expect(meta).toBeTruthy();
    expect(csp).toBe(`${meta}; frame-ancestors 'none'`);
    // every fetch the page script makes is same-origin (connect-src 'self' in both)
    expect(meta).toMatch(/connect-src 'self'/);
    const fetched = (html.match(/fetch\(\s*['"`]?([^'"`,)]*)/g) || []).map((f) => f.replace(/^fetch\(\s*['"`]?/, ''));
    fetched.forEach((u) => expect(u).not.toMatch(/^https?:/));
  });
});
