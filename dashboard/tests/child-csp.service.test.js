/**
 * The child pages' content security policy, report-only first (app_settings web_quiz_child_csp, default OFF).
 *
 * The real web quiz and join routers with a fake bot (tests/child-page-harness.js): the hub (plain and streamed), the
 * quiz (plain, streamed, streamed then closed, class, schools), the join page and its note, and the closed pages of
 * /h, /q, /c, /k and /j.
 *   ON  → Content-Security-Policy-Report-Only + nosniff on each; nothing else changes but the streamed fixes' line,
 *         which carries this request's nonce; every inline script on every page is allowed by its policy (page-run);
 *         POST /api/wq/csp-report logs one line per report: the directive, the blocked origin (or its keyword) and
 *         the script file:line — never the page's address, a path, a query or a sample; capped in size and per address.
 *   OFF → every row's status, headers and bytes equal the golden recorded on the base (before this change).
 *   The switch is ON only for the JSON boolean true.
 */
const crypto = require('crypto');
const GOLDEN = require('./fixtures/child-csp-off.golden.json');
const { ROWS, run, serve, goldenOf } = require('./child-page-harness');
const ChildCsp = require('../routes/child-csp');

const ON = () => true;
const OFF = () => false;
const HDR = 'content-security-policy-report-only';
const PAGE_ROWS = ROWS.filter((r) => r[0] !== 'report.post');
const nonceOf = (policy) => (/'nonce-([A-Za-z0-9+/=]+)'/.exec(policy) || [])[1];
const stripNonce = (body) => body.replace(/<script nonce="[A-Za-z0-9+/=]+">/g, '<script>');
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const row = (name) => ROWS.find((r) => r[0] === name);

