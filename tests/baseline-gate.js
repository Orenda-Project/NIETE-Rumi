#!/usr/bin/env node
/**
 * The baseline gate — computes what `tests/BASELINE.md` only described.
 *
 * This repo's suite is not green and has not been for a while, so the merge rule is
 * "no NEW failure" rather than "all green". That rule lived in prose, which gave it
 * exactly one bit of resolution: the suite is red, so a *new* violation inside an
 * already-red suite changed nothing observable and passed review unnoticed.
 *
 * That is not hypothetical. `source-hygiene` was already failing for unrelated reasons
 * when internal ticket references were added to public source — precisely what that
 * guard exists to prevent. Suite result: red before, red after. Offender list: 683
 * entries before, 686 after. Only the third number was a regression.
 *
 * So this gate compares at three levels of resolution:
 *
 *   1. SUITE    — a suite that was passing now fails
 *   2. TEST     — a suite already failing now fails additional tests
 *   3. OFFENDER — a suite already failing reports entries it did not report before
 *
 * Level 3 is the one that matters for the conformance guards in tests/setup/, because
 * those assert `expect(offenders).toEqual([])` — the whole finding lives in the diff,
 * not in the pass/fail. An offender that names `path:line` is compared by what that line
 * SAYS, not by where it sits (keyOffenders), so an edit that only moves lines is clean.
 *
 * Improvements are never regressions: fewer offenders, fewer failing tests, or a suite
 * going green are all reported and all clean. A gate that fires on progress gets muted.
 *
 * Usage:
 *   node tests/baseline-gate.js              # compare this run against the snapshot
 *   node tests/baseline-gate.js --update     # re-record the snapshot (review the diff!)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SNAPSHOT = path.join(REPO, 'tests', 'baseline.snapshot.json');
const BASELINE_MD = path.join(REPO, 'tests', 'BASELINE.md');

/** Jest writes colour codes into failureMessages even under --json. */
// The ESC byte is written as an explicit \x1b escape, NOT as a literal control
// character. A literal ESC in source is invisible in every diff and review, and any
// editor or lint autofix that normalises it silently turns this into a no-op — after
// which every coloured diff line fails the `^\s*\+` anchor and offenders are dropped
// WITHOUT the gate reporting anything. `extractOffenders` has tests pinning both
// coloured cases precisely so that regression cannot land quietly.
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

/**
 * Pull the ADDED entries out of a jest array diff.
 *
 * Only `+` lines count. A `-` line means the baseline had something this run does not,
 * which is an improvement. Returns a sorted set so jest's print order — which is not
 * stable across runs for a Set-derived array — cannot produce a phantom regression.
 */
function extractOffenders(message) {
  if (!message) return [];
  const found = new Set();
  const text = stripAnsi(message);   // hoisted: /g keeps lastIndex across iterations
  const re = /^\s*\+\s+"([^"]+)"/gm;
  let m;
  while ((m = re.exec(text)) !== null) found.add(m[1]);
  return [...found].sort();
}

/** Absolute paths differ per checkout; the snapshot has to be portable. */
function relSuite(name) {
  const i = name.lastIndexOf('/tests/');
  return i >= 0 ? name.slice(i + 1) : name;
}

/**
 * Collapse a `jest --json` report into { suite: { failing, offenders } }.
 * Passing suites are omitted — the snapshot records what is broken, so a suite going
 * green shrinks the file rather than leaving a stale "expected to fail" entry behind.
 *
 * With `opts.lineAt` (see repoLineReader), `path:line` offenders are keyed by their line's
 * text (keyOffenders), and `at` maps each such key to where its line is now, for the report.
 * `at` is never written to the snapshot (canonicalise drops it).
 */
function summariseRun(report, opts = {}) {
  const out = {};
  for (const suite of report.testResults || []) {
    const failing = [];
    const offenders = new Set();
    for (const a of suite.assertionResults || []) {
      if (a.status !== 'failed') continue;
      failing.push(a.fullName);
      for (const msg of a.failureMessages || []) {
        for (const o of extractOffenders(msg)) offenders.add(o);
      }
    }
    // A suite can fail to even load, in which case there are no assertionResults but
    // the suite still counts as broken.
    const crashed = failing.length === 0 && suite.status === 'failed';
    if (failing.length || crashed) {
      const keyed = keyOffenders([...offenders], opts.lineAt);
      const entry = { failing: failing.sort(), offenders: keyed.map((k) => k.key).sort() };
      const at = {};
      for (const k of keyed) if (k.line) at[k.key] = `${k.file}:${k.line}`;
      if (Object.keys(at).length) entry.at = at;
      out[relSuite(suite.name)] = entry;
    }
  }
  return out;
}

