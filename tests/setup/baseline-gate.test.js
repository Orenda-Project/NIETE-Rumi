/**
 * The baseline gate must catch a regression that hides inside an already-red suite.
 *
 * Why this exists: `tests/BASELINE.md` describes the rule ("no NEW failure") in prose,
 * and nothing computed it. The gate was a convention, so it had exactly one resolution —
 * red or green — and an already-red suite absorbed new violations invisibly.
 *
 * The real incident: `source-hygiene` was already failing for unrelated reasons. Internal
 * ticket references were then added to public source — the exact thing that guard exists
 * to prevent — and the merge gate stayed quiet, because the suite's PASS/FAIL had not
 * changed. Only the offender list inside it had grown, from 683 entries to 686.
 *
 * So the gate needs three levels of resolution, and these tests pin all three:
 *
 *   1. a suite that was passing now fails            → regression
 *   2. a suite already failing now fails MORE tests  → regression
 *   3. a suite already failing reports NEW OFFENDERS  → regression   <- the one that bit us
 *
 * And symmetrically it must NOT cry wolf: an unchanged already-red suite is the normal
 * state of this repo, and a gate that fires on it would be turned off within a day.
 */

const {
  extractOffenders,
  summariseRun,
  compareSnapshots,
  pruneFlaky,
  canonicalise,
  confirmRegressions,
  parseCliArgs,
  snapshotGrowth,
  normaliseOffender,
  needsConfirmation,
  flakyTwiceGates,
  keyOffenders,
  describeOffender,
  repoLineReader,
} = require('../baseline-gate');

const ESC = String.fromCharCode(27);

/** Minimal shape of what `jest --json` reports, trimmed to what the gate reads. */
function jestJson(suites) {
  return {
    testResults: Object.entries(suites).map(([name, tests]) => ({
      name,
      assertionResults: tests.map((t) => ({
        fullName: t.name,
        status: t.status,
        failureMessages: t.message ? [t.message] : [],
      })),
    })),
  };
}

describe('extractOffenders — pull the file:line list out of a jest array diff', () => {
  it('finds the added entries jest prints with a + prefix', () => {
    const msg = [
      'expect(received).toEqual(expected)',
      '- Array []',
      '+ Array [',
      '+   "bot/shared/config/branding.js:17",',
      '+   "bot/scripts/setup/flow-configs.js:163",',
      '+ ]',
    ].join('\n');
    expect(extractOffenders(msg)).toEqual([
      'bot/scripts/setup/flow-configs.js:163',
      'bot/shared/config/branding.js:17',
    ]);
  });

  it('is stable against ordering — the set is what matters, not jest print order', () => {
    const a = '+   "a.js:1",\n+   "b.js:2",';
    const b = '+   "b.js:2",\n+   "a.js:1",';
    expect(extractOffenders(a)).toEqual(extractOffenders(b));
  });

  it('ignores removed entries, which are improvements not regressions', () => {
    expect(extractOffenders('-   "gone.js:9",')).toEqual([]);
  });

  it('returns nothing for a failure that is not an array diff', () => {
    expect(extractOffenders('Expected 3 but received 4')).toEqual([]);
  });

  it('survives ANSI colour codes around the diff markers', () => {
    // Jest colourises when it thinks it has a TTY. `--json --outputFile` to a pipe
    // does not, which is the ONLY reason the first version of this gate worked: the
    // strip regex was missing the ESC byte, so a coloured line kept a leading \x1b,
    // the `^\s*\+` anchor no longer matched, and the offender was dropped SILENTLY.
    // An under-reporting gate is worse than no gate — it reports CLEAN on a regression.
    const coloured =
      `${ESC}[32m+${ESC}[39m   ${ESC}[32m"bot/leak.js:42"${ESC}[39m,\n` +
      `${ESC}[31m-${ESC}[39m   ${ESC}[31m"bot/fixed.js:7"${ESC}[39m,`;
    expect(extractOffenders(coloured)).toEqual(['bot/leak.js:42']);
  });

  it('strips other ANSI sequences without eating real content', () => {
    expect(extractOffenders(`${ESC}[1m${ESC}[41m+   "a.js:1",${ESC}[0m`)).toEqual(['a.js:1']);
  });
});

describe('pruneFlaky — a snapshot must never record a flaky suite as baseline', () => {
  // `--update` run during an unlucky moment would bake a documented-flaky suite into
  // the snapshot as an accepted failure. It would then be permanently excused, and
  // worse, the run where it PASSES reads as "fixed" noise on every future run.
  const snap = {
    'tests/setup/source-hygiene.test.js': { failing: ['x'], offenders: [] },
    'tests/training/certificate-pdf.test.js': { failing: ['mint'], offenders: [] },
  };

  it('drops flaky suites from what gets recorded', () => {
    expect(Object.keys(pruneFlaky(snap, ['tests/training/certificate-pdf.test.js'])))
      .toEqual(['tests/setup/source-hygiene.test.js']);
  });

  it('leaves the snapshot untouched when nothing is flaky', () => {
    expect(pruneFlaky(snap, [])).toEqual(snap);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(snap);
    pruneFlaky(snap, ['tests/training/certificate-pdf.test.js']);
    expect(JSON.stringify(snap)).toBe(before);
  });
});

describe('summariseRun — collapse a jest json report into a comparable snapshot', () => {
  it('records only failing suites, with their failing tests and offenders', () => {
    const snap = summariseRun(
      jestJson({
        'tests/green.test.js': [{ name: 'fine', status: 'passed' }],
        'tests/red.test.js': [
          { name: 'ok', status: 'passed' },
          { name: 'broken', status: 'failed', message: '+   "x.js:1",' },
        ],
      })
    );
    expect(Object.keys(snap)).toEqual(['tests/red.test.js']);
    expect(snap['tests/red.test.js'].failing).toEqual(['broken']);
    expect(snap['tests/red.test.js'].offenders).toEqual(['x.js:1']);
  });

  it('normalises absolute paths to repo-relative so snapshots survive a different checkout', () => {
    const snap = summariseRun(
      jestJson({
        '/home/someone/NIETE-Rumi/tests/a.test.js': [{ name: 'x', status: 'failed' }],
      })
    );
    expect(Object.keys(snap)).toEqual(['tests/a.test.js']);
  });
});

