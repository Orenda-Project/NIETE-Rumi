# Test baseline

The root suite is not green, and has not been for a while. Rather than block work
behind fixing unrelated pre-existing failures, this file pins **what already
fails** so the gate becomes *"no new failure"* instead of *"all green"* — the same
standard the parent bot's production merges use ("zero jest delta vs baseline").

If your change adds a suite to this list, that is a regression. If it removes one,
delete the line and say so in the PR.

---

## `npm test` IS the gate

```bash
npm ci        # root only — bot/ deps are NOT required
npm test      # runs every suite, then judges the delta against the snapshot
```

`npm test` exits **0** when you have added no new failure, and non-zero when you
have. That is the whole point: before 2026-08-31 it exited 1 on every branch for
everyone, so the exit code carried no information and both humans and agents
learned to ignore it. A gate nobody reads is not a gate.

**`npm test` takes NO arguments.** It runs the whole suite and compares the result
against the snapshot, so it cannot honour a path or pattern filter: a filtered run
would report every suite it did not run as "fixed", and `npm test -- tests/nothing/`
would exit 0 having tested nothing. It now refuses an argument it cannot honour rather
than dropping it silently — which it did until 2026-09-01, sending three Android
workflows and the qa-testing skill from 289 tests to 4,784 without a word. A guard
(`tests/setup/npm-test-args.test.js`) keeps a filtered `npm test` out of the repo.

Filtered runs go to raw Jest, which takes any Jest argument:

```bash
npm run test:raw                                   # plain jest, still red by design
npm run test:raw -- --testPathPattern=coaching     # one area
npm run test:raw -- tests/portal/                  # one directory
```

Add `--forceExit` to a filtered raw run: `tests/jest.config.js` does not set it, so
a subset can hang after the summary on an open handle.

No out-of-band installs are needed. Every bot-only dependency reachable from a root
suite is either stubbed in `tests/__mocks__/` or, for `jsonrepair`, a root
devDependency — see **Bot-only dependencies** below.

---

## Baseline as of `e71dbaa` (main)

Measured over four consecutive runs. Node v22.23.1, Jest 29.7.0.

| | |
|---|---|
| Total suites | 420 |
| Total tests | 4,797 |
| Stable failing suites | **30** |
| Flaky failing suites | **0 observed** (3 quarantined, see below) |
| Failing tests | 86 |
| Suites that fail to *load* | **0** |

`main` is measurably steadier than `develop`: four consecutive runs produced an
identical 30-suite failure set with **no flake at all**. The three suites quarantined
below did not fire once here.

That last row is the one to protect. Until 2026-08-31, **20 of 55 failing suites
never executed a single assertion** — they died at `require()` on a package that
lives in `bot/node_modules`, which the root job installs *after* it runs. Those were
not test failures; they were a harness gap wearing a test failure's clothes, and
they made the real backlog look twice its size.

### Stable failures — fail on every run

**Conformance guards (14).** These audit the repo, not behaviour: schema ↔ code
drift, circular requires, unresolved requires, hardcoded brand names and URLs,
`.env.template` completeness, internal ticket refs in shipped source, markdown link
integrity. They fail because the codebase moved and the allowlists were not
re-pinned. Fix them just-in-time — when you touch the surface a guard covers —
rather than all at once.

```
tests/setup/circular-deps.test.js
tests/setup/column-completeness.test.js
tests/setup/env-template-completeness.test.js
tests/setup/flow-config-conformance.test.js
tests/setup/link-integrity.test.js
tests/setup/no-hardcoded-bot-name.test.js
tests/setup/no-hardcoded-brand-urls.test.js
tests/setup/no-undefined-whatsapp-methods.test.js
tests/setup/schema-completeness.test.js
tests/setup/source-hygiene.test.js
tests/setup/table-usage-conformance.test.js
tests/setup/unresolved-requires.test.js
tests/setup/validate-flows.test.js
tests/unit/sprint-1/taleemabad-strip.test.js
```

**Behavioural failures (16).** These assert things about shipped behaviour that no
longer hold. Each one is a real finding, not harness debt.

