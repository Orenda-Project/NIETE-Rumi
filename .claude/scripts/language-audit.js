#!/usr/bin/env node
/**
 * language-audit — the language-debt ratchet, plus the WhatsApp field-cap check.
 *
 * VENDORED into NIETE-Rumi (bd-3lhh9.2) from hyasin270/rumi-agent-home
 * .claude/scripts/language-audit.js @ 3a2b29c. ONE local line differs: DEFAULT_TARGETS scans this
 * repo's bot/shared, under the same `niete` name the workspace uses, so snapshot keys match.
 * Change the logic upstream first, then copy it here again and keep that line. It runs in
 * `npm test` via tests/language/language-ratchet.test.js, so it gates every PR, not only pushes
 * made from the workspace's Claude sessions.
 *
 *   node .claude/scripts/language-audit.js            # compare against the snapshot
 *   node .claude/scripts/language-audit.js --update    # re-baseline (review the diff!)
 *   node .claude/scripts/language-audit.js --report     # counts only, never fails
 *
 * WHY A RATCHET AND NOT A CLEANUP
 *
 * Measured 2026-08-13 across both deployments: the reviewed string catalog covers
 * ~6% of language-dependent text. The other ~94% is inline per-language maps
 * (204 main / 209 NIETE), inline `=== 'ur' ?` ternaries (100 / 92) and
 * `|| 'en'` floors (101 / 77). A 300-site cleanup is not a task anyone will
 * finish, and every one of those sites arrived by accident rather than decision.
 *
 * So this does not demand a cleanup. It pins the per-file counts and fails when
 * any file gets WORSE. Adopting it requires changing nothing — it lands green —
 * and from then on a new inline map or English floor is a red check naming the
 * file. Debt can only ratchet down. This is the "coverage budget" pattern from
 * i18n tooling, inverted to measure debt rather than coverage, because we have no
 * translation-management system to measure coverage against.
 *
 * WHY THE CAP CHECK LIVES HERE TOO
 *
 * A bilingual footer of 87 characters against WhatsApp's 60-character cap made
 * Meta reject an entire message, so `/language` silently sent nothing for hours
 * while every automated check passed. Unit tests never cross the Graph API
 * boundary where the limit exists. Measuring the literals at rest is the only
 * cheap place to catch it — and it is measured in CODE POINTS, because Urdu and
 * emoji make `.length` (UTF-16 units) disagree with what Meta counts.
 *
 * This audits BOTH deployments from the parent workspace, so neither bot repo
 * needs a change to be covered, and one snapshot shows drift between them.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SNAPSHOT = path.join(__dirname, 'language-audit.snapshot.json');

/** Deployments to audit. Relative to the workspace root. */
const DEFAULT_TARGETS = [
  { name: 'niete', dir: 'bot/shared' },   // NIETE-Rumi's copy: this repo only (see the header)
];
// LANG_AUDIT_TARGETS="niete=/abs/path/to/bot/shared[,main-bot=...]" points the scan at the tree
// actually being pushed (a worktree, a fixture) instead of the workspace clones. Snapshot keys are
// `<name>:<rel>`, so the same baseline applies. `--update` is refused under an override: a partial
// scan must never be written as the whole-tree snapshot (pre-push gate, bd-d8zan).
const TARGETS = process.env.LANG_AUDIT_TARGETS
  ? process.env.LANG_AUDIT_TARGETS.split(',').filter(Boolean).map((s) => {
      const i = s.indexOf('=');
      return { name: s.slice(0, i), dir: s.slice(i + 1) };
    })
  : DEFAULT_TARGETS;

/**
 * WhatsApp Cloud API interactive-message limits.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 *
 * Headroom of 5 is deliberate: a string at exactly the cap fails on the next
 * word, and translation almost always lengthens text.
 */
const CAPS = { header: 60, body: 1024, footer: 60, button: 20 };
const CAP_HEADROOM = 5;

/** Count code points, not UTF-16 units — what Meta actually counts. */
const codePoints = (s) => [...s].length;

