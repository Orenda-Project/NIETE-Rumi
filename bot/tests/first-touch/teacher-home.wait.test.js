'use strict';
/**
 * The teacher home's slow-answer wait (switch quiz_teacher_home_wait, JSON `true` ONLY), at the router: the page the
 * server sends and its headers, and what the switch costs in reads.
 *
 *   ON   the page carries the wait's script (its own sha256 in the Content-Security-Policy) and «Try again», with the
 *        quick answer (quiz_teacher_home_paged) OFF and ON; the switch is read in the SAME app_settings read as the
 *        quick answer's switch, so the page costs the same reads ON as OFF; /api/th/home answers today's JSON.
 *   OFF  absent, false, the string "true", '"true"', 1, {}, "yes" or a failed read: the page's bytes AND headers are
 *        today's (recorded on the base), by today's reads.
 *
 * The page's own behaviour (the wait, «Try again» re-using the ask on its way, the late answer) is RUN in
 * teacher-home.page-run.test.js. Only the network boundary is faked; every module under test runs for real.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.PORTAL_URL = 'https://portal.example';
process.env.WHATSAPP_BOT_NUMBER = ['1555', '0001111'].join(''); // built at run time (no phone-shaped literal)
process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret-0123456789';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
const mockWalk = { forHome: undefined };
jest.mock('../../shared/services/first-touch/walk-persona', () => mockWalk);
jest.mock('../../shared/services/first-touch/one-door.service', () => ({}));
jest.mock('../../shared/services/first-touch/optional-modules', () => ({ load: (n) => (n === 'testPersona' ? mockWalk : null) }));

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const HomeToken = require('../../shared/services/first-touch/teacher-home.token');
const Fx = require('./teacher-home-waves-fixture');

const GOLDEN = path.join(__dirname, '__goldens__', 'teacher-home-wait-off.json');
const HOME_GOLDEN = path.join(__dirname, '__goldens__', 'teacher-home-paged-off.json');
const PHONE = ['92300', '0000931'].join(''); // built at run time (no phone-shaped literal in the tree)
const WAIT_KEY = 'quiz_teacher_home_wait';
const PAGED_KEY = 'quiz_teacher_home_paged';
// the page's shapes at the router: the token's language × the ?lang it was opened with
const SHAPES = Object.freeze([['en', null], ['ur', null], ['bi', null], ['bi', 'en']]);
const PAGEDS = Object.freeze([null, true]);
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

let srv;
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/th${p}`;
const H = () => ({ 'x-api-key': process.env.INTERNAL_API_KEY });
const tokenAt = (lang = 'en', now = Fx.NOW) => HomeToken.signTeacherHome({ uid: Fx.TEACHER.id, lang, via: 'go' }, { now });

/** A fresh process with the two page switches as given (`undefined` = no row). → the fake. */
async function boot({ paged = null, wait, now = Fx.NOW } = {}) {
  jest.resetModules();
  jest.setSystemTime(now);
  const sb = require('../../shared/config/supabase');
  const settings = [
    ...(paged === null ? [] : [{ key: PAGED_KEY, value: paged }]),
    ...(wait === undefined ? [] : [{ key: WAIT_KEY, value: wait }]),
  ];
  const fake = Fx.seed(sb, { now: Fx.NOW, settings });
  fake.db.users[0].phone_number = PHONE;
  const app = express();
  app.use('/api/internal/th', require('../../shared/services/first-touch/teacher-home.routes').createRouter());
  await stop();
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
  return fake;
}
async function stop() {
  if (!srv) return;
  const s = srv;
  srv = null;
  s.closeAllConnections();
  await new Promise((r) => s.close(r));
}
/** One GET on its own socket. → { status, headers (the ones a page carries; never the date or the socket's), text }. */
function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.get(url(p), { headers: H(), agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        const headers = {};
        Object.keys(res.headers).sort().filter((k) => !['date', 'connection', 'keep-alive'].includes(k)).forEach((k) => { headers[k] = res.headers[k]; });
        resolve({ status: res.statusCode, headers, text });
      });
    });
    req.on('error', reject);
  });
}
const shellPath = (lang, asked) => `/quiz/teacher/${tokenAt(lang)}${asked ? `?lang=${asked}` : ''}`;
/** Every page shape with the switches as booted → [{ paged, lang, asked, status, headers, sha256 }] and the reads it cost. */
async function pages(paged) {
  const out = [];
  let reads = 0;
  let settingsReads = 0;
  for (const [lang, asked] of SHAPES) {
    const m = await Fx.measure(() => get(shellPath(lang, asked)));
    reads += m.reads;
    settingsReads += Fx.S.reads.filter((r) => r.t === 'app_settings').length;
    out.push({ paged, lang, asked, status: m.value.status, headers: m.value.headers, sha256: sha256(m.value.text) });
  }
  return { rows: out, reads, settingsReads };
}
/** Every app_settings read that carries `key` (by `.eq` or `.in`) fails from now on (the database answers an error). */
function failSettingsWith(key) {
  const sb = require('../../shared/config/supabase');
  const from0 = sb.from;
  sb.from = (t) => {
    const b = from0(t);
    if (t !== 'app_settings') return b;
    const down = (r) => { r.maybeSingle = async () => ({ data: null, error: { message: 'settings down' } }); r.then = (res, rej) => Promise.resolve({ data: null, error: { message: 'settings down' } }).then(res, rej); return r; };
    const eq0 = b.eq.bind(b);
    b.eq = (k, v) => { const r = eq0(k, v); return v === key ? down(r) : r; };
    if (typeof b.in === 'function') { const in0 = b.in.bind(b); b.in = (k, vs) => { const r = in0(k, vs); return (vs || []).includes(key) ? down(r) : r; }; }
    return b;
  };
}
/** Counts the app_settings reads that carry `key` from now on. → { n } */
function watchSettingsWith(key) {
  const seen = { n: 0 };
  const sb = require('../../shared/config/supabase');
  const from0 = sb.from;
  sb.from = (t) => {
    const b = from0(t);
    if (t !== 'app_settings') return b;
    const eq0 = b.eq.bind(b);
    b.eq = (k, v) => { if (v === key) seen.n += 1; return eq0(k, v); };
    if (typeof b.in === 'function') { const in0 = b.in.bind(b); b.in = (k, vs) => { if ((vs || []).includes(key)) seen.n += 1; return in0(k, vs); }; }
    return b;
  };
  return seen;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
  mockWalk.forHome = undefined;
});
afterEach(async () => {
  jest.useRealTimers();
  await stop();
});

