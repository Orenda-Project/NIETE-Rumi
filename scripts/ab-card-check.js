#!/usr/bin/env node
/**
 * ab-card-check — the CI half of the A/B launch gate.
 *
 * A pull request that ADDS an A/B launch signal must carry a valid entry in ab/registry.json, and arms are chosen
 * only through the shared ab-assign module (assignArm). Signals and the comment rules are ported from the
 * session hook that guards the same thing, minus bare bucket(): here a storage bucket() call is common code.
 *
 *   added ab_<..>_enabled|percentage|share|on|assignment key  → must be a registered flag_key
 *   armFor( abBucket( getVariant( hash(..) % n, getGroup( / selectVariant( beside A/B words → always fails
 *   assignArm(, <x>_ab_<suffix>, *_AB_ENABLED, INSERT INTO an A/B table → needs at least one valid entry
 *   (an app_settings insert counts only through the ab_ key it carries: ordinary settings rows are not launches)
 *   every registry entry: slug test_id (no bead ids), ab_ flag_key, 64-hex card_sha256 (from card.py freeze)
 *
 * A signal counts only when the diff adds it: signals(added lines) minus signals(removed lines), per file.
 * Usage: node scripts/ab-card-check.js <base-ref>   (diffs <base-ref>...HEAD; exit 1 with the problems listed)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LEGACY = new Set(['topic_end_nudge_enabled', 'ab_lp_enabled', 'ab_lp_percentage', 'ab_lp_ch310_enabled',
  'ab_v10_enabled', 'niete_lp_ab_assignment', 'niete_coaching_ab_assignment',
  // The video-clip coaching test went live before the shared module; it keeps its own arm code and switch.
  'VIDEO_RECO_AB_ENABLED']);
const CODE_EXT = new Set(['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.py', '.sql', '.vue', '.json', '.yaml',
  '.yml', '.sh', '.ipynb']);
const HASH_LANGS = new Set(['.py', '.sh', '.yaml', '.yml', '.ipynb']);
const TEST_RE = /(\.test\.|\.spec\.|\/tests?\/|\/__tests__\/|\/test_[^/]*$)/;
const SKIP_RE = [/(^|\/)shared\/services\/ab-assign\.service\.js$/, /^ab\/registry\.json$/,
  /^scripts\/ab-card-check\.js$/, /^\.github\/workflows\/ab-card-check\.yml$/, /(^|\/)\.claude\//,
  /(^|\/)node_modules\//];
const SUF = '(?:enabled|percentage|share|on|assignment)';
const KEY_RE = new RegExp(`\\b(ab_\\w*?_${SUF}|ab_\\$\\{|\\w+_ab_${SUF}|\\w*_AB_ENABLED)\\b`, 'g');
const PICKS = ['armFor', 'abBucket', 'getVariant'];
const CALL_RE = new RegExp(`\\b(${[...PICKS, 'assignArm'].join('|')})\\s*\\(`, 'g');
const SH_CALL_RE = new RegExp(`\\b(${[...PICKS, 'assignArm'].join('|')})\\s+["'$\\w]`, 'g');
const SOFT_RE = /\b(getGroup|selectVariant)\s*\(/g;
const HASH_RE = /\bhash\w*\s*\([^)]*\)\s*%\s*\d/;
const AB_CTX = /\bab_|_ab\b|_ab_|\ba\/b\b|\bexperiment|\barms?\b|\bcohort/i;
const TABLES = '(\\w*_ab_assignment|ab_tests|ab_test_variants|\\w*bandit_(?:arms?|assignments?|polic(?:y|ies)))';
const INS_RE = new RegExp(`\\bINSERT\\s+INTO\\s+(?:\\w+\\.)?"?${TABLES}\\b`, 'gi');
const PICK_SIGNALS = new Set([...PICKS, 'getGroup', 'selectVariant'].map((n) => n + '(').concat('hash(...) % n'));

/** The text with comments dropped, and in .sql the read-only SELECT / WITH / CREATE VIEW statements. */
function codeOnly(text, ext) {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  t = t.replace(/^\s*\*.*$/gm, '');            // a doc-block line whose opener is outside the hunk
  t = t.replace(/(?<!:)\/\/.*$/gm, '');        // '//' after ':' is a URL
  if (HASH_LANGS.has(ext)) t = t.replace(/(?:^|(?<=\s))#.*$/gm, '');
  if (ext === '.sql') {
    t = t.replace(/--.*$/gm, '').split(';').filter((st) =>
      !/^\s*(?:select|with|create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view)\b/i.test(st)).join(';');
  }
  return t;
}

function signals(text, ext) {
  const t = codeOnly(text || '', ext);
  const s = new Set();
  for (const m of t.matchAll(KEY_RE)) s.add(m[1]);
  for (const m of t.matchAll(CALL_RE)) s.add(m[1] + '(');
  for (const m of t.matchAll(SH_CALL_RE)) s.add(m[1] + '(');
  if (AB_CTX.test(t)) for (const m of t.matchAll(SOFT_RE)) s.add(m[1] + '(');
  if (HASH_RE.test(t)) s.add('hash(...) % n');
  for (const m of t.matchAll(INS_RE)) s.add('insert:' + m[1].toLowerCase());
  return s;
}

/** A unified diff → [{file, added, removed}], the added and removed lines of each file joined by newlines. */
function parseDiff(diff) {
  const files = [];
  let cur = null;
  let inHunk = false;
  for (const line of (diff || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = { file: line.replace(/^diff --git a\/.* b\//, ''), added: [], removed: [] };
      files.push(cur);
      inHunk = false;
    } else if (!cur) {
      continue;
    } else if (!inHunk && line.startsWith('+++ ')) {
      if (line !== '+++ /dev/null') cur.file = line.replace(/^\+\+\+ b\//, '');
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk && line.startsWith('+')) {
      cur.added.push(line.slice(1));
    } else if (inHunk && line.startsWith('-')) {
      cur.removed.push(line.slice(1));
    }
  }
  return files.map((f) => ({ file: f.file, added: f.added.join('\n'), removed: f.removed.join('\n') }));
}

function skipped(file) {
  return !CODE_EXT.has(path.extname(file).toLowerCase()) || TEST_RE.test('/' + file)
    || SKIP_RE.some((re) => re.test(file));
}

/** {valid entries, problems} for the registry document. */
function checkRegistry(registry) {
  if (!registry || !Array.isArray(registry.tests)) {
    return { valid: [], problems: ['ab/registry.json must be {"tests": [ ... ]}'] };
  }
  const valid = [];
  const problems = [];
  registry.tests.forEach((e, i) => {
    const id = (e && e.test_id) || `#${i}`;
    const errs = [];
    if (typeof e?.test_id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.test_id)
      || /(^|[^a-z0-9])bd-[a-z0-9]/.test(e.test_id)) errs.push('test_id must be a lower-case slug, never a bead id');
    if (typeof e?.flag_key !== 'string' || !/^ab_[a-z0-9_]+$/.test(e.flag_key)) {
      errs.push('flag_key must start with ab_');
    }
    if (typeof e?.card_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.card_sha256)) {
      errs.push('card_sha256 must be the 64-hex hash card.py freeze printed');
    }
    if (errs.length) problems.push(`registry entry ${id}: ${errs.join('; ')}`);
    else valid.push(e);
  });
  return { valid, problems };
}

/** The pure check: {diff, registry} → {ok, problems}. */
function check({ diff, registry }) {
  const reg = checkRegistry(registry);
  const problems = [...reg.problems];
  const keys = new Set(reg.valid.map((e) => e.flag_key));
  for (const { file, added, removed } of parseDiff(diff)) {
    if (skipped(file)) continue;
    const ext = path.extname(file).toLowerCase();
    const before = signals(removed, ext);
    const sig = [...signals(added, ext)].filter((s) => !before.has(s) && !LEGACY.has(s)).sort();
    for (const s of sig) {
      if (PICK_SIGNALS.has(s)) {
        problems.push(`${file}: ${s} chooses an arm outside the shared ab-assign module; call assignArm instead`);
      } else if (s.startsWith('ab_') && s !== 'ab_${') {
        if (!keys.has(s)) problems.push(`${file}: ${s} is not a flag_key in ab/registry.json; add the entry card.py freeze printed`);
      } else if (!reg.valid.length) {
        problems.push(`${file}: ${s} launches an A/B test but ab/registry.json has no valid entry`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

function readRegistry(root) {
  const p = path.join(root, 'ab', 'registry.json');
  if (!fs.existsSync(p)) return { tests: [] };  // the module and registry may not have landed on this base yet
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return { tests: 'unparseable: ' + e.message };
  }
}

function main(argv) {
  const base = argv[2] || 'origin/main';
  const diff = execFileSync('git', ['diff', '--unified=0', '--no-color', '--no-ext-diff', `${base}...HEAD`],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const r = check({ diff, registry: readRegistry(process.cwd()) });
  if (r.ok) {
    console.log('ab-card-check: no unregistered A/B launch in this diff');
    return 0;
  }
  console.error('ab-card-check: this pull request launches an A/B test the registry does not cover\n');
  for (const p of r.problems) console.error('  - ' + p);
  console.error('\nRegister a kind:test card, run card.py freeze, and add the line it prints to ab/registry.json.');
  return 1;
}

module.exports = { check, parseDiff, signals, checkRegistry };
if (require.main === module) process.exit(main(process.argv));
