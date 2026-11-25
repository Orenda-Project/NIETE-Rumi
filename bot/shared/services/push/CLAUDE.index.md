# push — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/push -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `web-quiz-push-field.js` | Adds the push_remind field to the web quiz finish response when web_quiz_push_remind is on, else nothing |
| `web-quiz-push.routes.js` | Internal /api/internal/wqpush router (state, key, subscribe) behind web_quiz_push_remind, called by the portal edge |
| `web-quiz-push.service.js` | Web quiz reminder push: web_quiz_push_subscriptions table, VAPID sender, child and teacher evening reminders |

## Who reads this (all, generated)
- `web-quiz-push-field.js` ← imported by `bot/shared/routes/web-quiz-class-link.routes.js:25:34489aae`
- `web-quiz-push.routes.js` ← imported by `bot/shared/services/first-touch/push-remind.mount.js:9:ceb08b14`
- `web-quiz-push.service.js` ← imported by `bot/workers/push-ticks.js:21:b0b560fa` · `bot/shared/services/push/web-quiz-push-field.js:11:cc4db408` · `bot/shared/services/push/web-quiz-push.routes.js:22:0cd559ee`
- env `WQ_PUSH_ENC_KEY` read at `bot/shared/services/push/web-quiz-push.service.js:263:ce8c2730`
- env `WQ_PUSH_HASH_SALT` read at `bot/shared/services/push/web-quiz-push.service.js:261:de37a44e`
- env `WQ_PUSH_VAPID_PRIVATE` read at `bot/shared/services/push/web-quiz-push.service.js:547:8b92e87f`
- env `WQ_PUSH_VAPID_PUBLIC` read at `bot/shared/services/push/web-quiz-push.service.js:547:8b92e87f`
- env `WQ_PUSH_VAPID_SUBJECT` read at `bot/shared/services/push/web-quiz-push.service.js:547:8b92e87f`

## Tests (all, generated)
- `web-quiz-push-field.js` ← `bot/tests/push/web-quiz-push.routes.test.js`
- `web-quiz-push.routes.js` ← `bot/tests/push/web-quiz-push.routes.test.js`?
- `web-quiz-push.service.js` ← `bot/tests/push/web-quiz-push-finish.test.js` · `bot/tests/push/web-quiz-push-gone.test.js` · `bot/tests/push/web-quiz-push-ps.test.js` · `bot/tests/push/web-quiz-push-qa.test.js` · `bot/tests/push/web-quiz-push.routes.test.js` · `bot/tests/push/web-quiz-push.service.test.js` (+10: `python3 kg/kg.py who-reads bot/shared/services/push/web-quiz-push.service.js`)

## Related (all, generated)
- docs: `bot/shared/services/CLAUDE.md`?
