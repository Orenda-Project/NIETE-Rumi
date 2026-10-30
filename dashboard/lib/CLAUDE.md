# lib — Small shared helpers: feature flags, edge switches, date rules, COACHIP insights job
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/lib kg=9bf2a63f62f0 gen=1400cbdedb79 overflow=94 rendered=2026-10-30 kg.py=1.1.0 -->

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
| `analytics*` | 3 files; most used `analytics-lists.js`: One loader of the three school lists (FDE EMIS, RDF, etc.) that every schools-analytics tab counts against. |
| … | 27 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `feature-flags.js` ← imported by `dashboard/routes/app-login.routes.js:115:56e747e4` · `dashboard/routes/coach-card.routes.js:36:2687a7b5` (+15)
- `portal-auth.js` ← imported by `dashboard/routes/attendance.routes.js:57:7725a0c7` · `dashboard/routes/hcp.routes.js:47:7725a0c7` (+13)
- `analytics-lists.js` ← imported by `dashboard/routes/portal.routes.js:125:de843ac4` · `dashboard/services/coachip-scope.service.js:23:f5343854` (+7)
- … 28 more → `CLAUDE.index.md`

## Never (human)
- Never treat a non-boolean app_settings value as ON; only JSON true counts (`closed-way-back-switch.js:5`)
- Never use an env var for a bot-shared flag; one app_settings row answers both (`feature-flags.js:4`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `tests/portal/analytics-organization-scope.test.js` (analytics-lists.js, analytics-viewer.js, feature-flags.js)
- `tests/portal/analytics-schools-route.test.js` (analytics-viewer.js, feature-flags.js, leader-role.js)
- … 48 more → `CLAUDE.index.md`

## Related (generated)
- docs: `dashboard/CLAUDE.md`? · `docs/onboarding/local-portal.md`? · `portal/ANDROID.md`? · `portal/src/portal/newui/DESIGN.md`?
