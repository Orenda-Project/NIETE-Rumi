# Test baseline

The root suite is not green, and has not been for a while. Rather than block
language-unification work behind fixing unrelated pre-existing failures, this
file pins **what already fails** so the gate becomes *"no new failure"* instead
of *"all green"* — the same standard the parent bot's production merges use
("zero jest delta vs baseline").

If your change adds a suite to this list, that is a regression. If it removes
one, delete the line and say so in the PR.

---

## How to reproduce

```bash
npm ci      # root only — bot/ deps are NOT required
npm test
```

No out-of-band installs are needed. `dotenv` (bot-only) and `pg` (dashboard-only)
are mapped to stubs in `tests/jest.config.js`, the same pattern already used for
`axios`, `form-data`, `pino` and `canvas`. Before that mapping, 274 of the
failures were unresolved-module crashes rather than anything a test was
asserting.

---

## Baseline as of `fd3ecda`

Measured over three consecutive runs. Node v22.23.1, Jest 29.7.0.

| | |
|---|---|
| Total suites | 252 |
| Total tests | 2564 |
| Stable failing suites | **24** |
| Flaky failing suites | **3** |
| Failing tests | 71–76 (varies with the flaky three) |

### Stable failures — fail on every run

These are pre-existing and unrelated to language work. Sixteen are conformance
guards under `tests/setup/`, which the repo's own docs say to keep green; they
are the ones most likely to be touched by future work, so fix them
just-in-time when you edit the surface they guard rather than all at once.

```
tests/assessment-gen/portal-assessment-endpoint.test.js
tests/coaching/document-audio-routing.test.js
tests/coaching/fico-framework-ict.test.js
tests/coaching/fico-framework.test.js
tests/coaching/framework-registry.test.js
tests/setup/circular-deps.test.js
tests/setup/column-completeness.test.js
tests/setup/env-template-completeness.test.js
tests/setup/flow-config-conformance.test.js
tests/setup/link-integrity.test.js
tests/setup/logger-level-consistency.test.js
tests/setup/no-hardcoded-bot-name.test.js
tests/setup/no-hardcoded-brand-urls.test.js
tests/setup/no-undefined-whatsapp-methods.test.js
tests/setup/register-all-flows.test.js
tests/setup/schema-completeness.test.js
tests/setup/source-hygiene.test.js
tests/setup/table-usage-conformance.test.js
tests/setup/unresolved-requires.test.js
tests/setup/validate-flows.test.js
tests/student-videos/student-videos-flow.test.js
tests/textbook-lp-v2/pregen-lookup.test.js
tests/textbook-lp-v2/topic-matching.test.js
tests/unit/sprint-1/taleemabad-strip.test.js
```

### Flaky — pass or fail depending on the run

All three are certificate / R2-presign related, which suggests shared temp-file
or presign-timing state rather than three separate bugs. Treat a failure here
as inconclusive and re-run before investigating.

```
tests/training/certificate-fetch-or-mint.test.js
tests/training/certificate-pdf.test.js
tests/training/r2-presign-attachment.test.js
```

---

## Also worth knowing

**The standard integration suite is green.** `npm run test:e2e` runs the two
coaching integration suites — 19 tests, all passing. Use it as the quick
regression check around each change.

**The suite used to leak processes.** `tests/setup/worker-boot.test.js` boots
every entry point as a real child process; the lesson-plan and video workers
ignore `SIGTERM`, so they survived, orphaned to init, kept polling with whatever
queue config the run carried, and held their stdio pipes open — which also
stopped Jest from exiting, so that file hung rather than finishing. It now
escalates to `SIGKILL` and waits for the process to actually die, with a guard
test asserting no child survives. This only ever reproduced locally: CI runs the
root suite *before* `cd bot && npm ci`, and the whole file skips when
`bot/node_modules` is absent.

That audit also blanks the queue variables in the env it hands each child, so a
booted worker cannot reach a real queue no matter what the developer's `.env`
says. The check only asks whether the require chain loads; it has no business
claiming jobs. The guard lives in the test rather than in an npm script so it
travels with the code that needs it and cannot be bypassed by invoking Jest
directly.

**Known-failing is not the same as acceptable.** Two of the stable failures are
worth reading before touching their area — `unresolved-requires` is flagging a
test that requires a script which no longer exists, plus two stale allowlist
entries; `source-hygiene` and the `no-hardcoded-*` guards are the family we
intend to widen for teacher-facing copy.

---

## The gate is now computed, not read

Until 2026-08-07 this file *described* the rule and nothing enforced it. That gave
the gate one bit of resolution — the suite is red — so a new violation inside an
already-red suite changed nothing observable.

It happened: `source-hygiene` was already failing when internal ticket references
were added to public source, the exact thing that guard exists to prevent. Suite
result before and after: red. Offender list: 682 entries → 683. Only the third
number was a regression, and nothing was looking at it.

```bash
npm run test:baseline           # compare this tree against the snapshot
npm run test:baseline:update    # re-record it (review the diff before committing)
```

[`tests/baseline-gate.js`](baseline-gate.js) compares at three levels:

| | Catches |
|---|---|
| **Suite** | a suite that was passing now fails |
| **Test** | a suite already failing now fails *additional* tests |
| **Offender** | a suite already failing reports entries it did not report before |

The offender level is the one that matters for the `tests/setup/` guards, because
those assert `expect(offenders).toEqual([])` — the entire finding lives in the
array diff, not in the pass/fail.

Improvements are reported and never gate: fewer offenders, fewer failing tests, or
a suite going green are all clean. The three suites in **Flaky** above are read
straight out of this file by the gate and are excluded from gating, so a random
presign failure cannot make the gate red for reasons nobody can act on.

The snapshot is [`tests/baseline.snapshot.json`](baseline.snapshot.json) — 24
failing suites, 71 failing tests, 1,173 offenders, matching the counts recorded
above. Its own logic is covered by
[`tests/setup/baseline-gate.test.js`](setup/baseline-gate.test.js), including a
test that pins the offender-level case specifically.

**`--update` is the dangerous flag.** It swallows every regression present in the
tree at the time it runs. Only re-record from a tree you have separately verified,
and read the resulting diff.