describe('compareSnapshots — level 1: a suite that was green goes red', () => {
  it('reports it as a new failing suite', () => {
    const r = compareSnapshots(
      { 'tests/new.test.js': { failing: ['boom'], offenders: [] } },
      {}
    );
    expect(r.newSuites).toEqual(['tests/new.test.js']);
    expect(r.clean).toBe(false);
  });
});

describe('compareSnapshots — level 2: an already-red suite fails MORE tests', () => {
  it('reports the newly failing test even though the suite was already red', () => {
    const base = { 'tests/red.test.js': { failing: ['a'], offenders: [] } };
    const now = { 'tests/red.test.js': { failing: ['a', 'b'], offenders: [] } };
    const r = compareSnapshots(now, base);
    expect(r.newTests).toEqual([{ suite: 'tests/red.test.js', tests: ['b'] }]);
    expect(r.clean).toBe(false);
  });
});

describe('compareSnapshots — level 3: an already-red suite grows NEW OFFENDERS', () => {
  // The source-hygiene case. Same suite, same failing test, same red/green result —
  // only the offender list inside the message changed. A suite-level gate is blind here.
  it('reports offenders that were not in the baseline', () => {
    const base = {
      'tests/setup/source-hygiene.test.js': {
        failing: ['no internal refs'],
        offenders: ['bot/old.js:1'],
      },
    };
    const now = {
      'tests/setup/source-hygiene.test.js': {
        failing: ['no internal refs'],
        offenders: ['bot/old.js:1', 'bot/mine.js:42'],
      },
    };
    const r = compareSnapshots(now, base);
    expect(r.newOffenders).toEqual([
      { suite: 'tests/setup/source-hygiene.test.js', offenders: ['bot/mine.js:42'] },
    ]);
    expect(r.clean).toBe(false);
  });
});

describe('compareSnapshots — must not cry wolf', () => {
  const base = {
    'tests/setup/source-hygiene.test.js': {
      failing: ['no internal refs'],
      offenders: ['bot/a.js:1', 'bot/b.js:2'],
    },
  };

  it('an unchanged already-red suite is clean — that is this repo normal state', () => {
    expect(compareSnapshots(base, base).clean).toBe(true);
  });

  it('FEWER offenders is an improvement, not a regression', () => {
    const now = {
      'tests/setup/source-hygiene.test.js': {
        failing: ['no internal refs'],
        offenders: ['bot/a.js:1'],
      },
    };
    const r = compareSnapshots(now, base);
    expect(r.clean).toBe(true);
    expect(r.fixedOffenders).toEqual([
      { suite: 'tests/setup/source-hygiene.test.js', offenders: ['bot/b.js:2'] },
    ]);
  });

  it('a suite that went green is reported as fixed, and is clean', () => {
    const r = compareSnapshots({}, base);
    expect(r.clean).toBe(true);
    expect(r.fixedSuites).toEqual(['tests/setup/source-hygiene.test.js']);
  });

  it('a flaky suite named in the baseline does not fail the gate when it flips', () => {
    // BASELINE.md names three certificate/R2-presign suites as flaky. A failure there is
    // inconclusive by documented policy, so the gate must not treat it as a regression.
    const r = compareSnapshots(
      { 'tests/training/certificate-pdf.test.js': { failing: ['mint'], offenders: [] } },
      {},
      { flaky: ['tests/training/certificate-pdf.test.js'] }
    );
    expect(r.newSuites).toEqual([]);
    expect(r.flakyFailures).toEqual(['tests/training/certificate-pdf.test.js']);
    expect(r.clean).toBe(true);
  });
});

describe('canonicalise — the snapshot must be byte-stable across runs', () => {
  // Jest reports suites in a different order each run. An unsorted snapshot therefore
  // churns on every --update, and "review the diff" — the only guard against --update
  // swallowing a regression — becomes unreadable noise.
  it('sorts suite keys', () => {
    const out = canonicalise({ 'tests/z.test.js': { failing: [] }, 'tests/a.test.js': { failing: [] } });
    expect(Object.keys(out)).toEqual(['tests/a.test.js', 'tests/z.test.js']);
  });

  it('serialises identically regardless of insertion order', () => {
    const a = { 'tests/b.test.js': { failing: ['x'], offenders: [] }, 'tests/a.test.js': { failing: [], offenders: [] } };
    const b = { 'tests/a.test.js': { failing: [], offenders: [] }, 'tests/b.test.js': { failing: ['x'], offenders: [] } };
    expect(JSON.stringify(canonicalise(a))).toBe(JSON.stringify(canonicalise(b)));
  });
});


/**
 * A gate that goes red at random is a gate that gets switched off — which is exactly
 * how this repo's CI came to be `disabled_manually` in the first place. So a suspected
 * regression is CONFIRMED by a second full run, and only what reproduces in BOTH runs
 * counts.
 *
 * The case that forced this: `tests/training/portal-grand-quiz.test.js` fails roughly
 * one run in fourteen — its `jest.doMock` of the shared certificate service
 * intermittently loses to the real module, so a genuine `CERT-…` code arrives where the
 * mock's `TESTPFX-…` was expected. Nothing in the diff under test touched it. Left
 * unconfirmed, that one suite would have made every fourteenth PR red for a reason
 * nobody could act on.
 *
 * This is deliberately NOT the flaky list: a flaky-list entry is permanent and excuses
 * the suite forever, whereas confirmation is per-run and still fails the moment the
 * failure is real and reproducible.
 */
