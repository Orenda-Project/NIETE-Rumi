# observe2 — /observe2: FICO ICT live field form, checked moments, brief and indicator levels
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/observe/observe2 kg=1620bfd6f940 gen=cf14be410709 overflow=88 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `start.js` — command to live form
- `field-form.store.js` — main reader/writer of observation_field_forms; child-test code also reads it
- `rules.js` — evidence to a level on each of the 17 indicators
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `field-form.store.js` | Writes observation_field_forms, saving parts only while unsealed; child-test modules also read the table |
| `fico17.js` | The 17 FICO ICT indicators in plain words, grouped into four lesson moments, for observe2 |
| `strings.js` | Chat lines the observe2 coach reads, per language (en, ur), as data |
| `field-form.flow.js` | Defines the live field form WhatsApp Flow the coach fills during the lesson (observe2) |
| … | 17 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `coaching_sessions` (written by `capture-link.js` (+1)) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? (+88)
- column `coaching_sessions.user_id` (written by `capture-link.js`) ← read by `bot/shared/calls/call-context.repo.js:65:219f5683` · `bot/shared/calls/call-tools.repo.js:52:23fca46d` (+52)
- … 29 more → `CLAUDE.index.md`

## Never (human)
- Parts are saved only while unsealed: every write filters sealed_at IS NULL (field-form.store.js:7)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/observe2/thinking.test.js` (analysis.js, brief.js, evidence-check.flow.js, fico17.js, field-form.flow.js, field-form.store.js, rules.js)
- `tests/observe2/lesson-plan-and-fidelity.test.js` (brief.js, evidence-check.flow.js, fico17.js, field-form.flow.js, field-form.store.js, moments.js)
- … 42 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/observe/CLAUDE.index.md`? · `bot/shared/services/observe/CLAUDE.md`? · `bot/shared/services/observe/observe2/CLAUDE.index.md`? · `bot/shared/services/observe/observe2/CLAUDE.md`? · `bot/tests/i18n/CLAUDE.md`?
