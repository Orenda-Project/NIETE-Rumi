# coachip-rm — Adversarial sector-scope tests for COACHIP regional-manager routes

<!-- kg:meta repo=NIETE-Rumi dir=tests/coachip-rm kg=4a6cd3040a91 gen=c06e07faf17a overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `rm-sector-scope.test.js` — a sector RM replaying another sector's ids must get the invented-UUID 404
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/coachip-rm --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `rm-sector-scope.test.js` | bd-sex15q.17: adversarial RM sector-scope tests; a sector RM replaying another sector's ids gets the invented-UUID 404 |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- table `app_settings` (written by `rm-sector-scope.test.js`) ← read by `bot/shared/config/feature-flags.js:92:8d5282ae`? · `bot/shared/config/model-settings.js:162:19a9a79a`? (+124)
- table `coachip_circle_items` (written by `rm-sector-scope.test.js`) ← read by `dashboard/services/coachip-scope.service.js:114:6901ce57`?

## Never (human)
- An out-of-scope id answers the same 404 as an invented UUID, byte for byte (tests/coachip-rm/rm-sector-scope.test.js:297)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/lib/CLAUDE.index.md`? · `dashboard/services/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/coachip-rm/CLAUDE.md`?
