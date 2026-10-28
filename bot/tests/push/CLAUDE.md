# push — Tests for the web-quiz reminder push (switches, routes, service)

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/push kg=af88c20463b3 gen=e14ced3957d0 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `web-quiz-push.service.test.js` — switches, hashed subscription, send and revoke
- `web-quiz-push.routes.test.js` — /api/internal/wqpush off/401/on behaviour
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `web-quiz-push.routes.test.js` | Pins the /api/internal/wqpush router: 404 {off:true} when off, 401 without internal key, mounted in first-touch list |
| `web-quiz-push-finish.test.js` | Pins that web-quiz finish() adds push_remind:true only while web_quiz_push_remind and push env are set |
| `CLAUDE.md` | (unmapped) |
| `web-quiz-push.service.test.js` | Tests web-quiz reminder push service: switches, hashed subscription, next school day, no-name payload, 404/410 revoke |

## Who reads this (generated)
- env read here: `INTERNAL_API_KEY` · `WQ_PUSH_HASH_SALT`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/first-touch/CLAUDE.index.md`? · `bot/shared/services/first-touch/CLAUDE.md`? · `bot/shared/services/push/CLAUDE.md`? · `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? (+3)