describe('confirmRegressions — a regression must reproduce before it gates', () => {
  const red = (suites) => ({ newSuites: suites, newTests: [], newOffenders: [], clean: false });

  it('drops a new failing suite that did not reproduce on the second run', () => {
    const c = confirmRegressions(red(['tests/a.test.js']), red([]));
    expect(c.newSuites).toEqual([]);
    expect(c.clean).toBe(true);
    expect(c.unconfirmed.newSuites).toEqual(['tests/a.test.js']);
  });

  it('keeps a new failing suite that reproduced on both runs', () => {
    const c = confirmRegressions(red(['tests/a.test.js']), red(['tests/a.test.js']));
    expect(c.newSuites).toEqual(['tests/a.test.js']);
    expect(c.clean).toBe(false);
    expect(c.unconfirmed.newSuites).toEqual([]);
  });

  it('separates the reproducible from the transient in one run', () => {
    const c = confirmRegressions(
      red(['tests/real.test.js', 'tests/flake.test.js']),
      red(['tests/real.test.js']),
    );
    expect(c.newSuites).toEqual(['tests/real.test.js']);
    expect(c.unconfirmed.newSuites).toEqual(['tests/flake.test.js']);
    expect(c.clean).toBe(false);
  });

  it('confirms at test level, per suite — a new test must reproduce', () => {
    const first = {
      newSuites: [], newOffenders: [], clean: false,
      newTests: [{ suite: 'tests/a.test.js', tests: ['real one', 'flaky one'] }],
    };
    const second = {
      newSuites: [], newOffenders: [], clean: false,
      newTests: [{ suite: 'tests/a.test.js', tests: ['real one'] }],
    };
    const c = confirmRegressions(first, second);
    expect(c.newTests).toEqual([{ suite: 'tests/a.test.js', tests: ['real one'] }]);
    expect(c.unconfirmed.newTests).toEqual([{ suite: 'tests/a.test.js', tests: ['flaky one'] }]);
  });

  it('confirms at offender level, per suite — the level that caught the real incident', () => {
    const first = {
      newSuites: [], newTests: [], clean: false,
      newOffenders: [{ suite: 'tests/setup/source-hygiene.test.js', offenders: ['a.js:1', 'b.js:2'] }],
    };
    const second = {
      newSuites: [], newTests: [], clean: false,
      newOffenders: [{ suite: 'tests/setup/source-hygiene.test.js', offenders: ['a.js:1'] }],
    };
    const c = confirmRegressions(first, second);
    expect(c.newOffenders).toEqual([{ suite: 'tests/setup/source-hygiene.test.js', offenders: ['a.js:1'] }]);
    expect(c.clean).toBe(false);
  });

  it('drops a suite entirely when none of its new tests reproduced', () => {
    const first = {
      newSuites: [], newOffenders: [], clean: false,
      newTests: [{ suite: 'tests/a.test.js', tests: ['transient'] }],
    };
    const c = confirmRegressions(first, { newSuites: [], newTests: [], newOffenders: [], clean: true });
    expect(c.newTests).toEqual([]);
    expect(c.clean).toBe(true);
  });

  it('carries the first run fixed-lists through, so improvements are still reported', () => {
    const first = {
      ...red(['tests/a.test.js']),
      fixedSuites: ['tests/was-red.test.js'],
      fixedOffenders: [{ suite: 'tests/setup/x.test.js', offenders: ['gone.js:1'] }],
    };
    const c = confirmRegressions(first, red([]));
    expect(c.fixedSuites).toEqual(['tests/was-red.test.js']);
    expect(c.fixedOffenders).toEqual([{ suite: 'tests/setup/x.test.js', offenders: ['gone.js:1'] }]);
  });

  it('does not mutate either input', () => {
    const first = red(['tests/a.test.js']);
    const second = red([]);
    confirmRegressions(first, second);
    expect(first.newSuites).toEqual(['tests/a.test.js']);
    expect(second.newSuites).toEqual([]);
  });
});


/**
 * `npm test` runs the whole suite and judges a delta, so it cannot honour a path
 * filter — a filtered run compared against a full snapshot would report every
 * un-run baseline suite as "fixed", and `npm test -- tests/nothing/` would pass
 * cleanly. Silently ignoring the argument is worse than refusing it.
 *
 * This is not hypothetical: when `npm test` became the gate, three Android
 * workflows and the qa-testing skill were still calling `npm test -- tests/portal/`
 * and `npm test -- --testPathPattern=coaching`. The filter was dropped without a
 * word, so those jobs silently went from 289 tests to 4,784 — still passing, still
 * green, and no longer doing what they said.
 */
describe('parseCliArgs — an argument the gate cannot honour must be refused, not ignored', () => {
  it('accepts no arguments', () => {
    expect(parseCliArgs([])).toEqual({ update: false, retry: true, unknown: [] });
  });

  it('accepts --update', () => {
    expect(parseCliArgs(['--update'])).toEqual({ update: true, retry: true, unknown: [] });
  });

  it('accepts --no-retry, which turns confirmation off', () => {
    expect(parseCliArgs(['--no-retry'])).toEqual({ update: false, retry: false, unknown: [] });
  });

  it('reports a path filter as unknown — the exact call the workflows were making', () => {
    expect(parseCliArgs(['tests/portal/']).unknown).toEqual(['tests/portal/']);
  });

  it('reports a jest flag as unknown — the exact call the docs and skill were making', () => {
    expect(parseCliArgs(['--testPathPattern=coaching']).unknown).toEqual(['--testPathPattern=coaching']);
  });

  it('collects every unknown argument, not just the first', () => {
    expect(parseCliArgs(['--update', 'tests/a/', '--bogus']).unknown).toEqual(['tests/a/', '--bogus']);
  });
});

/**
 * "The snapshot may only ever shrink" was written into BASELINE.md and CLAUDE.md and
 * enforced by nothing — so a PR could add its own failures to the snapshot and the
 * gate would pass, cleanly. That is the same shape as the bug the gate itself exists
 * to fix: a rule described in prose that nothing computes.
 */
