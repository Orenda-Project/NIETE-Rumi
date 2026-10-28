# workflows — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=.github/workflows -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `android-debug.yml` | On-demand (workflow_dispatch) Android debug APK build for device testing against staging or a given API URL (bd-2553) |
| `android-release.yml` | Builds, signs and ships the NIETE Android app to Play on android-v* tags or manual dispatch (bd-2553) |
| `android-staging.yml` | Builds the Android app pointed at the staging portal on pushes to staging touching portal/, or manual dispatch (bd-2554) |
| `branch-guard.yml` | Fails any PR or push to main/staging/sandbox if tooling still references the retired develop branch |
| `ci.yml` | Main CI on PRs and pushes to main/staging/sandbox: root jest test job, lint, and portal newui vitest job |
| `data-standards.yml` | Data Standards schema gate on every PR and push to main/staging/sandbox; ownership check blocks, report job is advisory |
| `deploy.yml` | On push to main touching bot/, deploys the bot to Railway with RAILWAY_TOKEN; skips cleanly when the token is unset |
| `fresh-clone-smoke.yml` | Weekly Monday and manual smoke test that a fresh clone passes npm install and npm test |
| `kg-check.yml` | On every PR rebuilds the knowledge graph and fails if committed door files or kg summaries drift from the graph |
| `logger-level.yml` | Fast gate for the logger-severity ratchet on PRs and pushes to main/staging/sandbox touching bot/ |
| `main-source-branch.yml` | Fails any pull request into main whose head branch is not staging |
| `promotion-invariant.yml` | After pushes to main (or manual), checks main carries nothing that staging lacks, catching bypassed branch protection |
| `qa-impact.yml` | On PRs into sandbox/staging/main: Gherkin spec-freshness gate (blocking) and E2E proof (warning), one PR comment |
| `secret-scan.yml` | Runs the gitleaks CLI on pushes to main and every PR to block committed credentials |
| `staging-source-branch.yml` | On PRs into staging: source-branch check plus staging-needs-sandbox job requiring commits to already be on sandbox |
| `syntax.yml` | Cheap required check that every tracked JS under bot/ parses, on PRs and pushes to main/staging/sandbox (PR #1008) |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- skills: `gherkin-spec-sync`? · `niete-mock-e2e`?
- docs: `.claude/skills/data-standards/reference/instances/niete-rumi.md`? · `.github/CLAUDE.md`? · `.github/workflows/CLAUDE.index.md`? · `.github/workflows/CLAUDE.md`? · `docs/CLAUDE.index.md`? · `docs/CLAUDE.md`? · `docs/migration/08-launch-checklist.md`? · `docs/migration/CLAUDE.index.md`? · `docs/migration/CLAUDE.md`? · `docs/qa-automation.md`? · `docs/railway-operations.md`? · `portal/ANDROID.md`? · `portal/CLAUDE.index.md`? · `portal/CLAUDE.md`?
