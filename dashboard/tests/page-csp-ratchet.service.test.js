/**
 * Page CSP ratchet: every GET route of the portal's child and teacher page routers, and whether the document it serves
 * carries a content security policy — as a header the portal sets (`report-only` with web_quiz_child_csp on), or as the
 * bot page's own <meta> (`meta`; relayed pages) — or none.
 *
 * CSP_LESS lists today's documents with no policy at all. It may only SHRINK: a page that gains a policy leaves the
 * list (its row changes and the list must follow), and a new page route must be listed here before it can ship, with
 * or without a policy. The claims are checked: the portal's headers by driving the real routers (harness), the meta
 * by building the bot's pages.
 */
const fs = require('fs');
const path = require('path');
const { ROWS, run } = require('./child-page-harness');

// The teacher home's page builder reaches the bot's database module (its chat link); no database here.
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const FILES = ['web-quiz.routes.js', 'web-quiz-class-link.js', 'quiz-join.routes.js', 'quiz-teacher.routes.js',
  'first-touch.routes.js', 'quiz-go.routes.js', 'teacher-report.routes.js', 'teacher-stories.routes.js'];

// Every document route: [route as written in its file, file, policy]. policy: 'report-only' (the portal's header, with
// web_quiz_child_csp on), 'meta' (the bot page's own <meta>; relayed), 'none'.
const PAGES = [
  ['/h/:token', 'web-quiz.routes.js', 'report-only'],
  ['/q/:code', 'web-quiz.routes.js', 'report-only'],
  ['/q/:code/class', 'web-quiz.routes.js', 'report-only'],
  ['/q/:code/schools', 'web-quiz.routes.js', 'report-only'],
  ['/c/:token', 'web-quiz.routes.js', 'report-only'],
  ['/k/:token', 'web-quiz.routes.js', 'report-only'],
  ['/j/:code', 'web-quiz-class-link.js', 'report-only'],
  ['/quiz/join/:token', 'quiz-join.routes.js', 'report-only'],
  ['/lib/:token', 'web-quiz.routes.js', 'none'],
  ['/wq-probe', 'web-quiz.routes.js', 'none'],
  ['/wq/juice-demo.html', 'web-quiz.routes.js', 'none'],
  ['/quiz/teacher/:token', 'quiz-teacher.routes.js', 'meta'],
  ['/quiz/teacher/:token/stories', 'quiz-teacher.routes.js', 'none'],
  ['/quiz/teacher/:th/stories', 'teacher-stories.routes.js', 'none'],
  ['/m/:token', 'first-touch.routes.js', 'meta'],
  ['/f/:token', 'first-touch.routes.js', 'none'],
  ['/quiz/go/:token', 'quiz-go.routes.js', 'meta'],
  ['${REPORT_PATH}/:token', 'teacher-report.routes.js', 'none'],
  ['${REPORT_PATH}/:token/round', 'teacher-report.routes.js', 'none'],
];

// GET routes that serve no document: a redirect, a picture, a file, JSON.
const NOT_DOCUMENTS = [
  '/h/:token/manifest.webmanifest', '/c/:token/back', '/wq/vt/:vid.webp', '/s/:bookId/:file', '/q/:code/art/:kind.jpg', '/q/:code/art/:kind.png',
  '/wq/card/:token.png', '/quiz/teacher/:token/send', '/api/th/home', '/api/th/library', '/api/th/quiz/:id', '/m/:token/send',
  '/f/:token/teacher', '${REPORT_PATH}/:token/pdf', '${REPORT_PATH}/:token/remind', '${REPORT_PATH}/:token/fwd',
  '${REPORT_PATH}/:token/wfwd', '${REPORT_PATH}/:token/jlink', '/api/teacher/stories', '/api/teacher/story/preview',
];

// Today's documents with no policy. ONLY EVER SHRINKS.
const CSP_LESS = [
  '/lib/:token', '/wq-probe', '/wq/juice-demo.html', '/quiz/teacher/:token/stories', '/quiz/teacher/:th/stories', '/f/:token',
  '${REPORT_PATH}/:token', '${REPORT_PATH}/:token/round',
];
const CSP_LESS_MAX = 8;

