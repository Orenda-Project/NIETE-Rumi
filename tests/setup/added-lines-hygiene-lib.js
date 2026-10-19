/**
 * Added-lines hygiene: the repo is public, so a line of code, a comment or a test name never carries the name of a
 * private work-tracking item (a numbered decision, a reviewer or work-group handle, the org's private workspace name).
 * The tokens are matched by the patterns below; they are assembled from parts so this file is not a hit for its own
 * patterns.
 *
 * Tracker ids (b d - and 4+ letters/digits) are another team's normal convention in this shared repo, so they are
 * NOTED, never failed: both halves print `NOTE: tracker ids …` lines with a count per file, and the allowlist does
 * not store them.
 *
 * Two halves, both in added-lines-hygiene.test.js:
 *   - the tree: every tracked file under bot/, dashboard/, scripts/, tests/ and docs/, counted per FILE (matching
 *     lines, and the distinct tokens), against added-lines-hygiene.allowlist.json — shrink-only, warn-on-less;
 *   - the branch: the ADDED lines of HEAD's diff against its merge-base with origin/sandbox; any hit fails.
 * Tracker ids are noted in both halves, never failed.
 *
 * The allowlist stores each token ROT13-encoded (`tokensRot13`), so the list itself is not a hit.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '../..');
const ROOTS = ['bot', 'dashboard', 'scripts', 'tests', 'docs'];
const LIST = 'added-lines-hygiene.allowlist.json';

const j = (...parts) => parts.join('');
// A numbered decision: any case ("… #12", "… 12").
const DECISION = new RegExp(j('RUL', 'ING'), 'i').source;
const PATTERNS = [
  new RegExp(`${DECISION}\\s*#?\\d+`, 'gi'),
  new RegExp(j('lead', '-review'), 'g'),
  // A numbered review group. Never the bare "r<digit>-": the storage bucket is called r2-default.
  new RegExp(j('r[0-9]-', '(panel|red', 'team)'), 'g'),
  new RegExp(j('jug', 'nu-', 'org'), 'g'),
  new RegExp(j('\\bm-(meas', 'ure|pl', 'ay|cont', 'ent|ident', 'ity|teach', 'er)-?\\d*\\b'), 'g'),
  new RegExp(j('\\bqa-(chi', 'ld|teach', 'er|ident', 'ity)-?\\d*\\b'), 'g'),
];

// A tracker id: b d - and 4+ lowercase letters/digits. Noted, never failed.
const TRACKER = new RegExp(j('\\bb', 'd-[a-z0-9]{4,}'), 'g');

const rot13 = (s) => String(s).replace(/[a-z]/gi, (c) => {
  const b = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b);
});

/** The hygiene tokens on one line, as matched (whitespace collapsed), in order. */
function tokensIn(line) {
  const out = [];
  for (const rx of PATTERNS) {
    rx.lastIndex = 0;
    for (const m of String(line).matchAll(rx)) out.push(m[0].replace(/\s+/g, ' '));
  }
  return out;
}

/** The tracker ids on one line, in order (noted, never failed). */
function trackerIdsIn(line) {
  TRACKER.lastIndex = 0;
  return String(line).match(TRACKER) || [];
}

/**
 * One text → { count: lines with a hit, tokens: distinct tokens, sorted, trackers: lines with a tracker id }, or null
 * when it has neither.
 */
function scanText(text) {
  let count = 0;
  let trackers = 0;
  const tokens = new Set();
  for (const line of String(text).split('\n')) {
    if (trackerIdsIn(line).length) trackers += 1;
    const t = tokensIn(line);
    if (!t.length) continue;
    count += 1;
    t.forEach((x) => tokens.add(x));
  }
  return count || trackers ? { count, tokens: [...tokens].sort(), trackers } : null;
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
}

const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|mp3|mp4|wav|ogg|m4a|woff2?|ttf|otf|zip|gz|xlsx?|docx?|pptx?)$/i;

