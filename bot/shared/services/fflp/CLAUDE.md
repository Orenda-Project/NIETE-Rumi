# fflp — Free-form lesson-plan engine seam, default OFF behind app_settings.freeform_lp

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/fflp kg=fa562aa0e687 gen=531604b66501 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `index.js` — lazy single entry for every cross-module call
- `switch.js` — the one switch; every failure reads OFF
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `index.js` | Single lazy entry point to the free-form lesson-plan engine modules (fflp) so the seam loads when switch is off |
| `catalogue-match.js` | Matches a typed lesson-plan topic against catalogue titles by token overlap; hits keep the catalogue |
| `switch.js` | Reads app_settings.freeform_lp, the default-OFF switch of the free-form lesson-plan engine |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- `index.js` ← imported by `bot/shared/handlers/text-message.handler.js:3023:89db85cc` · `bot/workers/lesson-plan-generation.worker.js:196:075a3ddf`
- `catalogue-match.js` ← imported by `bot/shared/services/fflp/index.js:71:85c8e0de`
- `switch.js` ← imported by `bot/shared/services/fflp/index.js:70:ed433811`

## Never (human)
- Switch failures must return OFF (`bot/shared/services/fflp/switch.js:5`)
- Engine modules stay lazy getters so the seam loads when absent (`bot/shared/services/fflp/index.js:5`)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/fflp/switch.test.js` (index.js, switch.js)
- `tests/fflp/catalogue-match.test.js` (catalogue-match.js)
- `tests/fflp/engine-ready.test.js` (index.js)
- `tests/fflp/queue-worker.test.js` (index.js)
- `tests/fflp/seam-goldens.test.js` (index.js)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/fflp/CLAUDE.md`?
