#!/usr/bin/env node
/**
 * Every local require/import in the deployed code resolves to a file COMMITTED on the branch.
 *
 *   node scripts/ci/require-resolution.js                 # this checkout (tracked files only)
 *   node scripts/ci/require-resolution.js --ref origin/main   # any branch, without checking it out
 *   node scripts/ci/require-resolution.js --ref origin/staging --json
 *   --roots bot,dashboard   (default) — the code the bot, sqs-worker(s) and portal services run
 *
 * Scans EVERY .js/.cjs/.mjs file under the roots except test code (tests/, __tests__/, *.test.js, *.spec.js),
 * not only what is reachable from an entry point, so a lazy `require()` inside a function that runs once a
 * week is checked the same as a top-level one.
 * Checks require('…'), require.resolve('…'), import … from '…', export … from '…', import('…') whose
 * path starts with ./ or ../. A path built at run time (`./x/${name}`, './a' + b) is not checked.
 * Comments and string contents are masked first, so `"require('./x')"` in a string is not a require.
 *
 * A require that is optional by design (its caller catches MODULE_NOT_FOUND and falls back) ends its line with
 * `// optional-require: <why>`. The marker travels with the code down the ladder, so it holds on every branch
 * whether or not the module has arrived there yet. Entries in tests/setup/unresolved-requires.allowlist.json
 * (the reachability guard's list, { from, spec, reason }) are honoured too; the branch's OWN copy is read.
 *
 * Exit: 0 clean, 1 an unresolved require, 2 usage or git error.
 *
 * Why (bd-3fkutw): cherry-picks carried callers to staging and main without the modules they require.
 * The reachability guard was red in the baseline snapshot, so the new misses did not fail CI.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const DEFAULT_ROOTS = ['bot', 'dashboard'];
const ALLOWLIST_PATH = 'tests/setup/unresolved-requires.allowlist.json';
const SOURCE_RE = /\.(c|m)?js$/;
const SKIP_DIR_RE = /(^|\/)(node_modules|dist|coverage)\//;
// Test code is not deployed: bot/tests/, dashboard/tests/, __tests__/, *.test.js, *.spec.js.
const TEST_FILE_RE = /(^|\/)(tests|__tests__)\/|\.(test|spec)\.(c|m)?js$/;

// ─── Masking: comments → spaces, string/regex/template contents → spaces ─────────────────────
// Offsets and newlines are preserved, so a match in the masked text maps 1:1 onto the source.

const REGEX_AFTER_CHAR = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new',
  'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);

function mask(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };

  // Scan a quoted string starting at the quote; returns the index of the closing quote.
  function scanQuoted(i) {
    const q = src[i];
    let k = i + 1;
    while (k < n && src[k] !== q && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
    blank(i + 1, k);
    return k;
  }

  // Scan a template literal starting at the backtick; `${ … }` parts are scanned as code.
  function scanTemplate(i) {
    let k = i + 1;
    let litStart = k;
    while (k < n && src[k] !== '`') {
      if (src[k] === '\\') { k += 2; continue; }
      if (src[k] === '$' && src[k + 1] === '{') {
        blank(litStart, k);
        k = scanCode(k + 2, true) + 1;
        litStart = k;
        continue;
      }
      k++;
    }
    blank(litStart, k);
    return k;
  }

  // Scan a regex literal starting at the slash; returns the closing slash, or -1 if it is not one.
  function scanRegex(i) {
    let k = i + 1;
    let inClass = false;
    while (k < n && src[k] !== '\n') {
      const c = src[k];
      if (c === '\\') { k += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) { blank(i + 1, k); return k; }
      k++;
    }
    return -1;
  }

  // Scan code from i; with untilBrace, stop at the `}` that closes a template `${`.
  function scanCode(i, untilBrace) {
    let depth = 0;
    let lastSig = '';
    let lastWord = '';
    let k = i;
    while (k < n) {
      const c = src[k];
      const next = src[k + 1];
      if (c === '/' && next === '/') {
        const end = src.indexOf('\n', k);
        const stop = end === -1 ? n : end;
        blank(k, stop);
        k = stop;
        continue;
      }
      if (c === '/' && next === '*') {
        const end = src.indexOf('*/', k + 2);
        const stop = end === -1 ? n : end + 2;
        blank(k, stop);
        k = stop;
        continue;
      }
      if (c === '"' || c === "'") { k = scanQuoted(k) + 1; lastSig = c; lastWord = ''; continue; }
      if (c === '`') { k = scanTemplate(k) + 1; lastSig = c; lastWord = ''; continue; }
      if (c === '/' && (lastSig === '' || REGEX_AFTER_CHAR.has(lastSig) || REGEX_AFTER_WORD.has(lastWord))) {
        const end = scanRegex(k);
        if (end !== -1) { k = end + 1; lastSig = '/'; lastWord = ''; continue; }
      }
      if (c === '{') depth++;
      if (c === '}') {
        if (untilBrace && depth === 0) return k;
        depth--;
      }
      if (/[A-Za-z0-9_$]/.test(c)) {
        let e = k;
        while (e < n && /[A-Za-z0-9_$]/.test(src[e])) e++;
        lastWord = src.slice(k, e);
        lastSig = 'w';
        k = e;
        continue;
      }
      if (!/\s/.test(c)) { lastSig = c; lastWord = ''; }
      k++;
    }
    return k;
  }

  scanCode(0, false);
  return out.join('');
}