/** The tracked files under the roots (repo-relative), or a walk of the roots when git cannot list them. */
function trackedFiles() {
  try {
    return git(['ls-files', '-z', '--', ...ROOTS]).split('\0').filter(Boolean);
  } catch (_) {
    const out = [];
    const walk = (dir) => {
      let entries = [];
      try { entries = fs.readdirSync(path.join(REPO, dir), { withFileTypes: true }); } catch (e) { return; }
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (e.isFile()) out.push(rel);
      }
    };
    ROOTS.forEach(walk);
    return out;
  }
}

/**
 * Over the given repo-relative files (binary and unreadable files skipped): `found` { file: { count, tokens } } for
 * files with a hit, and `trackers` { file: lines with a tracker id }.
 */
function scanTree(files = trackedFiles(), read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8')) {
  const found = {};
  const trackers = {};
  for (const f of files) {
    if (BINARY.test(f)) continue;
    let text;
    try { text = read(f); } catch (_) { continue; }
    if (text.includes('\0')) continue;
    const hit = scanText(text);
    if (!hit) continue;
    if (hit.count) found[f] = { count: hit.count, tokens: hit.tokens };
    if (hit.trackers) trackers[f] = hit.trackers;
  }
  return { found, trackers };
}

// A path that itself names a token is stored ROT13-encoded behind this prefix.
const ENCODED = 'rot13:';
const keyOf = (f) => (tokensIn(f).length ? `${ENCODED}${rot13(f)}` : f);
const pathOf = (k) => (k.startsWith(ENCODED) ? rot13(k.slice(ENCODED.length)) : k);

/** The allowlist file's entries decoded: { file: { count, tokens } }. */
function decodeAllowlist(json) {
  const out = {};
  for (const [k, e] of Object.entries((json && json.files) || {})) out[pathOf(k)] = { count: e.count, tokens: (e.tokensRot13 || []).map(rot13) };
  return out;
}

/** A scan as the allowlist file stores it: one line per file, so a cleanup's diff is one line. */
function encodeAllowlist(found, why) {
  const rows = Object.keys(found).sort().map((f) => `    ${JSON.stringify(keyOf(f))}: ${JSON.stringify({ count: found[f].count, tokensRot13: found[f].tokens.map(rot13) })}`);
  return `{\n  "why": ${JSON.stringify(why)},\n  "files": {\n${rows.join(',\n')}\n  }\n}\n`;
}

/**
 * The tree half's verdict. FAIL: a file not listed; a listed file above its count; a token the file's entry does not
 * list. WARN and pass: a listed file below its count (DOWN), at 0 (CLEAN), not in the tree (GONE), or a listed token
 * no longer present. NOTE (never a failure): each file's tracker-id line count.
 */
function treeVerdict(found, allow, exists = (f) => fs.existsSync(path.join(REPO, f)), trackers = {}) {
  const failures = [];
  const warnings = [];
  const notes = Object.keys(trackers).sort().map((f) => `NOTE: tracker ids (noted, never failed): ${f} ${trackers[f]} line(s)`);
  for (const f of [...new Set([...Object.keys(found), ...Object.keys(allow)])].sort()) {
    const now = found[f] || { count: 0, tokens: [] };
    const a = allow[f];
    if (!a) {
      failures.push(`NEW: ${f} has ${now.count} line(s) naming private work items (${now.tokens.join(', ')}). Reword them in product words.`);
      continue;
    }
    if (now.count > a.count) failures.push(`UP: ${f} has ${now.count} such line(s), ${LIST} allows ${a.count}. Reword the new one(s).`);
    const fresh = now.tokens.filter((t) => !a.tokens.includes(t));
    if (fresh.length) failures.push(`NEW TOKEN: ${f} names ${fresh.join(', ')}, not on its entry. Reword it.`);
    if (now.count < a.count) {
      if (now.count === 0 && !exists(f)) warnings.push(`GONE: ${f} is not in this tree. Remove its entry from ${LIST}.`);
      else if (now.count === 0) warnings.push(`CLEAN: ${f} has none now. Remove its entry from ${LIST}.`);
      else warnings.push(`DOWN: ${f} has ${now.count}, ${LIST} says ${a.count}. Lower it to ${now.count}.`);
    } else if (now.count && a.tokens.some((t) => !now.tokens.includes(t))) {
      warnings.push(`DOWN: ${f} no longer names ${a.tokens.filter((t) => !now.tokens.includes(t)).join(', ')}. Drop them from its entry.`);
    }
  }
  return { failures, warnings, notes };
}

