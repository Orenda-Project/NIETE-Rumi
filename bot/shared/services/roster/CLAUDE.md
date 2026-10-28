# roster — /roster pipeline: decrypt photo, vision-extract rows, edit lines, store photos
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/roster kg=6929948f0d19 gen=e7bed10c948c overflow=3 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `roster-extraction.service.js` — register photo to structured rows
- `roster-lines.js` — stored roster to and from review TextArea lines
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `roster*` | 4 files; most used `roster-media.js`: Decrypts WhatsApp PhotoPicker media (CDN url plus encryption metadata) for the roster Flow |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- `roster-media.js` ← imported by `bot/shared/routes/observe2-form-endpoint.js:359:6c4c2981` · `bot/shared/routes/roster-flow-endpoint.js:40:6c4c2981` (+1)
- `roster-extraction.service.js` ← imported by `bot/shared/routes/roster-flow-endpoint.js:41:a2c77a01`
- `roster-lines.js` ← imported by `bot/shared/routes/roster-flow-endpoint.js:42:832a6d37`
- `roster-storage.js` ← imported by `bot/shared/routes/roster-flow-endpoint.js:43:e3122f53`
- env read here: `R2_ACCESS_KEY_ID` · `R2_ENDPOINT` · `R2_SECRET_ACCESS_KEY` · `ROSTER_R2_ACCESS_KEY_ID` · `ROSTER_R2_BUCKET` · `ROSTER_R2_ENDPOINT` · `ROSTER_R2_SECRET_ACCESS_KEY`

## Never (human)
- Cap downloaded register media size (`bot/shared/services/roster/roster-media.js:29`)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/database/bd-a21ks-actor-ledger.test.js` (roster-lines.js)
- `tests/observe2/external-plan.test.js` (roster-media.js)
- `tests/observe2/form-endpoint.test.js` (roster-media.js)
- `tests/roster/roster-boxes-and-rolls.test.js` (roster-lines.js)
- `tests/roster/roster-edit-save-identity.test.js` (roster-lines.js)
- `tests/roster/roster-extraction-identity.test.js` (roster-extraction.service.js)
- `tests/roster/roster-extraction-rows.test.js` (roster-extraction.service.js)
- `tests/roster/roster-failure-copy.test.js` (roster-extraction.service.js)
- `tests/roster/roster-identity-not-position.test.js` (roster-lines.js)
- `tests/roster/roster-lines.test.js` (roster-lines.js)
- … 3 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/roster/CLAUDE.index.md`? · `bot/shared/services/roster/CLAUDE.md`?