// ─── Extraction ──────────────────────────────────────────────────────────────────────────────

// [regex over the masked text, display form, must the string be the call's only argument?]
const FORMS = [
  [/(?<![\w$.])require\s*\(\s*(?=['"`])/g, 'require', true],
  [/(?<![\w$.])require\.resolve\s*\(\s*(?=['"`])/g, 'require.resolve', true],
  [/(?<![\w$.])import\s*\(\s*(?=['"`])/g, 'import()', true],
  [/(?<![\w$.])from\s*(?=['"])/g, 'from', false],
  [/(?<![\w$.])import\s*(?=['"])/g, 'import', false],
];

// `// optional-require: <why>` at the end of the require's line: the caller catches MODULE_NOT_FOUND and falls
// back, so a branch without the module is fine. It travels with the code down the ladder.
const OPTIONAL_MARKER_RE = /\/\/\s*optional-require:\s*(.+)$/;

function extract(src) {
  const masked = mask(src);
  const lines = src.split('\n');
  const found = [];
  for (const [re, kind, wholeArg] of FORMS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(masked))) {
      const q = m.index + m[0].length;
      const delim = src[q];
      const close = masked.indexOf(delim, q + 1);
      if (close === -1) continue;
      const spec = src.slice(q + 1, close);
      if (delim === '`' && spec.includes('${')) continue; // built at run time
      if (wholeArg && !/^\s*[,)]/.test(masked.slice(close + 1))) continue; // './a' + b
      if (!/^\.\.?(\/|$)/.test(spec)) continue; // a package, a builtin or an absolute path
      if (/(^|\/)node_modules\//.test(spec)) continue; // an installed package, never committed
      const line = src.slice(0, m.index).split('\n').length;
      const marker = OPTIONAL_MARKER_RE.exec(lines[line - 1] || '');
      found.push({ spec, line, kind, pos: m.index, optional: marker ? marker[1].trim() : null });
    }
  }
  return found.sort((a, b) => a.pos - b.pos);
}

// ─── Resolution against the committed file set ──────────────────────────────────────────────

function makeResolver(files, read) {
  const exts = ['', '.js', '.json', '.node', '.cjs', '.mjs'];
  const asFile = (p) => exts.map((e) => p + e).find((c) => files.has(c)) || null;
  function asDir(p) {
    const pkg = `${p}/package.json`;
    if (files.has(pkg)) {
      try {
        const main = JSON.parse(read(pkg) || '{}').main;
        if (main) {
          const target = path.posix.normalize(path.posix.join(p, main));
          const hit = asFile(target) || asIndex(target);
          if (hit) return hit;
        }
      } catch (_) { /* an unreadable package.json falls back to index, as Node does */ }
    }
    return asIndex(p);
  }
  const asIndex = (p) => ['index.js', 'index.json', 'index.node'].map((f) => `${p}/${f}`).find((c) => files.has(c)) || null;
  return function resolve(from, spec) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)).replace(/\/$/, '');
    if (target.startsWith('..')) return null; // outside the repo: not in the deploy
    return (spec.endsWith('/') ? null : asFile(target)) || asDir(target);
  };
}

// ─── Git access ──────────────────────────────────────────────────────────────────────────────

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}

/** Read many blobs of one commit in a single `git cat-file --batch`. */
function readBlobs(commit, paths) {
  const res = spawnSync('git', ['cat-file', '--batch'], {
    input: paths.map((p) => `${commit}:${p}`).join('\n') + '\n',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`git cat-file failed: ${res.stderr}`);
  const buf = res.stdout;
  const out = new Map();
  let at = 0;
  for (const p of paths) {
    const nl = buf.indexOf(0x0a, at);
    const header = buf.slice(at, nl).toString('utf8');
    at = nl + 1;
    const parts = header.split(' ');
    if (parts[1] === 'missing' || parts.length < 3) continue;
    const size = Number(parts[2]);
    out.set(p, buf.slice(at, at + size).toString('utf8'));
    at += size + 1;
  }
  return out;
}

function loadTree(ref) {
  if (!ref) {
    const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
    const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; } };
    return { label: 'this checkout', files, read, readMany: (ps) => new Map(ps.map((p) => [p, read(p)])) };
  }
  const commit = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  const files = git(['ls-tree', '-r', '-z', '--name-only', commit]).split('\0').filter(Boolean);
  const read = (p) => readBlobs(commit, [p]).get(p) ?? null;
  return { label: `${ref} (${commit.slice(0, 9)})`, files, read, readMany: (ps) => readBlobs(commit, ps) };
}

// ─── Check ───────────────────────────────────────────────────────────────────────────────────

function check({ ref = null, roots = DEFAULT_ROOTS } = {}) {
  const tree = loadTree(ref);
  const fileSet = new Set(tree.files);
  const inRoots = (p) => roots.some((r) => p === r || p.startsWith(`${r.replace(/\/$/, '')}/`));
  const sources = tree.files.filter((p) => inRoots(p) && SOURCE_RE.test(p) && !SKIP_DIR_RE.test(p) && !TEST_FILE_RE.test(p));
  const contents = tree.readMany(sources);

  let allow = [];
  if (fileSet.has(ALLOWLIST_PATH)) {
    try { allow = JSON.parse(tree.read(ALLOWLIST_PATH) || '[]'); } catch (_) { allow = []; }
  }
  const allowed = new Map(allow.map((a) => [`${a.from}|${a.spec}`, a.reason || '']));

  const resolve = makeResolver(fileSet, tree.read);
  const unresolved = [];
  const optional = [];
  for (const from of sources) {
    const src = contents.get(from);
    if (src == null) continue;
    for (const r of extract(src)) {
      if (resolve(from, r.spec)) continue;
      const hit = { from, line: r.line, spec: r.spec, kind: r.kind };
      if (r.optional) optional.push({ ...hit, how: 'marked', reason: r.optional });
      else if (allowed.has(`${from}|${r.spec}`)) optional.push({ ...hit, how: 'allowlisted', reason: allowed.get(`${from}|${r.spec}`) });
      else unresolved.push(hit);
    }
  }
  return { label: tree.label, scanned: sources.length, unresolved, optional };
}

function parseArgs(argv) {
  const opts = { ref: null, roots: DEFAULT_ROOTS, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--ref') opts.ref = argv[++i];
    else if (a === '--roots') opts.roots = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else throw new Error(`unknown argument '${a}'`);
  }
  if (opts.ref === undefined || opts.ref === '') throw new Error('--ref needs a branch or commit');
  if (!opts.roots.length) throw new Error('--roots needs at least one directory');
  return opts;
}

function main() {
  let opts;
  let result;
  try {
    opts = parseArgs(process.argv.slice(2));
    result = check(opts);
  } catch (err) {
    console.error(`require-resolution: ${err.message.split('\n')[0]}`);
    process.exit(2);
  }
  const { label, scanned, unresolved, optional } = result;
  if (opts.json) {
    const strip = ({ from, line, spec }) => ({ from, line, spec });
    console.log(JSON.stringify({ ref: label, scanned, unresolved: unresolved.map(strip), optional: optional.map(strip) }, null, 2));
  } else {
    const call = (h) => (h.kind === 'from' || h.kind === 'import' ? `${h.kind} '${h.spec}'` : `${h.kind.replace('()', '')}('${h.spec}')`);
    const show = (h) => `${h.from}:${h.line} ${call(h)}`;
    console.log(`require-resolution: ${label} — ${scanned} files under ${opts.roots.join(', ')}`);
    for (const h of unresolved) console.log(`  ✗ ${show(h)} — no such file on this branch`);
    for (const h of optional) console.log(`  optional (${h.how}): ${show(h)} — ${h.reason}`);
    console.log(`require-resolution: ${unresolved.length} unresolved, ${optional.length} optional`);
    if (unresolved.length) {
      console.log('\nCarry the missing module onto this branch. If the require is optional by design (its caller');
      console.log('catches MODULE_NOT_FOUND and falls back), end its line with `// optional-require: <why>`.');
    }
  }
  process.exit(unresolved.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { check, extract, mask, makeResolver };
