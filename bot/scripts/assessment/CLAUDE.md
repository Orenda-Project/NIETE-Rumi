# assessment — Backfills for exam-paper versioning (edited_from families)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/assessment kg=b513704f8188 gen=118bd3527f8f overflow=10 rendered=2026-11-10 kg.py=1.1.0 -->

## Entry points
- `backfill-paper-versions.js` — turns old edited papers into two versions
- `repair-backfilled-v1-created-at.js` — fixes timestamps that backfill wrote
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `backfill-paper-versions.js` | One-off dry-run-first backfill turning pre-versioning edited papers into two versions; needs --expect-ref guard |
| `repair-backfilled-v1-created-at.js` | Repairs v1 rows the first paper-versions backfill wrote with wrong created_at (bd-5ioto.11); dry run default |

## Who reads this (generated)
- table `assessment_papers` (written by `backfill-paper-versions.js` (+1)) ← read by `bot/shared/services/assessment/assessment-browse.service.js:173:d5e4566e`? · `bot/shared/services/assessment/assessment-feedback.service.js:67:760b644f`? (+6)
- column `assessment_papers.created_at` (written by `backfill-paper-versions.js` (+1)) ← read by `bot/shared/services/assessment/assessment-browse.service.js:174:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:419:2e6454e9` (+3)
- column `assessment_papers.id` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:174:16468a3d` · `bot/shared/services/assessment/assessment-feedback.service.js:67:760b644f` (+3)
- column `assessment_papers.request_id` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:174:16468a3d` · `bot/shared/services/assessment/assessment-feedback.service.js:67:760b644f` (+3)
- … 10 more → `CLAUDE.index.md`

## Never (human)
- Writes only with --yes --expect-ref <ref>; dry run is default (backfill-paper-versions.js:7)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/assessment/repair-backfilled-v1-created-at.test.js` (backfill-paper-versions.js, repair-backfilled-v1-created-at.js)
- `tests/assessment/backfill-paper-versions.test.js` (backfill-paper-versions.js)

## Related (generated)
- docs: `bot/scripts/CLAUDE.md`?