```
tests/assessment-gen/portal-assessment-endpoint.test.js
tests/coaching/bd-h9gnk-midflight-watchdog.test.js
tests/coaching/document-audio-routing.test.js
tests/coaching/fico-framework-ict.test.js
tests/coaching/fico-framework.test.js
tests/coaching/framework-registry.test.js
tests/coaching/lp-coaching-link.test.js
tests/coaching/reflective-v12-question-chain.test.js
tests/flow-response/endpoint-flow-routing.test.js
tests/observe/bd-5n1a2-resolve-teacher-empty-school.test.js
tests/quiz/lp-shelf.test.js
tests/student-videos/student-videos-flow.test.js
tests/textbook-lp-v2/handler-curriculum.test.js
tests/textbook-lp-v2/pregen-lookup.test.js
tests/textbook-lp-v2/topic-matching.test.js
tests/training/portal-level-unlock-logic.test.js
```

Three of these fail on `main` but not on `develop`, so `develop` already carries the
fix and they will retire on a future promotion: `portal-assessment-endpoint`,
`endpoint-flow-routing` (Pic-to-LP Confirm reads as an unknown flow ID — **this one is
live on production**), and `handler-curriculum`.

The highest-signal four, if you are picking one up:

- `coaching/document-audio-routing` — 40 MB audio returns `route_to_audio_pipeline`
  instead of `reject_too_large`. The Whisper 25 MB gate is not firing.
- `quiz/lp-shelf` — `redis.delete is not a function`; `flushShelf` throws on every
  flush and callers swallow it.
- `coaching/framework-registry` + `fico-framework-ict` — FICO reports `maxMarks` 148
  against an expected 104, Section B 10 indicators against 7. Either the rubric
  expanded and the tests are stale, or ICT is being served the wrong rubric. It is
  the scoring surface; worth settling which.
- `training/portal-level-unlock-logic` — the portal returns `locked` where the bot
  returns `not_started` for an `all_modules` vendor.

