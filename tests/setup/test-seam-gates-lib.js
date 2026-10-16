/**
 * Test-seam gates: the pure readers shared by
 *   repo-mocks-partial.test.js, repo-spy-failure-only.test.js, repo-seam-tests.test.js,
 *   virtual-mock-of-existing-module.test.js (its jest.doMock scan), fresh-profile-pages.test.js, copy-deck-lift.test.js.
 *
 * Every reader takes source text (or plain objects) and returns plain data, so each gate's rule is executed on
 * in-memory inputs in its own test file before it is run over the tree.
 *
 * The source reader is code-aware: strings, template literals, comments and regex literals are masked before
 * parentheses are matched or `describe(` is looked for, so a `)` inside a string never ends a call early and a
 * `jest.mock(` inside a comment is never read as a call.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const rel = (p) => path.relative(REPO, p).split(path.sep).join('/');

// ---------------------------------------------------------------------------------------------- the source mask

const REGEX_BEFORE = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

/**
 * The text with every comment blanked to spaces and every string, template and regex body blanked to `_`
 * (quotes and slashes kept, newlines kept). Same length as the input, so an index in the mask is an index in the text.
 */
function codeMask(text) {
  const src = String(text);
  const out = src.split('');
  const blank = (from, to, ch) => { for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ch; };
  let i = 0;
  let lastSig = '';
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      blank(i, stop, ' ');
      i = stop;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      blank(i, stop, ' ');
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      blank(i + 1, j, '_');
      i = j + 1;
      lastSig = c;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          // a template expression: skip to its closing brace (nested braces counted, inner strings skipped)
          let depth = 1;
          j += 2;
          while (j < src.length && depth > 0) {
            const e = src[j];
            if (e === "'" || e === '"' || e === '`') {
              const q = e;
              j += 1;
              while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
            } else if (e === '{') depth += 1;
            else if (e === '}') depth -= 1;
            j += 1;
          }
          continue;
        }
        j += 1;
      }
      blank(i + 1, j, '_');
      i = j + 1;
      lastSig = '`';
      continue;
    }
    if (c === '/' && (lastSig === '' || REGEX_BEFORE.has(lastSig) || /\b(return|typeof|case|in|of)$/.test(src.slice(Math.max(0, i - 8), i).trimEnd()))) {
      let j = i + 1;
      let cls = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
        j += 1;
      }
      blank(i + 1, j, '_');
      i = j + 1;
      lastSig = '/';
      continue;
    }
    if (!/\s/.test(c)) lastSig = /[A-Za-z0-9_$]/.test(c) ? 'w' : c;
    i += 1;
  }
  return out.join('');
}

