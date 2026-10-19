'use strict';
/**
 * The teacher's Stories page security policy (app_settings quiz_teacher_stories_csp, default off).
 * On: the page carries a hashed Content-Security-Policy <meta> (every inline script and style allowed by its sha256,
 * computed from the rendered text) and the route sends the same policy as a header plus frame-ancestors 'none', with
 * X-Content-Type-Options: nosniff. Off (absent, false, any non-true value, or the settings read failing): the page
 * bytes and headers are exactly today's (a golden recorded before the change). The switch rides the route's one
 * existing app_settings read. Supabase, SQS, Redis and WhatsApp are faked; every first-party module runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    isAvailable: () => true,
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    get: jest.fn(async (k) => keys.get(k) || null),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Stories = require('../../../shared/services/quiz/story-teacher.service');
const Routes = require('../../../shared/routes/story-teacher-internal.routes');

const GOLDEN = path.join(__dirname, 'fixtures', 'teacher-stories-page-off.golden.json');
const CSP_KEY = 'quiz_teacher_stories_csp';
const TEACHER = '11111111-1111-4111-8111-111111111111';
const OTHER = '11111111-1111-4111-8111-222222222222';
const B = (n) => `bbbbbbb${n}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
const NOW = Date.parse('2026-10-18T06:00:00Z');
const EXP = 4102444800;   // a fixed, far expiry: the same token bytes on every run

const book = (n, grade, lang, extra = {}) => ({
  id: B(n), title: `Book ${n} Testwala`, grade, lang, pages: 6, minutes: 2.5, cover_file: `cover-0000000${n}.webp`,
  featured_rank: null, status: 'ready', ...extra,
});

let db;
let settingsReads;
function seed({ csp } = {}) {
  db = {
    app_settings: [
      { key: 'web_quiz_stories_teacher', value: true }, { key: 'web_quiz_stories', value: true },
      { key: 'web_quiz_enabled', value: true }, { key: 'web_quiz_teachers', value: 'all' }, { key: 'web_quiz_hub', value: true },
      ...(csp === undefined ? [] : [{ key: CSP_KEY, value: csp }]),
    ],
    story_books: [book(1, 2, 'en'), book(2, 2, 'en', { featured_rank: 1 }), book(3, 2, 'en'), book(8, 2, 'ur', { title: 'کتاب Testwala' })],
    story_pages: [{ id: 'pg-2-1', book_id: B(2), n: 1, image_file: 'p01-00000002.webp' }],
    story_page_voices: [{ page_id: 'pg-2-1', audio_key: `story/sandbox/${B(2)}/a01-1a2b3c4d.ogg`, is_current: true }],
    users: [{ id: TEACHER, name: 'Ms Example Testwala', phone_number: 'teacher-phone', preferred_language: 'en' }],
    quizzes: [], quiz_questions: [], quiz_share_codes: [], quiz_sessions: [], story_events: [], challenge_passages: [], students: [],
  };
  const fake = makeFake(db);
  settingsReads = [];
  const from = (t) => {
    const q = fake.from(t);
    if (t !== 'app_settings') return q;
    return { ...q, select: (...a) => { const s = q.select(...a); settingsReads.push([]); const mine = settingsReads[settingsReads.length - 1];
      return { ...s, in: (col, keys) => { mine.push(...keys); return s.in(col, keys); }, eq: (col, v) => { if (col === 'key') mine.push(v); return s.eq(col, v); } }; } };
  };
  Object.assign(supabase, { from, rpc: fake.rpc });
  Stories._reset();
  require('../../../shared/services/quiz/web-quiz-link')._resetCache();
  try { require('../../../shared/services/quiz/web-quiz-hub-flags')._resetCache(); } catch (_) { /* no cache */ }
  try { require('../../../shared/services/quiz/web-quiz-hub-flags')._reset(); } catch (_) { /* no cache */ }
}
const th = (lang = 'en') => T.sign({ k: 'th', uid: TEACHER, lang, via: 'go', exp: EXP });