describe('snapshotGrowth — the baseline may shrink, never grow', () => {
  const snap = (suites) => Object.fromEntries(
    Object.entries(suites).map(([k, v]) => [k, { failing: v.failing || [], offenders: v.offenders || [] }]),
  );

  it('is clean when nothing changed', () => {
    const a = snap({ 'tests/a.test.js': { failing: ['t1'], offenders: ['o1'] } });
    expect(snapshotGrowth(a, a).grew).toBe(false);
  });

  it('is clean when a suite was removed — that is the point', () => {
    const before = snap({ 'tests/a.test.js': {}, 'tests/b.test.js': {} });
    const after = snap({ 'tests/a.test.js': {} });
    const g = snapshotGrowth(before, after);
    expect(g.grew).toBe(false);
    expect(g.removedSuites).toEqual(['tests/b.test.js']);
  });

  it('is clean when offenders shrink', () => {
    const before = snap({ 'tests/a.test.js': { offenders: ['o1', 'o2'] } });
    const after = snap({ 'tests/a.test.js': { offenders: ['o1'] } });
    expect(snapshotGrowth(before, after).grew).toBe(false);
  });

  it('FLAGS a newly accepted suite', () => {
    const before = snap({ 'tests/a.test.js': {} });
    const after = snap({ 'tests/a.test.js': {}, 'tests/new.test.js': {} });
    const g = snapshotGrowth(before, after);
    expect(g.grew).toBe(true);
    expect(g.addedSuites).toEqual(['tests/new.test.js']);
  });

  it('FLAGS newly accepted failing tests inside an already-accepted suite', () => {
    const before = snap({ 'tests/a.test.js': { failing: ['t1'] } });
    const after = snap({ 'tests/a.test.js': { failing: ['t1', 't2'] } });
    const g = snapshotGrowth(before, after);
    expect(g.grew).toBe(true);
    expect(g.addedTests).toEqual([{ suite: 'tests/a.test.js', tests: ['t2'] }]);
  });

  it('FLAGS newly accepted offenders — the level the real incident lived at', () => {
    const before = snap({ 'tests/setup/source-hygiene.test.js': { offenders: ['a.js:1'] } });
    const after = snap({ 'tests/setup/source-hygiene.test.js': { offenders: ['a.js:1', 'b.js:2'] } });
    const g = snapshotGrowth(before, after);
    expect(g.grew).toBe(true);
    expect(g.addedOffenders).toEqual([{ suite: 'tests/setup/source-hygiene.test.js', offenders: ['b.js:2'] }]);
  });

  it('reports a mixed diff honestly — growth wins even alongside a removal', () => {
    const before = snap({ 'tests/a.test.js': {}, 'tests/gone.test.js': {} });
    const after = snap({ 'tests/a.test.js': {}, 'tests/new.test.js': {} });
    const g = snapshotGrowth(before, after);
    expect(g.grew).toBe(true);
    expect(g.addedSuites).toEqual(['tests/new.test.js']);
    expect(g.removedSuites).toEqual(['tests/gone.test.js']);
  });
});


/**
 * An offender that only MOVED is not growth.
 *
 * The conformance guards under tests/setup/ report offenders as `path:line`, sometimes
 * with the offending source appended. Line numbers move whenever anything above them
 * is edited, so a snapshot comparison keyed on the raw string reports the same
 * violation at a new line as a brand-new offender.
 *
 * Measured on the staging sync, 2026-09-04: re-recording after merging main reported
 * 70 added offenders. Two were real. The other 68 were identical violations whose line
 * numbers had shifted — `no-hardcoded-bot-name` reported +3 for three byte-identical
 * strings that moved from lines 198/365/572 to 202/372/575.
 *
 * A gate that cries wolf 70-for-2 gets switched off, so growth is judged on the
 * normalised form: an addition counts only when the same violation was not also
 * removed. The REPORT still shows raw strings, because a human chasing it needs the
 * real line number.
 */
describe('normaliseOffender — line numbers move, violations do not', () => {
  it('strips a trailing path:line', () => {
    expect(normaliseOffender('bot/x.js:198')).toBe(normaliseOffender('bot/x.js:202'));
  });

  it('keeps the file distinct', () => {
    expect(normaliseOffender('bot/x.js:1')).not.toBe(normaliseOffender('bot/y.js:1'));
  });

  it('normalises path:line even when the offending source is appended', () => {
    const a = "bot/s.js:198 — hardcoded self-name — foo: 'Rumi reminds'";
    const b = "bot/s.js:202 — hardcoded self-name — foo: 'Rumi reminds'";
    expect(normaliseOffender(a)).toBe(normaliseOffender(b));
  });

  it('does NOT collapse two different violations in the same file', () => {
    const a = "bot/s.js:198 — hardcoded self-name — foo: 'one'";
    const b = "bot/s.js:198 — hardcoded self-name — bar: 'two'";
    expect(normaliseOffender(a)).not.toBe(normaliseOffender(b));
  });

  it('leaves a non-positional offender untouched', () => {
    expect(normaliseOffender('video_requests.observer_debrief')).toBe('video_requests.observer_debrief');
  });
});