describe('ON: every child page carries the report-only policy and nosniff, and nothing else changes', () => {
  test.each(PAGE_ROWS.map((r) => [r[0], r]))('%s', async (name, r) => {
    const got = await run(r, { routerOpts: { childCspOn: ON } });
    const off = GOLDEN[name];
    const policy = got.headers[HDR];
    expect(policy).toMatch(/^default-src 'self'; script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'sha256-[A-Za-z0-9+/]{43}='( 'sha256-[A-Za-z0-9+/]{43}=')?; /);
    expect(policy).not.toContain("'unsafe-inline' 'nonce");
    expect(/script-src[^;]*'unsafe-(inline|eval|hashes)'/.test(policy)).toBe(false);
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'; base-uri 'none'");
    expect(policy).toContain('report-uri /api/wq/csp-report');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(got.headers['content-security-policy']).toBeUndefined();   // report-only: nothing is blocked yet
    const { [HDR]: _p, 'x-content-type-options': _n, ...rest } = got.headers;
    expect(rest).toEqual(off.headers);
    expect(got.status).toBe(off.status);
    expect(sha(stripNonce(got.body))).toBe(off.sha);
  });

  test.each([['hub.flushed'], ['quiz.flushed']])('%s: the streamed fixes\' line carries this request\'s nonce', async (name) => {
    const got = await run(row(name), { routerOpts: { childCspOn: ON } });
    const nonce = nonceOf(got.headers[HDR]);
    expect(got.body).toContain(`<script nonce="${nonce}">(function(h){h.lang="ur"`);
    expect(got.body.match(/<script nonce=/g)).toHaveLength(1);
  });

  test('the designed wait (web_quiz_wait_ux on): its script is allowed by the hash of the module\'s own text', async () => {
    const WaitUx = require('../routes/web-quiz-wait-ux');
    const want = `'sha256-${crypto.createHash('sha256').update(WaitUx.JS, 'utf8').digest('base64')}'`;
    for (const name of ['hub.wait', 'hub.wait.flushed']) {
      const got = await run(row(name), { routerOpts: { childCspOn: ON } });
      expect([name, got.body.includes(`<script>${WaitUx.JS}</script>`), got.headers[HDR].includes(want)]).toEqual([name, true, true]);
    }
  });

  test('a fresh nonce on every request', async () => {
    const a = await run(row('hub.flushed'), { routerOpts: { childCspOn: ON } });
    const b = await run(row('hub.flushed'), { routerOpts: { childCspOn: ON } });
    expect(nonceOf(a.headers[HDR])).not.toBe(nonceOf(b.headers[HDR]));
  });

  test('page-run: every inline script on every page is allowed by its own policy; every script file is this site\'s', async () => {
    let inline = 0;
    for (const r of PAGE_ROWS) {
      const got = await run(r, { routerOpts: { childCspOn: ON } });
      const policy = got.headers[HDR];
      const nonce = nonceOf(policy);
      for (const m of got.body.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
        const attrs = m[1] || '';
        if (/\ssrc="/.test(attrs)) { expect(/\ssrc="(\/[^/][^"]*)"/.test(attrs)).toBe(true); continue; }
        if (/type="application\/json"/.test(attrs)) continue;   // data, never run
        inline += 1;
        const byNonce = attrs.trim() === `nonce="${nonce}"`;
        const byHash = policy.includes(`'sha256-${crypto.createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
        expect([r[0], byNonce || byHash]).toEqual([r[0], true]);
      }
    }
    // the hub's and the quiz's fixes, the quiz's ask-again, the join page's early tap; the designed wait's script on the
    // hub with web_quiz_wait_ux on (plain and streamed) and that hub's streamed fixes
    expect(inline).toBe(7);
  });
});

describe('OFF: every child page is byte-identical to the base (golden recorded before the change)', () => {
  test('the golden covers every row', () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(ROWS.map((r) => r[0]).sort());
  });
  test.each(ROWS.map((r) => [r[0], r]))('%s: switch off', async (name, r) => {
    expect(goldenOf(await run(r, { routerOpts: { childCspOn: OFF } }))).toEqual(GOLDEN[name]);
  });
  test.each(ROWS.map((r) => [r[0], r]))('%s: the switch reader throws → off', async (name, r) => {
    expect(goldenOf(await run(r, { routerOpts: { childCspOn: () => { throw new Error('x'); } } }))).toEqual(GOLDEN[name]);
  });
  test('no reader passed (the process switch, no database here) → off', async () => {
    expect(goldenOf(await run(row('hub.flushed')))).toEqual(GOLDEN['hub.flushed']);
  });
});

describe('POST /api/wq/csp-report (switch on): one line per report — directive, blocked origin, script file:line', () => {
  const report = (type, text) => ['r', 'wq', 'POST', '/api/wq/csp-report', { body: { type, text } }];
  const U = { directive: 'unknown', blocked: 'unknown', source: 'unknown' };
  const logged = (logEvent) => logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.csp_report');
  test.each([
    ['report-uri', report('application/csp-report', '{"csp-report":{"effective-directive":"script-src-elem","blocked-uri":"inline","document-uri":"https://portal.example/h/secret"}}'),
      { directive: 'script-src-elem', blocked: 'inline', source: 'unknown' }],
    ['an older browser', report('application/csp-report', '{"csp-report":{"violated-directive":"connect-src https://x","blocked-uri":"https://x"}}'),
      { directive: 'connect-src', blocked: 'https://x', source: 'unknown' }],
    ['the Reporting API', report('application/reports+json', '[{"type":"csp-violation","body":{"effectiveDirective":"script-src-attr","blockedURL":"inline","documentURL":"https://portal.example/q/AB12CD","sourceFile":"https://portal.example/wq/wq.js?v=abc","lineNumber":217}}]'),
      { directive: 'script-src-attr', blocked: 'inline', source: 'wq.js:217' }],
    ['eval, data and blob are kept as their keyword', report('application/csp-report', '{"csp-report":{"effective-directive":"img-src","blocked-uri":"data:image/png;base64,AAAA","source-file":"https://portal.example/wq/hub.js","line-number":340}}'),
      { directive: 'img-src', blocked: 'data', source: 'hub.js:340' }],
    ['an unreadable body', report('application/csp-report', '{not json'), U],
    ['a made-up directive', report('application/csp-report', '{"csp-report":{"effective-directive":"<script>"}}'), U],
  ])('%s', async (_, r, line) => {
    const logEvent = jest.fn();
    const got = await run(r, { routerOpts: { childCspOn: ON, logEvent } });
    expect(got.status).toBe(204);
    expect(got.headers['cache-control']).toBe('no-store');
    expect(logged(logEvent)).toEqual([['web_quiz.csp_report', line]]);
  });

  test('a report full of a child\'s link: the line keeps no token, no path, no query and no sample', async () => {
    const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJ6Il19.SeCrEtSeCrEtSeCrEtSeCr';
    const logEvent = jest.fn();
    const got = await run(report('application/csp-report', JSON.stringify({ 'csp-report': {
      'effective-directive': 'connect-src',
      'document-uri': `https://portal.example/h/${TOKEN}?kid=0123456789abcdef`,
      referrer: `https://portal.example/c/${TOKEN}`,
      'blocked-uri': `https://store.example/up/${TOKEN}/read.webm?X-Amz-Signature=abc123`,
      'source-file': `https://portal.example/wq/wq-challenge.js?v=${TOKEN}`,
      'line-number': 1418,
      'script-sample': `fetch("/h/${TOKEN}")`,
    } })), { routerOpts: { childCspOn: ON, logEvent } });
    expect(got.status).toBe(204);
    expect(logged(logEvent)).toEqual([['web_quiz.csp_report', { directive: 'connect-src', blocked: 'https://store.example', source: 'wq-challenge.js:1418' }]]);
    const text = JSON.stringify(logEvent.mock.calls);
    for (const bad of ['SeCrEt', TOKEN.slice(0, 12), '/h/', '/up/', '?', 'Signature', 'kid=', 'fetch(']) expect([bad, text.includes(bad)]).toEqual([bad, false]);
  });

  test('an inline script\'s report names the page, never its address', async () => {
    const logEvent = jest.fn();
    await run(report('application/csp-report', '{"csp-report":{"effective-directive":"script-src-elem","blocked-uri":"inline","source-file":"https://portal.example/h/eyJrIjoiaCJ9.SeCrEtSeCrEtSeCrEtSeCr","line-number":3}}'), { routerOpts: { childCspOn: ON, logEvent } });
    expect(logged(logEvent)).toEqual([['web_quiz.csp_report', { directive: 'script-src-elem', blocked: 'inline', source: 'page:3' }]]);
  });

  test('a body over the 8 kB cap: answered, nothing kept beyond "unknown"', async () => {
    const logEvent = jest.fn();
    const big = JSON.stringify({ 'csp-report': { 'effective-directive': 'connect-src', 'document-uri': 'https://portal.example/h/eyJrIjoiaCJ9.SeCrEtSeCrEtSeCrEtSeCr', 'script-sample': 'x'.repeat(9000) } });
    const got = await run(report('application/csp-report', big), { routerOpts: { childCspOn: ON, logEvent } });
    expect([204, 413]).toContain(got.status);
    expect(got.body).toBe('');
    expect(logged(logEvent).every((c) => JSON.stringify(c[1]) === JSON.stringify(U))).toBe(true);
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('SeCrEt');
  });

  test('switch off: today\'s 404 JSON, byte for byte, and nothing logged — whatever the body', async () => {
    const logEvent = jest.fn();
    expect(goldenOf(await run(row('report.post'), { routerOpts: { childCspOn: OFF, logEvent } }))).toEqual(GOLDEN['report.post']);
    const tokenBody = report('application/csp-report', '{"csp-report":{"effective-directive":"connect-src","document-uri":"https://portal.example/h/eyJrIjoiaCJ9.SeCrEtSeCrEtSeCrEtSeCr"}}');
    const got = await run(tokenBody, { routerOpts: { childCspOn: OFF, logEvent } });
    expect(goldenOf(got)).toEqual(GOLDEN['report.post']);
    expect(got.body).toBe('{"error":"not_found"}');
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('per address: 120 reports a minute are kept, the next is refused and not logged; another address is not held up', async () => {
    const logEvent = jest.fn();
    const s = await serve('wq', { childCspOn: ON, logEvent });
    const body = { type: 'application/csp-report', text: '{"csp-report":{"effective-directive":"img-src","blocked-uri":"https://x.example/a.png"}}' };
    try {
      const a = { 'x-forwarded-for': '203.0.113.7' };
      const first = [];
      for (let i = 0; i < 120; i += 1) first.push((await s.send('POST', '/api/wq/csp-report', body, a)).status);
      expect(first.every((st) => st === 204)).toBe(true);
      expect((await s.send('POST', '/api/wq/csp-report', body, a)).status).toBe(429);
      expect(logged(logEvent)).toHaveLength(120);
      expect((await s.send('POST', '/api/wq/csp-report', body, { 'x-forwarded-for': '203.0.113.8' })).status).toBe(204);
      expect(logged(logEvent)).toHaveLength(121);
    } finally {
      await s.close();
    }
  });
});

describe('the switch: only the JSON boolean true', () => {
  const dbWith = (answer) => () => ({ from: (t) => ({ select: () => ({ eq: (k, v) => ({ maybeSingle: async () => {
    expect([t, k, v]).toEqual(['app_settings', 'key', ChildCsp.KEY]);
    if (answer instanceof Error) throw answer;
    return answer;
  } }) }) }) });
  async function flagWith(answer) {
    const on = ChildCsp.createChildCspFlag({ db: dbWith(answer), now: () => 0 });
    on();
    await on.ready();
    return on;
  }
  test('true → ON', async () => {
    const on = await flagWith({ data: { value: true }, error: null });
    const got = await run(row('hub.page'), { routerOpts: { childCspOn: on } });
    expect(got.headers[HDR]).toMatch(/^default-src 'self'/);
  });
  test.each([
    ['the string true', { data: { value: 'true' }, error: null }],
    ['the quoted string', { data: { value: '"true"' }, error: null }],
    ['1', { data: { value: 1 }, error: null }],
    ['{}', { data: { value: {} }, error: null }],
    ['false', { data: { value: false }, error: null }],
    ['no row', { data: null, error: null }],
    ['a read error', { data: null, error: { message: 'x' } }],
    ['a thrown read', new Error('down')],
  ])('%s → OFF (golden)', async (_, answer) => {
    const on = await flagWith(answer);
    expect(on()).toBe(false);
    expect(goldenOf(await run(row('hub.flushed'), { routerOpts: { childCspOn: on } }))).toEqual(GOLDEN['hub.flushed']);
  });
});

describe('the policy pieces', () => {
  test('scriptHash: the sha256 of the first inline script\'s text', () => {
    expect(ChildCsp.scriptHash('<script>a()</script>')).toBe(`'sha256-${crypto.createHash('sha256').update('a()').digest('base64')}'`);
    expect(() => ChildCsp.scriptHash('<p>')).toThrow();
  });
  test('directiveOf: only a directive word', () => {
    expect(ChildCsp.directiveOf({ 'csp-report': { 'effective-directive': 'img-src' } })).toBe('img-src');
    expect(ChildCsp.directiveOf([{ body: { effectiveDirective: 'font-src' } }])).toBe('font-src');
    expect(ChildCsp.directiveOf(null)).toBeNull();
    expect(ChildCsp.directiveOf({ 'csp-report': { 'effective-directive': 'x'.repeat(60) } })).toBeNull();
  });
});
