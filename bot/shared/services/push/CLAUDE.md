# push — Web quiz reminder push: VAPID subscriptions, routes and finish-response field

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/push kg=fa868a8b7cc0 gen=5bc039c2c130 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `web-quiz-push.service.js` — table, sender and switches
- `web-quiz-push.routes.js` — internal router behind web_quiz_push_remind
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `web-quiz-push.service.js` | Web quiz reminder push: web_quiz_push_subscriptions table, VAPID sender, child and teacher evening reminders |
| `web-quiz-push-field.js` | Adds the push_remind field to the web quiz finish response when web_quiz_push_remind is on, else nothing |
| `web-quiz-push.routes.js` | Internal /api/internal/wqpush router (state, key, subscribe) behind web_quiz_push_remind, called by the portal edge |

## Who reads this (generated)
- `web-quiz-push.service.js` ← imported by `bot/workers/push-ticks.js:19:b0b560fa` · `bot/shared/services/push/web-quiz-push-field.js:11:cc4db408` (+1)
- `web-quiz-push.routes.js` ← imported by `bot/shared/services/first-touch/push-remind.mount.js:9:ceb08b14`
- env read here: `WQ_PUSH_ENC_KEY` · `WQ_PUSH_HASH_SALT` · `WQ_PUSH_VAPID_PRIVATE` · `WQ_PUSH_VAPID_PUBLIC` · `WQ_PUSH_VAPID_SUBJECT`

## Never (human)
- Switches are JSON true only and fail closed (web-quiz-push.service.js:4-5)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/push/web-quiz-push.routes.test.js`? (web-quiz-push-field.js, web-quiz-push.routes.js, web-quiz-push.service.js)
- `bot/tests/push/web-quiz-push-finish.test.js` (web-quiz-push.service.js)
- `bot/tests/push/web-quiz-push.service.test.js` (web-quiz-push.service.js)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`?