describe('snapshotGrowth — a moved offender is not growth', () => {
  const snap = (offs) => ({ 'tests/setup/g.test.js': { failing: [], offenders: offs } });

  it('ignores an offender that only changed line number', () => {
    const g = snapshotGrowth(snap(['bot/x.js:10']), snap(['bot/x.js:14']));
    expect(g.grew).toBe(false);
    expect(g.addedOffenders).toEqual([]);
  });

  it('still reports a genuinely new violation alongside moved ones', () => {
    const before = snap(['bot/x.js:10', 'bot/y.js:5']);
    const after  = snap(['bot/x.js:14', 'bot/y.js:5', 'bot/z.js:1']);
    const g = snapshotGrowth(before, after);
    expect(g.grew).toBe(true);
    expect(g.addedOffenders).toEqual([{ suite: 'tests/setup/g.test.js', offenders: ['bot/z.js:1'] }]);
  });

  it('reports the RAW string so the line number is chaseable', () => {
    const g = snapshotGrowth(snap([]), snap(['bot/z.js:77']));
    expect(g.addedOffenders[0].offenders).toEqual(['bot/z.js:77']);
  });

  it('a second violation in a file that already had one is growth', () => {
    const before = snap(["bot/s.js:10 — x — a: 'one'"]);
    const after  = snap(["bot/s.js:12 — x — a: 'one'", "bot/s.js:20 — x — b: 'two'"]);
    expect(snapshotGrowth(before, after).grew).toBe(true);
  });
});

/**
 * The gate itself must judge offenders the way the growth check does.
 *
 * `snapshotGrowth` learned on 2026-09-04 that a guard reporting `path:line` moves an
 * unchanged violation to a new line whenever anything above it is edited. The gate's
 * own comparison never learned it: it compared RAW strings, so on 2026-09-23 sandbox
 * reported 432 "new" source-hygiene offenders of which 129 were real — every PR that
 * touched a file carrying an old ticket ref reddened the gate for everyone, which is
 * the state that makes a gate unreadable.
 *
 * Normalising to a SET would swing too far the other way: `source-hygiene` reports a
 * bare `path:line`, so a second violation in a file that already had one would
 * normalise to the same string and vanish. So both comparisons count: an offender is
 * new when its file (its normalised form) carries MORE violations than the baseline
 * recorded, and the report names the raw lines that are not in the baseline verbatim,
 * because one of them is the new one and a human needs a line number to chase.
 */
describe('compareSnapshots — a moved offender is not a new one', () => {
  const snap = (offs) => ({
    'tests/setup/source-hygiene.test.js': { failing: ['no internal refs'], offenders: offs },
  });

  it('an offender that only changed line number is clean', () => {
    const r = compareSnapshots(snap(['bot/x.js:14']), snap(['bot/x.js:10']));
    expect(r.newOffenders).toEqual([]);
    expect(r.fixedOffenders).toEqual([]);
    expect(r.clean).toBe(true);
  });

  it('a SECOND bare path:line violation in a file that already had one is still new', () => {
    const r = compareSnapshots(snap(['bot/x.js:10', 'bot/x.js:30']), snap(['bot/x.js:10']));
    expect(r.newOffenders).toEqual([
      { suite: 'tests/setup/source-hygiene.test.js', offenders: ['bot/x.js:30'] },
    ]);
    expect(r.clean).toBe(false);
  });

  it('when every line moved AND the count grew, every unmatched line is named as a candidate', () => {
    const r = compareSnapshots(snap(['bot/x.js:14', 'bot/x.js:31']), snap(['bot/x.js:10']));
    expect(r.newOffenders).toEqual([
      { suite: 'tests/setup/source-hygiene.test.js', offenders: ['bot/x.js:14', 'bot/x.js:31'] },
    ]);
    expect(r.clean).toBe(false);
  });

  it('a file that dropped a violation while its others moved reports a fix, not a regression', () => {
    const r = compareSnapshots(snap(['bot/x.js:12']), snap(['bot/x.js:10', 'bot/x.js:40']));
    expect(r.newOffenders).toEqual([]);
    expect(r.fixedOffenders).toEqual([
      { suite: 'tests/setup/source-hygiene.test.js', offenders: ['bot/x.js:10', 'bot/x.js:40'] },
    ]);
    expect(r.clean).toBe(true);
  });
});

describe('snapshotGrowth — counts per file, so a bare path:line cannot hide', () => {
  const snap = (offs) => ({ 'tests/setup/g.test.js': { failing: [], offenders: offs } });

  it('a second bare path:line violation in a file that already had one is growth', () => {
    const g = snapshotGrowth(snap(['bot/x.js:10']), snap(['bot/x.js:10', 'bot/x.js:30']));
    expect(g.grew).toBe(true);
    expect(g.addedOffenders).toEqual([{ suite: 'tests/setup/g.test.js', offenders: ['bot/x.js:30'] }]);
  });
});

/**
 * A suite on the Flaky list is never gated — which is right for a flake and wrong for a
 * suite that has quietly become a deterministic failure. Both have happened: the two portal
 * certificate suites have failed on every run since a route change on 2026-09-18, while the
 * gate printed them, run after run, as "Flaky — inconclusive, not gating".
 *
 * The confirmation run already exists to separate a flake from a real failure. So a flaky-
 * listed suite that fails in BOTH runs is reported as such. It is advisory by default (the
 * two portal suites would otherwise redden every PR until they are fixed) and gates when
 * BASELINE_FLAKY_TWICE=gate — the switch to flip once the list is honest again.
 */
