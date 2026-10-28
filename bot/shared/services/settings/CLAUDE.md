# settings — Shared app_settings switch cache and the page-switch snapshot

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/settings kg=5e1aa2cafca6 gen=d667a4ae7eb4 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `switch-cache.js` — cachedSwitch: one read per TTL, last good on failure
- `settings-snapshot.js` — page switches in one read
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `settings-snapshot.js` | Single-read snapshot of web quiz page switches (page_keep/page_warm) to cut repeated settings reads |
| `switch-cache.js` | Cached app_settings switch reader so a settings outage costs one read per TTL, serving last good value |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- `settings-snapshot.js` ← imported by `bot/shared/services/child-test/app/add-child-switch.js:10:0634a325` · `bot/shared/services/child-test/app/all-grades-switch.js:9:0634a325` (+32)
- `switch-cache.js` ← imported by `bot/shared/services/classes/class-vocabulary.service.js:42:9cf59a45` · `bot/shared/services/coaching/iab-unreflected-switch.js:19:9cf59a45` (+8)

## Never (human)
- A failed read serves the last good value else off (`bot/shared/services/settings/switch-cache.js:8`)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/child-test/sa-any-school.test.js` (settings-snapshot.js)
- `bot/tests/quiz/web-quiz/web-quiz-page-keep.test.js` (settings-snapshot.js)
- `bot/tests/settings/switch-cache.test.js` (switch-cache.js)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/settings/CLAUDE.md`? · `bot/tests/child-test/CLAUDE.index.md`? · `bot/tests/quiz/web-quiz/CLAUDE.index.md`? · `bot/tests/settings/CLAUDE.md`?
