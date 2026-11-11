# lib — Small shared helpers: feature flags, edge switches, date rules, COACHIP insights job
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/lib kg=c8867b9798a6 gen=4365b8725019 overflow=104 rendered=2026-11-10 kg.py=1.1.0 -->

## Entry points
- `feature-flags.js` — fail-closed app_settings flags shared with the bot
- `fln-access.js` — one access rule for Reading Hour + Numeracy
- `insights/job.js` — COACHIP nightly pipeline entry
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `insights/` | COACHIP nightly insight job: stage modules run by job.js, writing coachip_* tables → `insights/CLAUDE.md` |
| `feature-flags.js` | Fail-closed feature flags backed by app_settings, shared by bot and dashboard so both surfaces give one answer; bd-2460. |
| `portal*` | 3 files; most used `portal-auth.js`: (unmapped) |
| `leader-role.js` | Middleware gating the Leader Portal (My Patch, roster) to the school-leader role family; bd-2434, port of bd-2385. |
| … | 29 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `feature-flags.js` ← imported by `dashboard/routes/app-login.routes.js:116:132c2e3b` · `dashboard/routes/coach-card.routes.js:36:2687a7b5` (+19)
- `portal-auth.js` ← imported by `dashboard/routes/app-feedback.routes.js:58:7365b659` · `dashboard/routes/attendance.routes.js:57:7725a0c7` (+18)
- `leader-role.js` ← imported by `dashboard/routes/hcp.routes.js:39:7f62b386` · `dashboard/routes/portal-child-test.routes.js:52:7f62b386` (+9)
- `teacher-app.js` ← imported by `dashboard/routes/app-login.routes.js:117:24ae2e7c` · `dashboard/routes/portal-lp612-own.routes.js:24:24ae2e7c` (+9)
- … 29 more → `CLAUDE.index.md`

## Never (human)
- Never treat a non-boolean app_settings value as ON; only JSON true counts (`closed-way-back-switch.js:5`)
- Never use an env var for a bot-shared flag; one app_settings row answers both (`feature-flags.js:4`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `tests/portal/analytics-organization-scope.test.js` (analytics-lists.js, analytics-viewer.js, feature-flags.js)
- `tests/portal/analytics-schools-route.test.js` (analytics-viewer.js, feature-flags.js, leader-role.js)
- … 55 more → `CLAUDE.index.md`

## Related (generated)
- docs: `dashboard/CLAUDE.md`? · `docs/onboarding/local-portal.md`? · `portal/ANDROID.md`? · `portal/src/portal/newui/DESIGN.md`?