const missing = (a, b) => a.filter((x) => !b.includes(x));

/**
 * Never record a documented-flaky suite as baseline.
 *
 * Without this, running --update at an unlucky moment bakes a flaky suite in as an
 * accepted failure — permanently excusing it, and making every later run where it
 * PASSES show up as "fixed" noise. Returns a new object; callers keep their input.
 */
function pruneFlaky(snapshot, flaky = []) {
  const out = {};
  for (const [suite, v] of Object.entries(snapshot)) {
    if (!flaky.includes(suite)) out[suite] = v;
  }
  return out;
}

/**
 * Sort suite keys before writing.
 *
 * Jest reports suites in a different order every run, so an unsorted snapshot changes
 * on every --update even when nothing is actually different. That matters more than it
 * sounds: "review the diff before committing" is the ONLY safeguard against --update
 * quietly swallowing a regression, and a diff that rewrites all 24 entries every time
 * is a diff nobody reads. Values are already sorted by summariseRun.
 *
 * Where a line sits NOW (`at`) is dropped: the snapshot records what an offender says,
 * and a line number in it would churn on every edit above it.
 */
function canonicalise(snapshot) {
  const out = {};
  for (const suite of Object.keys(snapshot).sort()) {
    const recorded = { ...snapshot[suite] };
    delete recorded.at;
    out[suite] = recorded;
  }
  return out;
}

/**
 * Compare a run against the baseline snapshot.
 *
 * `opts.flaky` names suites BASELINE.md documents as non-deterministic. A failure there
 * is inconclusive by policy, so it is surfaced separately and does not fail the gate —
 * otherwise the gate is red at random and stops being read.
 */
function compareSnapshots(now, base, opts = {}) {
  const flaky = opts.flaky || [];
  const r = {
    newSuites: [],
    newTests: [],
    newOffenders: [],
    flakyFailures: [],
    fixedSuites: [],
    fixedTests: [],
    fixedOffenders: [],
    clean: true,
  };

  for (const suite of Object.keys(now)) {
    if (flaky.includes(suite)) {
      r.flakyFailures.push(suite);
      continue;
    }
    if (!(suite in base)) {
      r.newSuites.push(suite);
      continue;
    }
    const newT = missing(now[suite].failing, base[suite].failing);
    const gotT = missing(base[suite].failing, now[suite].failing);
    // Per violation, not per raw string: a guard that reports `path:line` moves an
    // untouched violation whenever anything above it is edited. See offenderDelta.
    const { added: newO, removed: gotO } =
      offenderDelta(now[suite].offenders, base[suite].offenders);
    if (newT.length) r.newTests.push({ suite, tests: newT });
    if (gotT.length) r.fixedTests.push({ suite, tests: gotT });
    if (newO.length) r.newOffenders.push({ suite, offenders: newO });
    if (gotO.length) r.fixedOffenders.push({ suite, offenders: gotO });
  }

  for (const suite of Object.keys(base)) {
    if (!(suite in now) && !flaky.includes(suite)) r.fixedSuites.push(suite);
  }

  r.newSuites.sort();
  r.fixedSuites.sort();
  r.clean = !r.newSuites.length && !r.newTests.length && !r.newOffenders.length;
  return r;
}

/**
 * Read the flaky list straight out of BASELINE.md rather than duplicating it.
 * Two sources of truth for "which suites are flaky" is one too many.
 */
