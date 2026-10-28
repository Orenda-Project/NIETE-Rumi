# lp-v8 — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/lp-v8 -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `app-open-survey-fln.test.js` | Pins that a Reading Hour/Numeracy (FLN) app open skips the lesson-plan survey (fln_no_survey) in lp-app-open-survey |
| `app-open-survey.test.js` | bd-qvevax.2: pins the LP survey following the teacher into the app: 30s delay, same buttons, lp_feedback stored |
| `bd-oak77-9-route-all.test.js` | bd-oak77-9: pins the LP_612_ROUTE_ALL cutover: typed 6-12 lesson-plan intents go to the menu, flags default OFF |
| `bd-oak77-9-voice-route-all.test.js` | bd-oak77-9: pins the cutover on the voice door (handleVoiceLessonPlanRequest): redirect line when both flags on |
| `bd-v0toag.46-record-line.test.js` | bd-v0toag.46: pins the v10 coaching-ask record line wording (en and gender-neutral ur), 1,024 code-point cap |
| `catalog-splits.test.js` | bd-es2eg.12: pins applySplits turning a long lesson into two teaching days (part 2 id + 'b'); pure and idempotent |
| `leader-reader-pdf.test.js` | bd-4joiqz: pins POST /api/internal/lp/v8/pdf for a leader reader: school's served version/card, no plan_served trace |
| `lp-coaching-ask-answer.test.js` | Pins the teacher's yes/no to the coaching ask through MenuService._handleClassroomCoachingChoice and the mic instruction |
| `lp-coaching-ask-app-open.test.js` | Pins that a K-5 plan read in the teacher app books exactly one coaching ask, sent by the WhatsApp path's send |
| `lp-coaching-ask-caps.test.js` | Pins coaching-ask caps as pure functions: weekly cap over rolling seven days and no-back-to-back rules (nudges/caps) |
| `lp-coaching-ask-document.test.js` | Pins short-recording catch on the audio-document path: under-15-minute file after a yes is answered too short |
| `lp-coaching-ask-next-day.test.js` | Pins coaching-ask copy for a lesson planned the day before (after 14:00 PKT): says yesterday, never today |
| `lp-coaching-ask-router.test.js` | Pins the lpask_ button branch executed through the real webhook route; tq_yes_ taps never reach the coaching ask |
| `lp-coaching-ask-schedule.test.js` | Pins deliverV8Lesson scheduling the coaching ask off the sent lesson: PKT delay, 07:30 next school day after 14:00 |
| `lp-coaching-ask-send.test.js` | Pins the coaching-ask send handler: sweeper registration, body and two buttons with nudge id, first-time copy |
| `lp-coaching-ask-survey-window.test.js` | Pins coaching ask held back while a thumbs-down LP survey window is open, then sent on a later tick |
| `lp-coaching-ask-voice.test.js` | Pins the real voice handler after 'Record my lesson': short recording answered too short, yes expires after 8 hours |
| `lp-day-button-routing.test.js` | Pins each lesson-plan-day button (survey, coaching ask, etc.) reaching exactly one handler through the real webhook |
| `lp-v10-card-migration.test.js` | bd-v0toag.50.1: static SQL checks that migration V1.6.6 lets niete_lp_assets hold kind 'card', re-runnable |
| `lp-v10-card-wiring.test.js` | bd-v0toag.50.1: pins the v10 card sent by WhatsApp delivery and app Open via lp-v10-card.servedFor, v9 fallback |
| `lp-v10-card.test.js` | bd-v0toag.50.1: pins lp-v10-card.service pickServed/servedFor: card only for plan-arm v10 schools with a v9 lesson |
| `meta-bill-nl1-survey-acks.test.js` | bd-w2daa.9 NL1: pins K-5 survey tap getting a reaction not a thank-you text; repeat taps send nothing |
| `meta-bill-nl2-double-tap.test.js` | bd-w2daa.9 NL2: pins a lesson tapped twice within two minutes delivered once, re-deliverable after the window |
| `meta-bill-nl3-cutover-door.test.js` | bd-w2daa.9 NL3: pins the drained free-form Gamma job opening one Flow message led by the redirect line |
| `meta-bill-nl3-redirect-in-flow.test.js` | bd-w2daa.9 NL3: pins openLpBrowseFlow merging the redirect line into the Flow body, two messages if over the cap |
| `meta-bill-nl4-survey-dedupe.test.js` | bd-w2daa.9 NL4: pins one LP survey per lesson per ten minutes even when the lesson is delivered twice |
| `split-lesson-consumers.test.js` | bd-es2eg.12: pins parseCorpusLessonId reading a split part-2 id and listLessons ordering part 1 first |
| `web-lessons-link.test.js` | Pins lesson-plan doors sending a portal-link template for listed teachers, falling back to the Flow on template failure |
| `web-lessons-portal-link.test.js` | Pins GET /t/<token> landing a lesson-plans link on /portal/curriculum with a scoped session (portal-link-token) |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/nudges/CLAUDE.index.md`? · `dashboard/routes/CLAUDE.index.md`? · `dashboard/services/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/lp-v8/CLAUDE.index.md`? · `tests/lp-v8/CLAUDE.md`?
