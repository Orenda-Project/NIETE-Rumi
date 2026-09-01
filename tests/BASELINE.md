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

Need the raw Jest output with no verdict — debugging a single suite, or wanting the
unfiltered exit code?

```bash
npm run test:raw                                   # plain jest, still red by design
npm run test:raw -- --testPathPattern=coaching     # one area
```

Add `--forceExit` to a filtered raw run: `tests/jest.config.js` does not set it, so
a subset can hang after the summary on an open handle.

No out-of-band installs are needed. Every bot-only dependency reachable from a root
suite is either stubbed in `tests/__mocks__/` or, for `jsonrepair`, a root
devDependency — see **Bot-only dependencies** below.

---

## Baseline as of `553ab40` (develop)

Measured over four consecutive runs. Node v22.23.1, Jest 29.7.0.

| | |
|---|---|
| Total suites | 407 |
| Total tests | 4,713 |
| Stable failing suites | **30** |
| Flaky failing suites | **1** |
| Failing tests | 91–92 (varies with the flaky one) |
| Suites that fail to *load* | **0** |

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
tests/handlers/text-message-lp-keyword.test.js
tests/observe/bd-5n1a2-resolve-teacher-empty-school.test.js
tests/quiz/lp-shelf.test.js
tests/student-videos/student-videos-flow.test.js
tests/textbook-lp-v2/handler-curriculum.test.js
tests/textbook-lp-v2/pregen-lookup.test.js
tests/textbook-lp-v2/topic-matching.test.js
tests/training/portal-level-unlock-logic.test.js
```

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
```

Its Redis cancel-flag mock intermittently does not observe the expected `setex`.
This is the only flake left. The previous list named three certificate/R2-presign
suites, and separately `handlers/voice-language-floor` and `cache/language-writer`
were flaking — all of those were the missing-module problem surfacing
non-deterministically, depending on whether a suite's own `jest.mock` registered
before the real require. Stubbing the modules removed them.

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
suites, matching the counts recorded above. Its own logic is covered by
[`tests/setup/baseline-gate.test.js`](setup/baseline-gate.test.js), including a test
that pins the offender-level case specifically.

**`--update` is the dangerous flag.** It swallows every regression present in the
tree at the time it runs. Only re-record from a tree you have separately verified,
read the resulting diff, and say in the PR why the baseline moved.
