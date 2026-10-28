# handlers — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/tests/handlers -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `image-message.handler.test.js` | Tests the image message handler exists, routes correctly and handles errors |
| `is-video-command.test.js` | Pins isVideoCommand matching the /video command and the bare keyword 'video' without swallowing normal chat (bd-2486) |
| `lesson-plan-v2.handler.test.js` | Integration test of handleCurriculumLessonPlan across cached, queued and fallback outcomes with mocked AST, queue and R2 |
| `portal-bare-word.test.js` | Pins that the bare word 'portal' sends the same signed portal button as /portal, in English and Urdu (keyword-entry G1) |
| `portal-command-no-password.test.js` | Pins /portal sending one-tap signed link to every registered adult even with no password saved (bd-kkpg4t, bd-x7aprz.3) |
| `portal-request.test.js` | Pins isPortalRequest: only a whole-message portal request matches, with the PORTAL_KEYWORD_ROUTING switch |
| `reversed-slash-command.test.js` | Pins a slash command typed back way RTL Urdu displayed it ('Menu/', '/ menu') still reaches command (bd-5ls6qy.7) |
| `template-button-fallthrough.test.js` | Pins an unrecognised template QUICK_REPLY button falls through to the text handler instead of dead-ending (bd-kggts) |
| `try-child-video-menu.test.js` | Pins tryChildVideoMenu: anonymous quiz child with one matching student gets /video Flow, else falls through (bd-2475) |
| `try-curriculum-lp-serve.test.js` | Pins tryCurriculumLessonPlanServe grade/subject resolution: message first, then user columns, else no intercept |

## Who reads this (all, generated)
- env `INTERNAL_API_KEY` read at `bot/tests/handlers/portal-command-no-password.test.js:20:e9cb80e9`
- env `PORTAL_KEYWORD_ROUTING` read at `bot/tests/handlers/portal-bare-word.test.js:167:963d27c8` · `bot/tests/handlers/portal-request.test.js:33:c76e4cd4`
- env `SUPABASE_URL` read at `bot/tests/handlers/portal-command-no-password.test.js:21:88405bdc`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? · `bot/tests/handlers/CLAUDE.index.md`? · `bot/tests/handlers/CLAUDE.md`?
