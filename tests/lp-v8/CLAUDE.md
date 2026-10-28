# lp-v8 — Grade 1-5 v8 LP delivery, coaching ask, LP survey, web lessons link, Meta-bill cuts
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/lp-v8 kg=63eaf15787d9 gen=523fcc0f197d overflow=3 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `lp-coaching-ask-send.test.js` — the coaching ask at send time; sibling files cover schedule/caps/voice
- `meta-bill-nl2-double-tap.test.js` — double-tap guard, one of the bd-w2daa.9 message cuts
- Covers v8 catalogue, v10 card, survey. Root jest (tests/jest.config.js): from repo root `node tests/run.js tests/lp-v8 --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `app-open-survey.test.js` | bd-qvevax.2: pins the LP survey following the teacher into the app: 30s delay, same buttons, lp_feedback stored |
| `lp*` | 14 files; most used `lp-coaching-ask-send.test.js`: Pins the coaching-ask send handler: sweeper registration, body and two buttons with nudge id, first-time copy |
| `bd*` | 3 files; most used `bd-v0toag.46-record-line.test.js`: bd-v0toag.46: pins the v10 coaching-ask record line wording (en and gender-neutral ur), 1,024 code-point cap |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `web-lessons-link.test.js` | Pins lesson-plan doors sending a portal-link template for listed teachers, falling back to the Flow on template failure |
| `web-lessons-portal-link.test.js` | Pins GET /t/<token> landing a lesson-plans link on /portal/curriculum with a scoped session (portal-link-token) |
| `app-open-survey-fln.test.js` | Pins that a Reading Hour/Numeracy (FLN) app open skips the lesson-plan survey (fln_no_survey) in lp-app-open-survey |
| `leader-reader-pdf.test.js` | bd-4joiqz: pins POST /api/internal/lp/v8/pdf for a leader reader: school's served version/card, no plan_served trace |
| … | 3 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- A lesson tapped twice within two minutes must be delivered once (meta-bill-nl2-double-tap.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/nudges/CLAUDE.index.md`? (+6)