/** The index of the `)` that closes the `(` at `open`, read on a mask; -1 when unbalanced. */
function closeParen(mask, open) {
  let depth = 0;
  for (let i = open; i < mask.length; i += 1) {
    if (mask[i] === '(') depth += 1;
    else if (mask[i] === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** The first argument of a call (the text after `(`): { literal } for a quoted string, { ident } for a bare name, else null. */
function firstArg(text, open) {
  const rest = text.slice(open + 1);
  const lit = /^\s*(['"`])([^'"`\n]*)\1/.exec(rest);
  if (lit) return { literal: lit[2] };
  const id = /^\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(rest);
  if (id) return { ident: id[1] };
  return null;
}

/** `const|let|var NAME = '<string>'` bindings anywhere in the file → { NAME: string } (first one wins). */
function constStrings(text) {
  const out = {};
  const rx = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"\n]*)\2/g;
  for (let m = rx.exec(text); m; m = rx.exec(text)) if (!(m[1] in out)) out[m[1]] = m[3];
  return out;
}

/**
 * Every call to one of `names` (e.g. ['jest.mock', 'jest.doMock']) in code (never in a comment or string):
 * [{ name, start, open, end, spec, call }] — `spec` the first argument as a string (a literal, or a const string the
 * file binds) or null; `call` the call's full text, parentheses balanced.
 */
function calls(text, names, mask = codeMask(text)) {
  const consts = constStrings(text);
  const esc = names.map((n) => n.replace(/[.$]/g, (c) => `\\${c}`)).join('|');
  const rx = new RegExp(`(^|[^\\w$.])(${esc})\\s*\\(`, 'g');
  const out = [];
  for (let m = rx.exec(mask); m; m = rx.exec(mask)) {
    const start = m.index + m[1].length;
    const open = m.index + m[0].length - 1;
    const end = closeParen(mask, open);
    if (end < 0) continue;
    const a = firstArg(text, open);
    const spec = a ? (a.literal !== undefined ? a.literal : (Object.prototype.hasOwnProperty.call(consts, a.ident) ? consts[a.ident] : null)) : null;
    out.push({ name: m[2], start, open, end, spec, call: text.slice(start, end + 1) });
  }
  return out;
}

/** Every `describe(…)` (also .skip/.only/.each(…)(…)) with a readable title: [{ title, start, end }]. */
function describeSpans(text, mask = codeMask(text)) {
  const out = [];
  const rx = /(^|[^\w$.])(describe(?:\.(?:skip|only))?)\s*\(/g;
  for (let m = rx.exec(mask); m; m = rx.exec(mask)) {
    const open = m.index + m[0].length - 1;
    const end = closeParen(mask, open);
    if (end < 0) continue;
    const a = firstArg(text, open);
    out.push({ title: a && a.literal !== undefined ? a.literal : '', start: m.index + m[1].length, end });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- tree helpers

function walk(dir, keep, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, keep, out);
    else if (keep(e.name, full)) out.push(full);
  }
  return out;
}

const isTestFile = (name, full) => /\.(test|spec)\.js$/.test(name) || (name.endsWith('.js') && full.includes(`${path.sep}__tests__${path.sep}`));
const testFiles = (roots) => roots.flatMap((r) => walk(path.join(REPO, r), isTestFile));

/** { 'repo/relative/dir': n } from [{ file, n }]. */
function byDir(perFile) {
  const out = {};
  for (const { file, n } of perFile) {
    if (!n) continue;
    const dir = rel(path.dirname(file));
    out[dir] = (out[dir] || 0) + n;
  }
  return out;
}

/** The shrink-only check for a { dir: count } allowlist: new, up, down and clean all fail; equal passes. */
function countRatchet(hits, allow, what) {
  const out = [];
  for (const dir of [...new Set([...Object.keys(hits), ...Object.keys(allow)])].sort()) {
    const now = hits[dir] || 0;
    const ok = Object.prototype.hasOwnProperty.call(allow, dir) ? allow[dir] : null;
    if (ok === null) out.push(`NEW: ${dir} has ${now} ${what}.`);
    else if (now > ok) out.push(`UP: ${dir} has ${now} ${what}, the allowlist allows ${ok}.`);
    else if (now < ok) out.push(now === 0 ? `CLEAN: ${dir} has none now. Remove its entry from the allowlist.` : `DOWN: ${dir} has ${now}, the allowlist says ${ok}. Lower it to ${now}.`);
  }
  return out;
}

/** The shrink-only check for a list allowlist: an item found and not listed fails; a listed item no longer found fails. */
function listRatchet(found, allowed, what) {
  const f = new Set(found);
  const a = new Set(allowed);
  const out = [];
  for (const x of [...f].sort()) if (!a.has(x)) out.push(`NEW: ${x} ${what}.`);
  for (const x of [...a].sort()) if (!f.has(x)) out.push(`CLEAN: ${x} is fixed or gone. Remove it from the allowlist.`);
  return out;
}

// ------------------------------------------------------------------------------- gate 1: repo mocks are partial

const isRepoSpec = (spec) => typeof spec === 'string' && /\.repo(\.js)?$/.test(spec.split('/').pop());

/** The `jest.mock('<…>.repo', …)` calls in one file whose factory does not hold `jest.requireActual(`: [spec]. */
function wholeRepoMocks(text) {
  return calls(text, ['jest.mock'])
    .filter((c) => isRepoSpec(c.spec))
    .filter((c) => !/jest\.requireActual\s*\(/.test(c.call))
    .map((c) => c.spec);
}

// ------------------------------------------------------------------- gate 2: a repo is spied on only in a failure

const FAILURE_TITLE = /failure|unavailable/i;

/**
 * The `jest.spyOn(<repo>, …)` calls in one file outside every describe titled …failure… or …unavailable…: [line].
 * `<repo>` is `require('<…>.repo')` / `jest.requireActual('<…>.repo')` written inline, or a name the file binds to one.
 */
function repoSpiesOutsideFailure(text) {
  const mask = codeMask(text);
  const consts = constStrings(text);
  const specOf = (s) => (/^['"`]/.test(s) ? s.slice(1, -1) : (consts[s] !== undefined ? consts[s] : null));
  const REQ = String.raw`(?:jest\.requireActual|require)\s*\(\s*(['"][^'"]+['"]|[A-Za-z_$][\w$]*)\s*\)`;
  const repoNames = new Set();
  const bindRx = new RegExp(String.raw`(?:\b(?:const|let|var)\s+|(?:^|[;\n{(,]\s*))([A-Za-z_$][\w$]*)\s*=\s*${REQ}`, 'g');
  for (let m = bindRx.exec(text); m; m = bindRx.exec(text)) {
    if (mask[m.index + m[0].length - 1] !== ')') continue;
    if (isRepoSpec(specOf(m[2]))) repoNames.add(m[1]);
  }
  const spans = describeSpans(text, mask).filter((d) => FAILURE_TITLE.test(d.title));
  const out = [];
  for (const c of calls(text, ['jest.spyOn'], mask)) {
    const target = text.slice(c.open + 1, c.end).trim();
    const inline = new RegExp(`^${REQ}`).exec(target);
    const id = /^([A-Za-z_$][\w$]*)\s*,/.exec(target);
    const isRepo = inline ? isRepoSpec(specOf(inline[1])) : Boolean(id && repoNames.has(id[1]));
    if (!isRepo) continue;
    if (spans.some((d) => d.start < c.start && c.end < d.end)) continue;
    out.push(text.slice(0, c.start).split('\n').length);
  }
  return out;
}

// -------------------------------------------------------------------------------- gate 3: a seam test per seam

/** The repo modules a source requires by a relative path: ['child-bind-codes.repo', …] (sorted, unique). */
function relativeRepoRequires(text) {
  const out = new Set();
  for (const c of calls(text, ['require'])) {
    if (c.spec && c.spec.startsWith('.') && isRepoSpec(c.spec)) out.add(c.spec.split('/').pop().replace(/\.js$/, ''));
  }
  return [...out].sort();
}

/** Whether a test file's NAME can be the seam test of module `<m>.js`: `<m>-seam.test.js` or `<m>-<more>-seam.test.js`. */
function isSeamTestName(fileName, moduleBase) {
  const m = moduleBase.replace(/\.js$/, '');
  return fileName === `${m}-seam.test.js` || (fileName.startsWith(`${m}-`) && fileName.endsWith('-seam.test.js'));
}

/** Whether a test file's TEXT loads the real `<repo>` (a require or requireActual) and never jest.mock/doMocks it. */
function seamTestLoadsRealRepo(text, repoBase) {
  const hit = (c) => typeof c.spec === 'string' && c.spec.split('/').pop().replace(/\.js$/, '') === repoBase;
  const mask = codeMask(text);
  if (calls(text, ['jest.mock', 'jest.doMock'], mask).some(hit)) return false;
  return calls(text, ['require', 'jest.requireActual'], mask).some(hit);
}

/**
 * The (module, repo) seams without a seam test: ['<module> > <repo>'].
 * modules: [{ id, base, text }]; tests: [{ name, text }].
 */
function seamsWithoutTest(modules, tests) {
  const out = [];
  for (const mod of modules) {
    for (const repo of relativeRepoRequires(mod.text)) {
      const ok = tests.some((t) => isSeamTestName(t.name, mod.base) && seamTestLoadsRealRepo(t.text, repo));
      if (!ok) out.push(`${mod.id} > ${repo}`);
    }
  }
  return out.sort();
}

// --------------------------------------------------------------------------- gate 4: doMock of an existing module

const existsAsModule = (p) => ['', '.js', '.json', `${path.sep}index.js`].some((ext) => fs.existsSync(p + ext));
const isVirtualCall = (call) => /\{\s*virtual\s*:\s*true\s*\}\s*\)$/.test(call);
/** The one doMock spec allowed to be virtual whatever the tree holds: the optional native image package. */
const DOMOCK_ALLOWED = new Set(['sharp']);

/** The `jest.doMock(<relative>, …, { virtual: true })` calls in one file whose target exists: [spec]. */
function virtualDoMocksOfExisting(file, text, existsFn = existsAsModule) {
  return calls(text, ['jest.doMock'])
    .filter((c) => c.spec && !DOMOCK_ALLOWED.has(c.spec) && c.spec.startsWith('.') && isVirtualCall(c.call))
    .filter((c) => existsFn(path.resolve(path.dirname(file), c.spec)))
    .map((c) => c.spec);
}

// ------------------------------------------------------------------------------ gate 5: fresh-profile per page

const FRESH = /fresh[ -]profile/i;

/**
 * The navigable pages: each bot/shared/templates/*.page.js (id `<name>.page`), and each top-level
 * `function render<Name>Page(` in dashboard/routes/web-quiz*.js (id `render<Name>Page`, with the /wq/ scripts that
 * renderer alone loads as its `scripts`).
 * templates: ['class-round.page.js', …]; routes: [{ text }].
 */
function navigablePages(templates, routes) {
  const pages = templates.filter((n) => n.endsWith('.page.js')).map((n) => ({ id: n.replace(/\.js$/, ''), scripts: [] }));
  const renderers = [];
  for (const r of routes) {
    const rx = /^(?:async\s+)?function\s+(render\w*Page)\s*\(/gm;
    const found = [];
    for (let m = rx.exec(r.text); m; m = rx.exec(r.text)) found.push({ id: m[1], at: m.index });
    found.forEach((f, i) => {
      const nextTop = r.text.slice(f.at + 1).search(/^(?:async\s+)?function\s|^const\s|^module\.exports/m);
      const body = r.text.slice(f.at, nextTop < 0 ? undefined : f.at + 1 + nextTop);
      const scripts = [...new Set([...body.matchAll(/\/wq\/([\w-]+\.js)/g)].map((m) => m[1]))];
      renderers.push({ id: f.id, scripts, i });
    });
  }
  for (const r of renderers) {
    const own = r.scripts.filter((s) => renderers.filter((o) => o.scripts.includes(s)).length === 1);
    pages.push({ id: r.id, scripts: own });
  }
  return pages.sort((a, b) => a.id.localeCompare(b.id));
}

/** Whether one test text names the page (its id, or a script only that page loads) and carries the fresh-profile marker. */
function coversFreshProfile(text, page) {
  if (!FRESH.test(text)) return false;
  if (text.includes(page.id)) return true;
  return page.scripts.some((s) => new RegExp(`(^|[^\\w-])${s.replace(/[.]/g, '\\.')}`).test(text));
}

/** The page ids no test covers with a fresh profile. tests: [text]. */
function pagesWithoutFreshProfile(pages, tests) {
  return pages.filter((p) => !tests.some((t) => coversFreshProfile(t, p))).map((p) => p.id).sort();
}

/**
 * The gate's verdict. pages: navigablePages(); tests: [text]; allowed: the allowlist's `pages`.
 * failures: a page neither listed nor tested (NEW), and a listed page that no longer exists (GONE).
 * cleans: a listed page that now has its test; the gate warns and passes, so the PR adding the test need not edit the list.
 */
function freshProfileVerdict(pages, tests, allowed) {
  const ids = new Set(pages.map((p) => p.id));
  const without = new Set(pagesWithoutFreshProfile(pages, tests));
  const a = new Set(allowed);
  const failures = [];
  const cleans = [];
  for (const x of [...without].sort()) if (!a.has(x)) failures.push(`NEW: ${x} has no fresh-profile test. Add one (a test that names the page and says "fresh profile").`);
  for (const x of [...a].sort()) {
    if (!ids.has(x)) failures.push(`GONE: ${x} is no longer a page. Remove it from fresh-profile-pages.allowlist.json.`);
    else if (!without.has(x)) cleans.push(`CLEAN: remove ${x} from fresh-profile-pages.allowlist.json`);
  }
  return { failures, cleans };
}

// -------------------------------------------------------------------------------------------- gate 6: copy gap

const camel = (s) => s.replace(/[_-]+([a-z0-9])/g, (_, c) => c.toUpperCase());
const pascal = (s) => { const c = camel(s); return c.charAt(0).toUpperCase() + c.slice(1); };

/** Where a deck key's lift is looked for, in order. */
function liftNames(key) {
  const parts = key.split('.');
  if (parts[0] === 'bot') {
    const tail = parts.slice(1).join('_');
    return [`jugnu${pascal(tail)}`, camel(tail)];
  }
  const last = parts[parts.length - 1];
  return [...new Set([camel(`${parts[parts.length - 2]}_${last}`), camel(last)])];
}

/** A lift's value as text: a string as is; a function called with `{param}` for each parameter. */
function liftText(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'function') {
    const src = v.toString();
    const m = /^\s*(?:function[^(]*)?\(?([^)=]*)\)?\s*=>|^\s*function[^(]*\(([^)]*)\)/.exec(src);
    const params = ((m && (m[1] || m[2])) || '').split(',').map((s) => s.trim()).filter(Boolean);
    return String(v(...params.map((p) => `{${p}}`)));
  }
  if (v && typeof v === 'object' && (typeof v.en === 'string' || typeof v.ur === 'string')) return null;
  return null;
}

/**
 * Where a template lifts a deck key, from its own source:
 *   - a property line ending in a comment that names the key (`cardTitle: '…', // jg.round.card_title`) → that
 *     property of the exported table holding it ({ prop });
 *   - a comment that names the key right above `const NAME = {` (`// wa.t.fwd_text …` over `const FWD = {`) → the
 *     exported NAME as a whole ({ whole: NAME });
 *   - otherwise, when the source names the key or its area with a star (`jg.t.*`) and exports `T`: T under the
 *     camelCase lift names ({ guess: true }).
 * null when the template does not claim the key.
 */
function liftSite(source, key) {
  const k = key.replace(/\./g, '\\.');
  const prop = new RegExp(`^\\s*([A-Za-z_$][\\w$]*)\\s*:.*//\\s*${k}(?![\\w.])`, 'm').exec(source);
  if (prop) return { prop: prop[1] };
  const whole = new RegExp(`//[^\\n]*\\b${k}(?![\\w.])[^\\n]*\\n\\s*const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*\\{`).exec(source);
  if (whole) return { whole: whole[1] };
  if (new RegExp(`(^|[^\\w.])${k}(?![\\w])`).test(source)) return { guess: true };
  const area = key.split('.').slice(0, -1).join('.');
  if (source.includes(`${area}.*`)) return { guess: true };
  return null;
}

/** The { en, ur } a template lifts for a site, from its exports; null when the site names nothing it exports. */
function liftFrom(exportsObj, site, key) {
  const tables = Object.values(exportsObj || {}).filter((v) => v && typeof v === 'object' && v.en && typeof v.en === 'object');
  const pick = (table, name) => ({ en: table.en[name], ...(table.ur && Object.prototype.hasOwnProperty.call(table.ur, name) ? { ur: table.ur[name] } : {}) });
  if (site.prop) {
    const t = tables.find((x) => Object.prototype.hasOwnProperty.call(x.en, site.prop));
    return t ? pick(t, site.prop) : null;
  }
  if (site.whole) {
    const w = exportsObj && exportsObj[site.whole];
    return w && (typeof w.en === 'string' || typeof w.en === 'function') ? { en: w.en, ...(w.ur !== undefined ? { ur: w.ur } : {}) } : null;
  }
  const T = exportsObj && exportsObj.T;
  if (!T || !T.en) return null;
  const name = liftNames(key).find((n) => Object.prototype.hasOwnProperty.call(T.en, n));
  return name ? pick(T, name) : null;
}

/**
 * The state of every checked deck key: { key: 'same' | 'missing' | 'drift:en' | 'drift:ur' | 'drift:en+ur' | 'missing:ur' }.
 *   - a key is live when it is neither `retired` nor `held` (_meta: those are rendered or sent by no surface);
 *     the deck has no other live/draft marker (every key carries a `switch`), so every live key is in scope;
 *   - a live `bot.*` key is a WhatsApp line: its lift is UX_STRINGS[`jugnu<Tail>`] or UX_STRINGS[`<tail>`]
 *     (camelCase of everything after `bot.`), as { en, ur };
 *   - any other live key is checked when a template under bot/shared/templates claims it (liftSite); a key claimed
 *     by an explicit comment is read there first, then the claiming template's T, then any template's T (one card's
 *     words can sit in the page that draws it);
 *   - every other key (the child pages under dashboard/public/wq, the statement) is outside this gate.
 * EN is always compared; UR when the deck's UR does not say DRAFT. A function lift is called with `{param}` per
 * parameter, so `(name) => \`${name}'s turn\`` reads `{name}'s turn`.
 * deck: the parsed copy.v2.json; ux: UX_STRINGS; templates: [{ id, source, exports }].
 */
function copyStates(deck, ux, templates) {
  const out = {};
  const compare = (key, lift) => {
    if (!lift || lift.en === undefined) return 'missing';
    const bad = [];
    if (liftText(lift.en) !== deck[key].en) bad.push('en');
    const urDeck = deck[key].ur;
    if (typeof urDeck === 'string' && !/DRAFT/.test(urDeck)) {
      if (lift.ur === undefined) return bad.length ? `drift:${bad.join('+')}` : 'missing:ur';
      if (liftText(lift.ur) !== urDeck) bad.push('ur');
    }
    return bad.length ? `drift:${bad.join('+')}` : 'same';
  };
  for (const [key, entry] of Object.entries(deck)) {
    if (key === '_meta' || !entry || entry.retired || entry.held) continue;
    if (key.startsWith('bot.')) {
      const name = liftNames(key).find((n) => ux && Object.prototype.hasOwnProperty.call(ux, n));
      out[key] = compare(key, name ? ux[name] : null);
      continue;
    }
    const sites = templates.map((t) => ({ t, site: liftSite(t.source, key) })).filter((x) => x.site);
    if (!sites.length) continue;
    sites.sort((a, b) => Number(Boolean(a.site.guess)) - Number(Boolean(b.site.guess)));
    let lift = null;
    for (const { t, site } of sites) { lift = liftFrom(t.exports, site, key); if (lift) break; }
    // a claimed key a sibling template draws for it (the week card's words live in the Jugnu tab's T)
    for (const name of liftNames(key)) {
      if (lift) break;
      const t = templates.find((x) => x.exports && x.exports.T && x.exports.T.en && Object.prototype.hasOwnProperty.call(x.exports.T.en, name));
      if (t) lift = liftFrom(t.exports, { prop: name }, key);
    }
    out[key] = compare(key, lift);
  }
  return out;
}

module.exports = {
  REPO,
  rel,
  codeMask,
  closeParen,
  constStrings,
  calls,
  describeSpans,
  walk,
  testFiles,
  byDir,
  countRatchet,
  listRatchet,
  isRepoSpec,
  wholeRepoMocks,
  repoSpiesOutsideFailure,
  relativeRepoRequires,
  isSeamTestName,
  seamTestLoadsRealRepo,
  seamsWithoutTest,
  existsAsModule,
  isVirtualCall,
  DOMOCK_ALLOWED,
  virtualDoMocksOfExisting,
  navigablePages,
  coversFreshProfile,
  pagesWithoutFreshProfile,
  freshProfileVerdict,
  liftNames,
  liftText,
  liftSite,
  liftFrom,
  copyStates,
};
