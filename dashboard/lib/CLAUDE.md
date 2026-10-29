# lib — Small shared helpers: feature flags, edge switches, date rules, COACHIP insights job
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/lib kg=4240ff7bdbb5 gen=5cfe6e0bb41f overflow=91 rendered=2026-10-29 kg.py=1.1.0 -->

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
| `analytics*` | 3 files; most used `analytics-lists.js`: One loader of the three school lists (FDE EMIS, RDF, etc.) that every schools-analytics tab counts against. |
| `leader-role.js` | Middleware gating the Leader Portal (My Patch, roster) to the school-leader role family; bd-2434, port of bd-2385. |
| … | 26 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `feature-flags.js` ← imported by `dashboard/routes/app-login.routes.js:115:56e747e4` · `dashboard/routes/coach-card.routes.js:36:2687a7b5` (+15)
- `analytics-lists.js` ← imported by `dashboard/routes/portal.routes.js:121:de843ac4` · `dashboard/services/coachip-scope.service.js:23:f5343854` (+5)
- `pk-range.js` ← imported by `dashboard/routes/portal-teacher-coaching.routes.js:26:a69bbe61` · `dashboard/routes/portal-teacher-lessons.routes.js:21:150648cb` (+5)
- … 27 more → `CLAUDE.index.md`

## Never (human)
- Never treat a non-boolean app_settings value as ON; only JSON true counts (`closed-way-back-switch.js:5`)
- Never use an env var for a bot-shared flag; one app_settings row answers both (`feature-flags.js:4`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `tests/portal/analytics-schools-route.test.js` (analytics-viewer.js, feature-flags.js, leader-role.js)
- `dashboard/tests/closed-way-back-switch.service.test.js` (closed-way-back-switch.js)
- … 45 more → `CLAUDE.index.md`

## Related (generated)
- docs: `dashboard/CLAUDE.md`? · `docs/onboarding/local-portal.md`? · `portal/ANDROID.md`? · `portal/src/portal/newui/DESIGN.md`?