function getRoutes(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', file), 'utf8');
  return [...src.matchAll(/router\.get\((['`])([^'`]+)\1/g)].map((m) => m[2]);
}

describe('every page route is listed', () => {
  test.each(FILES)('%s: each GET route is a listed page or a listed non-document', (file) => {
    const listed = new Set([...PAGES.filter((p) => p[1] === file).map((p) => p[0]), ...NOT_DOCUMENTS]);
    const routes = getRoutes(file);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((r) => !listed.has(r))).toEqual([]);
  });
  test('no listed page is stale (each is still a route of its file)', () => {
    expect(PAGES.filter(([r, f]) => !getRoutes(f).includes(r))).toEqual([]);
    const all = FILES.flatMap(getRoutes);
    expect(NOT_DOCUMENTS.filter((r) => !all.includes(r))).toEqual([]);
  });
});

describe('the ratchet: documents without a policy may only shrink', () => {
  test('CSP_LESS is exactly the pages listed with no policy', () => {
    expect(PAGES.filter((p) => p[2] === 'none').map((p) => p[0]).sort()).toEqual([...CSP_LESS].sort());
  });
  test(`at most ${CSP_LESS_MAX} (lower this number when a page gains a policy; never raise it)`, () => {
    expect(CSP_LESS.length).toBeLessThanOrEqual(CSP_LESS_MAX);
  });
});

describe('header half: the portal\'s own pages, driven through the real routers', () => {
  // the harness row that drives each report-only route (its closed page and, where the bot answers, the page itself)
  const DRIVE = {
    '/h/:token': ['hub.closed', 'hub.page', 'hub.flushed', 'hub.wait', 'hub.wait.flushed'],
    '/q/:code': ['quiz.closed', 'quiz.page', 'quiz.flushed', 'quiz.flushed.again'],
    '/q/:code/class': ['quiz.class'],
    '/q/:code/schools': ['quiz.schools'],
    '/c/:token': ['challenge.closed'],
    '/k/:token': ['card.closed'],
    '/j/:code': ['classlink.closed'],
    '/quiz/join/:token': ['join.page', 'join.note'],
  };
  test('every report-only page has a driven row', () => {
    expect(PAGES.filter((p) => p[2] === 'report-only').map((p) => p[0]).sort()).toEqual(Object.keys(DRIVE).sort());
  });
  test.each(Object.entries(DRIVE))('%s carries the report-only header (switch on) and none with it off', async (route, names) => {
    for (const name of names) {
      const r = ROWS.find((x) => x[0] === name);
      const on = await run(r, { routerOpts: { childCspOn: () => true } });
      const off = await run(r, { routerOpts: { childCspOn: () => false } });
      expect([name, typeof on.headers['content-security-policy-report-only']]).toEqual([name, 'string']);
      expect([name, off.headers['content-security-policy-report-only'], off.headers['content-security-policy']]).toEqual([name, undefined, undefined]);
    }
  });
  test.each([
    ['/lib/:token', ['lib', 'wq', 'GET', '/lib/eyJrIjoibGliIn0.AbCdEfGhIjKlMnOpQrStUv', {}]],
    ['/wq-probe', ['probe', 'wq', 'GET', '/wq-probe', {}]],
  ])('%s: listed with no policy, and serves none (switch on)', async (route, r) => {
    const got = await run(r, { routerOpts: { childCspOn: () => true } });
    expect(got.status).toBe(200);
    expect(got.headers['content-security-policy-report-only']).toBeUndefined();
    expect(got.headers['content-security-policy']).toBeUndefined();
    expect(got.body).not.toMatch(/http-equiv="Content-Security-Policy"/i);
  });
});

describe('meta half: the relayed pages the bot draws', () => {
  const TOKEN = `eyJrIjoidGgifQ.${'A'.repeat(22)}`;
  const META = /<meta http-equiv="Content-Security-Policy" content="[^"]+">/;
  test.each([
    ['/quiz/teacher/:token', () => require('../../bot/shared/services/first-touch/teacher-home.page').buildShell({ token: TOKEN, lang: 'en' }).html],
    ['/m/:token', () => require('../../bot/shared/services/first-touch/maker.page').buildMakerPage({ token: TOKEN, lang: 'en' }).html],
    ['/quiz/go/:token', () => require('../../bot/shared/services/first-touch/go.page').buildRolePage({ t: TOKEN, lang: 'bi' }).html],
  ])('%s: the bot page carries its <meta> policy', (route, build) => {
    expect(PAGES.find((p) => p[0] === route)[2]).toBe('meta');
    expect(build()).toMatch(META);
  });
});

// ── relay census: a bot page relayed raw must carry the bot's own security headers, set BEFORE it is sent ──
// A route file that asks the bot client for `raw: true` and sends `out.bytes` relays the bot's page as is; the bot's
// security headers travel only if carryBotSecurity(res, out, …) (routes/edge-security-headers.js) runs before that
// send on the same handler. Order, not presence: a carry after the send is too late (the headers already went).
// RELAY_WITHOUT_CARRY lists today's relays that do not carry yet. It may only SHRINK (a relay that starts carrying
// leaves it); a NEW raw relay must carry before it can ship.
const ROUTES_DIR = path.join(__dirname, '..', 'routes');
const RELAY_WITHOUT_CARRY = ['first-touch.routes.js', 'quiz-go.routes.js', 'quiz-teacher.routes.js', 'teacher-report.routes.js', 'teacher-stories.routes.js'];
const RELAY_WITHOUT_CARRY_MAX = 5;

const SEND_RX = /\.send\(\s*out\.bytes\b/g;
const CARRY_RX = /\bcarryBotSecurity\(\s*res\s*,\s*out\s*,/g;
// where one handler's path starts: a route registration or a named function (the relay helper some files share)
const START_RX = /\brouter\.(?:get|post|put|patch|delete|all|use)\(|\bfunction\s+[A-Za-z_$][\w$]*\s*\(/g;

/** A route file's source → { relay, sends, bad: [{ at, why }] }: each raw send needs a carry earlier in its handler. */
function relayCheck(src) {
  const relay = /\braw:\s*true\b/.test(src) && SEND_RX.test(src);
  SEND_RX.lastIndex = 0;
  const starts = [...src.matchAll(START_RX)].map((m) => m.index);
  const carries = [...src.matchAll(CARRY_RX)].map((m) => m.index);
  const sends = relay ? [...src.matchAll(SEND_RX)].map((m) => m.index) : [];
  const bad = [];
  for (const at of sends) {
    const from = Math.max(-1, ...starts.filter((s) => s < at));
    const to = Math.min(src.length, ...starts.filter((s) => s > at));
    if (carries.some((c) => c > from && c < at)) continue;
    bad.push({ at: src.slice(0, at).split('\n').length, why: carries.some((c) => c > at && c < to) ? 'carry after send' : 'no carry' });
  }
  return { relay, sends: sends.length, bad };
}

describe('relay census: raw bot pages carry the bot\'s security headers before the send', () => {
  const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js')).sort();
  const census = Object.fromEntries(files.map((f) => [f, relayCheck(fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8'))]));

  test('the raw relays are exactly the listed ones plus those that carry (a new relay must carry)', () => {
    const relays = files.filter((f) => census[f].relay);
    expect(relays.filter((f) => census[f].bad.length && !RELAY_WITHOUT_CARRY.includes(f))).toEqual([]);
  });
  test('every listed relay is still a relay that does not carry (a fixed one leaves the list)', () => {
    expect(RELAY_WITHOUT_CARRY.filter((f) => !(census[f] && census[f].relay && census[f].bad.length))).toEqual([]);
  });
  test(`at most ${RELAY_WITHOUT_CARRY_MAX} (lower this number when a relay starts carrying; never raise it)`, () => {
    expect(RELAY_WITHOUT_CARRY.length).toBeLessThanOrEqual(RELAY_WITHOUT_CARRY_MAX);
  });
  test('a file that carries carries before every send (order, not presence)', () => {
    const carrying = files.filter((f) => census[f].relay && /\bcarryBotSecurity\(/.test(fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8')));
    expect(carrying.filter((f) => census[f].bad.length).map((f) => [f, census[f].bad])).toEqual([]);
  });

  describe('the checker itself', () => {
    const head = "const out = await callBot('GET', p, req, null, { raw: true });\n";
    test('carry, then send → good', () => {
      expect(relayCheck(`router.get('/a', async (req, res) => {\n${head}carryBotSecurity(res, out, { page: true });\nreturn res.status(200).send(out.bytes);\n});\n`).bad).toEqual([]);
    });
    test('send, then carry → bad ("carry after send")', () => {
      const got = relayCheck(`router.get('/a', async (req, res) => {\n${head}res.status(200).send(out.bytes);\ncarryBotSecurity(res, out, { page: true });\n});\n`);
      expect(got).toEqual({ relay: true, sends: 1, bad: [{ at: 3, why: 'carry after send' }] });
    });
    test('a carry in another handler does not count', () => {
      const got = relayCheck(`router.get('/a', async (req, res) => {\ncarryBotSecurity(res, out, {});\n});\nrouter.get('/b', async (req, res) => {\n${head}return res.send(out.bytes);\n});\n`);
      expect(got.bad).toEqual([{ at: 6, why: 'no carry' }]);
    });
    test('a shared relay helper: the carry inside it, before its send → good', () => {
      expect(relayCheck(`function relay(res, out) {\ncarryBotSecurity(res, out, {});\nres.status(out.status).send(out.bytes || Buffer.alloc(0));\n}\nrouter.get('/a', async (req, res) => {\n${head}return relay(res, out);\n});\n`).bad).toEqual([]);
    });
    test('no raw call → not a relay', () => {
      expect(relayCheck("router.get('/a', (req, res) => res.send(out.bytes));").relay).toBe(false);
    });
  });
});

// ── meta = header, per variant: every page module that builds a policy, every script/style variant it can serve ──
// A page sends its policy twice: the response header (the route sets the builder's `csp`) and a <meta> copy in the
// page (the edge relays only the bytes). For EVERY variant a builder can serve — each exported build*Page × its
// language × each option that changes a script or a style (the maker's addons, the teacher home's switch, …) — the
// two must agree: (a) script-src and style-src are the same in both; (b) each inline <script>'s and <style>'s sha256
// is in both; (c) the meta is the header minus `frame-ancestors` (header-only) and nothing else. A builder, an option
// key, an exported script/hash constant, an addon or a file setting the header that this list does not know is a red
// row naming it: add its variants here first.
describe('meta = header for every variant of every page that builds a policy', () => {
  const crypto = require('crypto');
  const FT = '../../bot/shared/services/first-touch';
  const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
  const unesc = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const directives = (p) => Object.fromEntries(String(p).split(';').map((d) => d.trim()).filter(Boolean)
    .map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v.join(' ')]; }));
  const metaOf = (html) => {
    const all = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g)];
    return all.length === 1 ? unesc(all[0][1]) : null;
  };
  const BOT = ['92', '300', '0000000'].join('');   // a dialable bot number's shape, built from parts

  /** The invariant on one served page: header policy + html → [] or the broken lines. */
  function agree(header, html) {
    const bad = [];
    const meta = metaOf(html);
    if (meta == null) return ['no single <meta> policy'];
    const h = directives(header);
    const m = directives(meta);
    if (h['frame-ancestors'] !== "'none'") bad.push("header lacks frame-ancestors 'none'");
    const { 'frame-ancestors': _fa, ...hRest } = h;
    if (JSON.stringify(hRest) !== JSON.stringify(m)) bad.push(`meta != header minus frame-ancestors: ${meta} | ${header}`);
    if (h['script-src'] !== m['script-src']) bad.push('script-src differs');
    if (h['style-src'] !== m['style-src']) bad.push('style-src differs');
    for (const x of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      const s = `'sha256-${sha(x[1])}'`;
      if (!String(h['script-src'] || '').split(' ').includes(s) || !String(m['script-src'] || '').split(' ').includes(s)) bad.push(`inline script ${s} not in both`);
    }
    for (const x of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
      const s = `'sha256-${sha(x[1])}'`;
      if (!String(h['style-src'] || '').split(' ').includes(s) || !String(m['style-src'] || '').split(' ').includes(s)) bad.push(`inline style ${s} not in both`);
    }
    if (/<script(?![^>]*\btype="application\/json")\s[^>]*>/.test(html.replace(/<script>/g, ''))) bad.push('a <script> with attributes that is not data');
    if (/<style\s[^>]*>/.test(html)) bad.push('a <style> with attributes');
    return bad;
  }

  const cross = (...lists) => lists.reduce((acc, l) => acc.flatMap((a) => l.map((b) => [...a, b])), [[]]);
  const Tour = () => require(`${FT}/tour.page`);
  const Cards = () => require(`${FT}/cards.page`);
  const ADDONS = {
    none: () => [],
    'tour.hidden': () => [Tour().tourAddon({ lang: 'en', show: false })],
    'tour.shown': () => [Tour().tourAddon({ lang: 'en', show: true })],
    'tour+cards.nobot': () => [Tour().tourAddon({ lang: 'en', show: false }), Cards().cardsAddon({ lang: 'en', bot: null })],
    'tour+cards': () => [Tour().tourAddon({ lang: 'en', show: true }), Cards().cardsAddon({ lang: 'en', bot: BOT })],
    'cards.ur': () => [Cards().cardsAddon({ lang: 'ur', bot: BOT })],
  };
  const TH_TOKEN = `eyJrIjoidGgifQ.${'A'.repeat(22)}`;
  const TREE = { 3: { sci: ['Parts of a plant'] } };

  // module → { builders: { name: { keys: its option keys, variants: () => [[label, built]] } }, constants: [...] }
  const MODULES = {
    'teacher-home.page': {
      constants: ['SCRIPT', 'SCRIPT_HASH'],
      builders: {
        buildShell: { keys: ['token', 'lang', 'switchTo', 'asked'],
          variants: (P) => cross(['en', 'ur'], [null, 'en', 'ur'], [null, 'en']).map(([lang, switchTo, asked]) => [`${lang}/${switchTo}/${asked}`, P.buildShell({ token: TH_TOKEN, lang, switchTo, asked })]) },
      },
    },
    'maker.page': {
      constants: ['SCRIPT', 'SCRIPT_HASH'],
      builders: {
        buildMakerPage: { keys: ['token', 'lang', 'switchTo', 'via', 'tree', 'pf', 'ready', 'view', 'addons'],
          variants: (P) => cross(['en', 'ur'], Object.keys(ADDONS), [null, 'ur'], ['empty', 'tree', 'ready', 'view']).map(([lang, a, switchTo, state]) => [`${lang}/${a}/${switchTo}/${state}`,
            P.buildMakerPage({ token: TH_TOKEN, lang, switchTo, addons: ADDONS[a](), tree: state === 'empty' ? {} : TREE,
              ...(state === 'ready' ? { ready: { grade: '3', subject: 'sci', topic: 'Parts of a plant', qlang: 'en', message: 'm', preview: 'p', total: 5, shareCodeId: 'c1' } } : {}),
              ...(state === 'view' ? { view: { screen: 'topic', grade: '3', subject: 'sci' } } : {}) })]) },
        buildMessagePage: { keys: ['lang', 'id', 'tap'],
          variants: (P) => cross(['en', 'ur'], ['mk.error', 'mk.stale'], [null, { href: `https://wa.me/${BOT}?text=quiz`, text: 'WhatsApp' }]).map(([lang, id, tap]) => [`${lang}/${id}/${tap ? 'tap' : '-'}`, P.buildMessagePage({ lang, id, tap })]) },
      },
    },
    'go.page': {
      constants: ['_CSS', '_SCRIPT', 'csp'],
      builders: {
        buildRolePage: { keys: ['t', 'lang', 'extra', 'bot'],
          variants: (P) => cross(['bi', 'ur', 'en'], [null, BOT], ['', '<p class="note">row</p>']).map(([lang, bot, extra]) => [`${lang}/${bot ? 'bot' : '-'}/${extra ? 'extra' : '-'}`, P.buildRolePage({ t: TH_TOKEN, lang, bot, extra })]) },
        buildPickPage: { keys: ['t', 'lang', 'kids', 'bot'],
          variants: (P) => cross(['bi', 'ur'], [[], [{ pick: 'p1', first: 'Sana Testwala' }], [{ pick: 'p1', first: 'Sana Testwala' }, { pick: 'p2', first: 'Ali Testwala' }]], [null, BOT])
            .map(([lang, kids, bot]) => [`${lang}/${kids.length}/${bot ? 'bot' : '-'}`, P.buildPickPage({ t: TH_TOKEN, lang, kids, bot })]) },
        buildMessagePage: { keys: ['id', 'lang', 'bot'],
          variants: (P) => cross(['go.error', 'go.stale', 'go.family'], ['bi', 'ur'], [null, BOT]).map(([id, lang, bot]) => [`${id}/${lang}/${bot ? 'bot' : '-'}`, P.buildMessagePage({ id, lang, bot })]) },
      },
    },
  };
  // the addon providers the maker route feeds buildMakerPage (each one's script/style is in ADDONS above)
  const KNOWN_ADDONS = ['Tour.tourAddon', 'Cards.cardsAddon'];
  // the files that set a Content-Security-Policy header, each from one of the builders above
  const HEADER_FILES = ['bot/shared/services/first-touch/go.routes.js', 'bot/shared/services/first-touch/maker.routes.js',
    'bot/shared/services/first-touch/teacher-home.routes.js', 'dashboard/routes/first-touch.routes.js', 'dashboard/routes/quiz-go.routes.js',
    'dashboard/routes/quiz-teacher.routes.js'];
  // the modules whose pages carry a <meta> policy
  const META_FILES = Object.keys(MODULES).map((m) => `bot/shared/services/first-touch/${m}.js`);

  const REPO = path.join(__dirname, '..', '..');
  const keysOf = (fn) => {
    const m = /^function\s*[A-Za-z_$][\w$]*\s*\(\s*\{([^}]*)\}/.exec(fn.toString());
    return m ? m[1].split(',').map((k) => k.split('=')[0].trim()).filter(Boolean) : ['<not a { … } option list>'];
  };
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === 'tests' || e.name.startsWith('.')) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.js') && !e.name.endsWith('.test.js') ? [p] : []);
  });
  const rel = (p) => path.relative(REPO, p).split(path.sep).join('/');

  test.each(Object.keys(MODULES))('%s: every build*Page and option key, and every exported script/hash constant, is known', (name) => {
    const P = require(`${FT}/${name}`);
    const m = MODULES[name];
    const builders = Object.keys(P).filter((k) => typeof P[k] === 'function' && /^build/.test(k));
    expect(builders.filter((b) => !m.builders[b]).map((b) => `unknown builder ${name}.${b}`)).toEqual([]);
    expect(Object.keys(m.builders).filter((b) => !builders.includes(b)).map((b) => `stale builder ${name}.${b}`)).toEqual([]);
    for (const b of builders) {
      expect(keysOf(P[b]).filter((k) => !m.builders[b].keys.includes(k)).map((k) => `unknown option ${name}.${b}({ ${k} })`)).toEqual([]);
    }
    const consts = Object.keys(P).filter((k) => /SCRIPT|HASH|CSS|^csp$/.test(k));
    expect(consts.filter((k) => !m.constants.includes(k)).map((k) => `unknown constant ${name}.${k}`)).toEqual([]);
    if (P.SCRIPT_HASH) expect(P.SCRIPT_HASH).toBe(sha(P.SCRIPT));
  });

  test.each(Object.entries(MODULES).flatMap(([name, m]) => Object.keys(m.builders).map((b) => [`${name}.${b}`, name, b])))('%s: header and meta agree on every variant', (_, name, b) => {
    const P = require(`${FT}/${name}`);
    const variants = MODULES[name].builders[b].variants(P);
    expect(variants.length).toBeGreaterThan(1);
    const seen = new Set();
    for (const [label, built] of variants) {
      expect([label, typeof built.csp, typeof built.html]).toEqual([label, 'string', 'string']);
      expect([label, agree(built.csp, built.html)]).toEqual([label, []]);
      seen.add(directives(built.csp)['script-src'] || '-');
    }
    if (P.SCRIPT_HASH && b !== 'buildMessagePage') expect([...seen].every((s) => s.includes(`'sha256-${P.SCRIPT_HASH}'`))).toBe(true);
  });

  test('the maker\'s addons: every provider the route feeds the page is known (its script and style are varied above)', () => {
    const src = fs.readFileSync(path.join(REPO, 'bot/shared/services/first-touch/maker.routes.js'), 'utf8');
    const used = [...src.matchAll(/addons(?:\.push\(|\s*=\s*\[)\s*([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\(/g)].map((x) => x[1]);
    expect(used.length).toBeGreaterThan(0);
    expect([...new Set(used)].filter((u) => !KNOWN_ADDONS.includes(u)).map((u) => `unknown addon ${u}`)).toEqual([]);
    // an addon whose script differs from the page's is allowed by its own hash (and a second one with it)
    const both = require(`${FT}/maker.page`).buildMakerPage({ token: TH_TOKEN, addons: ADDONS['tour+cards']() });
    expect((directives(both.csp)['script-src'].match(/'sha256-/g) || []).length).toBe(3);
  });

  test('every file that sets a Content-Security-Policy header or writes a <meta> policy is known', () => {
    const files = [...walk(path.join(REPO, 'bot', 'shared')), ...walk(path.join(REPO, 'dashboard', 'routes'))];
    const header = files.filter((f) => /['"]Content-Security-Policy['"]\s*:/.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
    const meta = files.filter((f) => /http-equiv="Content-Security-Policy"/.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
    expect(header.filter((f) => !HEADER_FILES.includes(f)).map((f) => `unknown header file ${f}`)).toEqual([]);
    expect(HEADER_FILES.filter((f) => !header.includes(f)).map((f) => `stale header file ${f}`)).toEqual([]);
    expect(meta.filter((f) => !META_FILES.includes(f)).map((f) => `unknown meta file ${f}`)).toEqual([]);
    expect(META_FILES.filter((f) => !meta.includes(f)).map((f) => `stale meta file ${f}`)).toEqual([]);
  });

  test.each([
    ['/m/:token (edge error page)', () => require('../routes/first-touch.routes').createFirstTouchRouter, `/m/${TH_TOKEN}`],
    ['/quiz/go/:token (edge error page)', () => require('../routes/quiz-go.routes').createQuizGoRouter, `/quiz/go/${TH_TOKEN}`],
    ['/quiz/teacher/:token (edge error page)', () => require('../routes/quiz-teacher.routes').createQuizTeacherRouter, `/quiz/teacher/${TH_TOKEN}`],
  ])('%s: the portal\'s own page — header and meta agree on the wire', async (_, make, url) => {
    const express = require('express');
    const http = require('http');
    const app = express();
    app.use(make()({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async () => new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } }), logEvent: () => {} }));
    const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      for (const lang of ['en', 'ur']) {
        const got = await new Promise((resolve, reject) => {
          http.get({ host: '127.0.0.1', port: srv.address().port, path: url, headers: { 'accept-language': lang } }, (res) => {
            const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, csp: res.headers['content-security-policy'], html: Buffer.concat(c).toString('utf8') }));
          }).on('error', reject);
        });
        expect([lang, got.status >= 500, typeof got.csp]).toEqual([lang, true, 'string']);
        expect([lang, agree(got.csp, got.html)]).toEqual([lang, []]);
      }
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  describe('the checker itself', () => {
    const H = "default-src 'none'; style-src 'sha256-S'; script-src 'sha256-X'; frame-ancestors 'none'";
    const page = (meta, body) => `<meta http-equiv="Content-Security-Policy" content="${meta}">${body}`;
    test('a script not in the policy → red', () => {
      expect(agree(H, page("default-src 'none'; style-src 'sha256-S'; script-src 'sha256-X'", '<script>a()</script>')).join()).toContain('inline script');
    });
    test('a meta that differs beyond frame-ancestors → red', () => {
      expect(agree(H, page("default-src 'none'; style-src 'sha256-S'; script-src 'sha256-Y'", '')).join()).toContain('script-src differs');
    });
    test('a header without frame-ancestors → red', () => {
      expect(agree("default-src 'none'", page("default-src 'none'", ''))).toEqual(["header lacks frame-ancestors 'none'"]);
    });
    test('agreeing pair with hashed script and style → green', () => {
      const s = sha('b{}'); const x = sha('a()');
      const h = `default-src 'none'; style-src 'sha256-${s}'; script-src 'sha256-${x}'; frame-ancestors 'none'`;
      expect(agree(h, page(h.replace("; frame-ancestors 'none'", ''), '<style>b{}</style><script>a()</script>'))).toEqual([]);
    });
  });
});