/**
 * A string literal's text as the runtime builds it (bd-s1m6xu): `ٹ` is one letter, not six
 * characters of source. The bot's observe-strings.js keeps Urdu labels as escapes, and measured raw
 * its 15-letter "ٹیچر منتخب کریں" button read as 80/20 — an outage report for a label Meta accepts.
 * Handles \uXXXX (surrogate pairs included), \u{…}, \xXX, the single-character escapes, and a
 * backslash before a newline, which continues the line and adds nothing.
 */
const SIMPLE_ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0', '\n': '' };
const decodeEscapes = (s) => s.replace(
  /\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g,
  (m, cp, u4, x2, ch) => {
    if (cp) return String.fromCodePoint(parseInt(cp, 16));
    if (u4) return String.fromCharCode(parseInt(u4, 16));
    if (x2) return String.fromCharCode(parseInt(x2, 16));
    return ch in SIMPLE_ESCAPES ? SIMPLE_ESCAPES[ch] : ch;
  });

/**
 * Strip comments before counting anything.
 *
 * Non-negotiable: good code explains itself, so the term a counter looks for is
 * usually named in the comment above it. Five separate guards in this programme
 * passed by matching their own explanatory prose. `[^:]` spares `https://`.
 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Debt signals. Order matters only for readability. */
