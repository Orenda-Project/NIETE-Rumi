# observe2 — /observe2: FICO ICT live field form, checked moments, brief and indicator levels
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/observe/observe2 kg=fb332f549994 gen=74a0a183255b overflow=129 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `start.js` — command to live form
- `field-form.store.js` — main reader/writer of observation_field_forms; child-test code also reads it
- `rules.js` — evidence to a level on each of the 17 indicators
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `field-form.store.js` | Writes observation_field_forms, saving parts only while unsealed; child-test modules also read the table |
| `strings.js` | Chat lines the observe2 coach reads, per language (en, ur), as data |
| `fico17.js` | The 17 FICO ICT indicators in plain words, grouped into four lesson moments, for observe2 |
| `moments.js` | One model call over the timestamped transcript returning moments the coach later checks (observe2) |
| `rules.js` | Turns the coach's evidence into a level on each of the 17 FICO ICT indicators using workbook thresholds |
| … | 17 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `coaching_sessions` (written by `capture-link.js` (+1)) ← read by `bot/scripts/fico17-v6-replay.js:87:0a1853f5`? · `bot/shared/calls/call-context.repo.js:63:5911672a`? (+99)
- column `coaching_sessions.user_id` (written by `capture-link.js`) ← read by `bot/shared/calls/call-context.repo.js:65:219f5683` · `bot/shared/calls/call-tools.repo.js:57:23fca46d` (+56)
- column `coaching_sessions.status` (written by `moments.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:57:23fca46d` (+44)
- … 39 more → `CLAUDE.index.md`

## Never (human)
- Parts are saved only while unsealed: every write filters sealed_at IS NULL (field-form.store.js:7)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/observe2/moments-v3.test.js` (field-form.store.js, label-check.js, moment-types.js, moments.js, quote-check.js, rules.js, strings.js)
- `tests/observe2/thinking.test.js` (analysis.js, brief.js, evidence-check.flow.js, fico17.js, field-form.flow.js, field-form.store.js, rules.js)
- … 77 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/observe/CLAUDE.md`?