describe('flaky-listed suites that fail in BOTH runs', () => {
  const FLAKY = ['tests/training/portal-grand-quiz.test.js', 'tests/queue/sqs-cancel-by-group.test.js'];
  const run = (suites) => Object.fromEntries(suites.map((s) => [s, { failing: ['t'], offenders: [] }]));

  it('a first run whose only failures are flaky-listed still asks for the confirmation run', () => {
    const first = compareSnapshots(run([FLAKY[0]]), {}, { flaky: FLAKY });
    expect(first.clean).toBe(true);
    expect(needsConfirmation(first)).toBe(true);
  });

  it('a clean first run with no flaky failure does not pay for a second run', () => {
    expect(needsConfirmation(compareSnapshots({}, {}, { flaky: FLAKY }))).toBe(false);
  });

  it('names the flaky-listed suites that failed in both runs, and only those', () => {
    const first = compareSnapshots(run(FLAKY), {}, { flaky: FLAKY });
    const second = compareSnapshots(run([FLAKY[0]]), {}, { flaky: FLAKY });
    const r = confirmRegressions(first, second);
    expect(r.flakyTwice).toEqual([FLAKY[0]]);
  });

  it('is advisory by default — the verdict stays clean', () => {
    const first = compareSnapshots(run([FLAKY[0]]), {}, { flaky: FLAKY });
    const r = confirmRegressions(first, compareSnapshots(run([FLAKY[0]]), {}, { flaky: FLAKY }));
    expect(r.clean).toBe(true);
  });

  it('gates when asked to', () => {
    const first = compareSnapshots(run([FLAKY[0]]), {}, { flaky: FLAKY });
    const r = confirmRegressions(first, compareSnapshots(run([FLAKY[0]]), {}, { flaky: FLAKY }),
      { strictFlaky: true });
    expect(r.clean).toBe(false);
  });

  it('a flaky suite that failed once and passed on the confirmation run gates nothing, even strict', () => {
    const first = compareSnapshots(run([FLAKY[1]]), {}, { flaky: FLAKY });
    const r = confirmRegressions(first, compareSnapshots({}, {}, { flaky: FLAKY }), { strictFlaky: true });
    expect(r.flakyTwice).toEqual([]);
    expect(r.clean).toBe(true);
  });

  it('reads the switch from the environment, and nothing else turns it on', () => {
    expect(flakyTwiceGates({ BASELINE_FLAKY_TWICE: 'gate' })).toBe(true);
    expect(flakyTwiceGates({})).toBe(false);
    expect(flakyTwiceGates({ BASELINE_FLAKY_TWICE: 'yes' })).toBe(false);
  });
});

/**
 * A line that only MOVED is not a new offender, even in a file whose count grew.
 *
 * Counting per file (2026-09-23) stopped a shift from going red on its own, but not once the
 * file's count had grown for any other reason: then every line of that file not present
 * verbatim in the snapshot was named, and a line that moved is never verbatim. On PR #4208,
 * `bot/shared/routes/teacher-training-endpoint.js` carried the same 98 ticket-ref lines before
 * and after the change. The snapshot held 97 of them, so the gate named 88, every one that had
 * moved, as NEW, and `test (22)` went red on every PR that touched the file.
 *
 * So a `path:line` offender is keyed by what its line SAYS: the file, the line's text with
 * whitespace collapsed, and which occurrence of that text in the file it is. A line that only
 * moved keeps its key; a new line gets a new one; a second copy of an existing line gets `#2`,
 * so a bare `path:line` guard still cannot hide a duplicate.
 */
const SHIFT_SUITE = 'tests/setup/source-hygiene.test.js';
const SHIFT_TEST = 'Source Hygiene no internal ticket references in shipped source';
/** A jest report whose one failing test printed `offs` as the added side of an array diff. */
const offenderReport = (offs, suite = SHIFT_SUITE) => jestJson({
  [suite]: [{
    name: SHIFT_TEST,
    status: 'failed',
    message: ['- Array []', '+ Array [', ...offs.map((o) => `+   "${o}",`), '+ ]'].join('\n'),
  }],
});
/** A fake working tree, { file: text }. `lineAt(file, n)` is all the gate reads from it. */
const treeOf = (files) => (file, n) => {
  if (!Object.prototype.hasOwnProperty.call(files, file)) return null;
  const lines = files[file].split('\n');
  return n >= 1 && n <= lines.length ? lines[n - 1] : null;
};

describe('content keys — a line that only moved is not a new offender', () => {
  // The tree the snapshot was recorded on: two old ticket refs, at lines 3 and 6.
  const RECORDED = treeOf({
    'bot/x.js': ['a', 'b', '// fix (bd-11)', 'c', 'd', 'retry(); // bd-22', 'e'].join('\n'),
  });
  // Later, four lines arrive at the top, and ONE of them is a genuinely new ref. The two old
  // refs are unchanged, four lines further down (the second one re-indented as well).
  const NOW = treeOf({
    'bot/x.js': ['// new (bd-33)', 'w', 'x', 'y', 'a', 'b', '// fix (bd-11)', 'c', 'd',
      '    retry();   // bd-22', 'e'].join('\n'),
  });
  const recorded = () =>
    canonicalise(summariseRun(offenderReport(['bot/x.js:3', 'bot/x.js:6']), { lineAt: RECORDED }));

  it('names only the genuinely new line, not the two that moved down', () => {
    const now = summariseRun(offenderReport(['bot/x.js:1', 'bot/x.js:7', 'bot/x.js:10']), { lineAt: NOW });
    const r = compareSnapshots(now, recorded());
    expect(r.newOffenders).toEqual([{ suite: SHIFT_SUITE, offenders: ['bot/x.js :: // new (bd-33)'] }]);
    expect(r.fixedOffenders).toEqual([]);
    expect(r.clean).toBe(false);
  });

  it('a shift with nothing new is clean', () => {
    const now = summariseRun(offenderReport(['bot/x.js:7', 'bot/x.js:10']), { lineAt: NOW });
    const r = compareSnapshots(now, recorded());
    expect(r.newOffenders).toEqual([]);
    expect(r.fixedOffenders).toEqual([]);
    expect(r.clean).toBe(true);
  });
});

