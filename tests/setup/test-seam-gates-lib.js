/**
 * Test-seam gates: the pure readers shared by
 *   repo-mocks-partial.test.js, repo-spy-failure-only.test.js, repo-seam-tests.test.js,
 *   virtual-mock-of-existing-module.test.js (its jest.doMock scan), fresh-profile-pages.test.js, copy-deck-lift.test.js,
 *   select-columns-exist.test.js, unresolved-requires.test.js (its later-merge rule), grade-form-one-home.test.js,
 *   copy-deck-urdu-joiners.test.js, copy-deck-quoted-labels.test.js, copy-deck-readers.test.js,
 *   content-changes-trace.test.js; repo-mocks-partial.test.js also reads jest.doMock, copy-deck-lift.test.js also
 *   reads the child pages (dashboard/public/wq).
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

/**
 * The warn-on-less check for a { key: count } allowlist named `file`: { failures, cleans }. A new key or a count above
 * the listed one fails; a lower count (DOWN) or none (CLEAN) is a warning only, so the PR that removes a hit is never
 * failed for it and may lower the entry in its own commit.
 */
function countVerdict(hits, allow, what, file) {
  const failures = [];
  const cleans = [];
  for (const k of [...new Set([...Object.keys(hits), ...Object.keys(allow)])].sort()) {
    const now = hits[k] || 0;
    const ok = Object.prototype.hasOwnProperty.call(allow, k) ? allow[k] : null;
    if (ok === null) failures.push(`NEW: ${k} has ${now} ${what}.`);
    else if (now > ok) failures.push(`UP: ${k} has ${now} ${what}, ${file} allows ${ok}.`);
    else if (now < ok) cleans.push(now === 0 ? `CLEAN: ${k} has none now. Remove its entry from ${file}.` : `DOWN: ${k} has ${now}, ${file} says ${ok}. Lower it to ${now}.`);
  }
  return { failures, cleans };
}

