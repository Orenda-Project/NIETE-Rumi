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