describe('keyOffenders — what a path:line offender is keyed by', () => {
  const lineAt = treeOf({
    'bot/a.js': ['x', '  // see  bd-1\t for why', 'y', '// see bd-1 for why', 'z', '//  see bd-1 for why'].join('\n'),
    'bot/b.js': ["const s = 'Rumi says hi';"].join('\n'),
  });
  const keys = (raws) => keyOffenders(raws, lineAt).map((k) => k.key);

  it('keys a bare path:line by its file and its line text, whitespace collapsed', () => {
    expect(keys(['bot/a.js:2'])).toEqual(['bot/a.js :: // see bd-1 for why']);
  });

  it('numbers repeats of one text in line order, so a duplicate stays visible', () => {
    expect(keys(['bot/a.js:6', 'bot/a.js:2', 'bot/a.js:4'])).toEqual([
      'bot/a.js :: // see bd-1 for why',
      'bot/a.js #2 :: // see bd-1 for why',
      'bot/a.js #3 :: // see bd-1 for why',
    ]);
  });

  it('remembers where each keyed line is now', () => {
    expect(keyOffenders(['bot/a.js:4'], lineAt)).toEqual([
      { key: 'bot/a.js :: // see bd-1 for why', file: 'bot/a.js', line: 4 },
    ]);
  });

  it('keys an offender that carries its own detail by its line, like any other', () => {
    expect(keys(["bot/b.js:1 — hardcoded self-name — const s = 'Rumi says hi';"]))
      .toEqual(["bot/b.js :: const s = 'Rumi says hi';"]);
  });

  it('leaves an offender with no line as it is', () => {
    expect(keys(['video_requests.observer_debrief', 'flow.json: ticket ref', 'bot/x.js → ../gone']))
      .toEqual(['video_requests.observer_debrief', 'flow.json: ticket ref', 'bot/x.js → ../gone']);
  });

  it('leaves a path:line it cannot read as it is, to be compared by count per file as before', () => {
    expect(keys(['bot/missing.js:3', 'bot/a.js:99'])).toEqual(['bot/missing.js:3', 'bot/a.js:99']);
  });

  it('without a reader, keys nothing (summariseRun stays a pure function of the report)', () => {
    expect(keyOffenders(['bot/a.js:2'])).toEqual([{ key: 'bot/a.js:2' }]);
  });
});

/**
 * source-hygiene names a markdown line that holds a credential or a deployment number by
 * `path:line` ALONE, on purpose. A content key must not undo that: the key is committed in the
 * snapshot and printed in CI logs, and this repo is public. Such a line is keyed by a hash of
 * its text, which is just as stable when the line moves. (The values below are assembled from
 * parts so this file holds no secret- or phone-shaped literal of its own.)
 */
describe('content keys never copy a secret or a phone number', () => {
  const D = (...parts) => parts.join('');
  const TOKEN = D('Zq7', 'Lw2', 'Xr9', 'Kp4').repeat(3);            // 36 letters and digits
  const PHONE = D('+', '92', ' 300', ' 12', '34567');
  const lineAt = treeOf({
    'docs/setup.md': ['# Setup', `api_key: ${TOKEN}`, '', `call ${PHONE} (bd-7)`].join('\n'),
    'docs/moved.md': ['', '', '', '', `api_key: ${TOKEN}`, '', '', `call ${PHONE} (bd-7)`].join('\n'),
  });

  it('keys a line carrying a credential by a hash of it, never by its text', () => {
    const [k] = keyOffenders(['docs/setup.md:2'], lineAt);
    expect(k.key).toMatch(/^docs\/setup\.md :: \[withheld [0-9a-f]{12}\]$/);
    expect(k.key).not.toContain(TOKEN.slice(0, 8));
  });

  it('withholds a phone number the same way', () => {
    const [k] = keyOffenders(['docs/setup.md:4'], lineAt);
    expect(k.key).toMatch(/^docs\/setup\.md :: \[withheld [0-9a-f]{12}\]$/);
    expect(k.key).not.toMatch(/300|34567/);
  });

  it('a withheld line that only moved keeps its key', () => {
    const at = (file, n) => keyOffenders([`${file}:${n}`], lineAt)[0].key.split(' :: ')[1];
    expect(at('docs/moved.md', 5)).toBe(at('docs/setup.md', 2));
    expect(at('docs/moved.md', 8)).toBe(at('docs/setup.md', 4));
    expect(at('docs/setup.md', 2)).not.toBe(at('docs/setup.md', 4));
  });

  it('the report prints where it is and the marker, never the text', () => {
    const now = summariseRun(offenderReport(['docs/setup.md:2']), { lineAt });
    const [key] = now[SHIFT_SUITE].offenders;
    const line = describeOffender(key, now[SHIFT_SUITE].at);
    expect(line).toMatch(/^docs\/setup\.md:2 {2}\[withheld [0-9a-f]{12}\]$/);
  });

  it('an ordinary offending line is not withheld', () => {
    expect(keyOffenders(['bot/x.js:1'], treeOf({ 'bot/x.js': '// fix (bd-11) at 2026-11-05' }))[0].key)
      .toBe('bot/x.js :: // fix (bd-11) at 2026-11-05');
  });
});

describe('content keys — the gate stays strict', () => {
  const SNAP = (files, offs) =>
    canonicalise(summariseRun(offenderReport(offs), { lineAt: treeOf(files) }));
  const RUN = (files, offs) => summariseRun(offenderReport(offs), { lineAt: treeOf(files) });
  const BASE_FILES = { 'bot/x.js': ['a', '// fix (bd-11)', 'b'].join('\n') };
  const base = () => SNAP(BASE_FILES, ['bot/x.js:2']);

  it('a second copy of an existing offending line is NEW, as #2', () => {
    const files = { 'bot/x.js': ['a', '// fix (bd-11)', 'b', '// fix (bd-11)'].join('\n') };
    const r = compareSnapshots(RUN(files, ['bot/x.js:2', 'bot/x.js:4']), base());
    expect(r.newOffenders).toEqual([{ suite: SHIFT_SUITE, offenders: ['bot/x.js #2 :: // fix (bd-11)'] }]);
  });

  it('an offending line whose text changed is NEW: touching the line is the moment to fix it', () => {
    const files = { 'bot/x.js': ['a', '// fixed (bd-11) for good', 'b'].join('\n') };
    const r = compareSnapshots(RUN(files, ['bot/x.js:2']), base());
    expect(r.newOffenders).toEqual([{ suite: SHIFT_SUITE, offenders: ['bot/x.js :: // fixed (bd-11) for good'] }]);
    expect(r.fixedOffenders).toEqual([{ suite: SHIFT_SUITE, offenders: ['bot/x.js :: // fix (bd-11)'] }]);
  });

  it('a removed offender is reported as fixed, and is clean', () => {
    const before = SNAP({ ...BASE_FILES, 'bot/y.js': '// bd-2' }, ['bot/x.js:2', 'bot/y.js:1']);
    const r = compareSnapshots(RUN({ 'bot/x.js': 'a\nb', 'bot/y.js': '// bd-2' }, ['bot/y.js:1']), before);
    expect(r.clean).toBe(true);
    expect(r.fixedOffenders).toEqual([{ suite: SHIFT_SUITE, offenders: ['bot/x.js :: // fix (bd-11)'] }]);
  });

  it('the same text in a different file is a different offender', () => {
    const files = { ...BASE_FILES, 'bot/z.js': '// fix (bd-11)' };
    const r = compareSnapshots(RUN(files, ['bot/x.js:2', 'bot/z.js:1']), base());
    expect(r.newOffenders).toEqual([{ suite: SHIFT_SUITE, offenders: ['bot/z.js :: // fix (bd-11)'] }]);
  });
});