Two of these assert by **reading source files and regex-matching them**
(`bd-h9gnk`'s worker-wiring case, `text-message-lp-keyword`). Those break on any
behaviour-preserving refactor. Convert them to behavioural assertions when you next
touch that code.

### Flaky — pass or fail depending on the run

Read by the gate straight out of this file and excluded from gating, so a random
failure here cannot make the gate red for a reason nobody can act on. Treat a
failure as inconclusive and re-run before investigating.

```
tests/queue/sqs-cancel-by-group.test.js
tests/training/certificate-pdf-issuance.test.js
tests/training/portal-grand-quiz.test.js
```

`portal-capstone-submit` is on the `develop` list too; it does not exist on `main` and
so is omitted here. **None of these three flaked in four consecutive runs on `main`** —
they are quarantined because the underlying race is the same code, not because they
misbehaved here.

`sqs-cancel-by-group` is its own thing: its Redis cancel-flag mock intermittently does
not observe the expected `setex`.

**The other three are ONE bug, not three.** All live in `tests/training/`, all reach
`bot/shared/services/training/certificate.service`, and all register their mock with
`jest.doMock` against a module the code under test requires *lazily* — so whether the
mock or the real module wins is decided by interleaving. Each passes **3/3 in isolation**
and inside its own `tests/training/` run, and each fails roughly one full-suite run in
ten. The tell is unmistakable: `portal-grand-quiz` fails with a genuine `CERT-…` code
where the mock's `TESTPFX-…` was expected, meaning the real generator ran.

They are listed rather than fixed because **the root cause is not yet established**, and
guessing at a fix in three test files nobody has diagnosed is how a flake becomes two
flakes. What an investigation on 2026-09-01 ruled OUT, so the next person does not
repeat it:

- **Not fixture-state leakage between tests.** `beforeEach` calls `jest.resetModules()`
  and reassigns `tableStates = {}`, and the fixtures only ever emit `TESTPFX-…` codes.
  The observed `CERT-20260901-IKNIRB` carries today's date and a random suffix, so it
  came from the real generator, not from a leaked fixture row.
- **Not a second require site with a different specifier.**
  `bot/shared/routes/internal-api.routes.js` lazy-requires `certificate-pdf.service`,
  a different module. The only site reaching `certificate.service` is
  `dashboard/routes/portal.routes.js`, whose specifier resolves to the same absolute
  path the test's `jest.doMock` targets.

What is still unknown is *which* require call returned the real module, and the run
produces no record of it. Finding it needs the run instrumented — wrap the mock factory
so it logs when it is consulted, and log at the lazy-require site, then run the full
suite until it reproduces (about one run in ten). Until then the confirm-run plus this
list keep the gate honest.

It is worth doing rather than tolerating: a test that sometimes exercises the real
certificate generator is not testing what it says it tests, and quarantining these four
suites costs 35 tests of gating.

This is also exactly why `--update` prunes the flaky list rather than recording it: a
`--update` run that happened to catch one of these would otherwise have baked it in as a
permanently accepted failure. It caught `certificate-pdf-issuance` doing precisely that
while this baseline was being recorded.

The previous list named three certificate/R2-presign suites, and separately
`handlers/voice-language-floor` and `cache/language-writer` were flaking — all of
those were the missing-module problem surfacing non-deterministically, depending on
whether a suite's own `jest.mock` registered before the real require. Stubbing the
modules removed them.

---

## Bot-only dependencies

CI runs the root suite **before** `cd bot && npm ci`, so any package that lives only
in `bot/node_modules` is unresolvable while the root suite runs. Source that requires
one at module scope therefore kills the whole suite file — not the test that touches
it, the *file*.

Two ways out, both already in use:

**1. A stub in `tests/__mocks__/`, wired via `moduleNameMapper` in
`tests/jest.config.js`.** The default. Every stub resolves *empty* rather than
returning plausible data, so a suite that reached through to one fails on a visible
assertion about missing data instead of passing on fiction.

`axios` · `form-data` · `pino` · `exceljs` · `canvas` · `dotenv` · `pg` ·
`@supabase/supabase-js` · `@aws-sdk/client-s3` · `@aws-sdk/s3-request-presigner` ·
`@aws-sdk/client-textract` · `fluent-ffmpeg` · `@ffmpeg-installer/ffmpeg` ·
`@ffprobe-installer/ffprobe` · `pdf-parse` · `pdfkit` · `mammoth` · `playwright-core`

**2. A root `devDependency`, when the test asserts the library's real behaviour.**
Only `jsonrepair` qualifies today. `tests/coaching/fidelity/fidelity-analyzer.test.js`
asserts that jsonrepair *repairs* a trailing-comma payload — a stub would have to
reimplement the library to pass, which is worse than depending on it. It is 784 KB,
pure JS, zero dependencies, and pinned to the same `^3.13.1` as `bot/package.json`.
It is a **devDependency**, and Railway builds from `bot/`, so it never reaches a
production install.

A suite may still install its own `jest.mock(…, { virtual: true })` — an explicit
per-test mock takes precedence over `moduleNameMapper`, and several do (the
html-to-pdf and certificate suites). The global stubs are the floor for suites that
never had one, not a replacement for a purpose-built mock.

**Adding a bot dependency that root-reachable source requires at module scope?** Add
a stub in the same PR, or a root devDependency if a test needs the real thing.
`npm test` will tell you: a `Cannot find module` on a suite that used to load is a
regression the gate reports as a new failing suite.

---

## Also worth knowing

**The standard integration suite is green.** `npm run test:e2e` runs the two
coaching integration suites — 19 tests, all passing. Use it as the quick regression
check around each change.

**The suite used to leak processes.** `tests/setup/worker-boot.test.js` boots every
entry point as a real child process; the lesson-plan and video workers ignore
`SIGTERM`, so they survived, orphaned to init, kept polling with whatever queue
config the run carried, and held their stdio pipes open — which also stopped Jest
from exiting, so that file hung rather than finishing. It now escalates to `SIGKILL`
and waits for the process to actually die, with a guard test asserting no child
survives. This only ever reproduced locally: CI runs the root suite *before*
`cd bot && npm ci`, and the whole file skips when `bot/node_modules` is absent.

That audit also blanks the queue variables in the env it hands each child, so a
booted worker cannot reach a real queue no matter what the developer's `.env` says.
The check only asks whether the require chain loads; it has no business claiming
jobs. The guard lives in the test rather than in an npm script so it travels with the
code that needs it and cannot be bypassed by invoking Jest directly.

**`schema-completeness` is RIGHT to flag the roster RPCs — do not widen it.**

An earlier version of this note said the guard was merely scoped too narrowly, because
`roster_apply_edits` and `roster_import_students` do have a `CREATE FUNCTION` on disk in
`bot/database/migrations/`, which the guard never opens. **That was too generous, and it
is corrected here.**

The guard compares against `infrastructure/supabase/00_complete-schema.sql`, and that is
the correct file to compare against: `npm run bootstrap:db` applies **only** that file
plus RLS and seed (`infrastructure/scripts/bootstrap-db.js`). Nothing applies
`bot/database/migrations/` — its 45 files are run by hand, one at a time, via the
Supabase SQL editor or `node infrastructure/scripts/run-migration.js <file>`, as those
files' own headers say.

So a **fresh clone that bootstraps does not get these two functions**, and the roster
save path calls them. That is a real gap for clone deployments, not a guard artefact.
The fix is to fold them into `00_complete-schema.sql`, not to broaden `SCHEMA_PATH` —
widening it would teach the guard to accept functions a fresh install never receives,
which is the opposite of what it is for.

**Known-failing is not the same as acceptable.** The 30 above are debt with a
deadline, not a new normal. The rule is that the snapshot may only ever **shrink**.

---

## The gate is computed, not read

Until 2026-08-07 this file *described* the rule and nothing enforced it. That gave
the gate one bit of resolution — the suite is red — so a new violation inside an
already-red suite changed nothing observable.

It happened: `source-hygiene` was already failing when internal ticket references
were added to public source, the exact thing that guard exists to prevent. Suite
result before and after: red. Offender list: 682 entries → 683. Only the third
number was a regression, and nothing was looking at it.

```bash
npm test                        # the gate — this is what CI runs
npm run test:baseline           # the same thing, spelled out
npm run test:baseline:update    # re-record the snapshot (review the diff!)
```

[`tests/baseline-gate.js`](baseline-gate.js) compares at three levels:

| | Catches |
|---|---|
| **Suite** | a suite that was passing now fails |
| **Test** | a suite already failing now fails *additional* tests |
| **Offender** | a suite already failing reports entries it did not report before |

The offender level is the one that matters for the `tests/setup/` guards, because
those assert `expect(offenders).toEqual([])` — the entire finding lives in the array
diff, not in the pass/fail.

Improvements are reported and never gate: fewer offenders, fewer failing tests, or a
suite going green are all clean.

The snapshot is [`tests/baseline.snapshot.json`](baseline.snapshot.json) — 30 failing
suites, matching the counts recorded above (the flaky three are pruned from it by
`--update`, so a flaky suite can never be baked in as an accepted failure). Its own logic is covered by
[`tests/setup/baseline-gate.test.js`](setup/baseline-gate.test.js), including a test
that pins the offender-level case specifically.

**`--update` is the dangerous flag.** It swallows every regression present in the
tree at the time it runs. Only re-record from a tree you have separately verified,
read the resulting diff, and say in the PR why the baseline moved.

**And the baseline may only ever SHRINK — now computed, not just asserted.**

```bash
npm run test:baseline:growth        # vs origin/develop
```

The gate compares your run against the snapshot **in your branch**, so a PR that adds
its own failures to the snapshot passes it, cleanly, printing CLEAN. That is the same
shape as the bug the gate was built to fix: a rule in prose that nothing computes.
`tests/baseline-growth-check.js` closes it by comparing the snapshot against the base
branch and failing if it grew — at all three levels. It runs on every PR in `ci.yml`
(which checks out with `fetch-depth: 0`, since a shallow clone cannot see the base).

Removals are reported and never fail; shrinking is the goal. A deliberate re-record
that genuinely must grow passes `--allow-growth`, so the intent is recorded rather than
inferred.

**It blocks a PR into `develop` and is advisory on a `develop` → `main` promotion.** A
promotion legitimately carries develop's larger baseline into main — develop is ahead,
so its snapshot is generally a superset — and blocking that would fire on every single
release. Measured 2026-09-01: main's snapshot held 24 suites against develop's 30, so a
promotion PR would have been refused for doing exactly what a promotion does. Advisory
keeps the signal — *you are importing N newly-accepted failures into prod* — without the
false block.