/** The warn-on-less check for a list allowlist named `file`: { failures, cleans }. A found item not listed fails; a listed item no longer found is a CLEAN warning. */
function listVerdict(found, allowed, what, file) {
  const f = new Set(found);
  const a = new Set(allowed);
  const failures = [];
  const cleans = [];
  for (const x of [...f].sort()) if (!a.has(x)) failures.push(`NEW: ${x} ${what}.`);
  for (const x of [...a].sort()) if (!f.has(x)) cleans.push(`CLEAN: ${x} is fixed or gone. Remove it from ${file}.`);
  return { failures, cleans };
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
 *   - a comment line that names the key and no other, right above a property line → that property ({ prop });
 *   - a comment that names the key right above `const NAME = {` (`// wa.t.fwd_text …` over `const FWD = {`) → the
 *     exported NAME as a whole ({ whole: NAME });
 *   - otherwise, when the source names the key or its area with a star (`jg.t.*`) and exports `T`: T under the
 *     camelCase lift names ({ guess: true }).
 * null when the template does not claim the key.
 */
/** A deck key named in a comment: jg.* / og.* / wa.* / bot.* / st.* (a starred area too). */
const DECK_KEY = /(?<![\w./])(?:jg|og|wa|bot|st)\.[a-z0-9_]+(?:\.[a-z0-9_*]+)*/g;

function liftSite(source, key) {
  const k = key.replace(/\./g, '\\.');
  const prop = new RegExp(`^\\s*([A-Za-z_$][\\w$]*)\\s*:.*//\\s*${k}(?![\\w.])`, 'm').exec(source);
  if (prop) return { prop: prop[1] };
  const above = new RegExp(`^[ \\t]*//([^\\n]*(?:^|[^\\w.])${k}(?![\\w.])[^\\n]*)\\n[ \\t]*([A-Za-z_$][\\w$]*)\\s*:`, 'm').exec(source);
  if (above && new Set(above[1].match(DECK_KEY) || []).size === 1) return { prop: above[2] };
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
  const compare = (key, lift) => liftState(deck[key], lift);
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

// ------------------------------------------------------------------------- gate 7: selected columns exist

/**
 * `const|let|var NAME = '<a>' + '<b>' …` (string literals and plain templates joined by +, over several lines) →
 * { NAME: string }. A binding whose value is anything else is not read.
 */
const STR_LIT = String.raw`(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|` + '`[^`$]*`' + ')';
const unquote = (parts) => parts.map((p) => p.slice(1, -1).replace(/\\(.)/g, '$1')).join('');

/** An expression's string value when it is string literals / plain templates joined by +, or a known const; else null. */
function stringOf(expr, consts = {}) {
  const e = String(expr || '').trim();
  if (new RegExp(`^${STR_LIT}(?:\\s*\\+\\s*${STR_LIT})*$`).test(e)) return unquote(e.match(new RegExp(STR_LIT, 'g')));
  if (/^[A-Za-z_$][\w$]*$/.test(e) && Object.prototype.hasOwnProperty.call(consts, e)) return consts[e];
  return null;
}

function constStringExprs(text) {
  const out = {};
  const lit = STR_LIT;
  const rx = new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(${lit}(?:\s*\+\s*${lit})*)\s*[;,\n]`, 'g');
  for (let m = rx.exec(text); m; m = rx.exec(text)) {
    if (m[1] in out) continue;
    const parts = m[2].match(new RegExp(lit, 'g')) || [];
    out[m[1]] = unquote(parts);
  }
  return out;
}

/** The columns a PostgREST select string names: `*`, embedded relations `x(...)` and counts skipped; `a:b` → b; `meta->x` → meta; `c::text` → c. */
function selectColumns(sel) {
  const items = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(sel)) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { items.push(cur); cur = ''; } else cur += ch;
  }
  items.push(cur);
  const out = [];
  for (let it of items) {
    it = it.trim();
    if (!it || it === '*' || it.includes('(') || it.startsWith('...')) continue;
    if (it.includes(':') && !it.includes('::')) it = it.slice(it.indexOf(':') + 1).trim();
    else if (/^[A-Za-z_]\w*\s*:[^:]/.test(it)) it = it.slice(it.indexOf(':') + 1).trim();
    it = it.split('->')[0].split('::')[0].trim().replace(/^"|"$/g, '');
    if (it && it !== '*') out.push(it);
  }
  return out;
}

/**
 * Every `.from(<table>)…select(<cols>)` chain in one source (a `.select(` anywhere in the chain that starts at the
 * `.from(`): [{ table, cols, line }] — table / cols null when not a readable string. A string is readable when it is
 * a literal, a plain template, a const string (literals joined by +), or a parameter of the enclosing same-file
 * function every call of which passes a readable string there (one entry per call).
 */
function selectsOf(text) {
  const mask = codeMask(text);
  const consts = constStringExprs(text);
  const lineOf = (i) => text.slice(0, i).split('\n').length;
  const readArg = (open, close) => {
    const raw = text.slice(open + 1, close);
    const first = (() => { let d = 0; for (let i = open + 1; i < close; i += 1) { const c = mask[i]; if ('([{'.includes(c)) d += 1; else if (')]}'.includes(c)) d -= 1; else if (c === ',' && d === 0) return text.slice(open + 1, i); } return raw; })().trim();
    const v = stringOf(first, consts);
    if (v !== null) return { values: [v] };
    if (/^[A-Za-z_$][\w$]*$/.test(first)) {
      const viaParam = paramValues(first, open);
      if (viaParam) return { values: viaParam };
    }
    return { values: null };
  };
  // a parameter of the enclosing `function f(…)` / `const f = (…) =>`, read at each same-file call of f
  const fnRx = /(?:\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)|\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>)/g;
  const fns = [];
  for (let m = fnRx.exec(mask); m; m = fnRx.exec(mask)) fns.push({ name: m[1] || m[3], params: (m[2] !== undefined ? m[2] : m[4] || "").split(',').map((x) => x.trim().split('=')[0].trim()), at: m.index });
  function paramValues(name, at) {
    const owner = fns.filter((f) => f.at < at).pop();
    if (!owner) return null;
    const idx = owner.params.indexOf(name);
    if (idx < 0) return null;
    const vals = [];
    const callRx = new RegExp(`(^|[^\\w$.])${owner.name.replace(/\$/g, '\\$')}\\s*\\(`, 'g');
    for (let m = callRx.exec(mask); m; m = callRx.exec(mask)) {
      const open = m.index + m[0].length - 1;
      if (fns.some((f) => f.at <= m.index && m.index < f.at + 40 && f.name === owner.name)) continue; // its own declaration
      const close = closeParen(mask, open);
      if (close < 0) return null;
      const args = []; let d = 0; let start = open + 1;
      for (let i = open + 1; i <= close; i += 1) {
        const c = mask[i];
        if ('([{'.includes(c)) d += 1; else if (')]}'.includes(c) && i !== close) d -= 1;
        if ((c === ',' && d === 0) || i === close) { args.push(text.slice(start, i).trim()); start = i + 1; }
      }
      const v = stringOf(args[idx], consts);
      if (v === null) return null;
      vals.push(v);
    }
    return vals.length ? vals : null;
  }
  const out = [];
  const fromRx = /\.\s*from\s*\(/g;
  for (let m = fromRx.exec(mask); m; m = fromRx.exec(mask)) {
    const open = m.index + m[0].length - 1;
    const close = closeParen(mask, open);
    if (close < 0) continue;
    const t = readArg(open, close).values;
    const table = t && t.length === 1 ? t[0] : null;
    // walk the chain: .name(…) segments while the next non-space is a dot
    let i = close + 1;
    for (;;) {
      const seg = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(mask.slice(i, i + 200));
      if (!seg) break;
      const o = i + seg[0].length - 1;
      const c = closeParen(mask, o);
      if (c < 0) break;
      if (seg[1] === 'select') {
        const v = readArg(o, c).values;
        if (o + 1 === c) out.push({ table, cols: [], line: lineOf(o) });
        else if (!v) out.push({ table, cols: null, line: lineOf(o) });
        else for (const sel of v) out.push({ table, cols: selectColumns(sel), line: lineOf(o) });
      }
      i = c + 1;
    }
  }
  return out;
}

/**
 * The selected columns the schema does not have: { hits: ['table.column'], dynamic: n }. `columns` is
 * { table: Set } (the strict-columns parser's output). A select whose table or string cannot be read counts as
 * dynamic; a table the schema does not create is reported as `table.*` once per select.
 */
function missingSelectedColumns(selects, columns) {
  const hits = [];
  let dynamic = 0;
  for (const s of selects) {
    if (!s.table || s.cols === null) { dynamic += 1; continue; }
    const have = columns[s.table.toLowerCase()];
    if (!have) { hits.push(`${s.table}.*`); continue; }
    for (const c of s.cols) if (!have.has(c)) hits.push(`${s.table}.${c}`);
  }
  return { hits, dynamic };
}

// ----------------------------------------------------------- unresolved-requires: a later-merge entry names its provider

const LATER = /\b(?:later|follow-?up|upcoming|future|next)\s+(?:merge|pr|pull request|change|commit|release)\b|\bships?\s+(?:in\s+|with\s+)?(?:a\s+)?later\b|\blands?\s+later\b/i;

/** A provider written as a PR number or a branch, not as the module that provides. */
const NOT_A_PROVIDER = /#\d|\bPR\b|pull request|\bbranch\b|\bmerge of\b/i;

/**
 * The unresolved-requires allowlist entries whose reason says the missing module ships in a later merge and that do
 * not name its provider: no `provider` field, one under 10 characters, or one that is a PR number / branch rather
 * than the module. entries: [{ from, spec, reason, provider? }] → those entries.
 */
function laterMergeWithoutProvider(entries) {
  return (entries || [])
    .filter((e) => LATER.test(String(e.reason || '')))
    .filter((e) => {
      const p = typeof e.provider === 'string' ? e.provider.trim() : '';
      return p.length < 10 || NOT_A_PROVIDER.test(p);
    });
}

// -------------------------------------------------------------------- one home for the challenge form (formFor)

/** The lines of every `formFor(` call in code (bare or as a member); the `function formFor(` declaration is not one. */
function formForCalls(text) {
  const mask = codeMask(text);
  const out = [];
  const rx = /(^|[^\w$])formFor\s*\(/g;
  for (let m = rx.exec(mask); m; m = rx.exec(mask)) {
    const at = m.index + m[1].length;
    if (/\bfunction\s*$/.test(mask.slice(Math.max(0, at - 20), at))) continue;
    out.push(text.slice(0, at).split('\n').length);
  }
  return out;
}

/** Whether a repo-relative path is the challenge form's home: bot/shared/services/quiz/web-quiz-challenge*.js. */
const isFormHome = (id) => /^bot\/shared\/services\/quiz\/web-quiz-challenge[\w.-]*\.js$/.test(id);

// ------------------------------------------------------------------------ repo doMocks are partial too

/** The `jest.doMock('<…>.repo', …)` calls in one file whose factory does not hold `jest.requireActual(`: [spec]. */
function wholeRepoDoMocks(text) {
  return calls(text, ['jest.doMock'])
    .filter((c) => isRepoSpec(c.spec))
    .filter((c) => !/jest\.requireActual\s*\(/.test(c.call))
    .map((c) => c.spec);
}

// ------------------------------------------------------------------------ the child pages' copy (dashboard/public/wq)

/** The index of the `}` that closes the `{` at `open`, read on a mask; -1 when unbalanced. */
function closeBrace(mask, open) {
  let depth = 0;
  for (let i = open; i < mask.length; i += 1) {
    if (mask[i] === '{') depth += 1;
    else if (mask[i] === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Where a page script keeps a deck key, in order: camelCase after the first part, the bot-side names, the last part as is. */
function wqLiftNames(key) {
  const parts = key.split('.');
  return [...new Set([camel(parts.slice(1).join('_')), ...liftNames(key), parts[parts.length - 1]])];
}

/** The `<lang>: { … }` table spans of a script: [{ open, close }] (read on the mask). */
function langTables(mask, lang) {
  const out = [];
  const rx = new RegExp(`(^|[^\\w$.])${lang}\\s*:\\s*\\{`, 'g');
  for (let m = rx.exec(mask); m; m = rx.exec(mask)) {
    const open = m.index + m[0].length - 1;
    const close = closeBrace(mask, open);
    if (close > 0) out.push({ open, close });
  }
  return out;
}

/** The value of property `name` in the first table that has it: evaluated on its own; undefined when absent or not self-contained. */
function tableValue(text, mask, tables, name) {
  const vm = require('vm');
  const rx = new RegExp(`(^|[{,\\s])${name.replace(/\$/g, '\\$')}\\s*:`, 'g');
  for (const t of tables) {
    const body = mask.slice(t.open + 1, t.close);
    rx.lastIndex = 0;
    let m = rx.exec(body);
    while (m) {
      // only the table's own properties (depth 0 inside it)
      const at = t.open + 1 + m.index + m[0].length;
      let d = 0;
      for (let i = t.open + 1; i < at; i += 1) { if ('([{'.includes(mask[i])) d += 1; else if (')]}'.includes(mask[i])) d -= 1; }
      if (d === 0) {
        let end = at;
        let e = 0;
        for (; end < t.close; end += 1) {
          const c = mask[end];
          if ('([{'.includes(c)) e += 1; else if (')]}'.includes(c)) e -= 1;
          else if (c === ',' && e === 0) break;
        }
        try { return vm.runInNewContext(`(${text.slice(at, end)})`, Object.create(null), { timeout: 100 }); } catch (_) { return undefined; }
      }
      m = rx.exec(body);
    }
  }
  return undefined;
}

/** The index (in `tables`) of the first table holding property `name` as its own (depth 0); -1 when none. */
function tableProp(mask, tables, name) {
  const rx = new RegExp(`(^|[{,\\s])${name.replace(/\$/g, '\\$')}\\s*:`, 'g');
  for (let i = 0; i < tables.length; i += 1) {
    const t = tables[i];
    const body = mask.slice(t.open + 1, t.close);
    rx.lastIndex = 0;
    for (let m = rx.exec(body); m; m = rx.exec(body)) {
      const at = t.open + 1 + m.index + m[0].length;
      let d = 0;
      for (let j = t.open + 1; j < at; j += 1) { if ('([{'.includes(mask[j])) d += 1; else if (')]}'.includes(mask[j])) d -= 1; }
      if (d === 0) return i;
    }
  }
  return -1;
}

/** The index of the `{` of the object literal that holds position `at` (read on a mask); -1 at top level. */
function parentBrace(mask, at) {
  let depth = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    if (mask[i] === '}') depth += 1;
    else if (mask[i] === '{') { if (depth === 0) return i; depth -= 1; }
  }
  return -1;
}

/** A lift's value as text, a function called with the deck's own {placeholders} (from the deck's EN) in order. */
function liftTextFor(v, deckEntry) {
  if (typeof v !== 'function') return liftText(v);
  const names = [...new Set([...String(deckEntry.en || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
  try { return String(v(...names.map((n) => `{${n}}`))); } catch (_) { return null; }
}

/** One deck key's state against a lift { en, ur } (null = missing): 'same' | 'missing' | 'missing:ur' | 'drift:…'. */
function liftState(entry, lift, text = liftText) {
  if (!lift || lift.en === undefined) return 'missing';
  const bad = [];
  if (text(lift.en, entry) !== entry.en) bad.push('en');
  const urDeck = entry.ur;
  if (typeof urDeck === 'string' && !/DRAFT/.test(urDeck)) {
    if (lift.ur === undefined) return bad.length ? `drift:${bad.join('+')}` : 'missing:ur';
    if (text(lift.ur, entry) !== urDeck) bad.push('ur');
  }
  return bad.length ? `drift:${bad.join('+')}` : 'same';
}

/**
 * The state of every live, non-`bot.*` deck key a child page script claims (liftSite on its source):
 * { key: state }. The lift is read from the script's `en: {…}` / `ur: {…}` tables under the claimed property, else
 * under wqLiftNames(key); scripts that claim the key by an explicit comment are read first.
 * deck: the parsed copy.v2.json; scripts: [{ id, source }].
 */
function readScripts(scripts) {
  return scripts.map((s) => {
    const mask = codeMask(s.source);
    return { ...s, mask, en: langTables(mask, 'en'), ur: langTables(mask, 'ur') };
  });
}

/** The live, non-`bot.*` deck keys some script claims: [[key, entry, sites]], explicit claims first. */
function wqClaims(deck, read) {
  const out = [];
  for (const [key, entry] of Object.entries(deck)) {
    if (key === '_meta' || !entry || entry.retired || entry.held || key.startsWith('bot.')) continue;
    const sites = read.map((s) => ({ s, site: liftSite(s.source, key) })).filter((x) => x.site);
    if (!sites.length) continue;
    sites.sort((a, b) => Number(Boolean(a.site.guess)) - Number(Boolean(b.site.guess)));
    out.push([key, entry, sites]);
  }
  return out;
}

/** Where a claimed key's EN is lifted: { s, name, en } for the first script and name whose `en` table has it; null when none. */
function wqEnLift(key, sites) {
  for (const { s, site } of sites) {
    const names = site.prop ? [site.prop] : wqLiftNames(key);
    for (const n of names) {
      const en = tableValue(s.source, s.mask, s.en, n);
      if (en !== undefined) return { s, name: n, en };
    }
  }
  return null;
}

/**
 * A server-carried line: a key a page claims with no `en`/`ur` table lift at all, whose bytes a bot template lifts
 * `same` (botStates, copyStates' map, says `same` for the bare key), is `carried`: the page shows what the server
 * sends (wq-trail.js renders `d.round_handback`, lifted in class-round.page.js). `carried` is clean. Without
 * botStates, or with the template's lift not `same`, the key stays `missing`.
 */
function wqCopyStates(deck, scripts, botStates = {}) {
  const out = {};
  for (const [key, entry, sites] of wqClaims(deck, readScripts(scripts))) {
    const hit = wqEnLift(key, sites);
    let lift = null;
    if (!hit && botStates[key] === 'same') { out[key] = 'carried'; continue; }
    if (hit) {
      const ur = tableValue(hit.s.source, hit.s.mask, hit.s.ur, hit.name);
      lift = { en: hit.en, ...(ur !== undefined ? { ur } : {}) };
    }
    out[key] = liftState(entry, lift, liftTextFor);
  }
  return out;
}

/**
 * EN ⇒ UR in the same table: the keys (sorted) a child page lifts in an `en: {…}` table (as wqCopyStates finds the
 * lift) whose `ur: {…}` sibling — the `ur:` table of the same object — has no property of that name. Only keys whose
 * deck Urdu is a string that is not a DRAFT are read (a key with no approved Urdu has nothing to lift). A UR value
 * kept in another object (another `{ en, ur }` pair) is not the same table, and is a hit.
 */
function wqEnWithoutUr(deck, scripts) {
  const out = [];
  for (const [key, entry, sites] of wqClaims(deck, readScripts(scripts))) {
    if (typeof entry.ur !== 'string' || /DRAFT/.test(entry.ur)) continue;
    const hit = wqEnLift(key, sites);
    if (!hit) continue;
    const { s, name } = hit;
    const enTable = s.en[tableProp(s.mask, s.en, name)];
    const parent = parentBrace(s.mask, enTable.open);
    const urSiblings = s.ur.filter((t) => parentBrace(s.mask, t.open) === parent);
    if (tableProp(s.mask, urSiblings, name) < 0) out.push(key);
  }
  return out.sort();
}

/** The gap states a lift can only lower: a state's parts (en/ur missing or drifting). */
const GAP_PARTS = {
  missing: ['en-missing', 'ur-missing'],
  'missing:ur': ['ur-missing'],
  'drift:en': ['en-drift'],
  'drift:ur': ['ur-drift'],
  'drift:en+ur': ['en-drift', 'ur-drift'],
};

/**
 * A gap state's parts: GAP_PARTS for a lift state; else each `+`-joined part, a counted one (`ur:2`) as that many
 * parts (ur#1, ur#2), so en:1+ur:2 → ur:1 is a strict part of it and ur:1 → ur:2 or en:1 is not.
 */
function gapParts(state) {
  if (GAP_PARTS[state]) return GAP_PARTS[state];
  return String(state).split('+').flatMap((p) => {
    const m = /^(.+):(\d+)$/.exec(p);
    return m ? Array.from({ length: Number(m[2]) }, (_, i) => `${m[1]}#${i + 1}`) : [p];
  });
}

/**
 * The copy gap against copy-deck-lift.allowlist.json { key: state }: { failures, cleans }. `same` and `carried` are clean.
 *   NEW (fails): a key not same and not listed. CHANGED (fails): a listed key whose gap is not a part of the listed one.
 *   CLEAN (warns): a listed key now same or no longer checked. LESS (warns): a listed key whose gap is a strict part of
 *   the listed one (drift:en+ur → drift:ur; missing → missing:ur). A lift PR is never failed for lowering the gap.
 * opts (another deck gate on the same engine): file (the allowlist's name), fix (what a NEW key's author does),
 * gone (the word for a key no longer in states).
 */
function copyGapVerdict(states, allow, opts = {}) {
  const FILE = opts.file || 'copy-deck-lift.allowlist.json';
  const FIX = opts.fix || "lift the deck's string byte for byte";
  const GONE = opts.gone || 'no longer checked';
  const failures = [];
  const cleans = [];
  for (const key of [...new Set([...Object.keys(states), ...Object.keys(allow)])].sort()) {
    const now = states[key];
    const ok = allow[key];
    if (now === 'same' || now === 'carried' || now === undefined) { if (ok !== undefined) cleans.push(`CLEAN: ${key} is ${now || GONE}. Remove it from ${FILE}.`); continue; }
    if (ok === undefined) { failures.push(`NEW: ${key} is ${now}. ${FIX.charAt(0).toUpperCase()}${FIX.slice(1)}.`); continue; }
    if (ok === now) continue;
    const was = gapParts(ok);
    const is = gapParts(now);
    if (is.every((x) => was.includes(x)) && is.length < was.length) cleans.push(`LESS: ${key} is ${now} now, the allowlist says ${ok}. Lower its entry in ${FILE}.`);
    else failures.push(`CHANGED: ${key} is ${now}, the allowlist says ${ok}.`);
  }
  return { failures, cleans };
}

// ------------------------------------------------------------------------------ the deck's quoted labels

const isLive = (key, entry) => key !== '_meta' && entry && typeof entry === 'object' && !entry.retired && !entry.held;
const readUr = (entry) => (typeof entry.ur === 'string' && !/DRAFT/.test(entry.ur) ? entry.ur : null);

/**
 * The deck keys whose quoted button labels name no live label: { key: 'en:<n>' | 'ur:<n>' | 'en:<n>+ur:<m>' }.
 * Every «…» in a live key's UR (not a DRAFT) is byte-equal to some live key's UR; every "…" in its EN to some live
 * key's EN. live = neither `retired` nor `held`, as copyStates.
 */
function quotedLabelGaps(deck) {
  const live = Object.entries(deck || {}).filter(([k, e]) => isLive(k, e));
  const labels = {
    en: new Set(live.map(([, e]) => e.en).filter((s) => typeof s === 'string')),
    ur: new Set(live.map(([, e]) => readUr(e)).filter(Boolean)),
  };
  const QUOTE = { en: /"([^"\n]*)"/g, ur: /«([^»\n]*)»/g };
  const out = {};
  for (const [key, entry] of live) {
    const text = { en: typeof entry.en === 'string' ? entry.en : '', ur: readUr(entry) || '' };
    const parts = ['en', 'ur'].map((l) => [l, [...text[l].matchAll(QUOTE[l])].filter((m) => !labels[l].has(m[1])).length])
      .filter(([, n]) => n > 0).map(([l, n]) => `${l}:${n}`);
    if (parts.length) out[key] = parts.join('+');
  }
  return out;
}

// ------------------------------------------------------------------------------- the deck's raw readers

/**
 * The files (ids, sorted) that read the copy deck raw: a `require` in code (never a comment or a string) whose path
 * ends in `copy.v2.json` or `copy.v2`. The file that defines `deckLine` (the one door, '' for a held or retired key)
 * is not a raw reader. files: [{ id, source }].
 */
function rawDeckReaders(files) {
  const out = [];
  for (const { id, source } of files) {
    const mask = codeMask(source);
    if (/(^|[^\w$.])(?:function\s+deckLine\s*\(|(?:const|let|var)\s+deckLine\s*=)/.test(mask)) continue;
    if (calls(source, ['require'], mask).some((c) => /(^|\/)copy\.v2(\.json)?$/.test(c.spec || ''))) out.push(id);
  }
  return out.sort();
}

// ------------------------------------------------------------------------- a content file's changes trace

const TRACE_FIELDS = ['at', 'field', 'what', 'why', 'text_hash_before'];
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * The problems (strings, `<where>: <what>`) of every `changes` array in a parsed content file: each entry has the
 * five fields as non-empty strings, `at` is an ISO time, `text_hash_before` is 32 lowercase hex (the files' own
 * text_hash format) and, when the holding object records a `text_hash`, differs from it. [] when the file has none.
 */
function changesTraceProblems(doc) {
  const out = [];
  const visit = (o, where) => {
    if (Array.isArray(o)) { o.forEach((x, i) => visit(x, `${where}[${i}]`)); return; }
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      const at = where ? `${where}.${k}` : k;
      if (k !== 'changes') { visit(v, at); continue; }
      if (!Array.isArray(v)) { out.push(`${at}: not an array`); continue; }
      v.forEach((e, i) => {
        const w = `${at}[${i}]`;
        for (const f of TRACE_FIELDS) if (!e || typeof e[f] !== 'string' || !e[f]) out.push(`${w}: ${f} is missing or empty`);
        if (!e) return;
        if (typeof e.at === 'string' && e.at && (!ISO_TIME.test(e.at) || Number.isNaN(Date.parse(e.at)))) out.push(`${w}: at is not an ISO time`);
        const h = e.text_hash_before;
        if (typeof h === 'string' && h && !/^[0-9a-f]{32}$/.test(h)) out.push(`${w}: text_hash_before is not 32 lowercase hex`);
        else if (typeof h === 'string' && h === o.text_hash) out.push(`${w}: text_hash_before is the current text_hash`);
      });
    }
  };
  visit(doc, '');
  return out;
}

// --------------------------------------------------------------------------- the deck's Urdu no-break rules

const NBSP = '\u00a0';
const ORPHAN_VERBS = new Set(['ہے', 'ہیں', 'گا', 'گی', 'گے']);
/** What may trail a string's last word: whitespace, punctuation, quotes, bidi isolates and marks. */
const TRAIL = /[\s\u2066-\u2069\u200e\u200f\u061c۔؟!?.,،:;…"'«»)\]]+$/;

/** The deck keys (sorted) whose Urdu ends on «ہے ہیں گا گی گے» after a plain space (not U+00A0) before it. */
function urduOrphans(deck) {
  const out = [];
  for (const [key, entry] of Object.entries(deck || {})) {
    if (key === '_meta' || !entry || typeof entry.ur !== 'string') continue;
    const s = entry.ur.replace(TRAIL, '');
    const m = /([\s\u00a0]+)([^\s\u00a0]+)$/.exec(s);
    if (!m || !ORPHAN_VERBS.has(m[2])) continue;
    if (m[1] !== NBSP) out.push(key);
  }
  return out.sort();
}

/** The deck keys (sorted) whose Urdu has «واٹس ایپ» without exactly U+00A0 between the two words. */
function whatsappWithoutJoiner(deck) {
  const out = [];
  for (const [key, entry] of Object.entries(deck || {})) {
    if (key === '_meta' || !entry || typeof entry.ur !== 'string') continue;
    if (/واٹس(?!\u00a0ایپ)\s*ایپ/.test(entry.ur)) out.push(key);
  }
  return out.sort();
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
  countVerdict,
  listVerdict,
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
  stringOf,
  constStringExprs,
  selectColumns,
  selectsOf,
  missingSelectedColumns,
  laterMergeWithoutProvider,
  formForCalls,
  isFormHome,
  wholeRepoDoMocks,
  wqLiftNames,
  liftState,
  wqCopyStates,
  wqEnWithoutUr,
  copyGapVerdict,
  quotedLabelGaps,
  rawDeckReaders,
  changesTraceProblems,
  urduOrphans,
  whatsappWithoutJoiner,
};
