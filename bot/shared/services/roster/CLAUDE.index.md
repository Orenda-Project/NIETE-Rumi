# roster — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/roster -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `roster-extraction.service.js` | Reads a photographed attendance register into structured roster rows via the vision LLM |
| `roster-lines.js` | Converts a stored roster to and from editable TextArea lines on the roster REVIEW Flow screen |
| `roster-media.js` | Decrypts WhatsApp PhotoPicker media (CDN url plus encryption metadata) for the roster Flow |
| `roster-storage.js` | Stores the register photos for roster extraction so extractions can be audited |

## Who reads this (all, generated)
- `roster-extraction.service.js` ← imported by `bot/shared/routes/roster-flow-endpoint.js:41:a2c77a01`
- `roster-lines.js` ← imported by `bot/shared/routes/roster-flow-endpoint.js:42:832a6d37`
- `roster-media.js` ← imported by `bot/shared/routes/observe2-form-endpoint.js:359:6c4c2981` · `bot/shared/routes/roster-flow-endpoint.js:40:6c4c2981` · `bot/shared/services/observe/observe2/added-plan.js:58:26d9b520`
- `roster-storage.js` ← imported by `bot/shared/routes/roster-flow-endpoint.js:43:e3122f53`
- env `R2_ACCESS_KEY_ID` read at `bot/shared/services/roster/roster-storage.js:64:57449137`
- env `R2_ENDPOINT` read at `bot/shared/services/roster/roster-storage.js:63:cd87adcc`
- env `R2_SECRET_ACCESS_KEY` read at `bot/shared/services/roster/roster-storage.js:65:9e0cc55d`
- env `ROSTER_R2_ACCESS_KEY_ID` read at `bot/shared/services/roster/roster-storage.js:64:57449137`
- env `ROSTER_R2_BUCKET` read at `bot/shared/services/roster/roster-storage.js:51:093ff300`
- env `ROSTER_R2_ENDPOINT` read at `bot/shared/services/roster/roster-storage.js:63:cd87adcc`
- env `ROSTER_R2_SECRET_ACCESS_KEY` read at `bot/shared/services/roster/roster-storage.js:65:9e0cc55d`

## Tests (all, generated)
- `roster-extraction.service.js` ← `tests/roster/roster-extraction-identity.test.js` · `tests/roster/roster-extraction-rows.test.js` · `tests/roster/roster-failure-copy.test.js`
- `roster-lines.js` ← `tests/database/bd-a21ks-actor-ledger.test.js` · `tests/roster/roster-boxes-and-rolls.test.js` · `tests/roster/roster-edit-save-identity.test.js` · `tests/roster/roster-identity-not-position.test.js` · `tests/roster/roster-lines.test.js`
- `roster-media.js` ← `tests/observe2/external-plan.test.js` · `tests/observe2/form-endpoint.test.js` · `tests/roster/roster-media.test.js`
- `roster-storage.js` ← `tests/roster/roster-shift-endpoint.test.js` · `tests/roster/roster-storage.test.js`

## Related (all, generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/roster/CLAUDE.index.md`? · `bot/shared/services/roster/CLAUDE.md`? · `tests/database/CLAUDE.index.md`? · `tests/database/CLAUDE.md`? · `tests/observe2/CLAUDE.index.md`? · `tests/roster/CLAUDE.index.md`? · `tests/roster/CLAUDE.md`?
