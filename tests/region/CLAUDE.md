# region — Tests region-config labels and the DB-driven region feature gating

<!-- kg:meta repo=NIETE-Rumi dir=tests/region kg=733be1784b12 gen=8c871bfcd81c overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `region-features.test.js` — region behaviour comes from a region_features row
- `coach-role-label.test.js` — region-scoped coach label
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/region --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `region-features.test.js` | Pins region-features.service: LP behaviour comes from a region_features row, safe default when absent or DB throws |
| `CLAUDE.md` | (unmapped) |
| `coach-role-label.test.js` | Pins coachRoleLabelForRegion in region-config: default label, per-region REGION_COACH_ROLE_LABEL_MAP override |

## Who reads this (generated)
- env read here: `DEFAULT_REGION`

## Never (human)
- Region behaviour is data (a region_features row), not code branches (region-features.test.js:5)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/region/CLAUDE.md`?
