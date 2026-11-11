# workflows — CI gates and deploy jobs; branch ladder is sandbox to staging to main
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=.github/workflows kg=923293d18b0c gen=67a5fd9c6b83 overflow=4 rendered=2026-11-10 kg.py=1.1.0 -->

## Entry points
- `ci.yml` — root jest, lint and portal vitest on PRs; qa-impact.yml gates spec freshness
- `syntax.yml` — cheap parse check on bot/ JS, run on PRs and pushes
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `qa-impact.yml` | On PRs into sandbox/staging/main: Gherkin spec-freshness gate (blocking) and E2E proof (warning), one PR comment |
| `android*` | 3 files; most used `android-release.yml`: Builds, signs and ships the NIETE Android app to Play on android-v* tags or manual dispatch (bd-2553) |
| `data-standards.yml` | Data Standards schema gate on every PR and push to main/staging/sandbox; ownership check blocks, report job is advisory |
| `branch-guard.yml` | Fails any PR or push to main/staging/sandbox if tooling still references the retired develop branch |
| `ci.yml` | Main CI on PRs and pushes to main/staging/sandbox: root jest test job, lint, and portal newui vitest job |
| `fresh-clone-smoke.yml` | Weekly Monday and manual smoke test that a fresh clone passes npm install and npm test |
| `kg-check.yml` | On every PR rebuilds the knowledge graph and fails if committed door files or kg summaries drift from the graph |
| `logger-level.yml` | Fast gate for the logger-severity ratchet on PRs and pushes to main/staging/sandbox touching bot/ |
| `syntax.yml` | Cheap required check that every tracked JS under bot/ parses, on PRs and pushes to main/staging/sandbox (PR #1008) |
| … | 6 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Never list the retired develop branch in any workflow; branch-guard fails it (data-standards.yml:51)
- main accepts PRs only from staging (main-source-branch.yml:1)
- data-standards.yml has no paths filter so a required check always reports (data-standards.yml:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- skills: `niete-mock-e2e`?
- docs: `.claude/skills/data-standards/reference/instances/niete-rumi.md`? · `.github/CLAUDE.md`? · `docs/migration/08-launch-checklist.md`? · `docs/qa-automation.md`? · `portal/ANDROID.md`?