const DEBT_PATTERNS = {
  // A language decision expressed as control flow instead of data.
  ternaries: /===?\s*['"]ur['"]\s*\?/g,
  // An unreviewed per-language string map, invisible to the catalog and to the
  // cap check that guards the catalog.
  inlineMaps: /\{\s*en\s*:\s*['"`]/g,
  // An independent, unreviewed decision to fall back to English. There were 101
  // of these in the main bot and 0 `|| 'ur'`, which is why a lookup miss
  // degrades silently rather than loudly.
  englishFloors: /\|\|\s*['"]en['"]/g,
  // Placeholder copy that reaches teachers as English via the fallback path.
  sentinels: /__TODO_TRANSLATE__/g,
};

/** Not debt — tracked so improvement is visible alongside it. */
const CREDIT_PATTERNS = { catalog: /resolveUx\s*\(/g };

/**
 * Files whose DESIGNATED PURPOSE is holding per-language data.
 *
 * A per-language map is only debt when it is scattered through a handler or
 * service. Inside the catalog, the registry, the prompt table or the recognition
 * tables, it is the intended shape — that is what "language is data, not code"
 * means in practice.
 *
 * Without this exemption the ratchet is actively harmful: `ux-strings.js` alone
 * contributes 24 of the 413 inline maps, so ADDING A CATALOG ENTRY — the exact
 * remediation this tool exists to encourage — would fail the check. A guard that
 * punishes the fix teaches people to route around the guard. Found by running the
 * tool against the real tree; no unit test would have surfaced it.
 *
 * These files are still subject to the cap check and the sentinel check. Being
 * the right home for a string does not make an over-long string safe.
 */
const CATALOG_FILES = /(^|\/)config\/(ux-strings|languages|language-config|language-prompts|system-messages|tts-voices|gamma-languages\.config)\.js$|(^|\/)utils\/language-detector\.js$/;

const isCatalogFile = (relPath) => CATALOG_FILES.test(relPath);

const ZERO = { ternaries: 0, inlineMaps: 0, englishFloors: 0, sentinels: 0, catalog: 0 };
const DEBT_KEYS = Object.keys(DEBT_PATTERNS);

function countDebt(rawSrc, relPath = '') {
  const src = stripComments(rawSrc);
  const out = { ...ZERO };
  for (const [k, re] of Object.entries({ ...DEBT_PATTERNS, ...CREDIT_PATTERNS })) {
    out[k] = (src.match(re) || []).length;
  }
  // A designated catalog is where per-language maps BELONG. Zeroing this (rather
  // than skipping the file) keeps its ternaries, floors, sentinels and caps
  // counted — only the map shape is exempt.
  if (isCatalogFile(relPath)) out.inlineMaps = 0;
  return out;
}

/**
 * Find literal text assigned to a length-capped WhatsApp field.
 *
 * Interpolated values are skipped, not guessed: `${data.heading}` has no length
 * at rest, and pretending otherwise produces false positives that get the whole
 * check switched off. Those surfaces are covered by language-parity instead.
 */
function findCapViolations(rawSrc, file) {
  const src = stripComments(rawSrc);
  const hits = [];
  for (const [field, cap] of Object.entries(CAPS)) {
    // `footer: { text: '…' }` and the flatter `footer: '…'`
    const patterns = [
      new RegExp(`${field}\\s*:\\s*\\{[^{}]*?text\\s*:\\s*(["'\`])([\\s\\S]*?)\\1`, 'g'),
      new RegExp(`${field}\\s*:\\s*(["'\`])([\\s\\S]*?)\\1`, 'g'),
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(src)) !== null) {
        if (m[2].includes('${')) continue;      // runtime-injected
        const text = decodeEscapes(m[2]);
        const len = codePoints(text);
        if (len <= cap - CAP_HEADROOM) continue;
        // Two severities, deliberately. Over the cap is an OUTAGE NOW — Meta
        // rejects the whole message and the feature sends nothing. Inside the
        // headroom band is AT RISK — it works today and breaks on the next word
        // or the next translation. Only the first gates, so the check can be
        // adopted without first editing product copy; the second is the early
        // warning that would have flagged the /language footer before it grew.
        hits.push({
          file, field, cap, len,
          severity: len > cap ? 'violation' : 'at-risk',
          sample: text.slice(0, 48),
        });
      }
    }
  }
  return hits;
}

// ── walking ───────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/node_modules|__mocks__|\.git|dist|build|coverage|__tests__|\btests?\b/.test(p)) continue;
      walk(p, out);
    } else if (/\.(js|ts|tsx)$/.test(p) && !/\.test\.|\.spec\./.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function scan() {
  const counts = {};
  const capHits = [];
  const found = [];
  const absent = [];
  for (const t of TARGETS) {
    const abs = path.resolve(REPO_ROOT, t.dir);   // resolve, not join: an override dir may be absolute
    if (!fs.existsSync(abs)) { absent.push(t.dir); continue; }
    found.push(t.dir);
    for (const f of walk(abs)) {
      let src;
      try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
      const rel = path.relative(abs, f);
      const key = `${t.name}:${rel}`;
      counts[key] = countDebt(src, rel);
      capHits.push(...findCapViolations(src, key));
    }
  }
  return { counts, capHits, found, absent };
}

// ── ratchet ───────────────────────────────────────────────────────────────────
/** Keep only files carrying debt, sorted, so the snapshot is small and stable. */
function canonicalise(counts) {
  const out = {};
  for (const f of Object.keys(counts).sort()) {
    const c = counts[f];
    if (DEBT_KEYS.some((k) => (c[k] || 0) > 0)) out[f] = c;
  }
  return out;
}

/**
 * Compare per file, per signal. Only increases fail; decreases and deletions are
 * improvements. Credit signals (catalog use) can never fail the check.
 */
function compare(now, base) {
  const r = { worsened: [], improved: [], clean: true };
  for (const file of new Set([...Object.keys(now), ...Object.keys(base)])) {
    const a = { ...ZERO, ...(base[file] || {}) };
    const b = { ...ZERO, ...(now[file] || {}) };
    const up = {};
    const down = {};
    for (const k of DEBT_KEYS) {
      const d = (b[k] || 0) - (a[k] || 0);
      if (d > 0) up[k] = d;
      else if (d < 0) down[k] = -d;
    }
    if (Object.keys(up).length) r.worsened.push({ file, deltas: up });
    if (Object.keys(down).length) r.improved.push({ file, deltas: down });
  }
  r.worsened.sort((x, y) => x.file.localeCompare(y.file));
  r.improved.sort((x, y) => x.file.localeCompare(y.file));
  r.clean = r.worsened.length === 0;
  return r;
}

function totals(counts) {
  const t = { ...ZERO, files: 0 };
  for (const c of Object.values(counts)) {
    t.files++;
    for (const k of Object.keys(ZERO)) t[k] += c[k] || 0;
  }
  return t;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const update = argv.includes('--update');
  const reportOnly = argv.includes('--report');
  if (update && process.env.LANG_AUDIT_TARGETS) {
    console.error('language-audit: refusing --update under LANG_AUDIT_TARGETS — a partial scan must not become the snapshot.');
    process.exit(2);
  }

  const { counts, capHits, found, absent } = scan();

  // Refuse to report on nothing.
  //
  // The bot repos are separate clones that exist only in the main workspace
  // checkout, so from a git worktree every target is absent and the scan returns
  // zero files. An empty scan compared against the snapshot reads as "every file
  // improved" and would PASS — a silent false pass, which is the exact failure this
  // tool exists to remove. Verified from a worktree on 2026-08-13: files scanned 0.
  if (!found.length) {
    console.error('language-audit: none of the audited directories exist here.');
    for (const d of absent) console.error(`  missing: ${d}`);
    console.error('\n  The bot repos live only in the main workspace checkout, not in a');
    console.error('  git worktree. Run this from the workspace root.');
    process.exit(2);
  }
  const t = totals(counts);
  const debt = t.ternaries + t.inlineMaps + t.englishFloors;
  const reviewed = debt + t.catalog ? ((t.catalog / (debt + t.catalog)) * 100).toFixed(1) : '0.0';

  console.log('language-audit');
  console.log(`  files scanned      ${t.files}`);
  console.log(`  inline maps        ${t.inlineMaps}`);
  console.log(`  ur ternaries       ${t.ternaries}`);
  console.log(`  || 'en' floors     ${t.englishFloors}`);
  console.log(`  translate sentinels ${t.sentinels}`);
  console.log(`  catalog uses       ${t.catalog}`);
  console.log(`  reviewed share     ${reviewed}%  (catalog / catalog+debt)`);

  const capViolations = capHits.filter((h) => h.severity === 'violation');
  const capAtRisk = capHits.filter((h) => h.severity === 'at-risk');

  if (capViolations.length) {
    console.error('\n  FIELD-CAP VIOLATIONS — over the cap. Meta rejects the whole message:');
    for (const h of capViolations) {
      console.error(`    ${h.file}  ${h.field} ${h.len}/${h.cap}  "${h.sample}"`);
    }
  }
  if (capAtRisk.length) {
    console.log(`\n  at risk — inside ${CAP_HEADROOM} code points of the cap (works now, breaks on the next word):`);
    for (const h of capAtRisk) {
      console.log(`    ${h.file}  ${h.field} ${h.len}/${h.cap}  "${h.sample}"`);
    }
  }
  if (!capHits.length) console.log('  field caps         ok');

  if (update) {
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(canonicalise(counts), null, 2)}\n`);
    console.log(`\n  snapshot written: ${path.relative(REPO_ROOT, SNAPSHOT)}`);
    console.log('  Review the diff before committing — an accidental --update accepts');
    console.log('  every regression present in the tree right now.');
    return;
  }

  if (reportOnly) return;

  if (!fs.existsSync(SNAPSHOT)) {
    console.error(`\n  no snapshot at ${path.relative(REPO_ROOT, SNAPSHOT)}`);
    console.error('  record one from a known-good tree: node .claude/scripts/language-audit.js --update');
    process.exit(2);
  }

  const base = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const r = compare(canonicalise(counts), base);

  if (r.improved.length) {
    console.log('\n  improved:');
    for (const i of r.improved) {
      console.log(`    ${i.file}  ${Object.entries(i.deltas).map(([k, v]) => `-${v} ${k}`).join(', ')}`);
    }
  }

  // Over-cap literals gate independently of the ratchet: that is a live outage,
  // not accumulated debt. At-risk strings only warn, so adopting this tool never
  // requires editing product copy first.
  if (r.clean && !capViolations.length) {
    console.log('\n  CLEAN — no file gained language debt, no field-cap violation.');
    if (capAtRisk.length) console.log(`  (${capAtRisk.length} string(s) at risk near a cap — not gating, but worth shortening.)`);
    return;
  }

  if (r.worsened.length) {
    console.error('\n  NEW language debt:');
    for (const w of r.worsened) {
      console.error(`    ${w.file}  ${Object.entries(w.deltas).map(([k, v]) => `+${v} ${k}`).join(', ')}`);
    }
    console.error('\n  Route the string through the catalog (resolveUx) instead of adding');
    console.error('  an inline map, ternary or English floor. See the language-protocol skill.');
  }
  process.exit(1);
}

if (require.main === module) main();

module.exports = {
  stripComments, codePoints, decodeEscapes, countDebt, findCapViolations,
  canonicalise, compare, totals, scan, CAPS, CAP_HEADROOM,
  isCatalogFile, CATALOG_FILES,
};