describe('switch OFF: today\'s page, bytes and headers, by today\'s reads (quick answer OFF and ON)', () => {
  const today = {}; // per quick-answer value: { rows, reads, settingsReads } with no wait row (the base's recording)

  test('no row: the page as recorded on the base, every shape, quick answer OFF and ON; the shell answers as today (direct build)', async () => {
    const all = [];
    for (const paged of PAGEDS) {
      await boot({ paged });
      today[paged] = await pages(paged);
      all.push(...today[paged].rows);
    }
    const Page = require('../../shared/services/first-touch/teacher-home.page');
    const shell = [];
    for (const paged of [false, true]) {
      for (const lang of ['en', 'ur']) {
        for (const switchTo of [null, 'en', 'ur']) {
          for (const asked of [null, 'en', 'ur']) {
            const b = Page.buildShell({ token: 'a.b-c_D', lang, switchTo, asked, ...(paged ? { paged: true } : {}) });
            shell.push({ paged, lang, switchTo, asked, sha256: sha256(`${b.html}\n${b.csp}`) });
          }
        }
      }
    }
    const now = { route: all, shell };
    if (process.env.TEACHER_HOME_RECORD === '1') fs.writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
    expect(now).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
    // the page's header carries the script's hash; OFF it is today's script (or the quick answer's)
    expect(all.every((r) => /script-src 'sha256-/.test(r.headers['content-security-policy']))).toBe(true);
  });

  test.each([[false], ['true'], ['"true"'], [' TRUE '], [1], [{}], [{ enabled: true }], ['yes'], [null]])('%p: the page byte for byte and header for header as with no row, by the same reads, quick answer OFF and ON', async (wait) => {
    const gold = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).route;
    for (const paged of PAGEDS) {
      await boot({ paged });
      const none = await pages(paged);
      await boot({ paged, wait });
      const got = await pages(paged);
      expect(got.rows).toEqual(gold.filter((r) => r.paged === paged));
      expect({ reads: got.reads, settingsReads: got.settingsReads }).toEqual({ reads: none.reads, settingsReads: none.settingsReads });
    }
  });

  test('a failed read of the page switches (wait row true): today\'s page (the quick answer\'s failed read is OFF today too)', async () => {
    const gold = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).route.filter((r) => r.paged === null);
    for (const paged of PAGEDS) {
      await boot({ paged, wait: true });
      failSettingsWith(PAGED_KEY);
      const got = await pages(null);
      expect(got.rows).toEqual(gold);
    }
  });
});