describe('describeOffender — the report still says where the line is now', () => {
  it('prints the current path:line, then what the line says', () => {
    const now = summariseRun(offenderReport(['bot/x.js:7']), {
      lineAt: treeOf({ 'bot/x.js': ['', '', '', '', '', '', '  // fix (bd-11)'].join('\n') }),
    });
    const key = now[SHIFT_SUITE].offenders[0];
    expect(describeOffender(key, now[SHIFT_SUITE].at)).toBe('bot/x.js:7  // fix (bd-11)');
  });

  it('prints a content key it has no position for as its file and text', () => {
    expect(describeOffender('bot/x.js #2 :: // fix (bd-11)')).toBe('bot/x.js (#2)  // fix (bd-11)');
  });

  it('prints anything else as it is', () => {
    expect(describeOffender('bot/x.js:7')).toBe('bot/x.js:7');
    expect(describeOffender('coaching_sessions.error', {})).toBe('coaching_sessions.error');
  });
});

describe('canonicalise — the snapshot records what a line says, never where it is', () => {
  it('drops the current-position map summariseRun keeps for the report', () => {
    const now = summariseRun(offenderReport(['bot/x.js:1']), { lineAt: treeOf({ 'bot/x.js': '// bd-1' }) });
    expect(now[SHIFT_SUITE].at).toEqual({ 'bot/x.js :: // bd-1': 'bot/x.js:1' });
    expect(canonicalise(now)).toEqual({
      [SHIFT_SUITE]: { failing: [SHIFT_TEST], offenders: ['bot/x.js :: // bd-1'] },
    });
  });
});

/**
 * Snapshots on other branches (staging, main) still hold `file:line` entries until they are
 * re-recorded or migrated, and the growth check reads the BASE branch's snapshot. Neither form
 * can be translated into the other without the tree it was recorded on, so a file that has
 * entries in both forms is compared the old way: by how many violations it carries.
 */
describe('mixed forms — a file:line snapshot against content keys', () => {
  const suite = (offs) => ({ [SHIFT_SUITE]: { failing: [SHIFT_TEST], offenders: offs } });
  const LEGACY = suite(['bot/x.js:10', 'bot/x.js:20', 'bot/y.js:5', 'coaching_sessions.error']);
  const MIGRATED = suite([
    'bot/x.js :: // fix (bd-11)', 'bot/x.js :: retry(); // bd-22', 'bot/y.js :: // bd-5', 'coaching_sessions.error',
  ]);

  it('a migration that keeps every file\'s count is not growth', () => {
    const g = snapshotGrowth(LEGACY, MIGRATED);
    expect(g.grew).toBe(false);
    expect(g.addedOffenders).toEqual([]);
  });

  it('a file whose count grew is still growth, and every entry for that file is named', () => {
    const grown = suite([...MIGRATED[SHIFT_SUITE].offenders, 'bot/y.js :: // bd-6']);
    const g = snapshotGrowth(LEGACY, grown);
    expect(g.grew).toBe(true);
    expect(g.addedOffenders).toEqual([
      { suite: SHIFT_SUITE, offenders: ['bot/y.js :: // bd-5', 'bot/y.js :: // bd-6'] },
    ]);
  });

  it('the gate judges content keys against a file:line base by count per file', () => {
    expect(compareSnapshots(MIGRATED, LEGACY).clean).toBe(true);
    const r = compareSnapshots(suite([...MIGRATED[SHIFT_SUITE].offenders, 'bot/z.js :: // bd-9']), LEGACY);
    expect(r.newOffenders).toEqual([{ suite: SHIFT_SUITE, offenders: ['bot/z.js :: // bd-9'] }]);
  });

  it('two file:line snapshots are still compared exactly as before', () => {
    const g = snapshotGrowth(LEGACY, suite(['bot/x.js:12', 'bot/x.js:22', 'bot/y.js:5', 'coaching_sessions.error']));
    expect(g.grew).toBe(false);
  });
});

describe('repoLineReader — reads the tree the guards just scanned', () => {
  const path = require('path');
  const ROOT = path.resolve(__dirname, '../..');

  it('returns line n of a repo file, 1-based', () => {
    expect(repoLineReader(ROOT)('tests/setup/baseline-gate.test.js', 1)).toBe('/**');
  });

  it('returns null for a missing file, a line out of range, or a path outside the repo', () => {
    const read = repoLineReader(ROOT);
    expect(read('tests/setup/no-such-file.js', 1)).toBeNull();
    expect(read('tests/setup/baseline-gate.test.js', 0)).toBeNull();
    expect(read('tests/setup/baseline-gate.test.js', 10 ** 6)).toBeNull();
    expect(read('../outside.js', 1)).toBeNull();
    expect(read('tests/setup', 1)).toBeNull();
  });
});
