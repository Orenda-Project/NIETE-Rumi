# app — Coach-app API and app_settings switches for the self-administered assessment
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/child-test/app kg=6b8199b57512 gen=0304859724d9 overflow=103 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `sa-api.service.js` — schools, day list, outcomes, battery, sessions for the portal
- `app-api.service.js` — coach-recorded child test from the app (bd-s1oo0.7)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `sa-api.service.js` | Coach app's self-administered Learning assessment API: schools, day list, outcomes, battery, presign, register, sessions |
| `app-api.service.js` | Bot side of the coach-app child test (card, timer, recorder); portal relays here over the internal API (bd-s1oo0.7) |
| `mcq-switch.js` | (unmapped) |
| `per-visit-switch.js` | (unmapped) |
| `practice-only-switch.js` | Switch (child_test_practice_only): coaches off the pilot list get practice schools only; read by gate.isPracticeCoach |
| `coach-last-word-switch.js` | Switch (sa_coach_last_word) enabling POST /sa/last-word-hint suggestions for coaches; read by sa-api.service |
| … | 24 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `app-api.service.js` ← imported by `bot/shared/handlers/jugnu-command.js:126:4324bdc8` · `bot/shared/services/child-test/app/sa-api.service.js:76:83955dcf` (+1)
- `mcq-switch.js` ← imported by `bot/shared/services/child-test/sa-store.js:221:a7228eb8` · `bot/shared/services/child-test/sa/score.js:119:55ca8896` (+1)
- `coach-last-word-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:109:6ae06b45` · `bot/shared/services/child-test/app/sa-api.service.js:63:317cbf62`
- `per-visit-switch.js` ← imported by `bot/shared/services/child-test/app/app-api.service.js:307:c74394e6` · `bot/shared/services/child-test/app/sa-api.service.js:60:7ef79205`
- … 30 more → `CLAUDE.index.md`

## Never (human)
- Switches fail closed: only JSON true turns one on (rdf-switch.js:6)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/child-test/sa-per-visit.test.js` (app-api.service.js, per-visit-switch.js, sa-api.service.js)
- `bot/tests/child-test/sa-practice-only.test.js` (app-api.service.js, practice-only-switch.js, sa-api.service.js)
- … 54 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/child-test/CLAUDE.md`?