function res() {
  const r = { code: 200, headers: {}, body: null, ctype: null };
  r.set = (k, v) => { if (k && typeof k === 'object') Object.assign(r.headers, k); else r.headers[k] = v; return r; };
  r.status = (c) => { r.code = c; return r; };
  r.type = (t) => { r.ctype = t; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

// Every page shape the route renders: shelf (en, ur — two inline styles), preview (with a voice file, without), the
// preview that cannot be made ready (no script), and the shelf for a class with no web link.
const PAGES = {
  shelf_en: { tok: 'en', query: { grade: '2', lang: 'en' } },
  shelf_ur: { tok: 'ur', query: { grade: '2', lang: 'ur' } },
  preview_audio: { tok: 'en', query: { grade: '2', lang: 'en', book: B(2) } },
  preview_plain_ur: { tok: 'ur', query: { grade: '2', lang: 'en', book: B(1) } },
  preview_error: { tok: 'en', query: { grade: '2', lang: 'en', book: B(9) } },
  shelf_closed: { tok: 'en', query: { grade: '2', lang: 'en' }, closed: true },
};
async function render(name, { csp } = {}) {
  const p = PAGES[name];
  seed({ csp });
  if (p.closed) db.app_settings.find((r) => r.key === 'web_quiz_teachers').value = [OTHER];
  const r = res();
  await Routes.servePage({ params: { th: th(p.tok) }, query: p.query, headers: {} }, r);
  return r;
}
const snap = (r) => ({ code: r.code, ctype: r.ctype, headers: r.headers, body: r.body });

/* ---- the page-run checker: parse the page, test every inline block and every URL it loads against the policy ---- */
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
const unesc = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function metaPolicy(html) {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  return m ? unesc(m[1]) : null;
}
function directives(policy) {
  const out = {};
  for (const part of String(policy || '').split(';')) {
    const [name, ...vals] = part.trim().split(/\s+/);
    if (name) out[name] = vals;
  }
  return out;
}
const SITE = 'https://quiz.example.com';
function allowed(dirs, name, url) {
  const list = dirs[name] || dirs['default-src'] || [];
  const u = new URL(url, `${SITE}/quiz/teacher/x/stories`);
  if (u.origin === SITE) return list.includes("'self'");
  return list.includes(u.origin) || list.includes(`${u.protocol}//${u.host}`);
}
/** Every problem with this page under its own <meta> policy; [] when every inline block and every load is allowed. */
function check(html) {
  const problems = [];
  const policy = metaPolicy(html);
  if (!policy) return ['no CSP meta'];
  const d = directives(policy);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  for (const s of scripts) if (!(d['script-src'] || []).includes(`'sha256-${sha(s)}'`)) problems.push(`script not hashed: ${s.slice(0, 40)}`);
  for (const s of styles) if (!(d['style-src'] || []).includes(`'sha256-${sha(s)}'`)) problems.push(`style not hashed: ${s.slice(0, 40)}`);
  if (/<script\s+src=|\son[a-z]+="|style="/.test(html)) problems.push('an inline handler, style attribute or script src');
  const loads = [];
  for (const s of scripts) for (const m of s.matchAll(/fetch\(\s*['"]([^'"]+)['"]/g)) loads.push(['connect-src', m[1]]);
  for (const m of html.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)) loads.push(['img-src', unesc(m[1])]);
  for (const m of html.matchAll(/<audio\b[^>]*\ssrc="([^"]+)"/g)) loads.push(['media-src', unesc(m[1])]);
  for (const m of html.matchAll(/<link\b[^>]*\shref="([^"]+)"[^>]*\sas="font"/g)) loads.push(['font-src', unesc(m[1])]);
  for (const s of styles) for (const m of s.matchAll(/url\(([^)]+)\)/g)) loads.push(['font-src', m[1].replace(/["']/g, '')]);
  for (const m of html.matchAll(/<form\b[^>]*\saction="([^"]+)"/g)) loads.push(['form-action', unesc(m[1])]);
  for (const [dir, url] of loads) if (!allowed(d, dir, url)) problems.push(`${dir} refuses ${url}`);
  return problems;
}

let dateSpy;
let randSpy;
const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_BASE_URL: SITE, REFERRAL_BOT_NUMBER: '0000' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  dateSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  randSpy = jest.spyOn(Math, 'random').mockReturnValue(0.37);   // the share code: the same on every run
  require('../../../shared/services/cache/railway-redis.service').__keys.clear();
});
afterEach(() => { dateSpy.mockRestore(); randSpy.mockRestore(); });
afterAll(() => { process.env = SAVED; });

describe('switch off: the page bytes and headers are today\'s (golden)', () => {
  if (process.env.WRITE_STORIES_CSP_GOLDEN === '1') {
    test('record the golden (run on the base, before the change)', async () => {
      const out = {};
      for (const name of Object.keys(PAGES)) out[name] = snap(await render(name));
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, `${JSON.stringify(out, null, 1)}\n`);
    });
    return;
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const states = { absent: undefined, false: false, 'string true': 'true', one: 1, object: { on: true } };
  for (const [state, v] of Object.entries(states)) {
    test.each(Object.keys(PAGES))(`${CSP_KEY} ${state}: %s is byte-identical`, async (name) => {
      expect(snap(await render(name, { csp: v }))).toEqual(golden[name]);
    });
  }
});

describe('switch on: a hashed policy in the page and the header', () => {
  test.each(Object.keys(PAGES))('%s: meta policy present; header = meta + frame-ancestors \'none\'; nosniff; no other header added', async (name) => {
    const off = await render(name);
    const r = await render(name, { csp: true });
    expect(r.code).toBe(200);
    const meta = metaPolicy(r.body);
    expect(meta).toMatch(/^default-src 'none'; style-src 'sha256-/);
    expect(meta).not.toContain('frame-ancestors');
    expect(r.headers['Content-Security-Policy']).toBe(`${meta}; frame-ancestors 'none'`);
    expect(r.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(r.headers['X-Frame-Options']).toBeUndefined();   // the teacher home sends none either
    expect(Object.keys(r.headers).sort()).toEqual([...Object.keys(off.headers), 'Content-Security-Policy', 'X-Content-Type-Options'].sort());
    // the page is today's page plus exactly one <meta> line
    expect(r.body.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">\n/, '')).toBe(off.body);
  });
  test('the page-run: every inline script and style is hashed, every fetch / image / audio / font / form origin is allowed', async () => {
    for (const name of Object.keys(PAGES)) {
      const r = await render(name, { csp: true });
      expect({ name, problems: check(r.body) }).toEqual({ name, problems: [] });
    }
    // the checker saw the loads it should: the "send to class" POST, the covers, the voice file, the Urdu font
    const pre = (await render('preview_audio', { csp: true })).body;
    expect(pre).toContain("fetch('/api/teacher/story/share'");
    expect(pre).toContain(`src="/s/${B(2)}/cover-00000002.webp"`);
    expect(pre).toContain('<audio controls preload="none"');
    expect(directives(metaPolicy(pre))['media-src']).toEqual(["'self'"]);
    expect((await render('shelf_ur', { csp: true })).body).toContain('/wq/fonts/wq-nastaliq-3.woff2');
  });
  test('"Send to class": the form posts to this origin and the 302 it gets back (wa.me) is allowed by form-action', async () => {
    const r = await render('preview_audio', { csp: true });
    const d = directives(metaPolicy(r.body));
    expect(r.headers['Content-Security-Policy']).toContain(d['form-action'].join(' '));
    const layer = Routes.stack.find((l) => l.route && l.route.path === '/send');
    const out = res();
    out.redirect = (code, url) => { out.code = code; out.location = url; return out; };
    out.headersSent = false;
    await layer.route.stack[0].handle({ body: { th: th('en'), story_id: B(2) } }, out);
    expect(out.code).toBe(302);
    expect(out.location).toMatch(/^https:\/\/wa\.me\//);
    expect(allowed(d, 'form-action', out.location)).toBe(true);
    expect(allowed(d, 'form-action', 'https://api.whatsapp.com/send?text=x')).toBe(true);   // wa.me's own next hop
    // a page with no form names no other origin
    expect(directives(metaPolicy((await render('shelf_en', { csp: true })).body))['form-action']).toEqual(["'self'"]);
  });
  test('a script edited without its hash goes red (and so does a style)', async () => {
    const r = await render('preview_audio', { csp: true });
    expect(check(r.body)).toEqual([]);
    const script = r.body.replace(/<script>\(function\(\)\{/, '<script>(function(){void 0;');
    expect(script).not.toBe(r.body);
    expect(check(script)).toEqual([expect.stringMatching(/^script not hashed/)]);
    const style = r.body.replace(/<style>:root\{/, '<style>:root{--x:0;');
    expect(check(style)).toEqual([expect.stringMatching(/^style not hashed/)]);
  });
  test('an absolute image or fetch origin that the policy does not name goes red', async () => {
    const r = await render('preview_audio', { csp: true });
    expect(check(r.body.replace(`src="/s/${B(2)}/cover-00000002.webp"`, 'src="https://cdn.example.org/c.webp"')))
      .toEqual(['img-src refuses https://cdn.example.org/c.webp']);
  });
  test('the teacher-home slot (/api/internal/th/:token/stories → servePage) gets the same policy', async () => {
    seed({ csp: true });
    const r = res();
    await Routes.servePage({ params: { token: th('en') }, query: { grade: '2', lang: 'en' } }, r);
    expect(check(r.body)).toEqual([]);
    expect(r.headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  });
});

describe('the switch read', () => {
  test('rides the page\'s existing app_settings read (on and off alike): no new read, the key in the stories switch\'s list', async () => {
    const counts = [];
    for (const v of [undefined, true, false]) {
      await render('shelf_en', { csp: v });
      counts.push(settingsReads.length);
      const withKey = settingsReads.filter((keys) => keys.includes(CSP_KEY));
      expect(withKey).toHaveLength(1);
      expect(withKey[0]).toEqual(expect.arrayContaining(['web_quiz_stories_teacher', 'web_quiz_stories', 'web_quiz_hub', CSP_KEY]));
    }
    expect(new Set(counts).size).toBe(1);
  });
  test('the switch alone never opens the page: stories switch off + csp on → today\'s 404, no policy header', async () => {
    seed({ csp: true });
    db.app_settings = db.app_settings.filter((r) => r.key !== 'web_quiz_stories_teacher');
    Stories._reset();
    const r = res();
    await Routes.servePage({ params: { th: th('en') }, query: {} }, r);
    expect(r.code).toBe(404);
    expect(r.body).toEqual({ error: 'stories_off' });
    expect(r.headers['Content-Security-Policy']).toBeUndefined();
  });
  test('a settings outage: off, nothing thrown (404 stories_off as today, no policy, pageCspOn false)', async () => {
    seed({ csp: true });
    supabase.from = (t) => (t === 'app_settings' ? { select: () => ({ in: () => Promise.reject(new Error('down')) }) } : null);
    Stories._reset();
    const r = res();
    await expect(Routes.servePage({ params: { th: th('en') }, query: {} }, r)).resolves.not.toThrow();
    expect(r.code).toBe(404);
    expect(r.headers['Content-Security-Policy']).toBeUndefined();
    expect(Stories.pageCspOn()).toBe(false);
  });
  test('pageCspOn before any read: false (no read of its own)', () => {
    seed({ csp: true });
    expect(Stories.pageCspOn()).toBe(false);
    expect(settingsReads).toHaveLength(0);
  });
});

describe('the shared helper (teacher-home.page csp): the teacher home\'s policy is unchanged', () => {
  test('one style hash and one script hash, header and meta, and the no-script page: today\'s strings', () => {
    const { csp } = require('../../../shared/services/first-touch/teacher-home.page');
    expect(csp('S', 'H')).toBe("default-src 'none'; style-src 'sha256-S'; script-src 'sha256-H'; connect-src 'self'; img-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    expect(csp('S', 'H', { meta: true })).toBe("default-src 'none'; style-src 'sha256-S'; script-src 'sha256-H'; connect-src 'self'; img-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'");
    expect(csp('S', null)).toBe("default-src 'none'; style-src 'sha256-S'; img-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  });
});
