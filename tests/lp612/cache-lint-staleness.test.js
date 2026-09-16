/**
 * A CACHED LESSON CARRIES A VERDICT NOBODY RE-CHECKS — bd-2cbwr.
 *
 * The RELIGIOUS_MARKS gate runs ONLY inside fresh authoring. A cache hit returns the stored
 * artifact untouched (`lp612-serving.service.js`, the `status === 'ready' && r2_key` branch), so
 * the row's `lint_clean` / `lint_fails` are whatever the gate said ON THE DAY THAT DOCUMENT WAS
 * AUTHORED. When the gate itself changes — and it changed twice in three days, bd-qzitp on
 * 2026-09-14 and bd-kpqu6 on 2026-09-16 — every already-`ready` row keeps serving under the old
 * ruling, and nothing in the schema records which ruling that was.
 *
 * That is the defect: not that the verdict is wrong, but that it is UNDATED. You cannot query for
 * the documents whose verdict predates the current gate, so you cannot tell a cleared lesson from
 * an un-re-checked one, and the 2026-09-14 fix shipped with no backfill because there was no way
 * to name the population it needed to backfill.
 *
 * So the row gets a STAMP — `lint_version`, the gate ruleset that produced `lint_fails` — and the
 * cache-hit path reads it. The stamp makes staleness a QUERY rather than an archaeology exercise.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. A stale stamp does not withhold the lesson. Those documents
 * are serving today; holding them on a version mismatch would deny teachers lessons over a
 * bookkeeping fact, and brief §4c/G5c is explicit that an automated check is not what CLEARS
 * religious content — the native-speaker review is. The stamp's job is to make the population
 * findable and loud, not to arbitrate it. See the companion e2e for the delivery half.
 *
 * `never_looked` vs `unstamped` are kept apart on purpose. This codebase already draws that line
 * (the worker writes `lint_clean: null` on a reused render precisely because "we did not look" is
 * a different fact from "we looked and it was not clean"), and collapsing them here would hide
 * reused documents inside the pre-migration backlog.
 */

const {
  LP612_LINT_VERSION,
  cachedLintStatus,
} = require('../../bot/shared/services/lp612-lint-staleness');

const ready = (over = {}) => ({
  id: 'render-1',
  status: 'ready',
  r2_key: 'lp612/v9.6/ur/x.pdf',
  lint_clean: true,
  lint_fails: [],
  lint_version: LP612_LINT_VERSION,
  ...over,
});

describe('the stamp is a real, non-empty ruleset identifier', () => {
  it('exists and is a string — an undefined stamp would make every row read as current', () => {
    expect(typeof LP612_LINT_VERSION).toBe('string');
    expect(LP612_LINT_VERSION.length).toBeGreaterThan(0);
  });
});

describe('A — a row whose verdict was produced by the gate running today', () => {
  it('is not stale, and says so without hedging', () => {
    const s = cachedLintStatus(ready());
    expect(s.stale).toBe(false);
    expect(s.reason).toBe('current');
    expect(s.stampedVersion).toBe(LP612_LINT_VERSION);
  });

  it('a clean row carries no religious fails', () => {
    expect(cachedLintStatus(ready()).religiousFails).toEqual([]);
  });
});

describe('B — a verdict from a gate that has since moved', () => {
  it('is stale, and names the version it was judged under', () => {
    const s = cachedLintStatus(ready({ lint_version: '2026-09-01' }));
    expect(s.stale).toBe(true);
    expect(s.reason).toBe('version_moved');
    expect(s.stampedVersion).toBe('2026-09-01');
  });

  it('THE RED TEST — a pre-migration row (no stamp at all) is stale, not assumed current', () => {
    // Every row that exists on production today is this shape. Reading an absent stamp as
    // "current" is exactly the bug: it would report the whole pre-fix backlog as re-checked.
    const s = cachedLintStatus(ready({ lint_version: null }));
    expect(s.stale).toBe(true);
    expect(s.reason).toBe('unstamped');
    expect(s.stampedVersion).toBeNull();
  });

  it('an undefined stamp (the column not selected, or not migrated) is unstamped too', () => {
    const row = ready();
    delete row.lint_version;
    expect(cachedLintStatus(row).reason).toBe('unstamped');
  });
});

describe('C — a reused render, where the gate never ran at all', () => {
  // bd-oak77.12: the worker writes lint_clean/lint_fails as NULL on a reuse because "we did not
  // look" is the truth, and is a different fact from `false`/`[]`.
  const reused = ready({ lint_clean: null, lint_fails: null, lint_version: null });

  it('is stale for its OWN reason, not lumped in with the unstamped backlog', () => {
    const s = cachedLintStatus(reused);
    expect(s.stale).toBe(true);
    expect(s.reason).toBe('never_looked');
  });

  it('a reused row reports no religious fails — absence of a verdict is not a clean verdict', () => {
    const s = cachedLintStatus(reused);
    expect(s.religiousFails).toEqual([]);
    // …and the caller can still tell the two apart, which is the whole point.
    expect(s.reason).not.toBe('current');
  });
});

describe('D — a ready row that is ALREADY carrying a religious fail', () => {
  // This is the population bd-2cbwr was filed over: `ready`, delivered, and gated. The gate
  // produces a fail list; a row reaching `ready` with one in it is a lesson going out under a
  // finding nobody re-examined.
  const RELIGIOUS = 'RELIGIOUS_MARKS: /sections/0/blocks/1/text names the Prophet ("نبی") with no honorific after it';
  const OTHER = 'PAGE COUNT: teach needs 10 pages; the cap is 7.';

  it('surfaces the religious fail specifically, not buried in the whole fail list', () => {
    const s = cachedLintStatus(ready({ lint_clean: false, lint_fails: [OTHER, RELIGIOUS] }));
    expect(s.religiousFails).toEqual([RELIGIOUS]);
  });

  it('a non-religious fail is NOT reported as one — this gate is the hard hold, not a catch-all', () => {
    const s = cachedLintStatus(ready({ lint_clean: false, lint_fails: [OTHER] }));
    expect(s.religiousFails).toEqual([]);
  });

  it('a religious fail on a CURRENT stamp is still reported — it is serving either way', () => {
    // Staleness and violation are independent facts. A document judged by today's gate and found
    // wanting is not made acceptable by the stamp being fresh.
    const s = cachedLintStatus(ready({ lint_clean: false, lint_fails: [RELIGIOUS] }));
    expect(s.stale).toBe(false);
    expect(s.religiousFails).toHaveLength(1);
  });
});

describe('E — malformed and missing input never throws on the serving hot path', () => {
  // This runs on every cache hit. A throw here is a lesson the teacher does not receive, so the
  // degenerate shapes are part of the contract rather than an edge case.
  it('a null row is unstamped, not an exception', () => {
    expect(() => cachedLintStatus(null)).not.toThrow();
    expect(cachedLintStatus(null).reason).toBe('unstamped');
  });

  it('lint_fails that is not an array yields no religious fails and no throw', () => {
    expect(cachedLintStatus(ready({ lint_fails: 'RELIGIOUS_MARKS: x' })).religiousFails).toEqual([]);
    expect(cachedLintStatus(ready({ lint_fails: undefined })).religiousFails).toEqual([]);
  });

  it('a non-string entry inside lint_fails is skipped rather than crashing the match', () => {
    const s = cachedLintStatus(ready({ lint_clean: false, lint_fails: [null, 42, { code: 'x' }] }));
    expect(s.religiousFails).toEqual([]);
  });
});
