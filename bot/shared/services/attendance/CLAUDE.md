# attendance — BigQuery sync of the daily teacher-presence rollup to the STEPS warehouse

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/attendance kg=346a4b8a6fb8 gen=3ee2de3e4fdc overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `bigquery-sync.service.js` — thin wrapper writing the rollup (Round 2)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `bigquery-sync.service.js` | BigQuery writer for the daily teacher-presence rollup into the STEPS warehouse (Round 2) |

## Who reads this (generated)
- `bigquery-sync.service.js` ← imported by `bot/workers/attendance-bigquery-export.worker.js:42:ce1067eb`
- env read here: `BIGQUERY_STEPS_AUTO_CREATE_TABLE` · `BIGQUERY_STEPS_DATASET` · `BIGQUERY_STEPS_PROJECT_ID` · `BIGQUERY_STEPS_TABLE` · `GOOGLE_SERVICE_ACCOUNT_PATH`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/attendance/bigquery-sync.test.js` (bigquery-sync.service.js)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/attendance/CLAUDE.md`? · `docs/CLAUDE.index.md`? · `docs/attendance-bigquery-sync.md`? · `tests/attendance/CLAUDE.index.md`? (+1)
