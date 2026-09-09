# bd-60067 — Assessment Generator on the Portal

Plan (V2, all 5 decisions settled): https://claude.ai/code/artifact/3926b822-2e3f-41d1-8146-d5971532373b

Layout note: on `develop` the services live in `bot/shared/services/assessment/`,
not the flat path the plan quoted from `origin/main`. Orchestrator is byte-identical
across the two branches (verified: git diff main..develop touches only portal exam files).

## Build order — 8 steps, 2 shipping gates

- [x] 1. S1 — split `buildPaper()` out of `process()`. WhatsApp path behaviourally identical.
- [~] 2. S5 done (`answer_key_r2_key`, commit af2f5d0d, bd-60068 closed). S6 (shared cap) pending — belongs with the API in step 4, since the cap reaches the portal via /assessment/options.
- [ ] 3. S2 + S3 — `deliver` mode + shared `createAndQueue()`.
- [ ] 4. S4 + six internal endpoints.
- [ ] 5. Portal client, form, My papers.
- [ ] 6. GATE — ship generation (staging by hand, then prod on operator's go).
- [ ] 7. Review layer (`listQuestions`/`saveEdit` + rerender split).
- [ ] 8. GATE — ship editing.

## Baseline (recorded before any edit)

**tests/assessment: 27/27 suites, 386/386 tests GREEN.**

Two environment artifacts had to be cleared first, neither a code failure:
1. `@supabase/supabase-js` is a `bot/` dependency, not a root one — `npm install`
   in `bot/` fixed 10 of the 12 initial failures.
2. Two suites (`assessment-navfit-urdu`, `assessment-rebuild-completion`) require
   the real Supabase env vars, because they load `assessment-gen-endpoint.js`
   which requires the real config, which `process.exit(78)`s when they are unset.

Repeatable baseline command (from the worktree root):

    SUPABASE_URL=$(grep -m1 '^SUPABASE_URL=' .env | cut -d= -f2-) \
    SUPABASE_SERVICE_ROLE_KEY=$(grep -m1 '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2-) \
    npx jest tests/assessment/

NOTE: the worktree `.env` was seeded with the MAIN BOT's credentials by
`.worktreeinclude` and has been REPLACED with `NIETE-Rumi/.env`
(project ref ihzciabopbttygxxgrkm). See CLAUDE.md's REPO= warning.

## Baseline gate (`npm test`) — reports REGRESSION, and it is NOT ours

`node tests/baseline-gate.js` exits with REGRESSION on this branch. Verified
pre-existing, three ways:

1. The snapshot `tests/baseline.snapshot.json` was last committed at `c2f96045`
   — **739 commits behind `origin/develop`**. It reports "fixed" suites and
   "fixed offenders" (`source-hygiene -354`) as well as new ones, which is the
   signature of a stale snapshot rather than a broken branch.
2. The suites it names — `flow-config-conformance` (student-join-flow.json),
   `circular-deps` (quiz transcript services), `PROD_DIGEST_WINDOW_MIN` — touch
   nothing this branch edits.
3. **`grep -ci assessment` over the whole gate output returns 0.** No assessment
   suite appears anywhere in it.

Our own gate is `tests/assessment/`, which is green and growing (see per-step
notes below). Flag this in the PR rather than updating the snapshot: refreshing
it here would silently absorb 739 commits of other people's drift into our diff.

## Progress

| Step | State | Evidence |
|---|---|---|
| 1 · S1 buildPaper | done | `af2f5d0d`; 9 seam tests; WhatsApp path unchanged |
| 2 · S5 answer key column | done | `af2f5d0d` + V1.4.2 migration; 4 tests; bd-60068 closed |
| 2 · S6 shared cap | moved to step 4 | the portal reads the cap from `/assessment/options`, so it lands with the API rather than before it |

tests/assessment: **29 suites / 399 tests, all green** (baseline 27/386).
