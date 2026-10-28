# handlers — Tests for message-handler entry points: portal, video, slash and button routes
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/handlers kg=379eb8b1565b gen=8626ce21723a overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `portal-request.test.js` — isPortalRequest table behind the portal keyword doors
- `reversed-slash-command.test.js` — RTL-typed commands still route (bd-5ls6qy.7)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `portal*` | 3 files; most used `portal-bare-word.test.js`: Pins that the bare word 'portal' sends the same signed portal button as /portal, in English and Urdu (keyword-entry G1) |
| `reversed-slash-command.test.js` | Pins a slash command typed back way RTL Urdu displayed it ('Menu/', '/ menu') still reaches command (bd-5ls6qy.7) |
| `lesson-plan-v2.handler.test.js` | Integration test of handleCurriculumLessonPlan across cached, queued and fallback outcomes with mocked AST, queue and R2 |
| `try-child-video-menu.test.js` | Pins tryChildVideoMenu: anonymous quiz child with one matching student gets /video Flow, else falls through (bd-2475) |
| `image-message.handler.test.js` | Tests the image message handler exists, routes correctly and handles errors |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `try-curriculum-lp-serve.test.js` | Pins tryCurriculumLessonPlanServe grade/subject resolution: message first, then user columns, else no intercept |
| `template-button-fallthrough.test.js` | Pins an unrecognised template QUICK_REPLY button falls through to the text handler instead of dead-ending (bd-kggts) |
| `is-video-command.test.js` | Pins isVideoCommand matching the /video command and the bare keyword 'video' without swallowing normal chat (bd-2486) |

## Who reads this (generated)
- env read here: `INTERNAL_API_KEY` · `PORTAL_KEYWORD_ROUTING` · `SUPABASE_URL`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? (+2)