/** The added lines of a unified diff (`git diff -U0`): [{ file, line, text }]. */
function addedLines(diff) {
  const out = [];
  let file = null;
  let at = 0;
  for (const l of String(diff).split('\n')) {
    if (l.startsWith('+++ ')) { file = l === '+++ /dev/null' ? null : l.slice(4).replace(/^b\//, ''); continue; }
    if (l.startsWith('--- ')) continue;
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { at = Number(h[1]); continue; }
    if (!file) continue;
    if (l.startsWith('+')) { out.push({ file, line: at, text: l.slice(1) }); at += 1; } else if (!l.startsWith('-') && !l.startsWith('\\')) at += 1;
  }
  return out;
}

/**
 * The branch half's verdict over added lines: every hit fails as `file:line:token`. `onBase(file, text)` true means
 * the same line is already on the base branch's copy of the file (a carried line, e.g. a pick onto another branch),
 * which the tree half counts instead.
 */
function diffVerdict(added, onBase = () => false) {
  const failures = [];
  for (const a of added) {
    const toks = tokensIn(a.text);
    if (!toks.length || onBase(a.file, a.text)) continue;
    for (const t of toks) failures.push(`${a.file}:${a.line}:${t}`);
  }
  return failures;
}

/** The tracker ids on added lines, one NOTE per file with its line count (never a failure). */
function diffNotes(added) {
  const n = new Map();
  for (const a of added) if (trackerIdsIn(a.text).length) n.set(a.file, (n.get(a.file) || 0) + 1);
  return [...n.keys()].sort().map((f) => `NOTE: tracker ids on added lines (noted, never failed): ${f} ${n.get(f)} line(s)`);
}

/** The merge-base of HEAD and origin/sandbox, or null when git or the ref is unavailable. */
function mergeBase(ref = 'origin/sandbox') {
  try { return git(['merge-base', 'HEAD', ref]).trim() || null; } catch (_) { return null; }
}

/** HEAD's added lines since `base`, and a reader of the base ref's copy of a file (null when absent). */
function branchAdded(base, ref = 'origin/sandbox') {
  const added = addedLines(git(['diff', '-U0', '--no-color', '--no-ext-diff', base, 'HEAD']));
  const cache = new Map();
  const onBase = (file, text) => {
    if (!cache.has(file)) {
      let lines = null;
      try { lines = new Set(git(['show', `${ref}:${file}`]).split('\n')); } catch (_) { lines = new Set(); }
      cache.set(file, lines);
    }
    return cache.get(file).has(text);
  };
  return { added, onBase };
}

module.exports = {
  REPO, ROOTS, LIST, PATTERNS, TRACKER, rot13, tokensIn, trackerIdsIn, scanText, trackedFiles, scanTree, decodeAllowlist, encodeAllowlist,
  treeVerdict, addedLines, diffVerdict, diffNotes, mergeBase, branchAdded,
};

if (require.main === module) {
  // `node tests/setup/added-lines-hygiene-lib.js measure` prints the allowlist for today's tree.
  if (process.argv[2] !== 'measure') { process.stderr.write('usage: node tests/setup/added-lines-hygiene-lib.js measure\n'); process.exit(2); }
  const why = 'Files that named private work items before this gate, with their line counts and tokens (ROT13). Tracker ids are noted, never listed. Shrink only: reword in product words, then lower or remove the entry.';
  process.stdout.write(encodeAllowlist(scanTree().found, why));
}