function flakyFromBaselineDoc(md = BASELINE_MD) {
  if (!fs.existsSync(md)) return [];
  const text = fs.readFileSync(md, 'utf8');
  const section = text.split(/^###\s+Flaky/m)[1];
  if (!section) return [];
  const block = section.match(/```([\s\S]*?)```/);
  if (!block) return [];
  return block[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith('.test.js'));
}

/**
 * Keep only the regressions that reproduce across two independent runs.
 *
 * A gate that goes red at random gets switched off — which is literally how this
 * repo's CI ended up `disabled_manually`. `tests/training/portal-grand-quiz.test.js`
 * fails about one run in fourteen (its `jest.doMock` of the shared certificate
 * service intermittently loses to the real module), and one such suite is enough to
 * make every fourteenth PR red for a reason nobody can act on.
 *
 * So a suspected regression is CONFIRMED by a second full run and only what appears
 * in BOTH counts. Confirmation is per-run and costs nothing on the happy path: the
 * second run happens only when the first looks red.
 *
 * This is deliberately not the flaky list. A flaky-list entry is permanent and
 * excuses a suite forever; confirmation still fails the moment a failure is real and
 * reproducible. Use the list for a suite whose flakiness is understood and accepted,
 * and confirmation for everything else.
 *
 * Returns a new result; neither input is mutated. `unconfirmed` carries what did not
 * reproduce, so a transient failure is still reported rather than silently dropped.
 */
function confirmRegressions(first, second, opts = {}) {
  const arr = (x) => x || [];
  const secondSuites = new Set(arr(second.newSuites));
  const newSuites = arr(first.newSuites).filter((x) => secondSuites.has(x));
  const staleSuites = arr(first.newSuites).filter((x) => !secondSuites.has(x));

  const index = (entries, field) => {
    const m = new Map();
    for (const e of arr(entries)) m.set(e.suite, new Set(e[field]));
    return m;
  };

  const split = (entries, field, seen) => {
    const kept = [];
    const stale = [];
    for (const e of arr(entries)) {
      const also = seen.get(e.suite) || new Set();
      const c = e[field].filter((x) => also.has(x));
      const u = e[field].filter((x) => !also.has(x));
      if (c.length) kept.push({ suite: e.suite, [field]: c });
      if (u.length) stale.push({ suite: e.suite, [field]: u });
    }
    return [kept, stale];
  };

  const [newTests, staleTests] = split(first.newTests, 'tests', index(second.newTests, 'tests'));
  const [newOffenders, staleOffenders] =
    split(first.newOffenders, 'offenders', index(second.newOffenders, 'offenders'));

  // A flaky-listed suite that failed in BOTH runs is behaving like a real failure. See
  // needsConfirmation for why the second run exists even when the first looked clean.
  const secondFlaky = new Set(arr(second.flakyFailures));
  const flakyTwice = arr(first.flakyFailures).filter((s) => secondFlaky.has(s)).sort();
  const strict = !!opts.strictFlaky && flakyTwice.length > 0;

  return {
    ...first,
    newSuites,
    newTests,
    newOffenders,
    flakyTwice,
    unconfirmed: { newSuites: staleSuites, newTests: staleTests, newOffenders: staleOffenders },
    clean: !newSuites.length && !newTests.length && !newOffenders.length && !strict,
  };
}

/**
 * Does this first run need the confirmation run?
 *
 * Yes when it looks red — and ALSO when a flaky-listed suite failed. A flaky failure never
 * gates, so without a second run there is no way to tell a flake from a suite that has
 * started failing every time; the Flaky list then hides a deterministic red for as long as
 * nobody reads it. The portal certificate suites were exactly that from 2026-09-18.
 */
function needsConfirmation(first) {
  return !first.clean || (first.flakyFailures || []).length > 0;
}

/**
 * Whether a flaky-listed suite that failed in BOTH runs fails the gate. Advisory by
 * default; `BASELINE_FLAKY_TWICE=gate` makes it gate. Exactly that value and no other, so
 * a typo cannot turn a gate on or off by accident.
 */
function flakyTwiceGates(env = process.env) {
  return env.BASELINE_FLAKY_TWICE === 'gate';
}

/**
 * Parse the gate's own flags, and report anything it cannot honour.
 *
 * The gate runs the WHOLE suite and compares the result against a full snapshot, so
 * it cannot accept a path filter: a filtered run would report every un-run baseline
 * suite as "fixed", and `npm test -- tests/nothing/` would exit 0 having tested
 * nothing. Refusing the argument is the only safe behaviour — silently dropping it
 * is how a green check comes to mean nothing.
 *
 * Learned the hard way. When `npm test` became the gate, three Android workflows and
 * the qa-testing skill were still passing `-- tests/portal/` and
 * `-- --testPathPattern=coaching`. The filters were dropped without a word, so those
 * jobs went from 289 tests to 4,784, stayed green, and stopped doing what they said.
 * Anything filtered belongs on `npm run test:raw`.
 */
function parseCliArgs(argv) {
  const known = new Set(['--update', '--no-retry']);
  return {
    update: argv.includes('--update'),
    retry: !argv.includes('--no-retry'),
    unknown: argv.filter((a) => !known.has(a)),
  };
}

// ── Offender keys ────────────────────────────────────────────────────────────
/**
 * The tests/setup/ guards name most offenders as `path:line`, sometimes with detail after
 * it. A line number is WHERE a violation sits, and it moves whenever anything above it is
 * edited. The snapshot has to record WHAT the violation is.
 *
 * History, so nobody walks back into it:
 *   - 2026-09-04: raw strings. 70 additions reported on the staging sync, 2 real; the other
 *     68 had moved (`no-hardcoded-bot-name`: three identical strings, lines 198/365/572 ->
 *     202/372/575).
 *   - 2026-09-23: count per file. A shift alone went quiet, but once a file's count grew for
 *     any reason, every line of it not present verbatim in the snapshot was named, and a
 *     line that moved is never verbatim. PR #4208: `teacher-training-endpoint.js` had the
 *     same 98 ticket-ref lines before and after the change, the snapshot held 97, and the
 *     gate named 88 of them as NEW. `test (22)` was red on every PR, so nobody read it.
 *   - now: by content. `path :: <the line's text>`, and `path #N :: <text>` for the Nth line
 *     in a file with the same text.
 */
const POSITION_RE = /^([^\s:]+):(\d+)/;
const CONTENT_KEY_RE = /^([^\s:]+)(?: #(\d+))? :: ([\s\S]*)$/;

/** Whitespace is not content: re-indenting a line or retabbing it must not make it new. */
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();

function contentKey(file, text, n = 1) {
  return `${file}${n > 1 ? ` #${n}` : ''} :: ${text}`;
}

function parseContentKey(s) {
  const m = CONTENT_KEY_RE.exec(String(s));
  return m ? { file: m[1], n: m[2] ? Number(m[2]) : 1, text: m[3] } : null;
}

/**
 * Key each offender by what it says rather than where it sits.
 *
 * A `path:line` offender whose line can be read becomes `path :: <that line, whitespace
 * collapsed>`. Lines in one file with the same text are numbered in line order, and the
 * second becomes `path #2 :: <text>`, so a copy of an existing violation is still a new
 * key: a bare `path:line` guard (source-hygiene) cannot hide a duplicate. Detail a guard
 * appends after `path:line` is not part of the key; the line is.
 *
 * Everything else is kept as it is. An offender with no line (`video_requests.observer_debrief`)
 * already says what it is. A `path:line` whose line cannot be read stays positional, and
 * offenderDelta compares it by count per file, as the gate did before.
 *
 * `lineAt(file, n)` returns line n (1-based) of a repo file, or null; without it nothing is
 * keyed. Returns [{ key, file?, line? }], where `file:line` is where a keyed line is NOW.
 */
function keyOffenders(raws, lineAt) {
  const out = [];
  const located = [];
  for (const raw of raws) {
    const m = POSITION_RE.exec(raw);
    const text = m && lineAt ? lineAt(m[1], Number(m[2])) : null;
    if (typeof text === 'string') located.push({ raw, file: m[1], line: Number(m[2]), text: squash(text) });
    else out.push({ key: raw });
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  located.sort((a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.raw, b.raw));
  const seen = new Map();
  for (const o of located) {
    const id = `${o.file}\u0000${o.text}`;
    const n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    out.push({ key: contentKey(o.file, o.text, n), file: o.file, line: o.line });
  }
  return out;
}

/**
 * Read lines of the tree the guards just scanned: the gate runs in the same checkout.
 * Cached per file. Null for a path outside `root`, anything that is not a readable file,
 * or a line out of range.
 */
function repoLineReader(root = REPO) {
  const top = path.resolve(root);
  const cache = new Map();
  const load = (file) => {
    const abs = path.resolve(top, file);
    if (!abs.startsWith(top + path.sep)) return null;
    try {
      return fs.readFileSync(abs, 'utf8').split('\n');
    } catch {
      return null;
    }
  };
  return (file, n) => {
    if (!cache.has(file)) cache.set(file, load(file));
    const lines = cache.get(file);
    return lines && Number.isInteger(n) && n >= 1 && n <= lines.length ? lines[n - 1] : null;
  };
}

/**
 * How the report prints an offender: where its line is NOW, then what it says. A human
 * chasing it needs the line number, even though the snapshot never records one. `at` maps
 * a key to its current `path:line` (summariseRun keeps it for the run it read).
 */
function describeOffender(key, at) {
  const c = parseContentKey(key);
  if (!c) return key;
  if (at && at[key]) return `${at[key]}  ${c.text}`;
  return `${c.file}${c.n > 1 ? ` (#${c.n})` : ''}  ${c.text}`;
}

/**
 * The `path:line` comparison, kept for entries that are still positional: a line the gate
 * could not read, or a snapshot recorded before content keys (staging and main keep their
 * own until they are re-recorded). Drops only the FIRST `:<digits>` after a path, so
 * detail after it still tells two violations in one file apart, and an offender with no
 * line (`video_requests.observer_debrief`) is untouched.
 */
function normaliseOffender(s) {
  return String(s).replace(/^([^\s:]+):\d+/, '$1:L');
}

/**
 * Which offenders are genuinely NEW in `now`, and which are genuinely GONE from `base`.
 *
 * Content keys compare as a set: a key on one side and not the other is the finding.
 *
 * A `path:line` entry cannot be translated into a content key without the tree it was
 * recorded on, so a FILE that has entries in both forms (a positional snapshot entry
 * against a content-keyed run, or the reverse) is judged by how many violations it carries,
 * and so is a positional entry against another positional one (per normaliseOffender). In
 * both, when a count grows, every entry not present verbatim on the other side is named:
 * one of them is the new one. Returns sorted arrays; inputs are not mutated.
 */
function offenderDelta(now = [], base = []) {
  const fileOf = (x) => {
    const c = parseContentKey(x);
    if (c) return { file: c.file, form: 'text' };
    const p = POSITION_RE.exec(x);
    return p ? { file: p[1], form: 'line' } : null;
  };
  const forms = new Map();
  for (const x of [...now, ...base]) {
    const f = fileOf(x);
    if (!f) continue;
    if (!forms.has(f.file)) forms.set(f.file, new Set());
    forms.get(f.file).add(f.form);
  }
  const groupOf = (x) => {
    const f = fileOf(x);
    return f && forms.get(f.file).size > 1 ? `\u0000${f.file}` : normaliseOffender(x);
  };
  const group = (list) => {
    const m = new Map();
    for (const raw of list) {
      const k = groupOf(raw);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(raw);
    }
    return m;
  };
  const beyond = (from, against) => {
    const other = group(against);
    const out = [];
    for (const [k, raws] of group(from)) {
      const theirs = other.get(k) || [];
      if (raws.length <= theirs.length) continue;
      const verbatim = new Set(theirs);
      out.push(...raws.filter((x) => !verbatim.has(x)));
    }
    return out.sort();
  };
  return { added: beyond(now, base), removed: beyond(base, now) };
}

/**
 * Compare two snapshots and report whether the baseline GREW.
 *
 * "The snapshot may only ever shrink" was written into BASELINE.md and CLAUDE.md and
 * enforced by nothing, which is precisely the shape of the bug this gate exists to
 * fix: a rule in prose that nothing computes. Without this, a PR can add its own
 * failures to the snapshot and the gate passes, cleanly, saying CLEAN.
 *
 * Shrinking is the goal, so a removal is never flagged. Growth is flagged at all
 * three levels the gate itself compares, for the same reason: a new offender inside
 * an already-accepted suite is the level the real incident lived at.
 */
function snapshotGrowth(before, after) {
  const list = (o, k, f) => (o[k] ? o[k][f] || [] : []);
  const addedSuites = Object.keys(after).filter((s) => !(s in before)).sort();
  const removedSuites = Object.keys(before).filter((s) => !(s in after)).sort();

  // `outKey` is separate from `field` on purpose: the snapshot stores the test list
  // under `failing`, but every other result in this file calls it `tests`, and a
  // reader comparing gate output to growth output should not have to notice.
  const grown = (field, outKey) => {
    const out = [];
    for (const suite of Object.keys(after)) {
      if (!(suite in before)) continue;          // covered by addedSuites
      const was = new Set(list(before, suite, field));
      const now = list(after, suite, field).filter((x) => !was.has(x));
      if (now.length) out.push({ suite, [outKey]: now.sort() });
    }
    return out.sort((a, b) => a.suite.localeCompare(b.suite));
  };

  const addedTests = grown('failing', 'tests');

  // Offenders are compared the way the gate compares them (offenderDelta): by content key,
  // so a violation that merely moved line is not growth while a second copy of one is; and
  // by count per file wherever one side still holds `path:line` entries.
  const addedOffenders = [];
  for (const suite of Object.keys(after)) {
    if (!(suite in before)) continue;
    const { added } = offenderDelta(list(after, suite, 'offenders'), list(before, suite, 'offenders'));
    if (added.length) addedOffenders.push({ suite, offenders: added });
  }
  addedOffenders.sort((a, b) => a.suite.localeCompare(b.suite));
  return {
    grew: !!(addedSuites.length || addedTests.length || addedOffenders.length),
    addedSuites,
    removedSuites,
    addedTests,
    addedOffenders,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function runJest() {
  const out = path.join(require('os').tmpdir(), `niete-jest-${process.pid}.json`);
  try {
    execFileSync(process.execPath, [
      path.join(REPO, 'tests', 'run.js'), '--json', `--outputFile=${out}`,
    ], { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });
  } catch {
    // Non-zero exit is expected — the suite is red by design. The JSON is what matters.
  }
  if (!fs.existsSync(out)) {
    console.error('baseline-gate: jest produced no JSON report. Run `npm test` and fix that first.');
    process.exit(2);
  }
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.unlinkSync(out);
  return report;
}

function list(label, items, fmt = (x) => x) {
  if (!items.length) return;
  console.log(`\n${label}`);
  for (const i of items) console.log(`  ${fmt(i)}`);
}

function main() {
  const { update, retry, unknown } = parseCliArgs(process.argv.slice(2));
  if (unknown.length) {
    console.error(`baseline-gate: cannot honour ${unknown.map((a) => `"${a}"`).join(', ')}.`);
    console.error('');
    console.error('  `npm test` is the baseline gate. It runs the WHOLE suite and compares the');
    console.error('  result against tests/baseline.snapshot.json, so it cannot take a path or');
    console.error('  pattern filter — a filtered run would report every suite it did not run as');
    console.error('  "fixed", and would exit 0 having tested almost nothing.');
    console.error('');
    console.error('  For a filtered run, use raw jest, which takes any jest argument:');
    console.error(`    npm run test:raw -- ${unknown.join(' ')}`);
    console.error('');
    console.error('  The gate itself accepts only --update and --no-retry. See tests/BASELINE.md.');
    process.exit(2);
  }
  const flaky = flakyFromBaselineDoc();
  // The guards scanned this checkout, so its lines are the ones their `path:line` names.
  const now = summariseRun(runJest(), { lineAt: repoLineReader(REPO) });

  if (update) {
    const dropped = Object.keys(now).filter((s) => flaky.includes(s));
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(canonicalise(pruneFlaky(now, flaky)), null, 2)}\n`);
    if (dropped.length) {
      console.log(`baseline-gate: excluded ${dropped.length} flaky suite(s) from the snapshot:`);
      for (const d of dropped) console.log(`  ${d}`);
    }
    const kept = pruneFlaky(now, flaky);
    const suites = Object.keys(kept).length;
    const offenders = Object.values(kept).reduce((n, s) => n + s.offenders.length, 0);
    console.log(`baseline-gate: snapshot written — ${suites} failing suites, ${offenders} offenders.`);
    console.log(`  ${path.relative(REPO, SNAPSHOT)}`);
    console.log('  Review the diff before committing: an accidental --update hides every regression it swallowed.');
    return;
  }

  if (!fs.existsSync(SNAPSHOT)) {
    console.error(`baseline-gate: no snapshot at ${path.relative(REPO, SNAPSHOT)}.`);
    console.error('  Record one from a known-good tree: node tests/baseline-gate.js --update');
    process.exit(2);
  }

  const base = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const first = compareSnapshots(now, base, { flaky });

  // Confirm before failing. The second run happens ONLY when the first pass looks red or
  // a flaky-listed suite failed (needsConfirmation), so a fully clean run is unchanged.
  // --no-retry restores single-pass behaviour for anyone who wants the raw first verdict.
  let r = first;
  let didConfirm = false;
  if (needsConfirmation(first) && retry) {
    console.log(first.clean
      ? '\nbaseline-gate: a flaky-listed suite failed — a second full run tells a flake from a real failure.'
      : '\nbaseline-gate: possible regression — confirming with a second full run.');
    const again = summariseRun(runJest(), { lineAt: repoLineReader(REPO) });
    r = confirmRegressions(first, compareSnapshots(again, base, { flaky }),
      { strictFlaky: flakyTwiceGates() });
    didConfirm = true;
  }

  list('NEW failing suites (were green):', r.newSuites);
  list('NEW failing tests in already-red suites:', r.newTests,
    (x) => `${x.suite}\n      ${x.tests.join('\n      ')}`);
  // Each one where it is now, then what it says.
  list('NEW offenders in already-red suites:', r.newOffenders,
    (x) => `${x.suite}\n      ${x.offenders.map((k) => describeOffender(k, (now[x.suite] || {}).at)).join('\n      ')}`);
  list('Fixed suites (now green):', r.fixedSuites);
  list('Fixed offenders:', r.fixedOffenders,
    (x) => `${x.suite} (-${x.offenders.length})`);
  list('Flaky suites failing — inconclusive, not gating:', r.flakyFailures);
  list(flakyTwiceGates()
    ? 'Flaky-listed suites that failed in BOTH runs — gating (BASELINE_FLAKY_TWICE=gate):'
    : 'Flaky-listed suites that failed in BOTH runs — likely no longer flaky (advisory; '
      + 'BASELINE_FLAKY_TWICE=gate makes this gate):', r.flakyTwice || []);

  if (didConfirm && r.unconfirmed) {
    const u = r.unconfirmed;
    list('Did NOT reproduce on the second run — treated as flake, not gating:', u.newSuites);
    list('Did NOT reproduce (tests):', u.newTests,
      (x) => `${x.suite}\n      ${x.tests.join('\n      ')}`);
    list('Did NOT reproduce (offenders):', u.newOffenders,
      (x) => `${x.suite} (${x.offenders.length})`);
    const n = u.newSuites.length + u.newTests.length + u.newOffenders.length;
    if (n) {
      console.log('\n  A suite that fails intermittently is still a bug. If one keeps');
      console.log('  appearing here, fix it or add it to the Flaky list in tests/BASELINE.md.');
    }
  }

  if (r.clean) {
    console.log('\nbaseline-gate: CLEAN — no new failing suite, test, or offender.');
    return;
  }
  // stdout, like the lists above it: on stderr the verdict interleaved into the middle of
  // the lists in CI logs, and the "Flaky — not gating" list read as part of the regression.
  console.log('\nbaseline-gate: REGRESSION — the NEW items above' + (r.flakyTwice && r.flakyTwice.length && flakyTwiceGates() ? ', and the flaky-listed suites that failed in both runs,' : '') + ' fail the gate.');
  console.log('  A red suite is not a licence to add to it. Fix, or justify in the PR.');
  process.exit(1);
}

if (require.main === module) main();

module.exports = {
  extractOffenders,
  pruneFlaky,
  canonicalise,
  summariseRun,
  compareSnapshots,
  flakyFromBaselineDoc,
  confirmRegressions,
  parseCliArgs,
  snapshotGrowth,
  normaliseOffender,
  needsConfirmation,
  flakyTwiceGates,
  relSuite,
  keyOffenders,
  repoLineReader,
  describeOffender,
  offenderDelta,
};