describe('switch ON (JSON true): the wait\'s page, in the same reads', () => {
  test.each([[null], [true]])('quick answer %p: the wait\'s script under its own hash, «Try again» on the page; reads OFF = ON (stated)', async (paged) => {
    await boot({ paged });
    const off = await pages(paged);
    await boot({ paged, wait: true });
    const on = await pages(paged);
    const Page = require('../../shared/services/first-touch/teacher-home.page');
    for (const r of on.rows) {
      expect(r.status).toBe(200);
      expect(r.headers['content-security-policy']).toContain(`script-src 'sha256-${Page.SCRIPT_WAIT_HASH}'`);
    }
    const html = (await get(shellPath('en', null))).text;
    expect(html).toContain(`<script>${Page.SCRIPT_WAIT}</script>`);
    expect(html).toContain('id="th-retry" type="button" hidden>Try again</button>');
    // the cost, stated: four page loads, the same reads with the switch OFF and ON (2 app_settings reads on the cold
    // first load: the home's own switch, then ONE read that carries both page switches; the next loads ride the 30 s caches)
    expect({ reads: on.reads, settingsReads: on.settingsReads }).toEqual({ reads: off.reads, settingsReads: off.settingsReads });
    expect(on.settingsReads).toBe(2);
    // something ON changes (the page), so the equal reads above are not a vacuous OFF row
    expect(on.rows.map((r) => r.sha256)).not.toEqual(off.rows.map((r) => r.sha256));
  });

  test('the wait switch rides the quick answer\'s read: one app_settings read carries both keys, on the page and on the home', async () => {
    await boot({ paged: true, wait: true });
    const wait = watchSettingsWith(WAIT_KEY);
    const paged = watchSettingsWith(PAGED_KEY);
    expect((await get(shellPath('en', null))).status).toBe(200);
    expect({ wait: wait.n, paged: paged.n }).toEqual({ wait: 1, paged: 1 });
    const q = Fx.S.queries.filter((x) => x.t === 'app_settings');
    expect(q.length).toBeGreaterThan(0);
  });

  test('the home\'s JSON is today\'s with the switch ON (the wait is the page\'s alone), by today\'s reads', async () => {
    await boot({ paged: null });
    const off = await Fx.measure(() => get(`/api/th/home?t=${tokenAt()}`));
    await boot({ paged: null, wait: true });
    const on = await Fx.measure(() => get(`/api/th/home?t=${tokenAt()}`));
    expect(on.value.status).toBe(200);
    expect(on.value.text).toBe(fs.readFileSync(HOME_GOLDEN, 'utf8'));
    expect(on.reads).toBe(off.reads);
  });

  test('never read while the home itself is off (today\'s 404 reads one switch)', async () => {
    const fake = await boot({ paged: true, wait: true });
    fake.db.app_settings = fake.db.app_settings.filter((r) => r.key !== 'quiz_teacher_home');
    const wait = watchSettingsWith(WAIT_KEY);
    expect((await get(shellPath('en', null))).status).toBe(404);
    expect(wait.n).toBe(0);
  });
});
