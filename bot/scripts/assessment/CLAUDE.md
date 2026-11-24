# assessment — Backfills for exam-paper versioning (edited_from families)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/assessment kg=59c61b3db668 gen=0a01e2cc82df overflow=11 rendered=2026-11-24 kg.py=1.1.0 -->

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
- table `assessment_papers` (written by `backfill-paper-versions.js` (+1)) ← read by `bot/shared/services/assessment/assessment-browse.service.js:176:d5e4566e`? · `bot/shared/services/assessment/assessment-feedback.service.js:67:760b644f`? (+8)
- column `assessment_papers.id` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:177:16468a3d` · `bot/shared/services/assessment/assessment-feedback.service.js:67:760b644f` (+5)
- column `assessment_papers.created_at` (written by `backfill-paper-versions.js` (+1)) ← read by `bot/shared/services/assessment/assessment-browse.service.js:177:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:449:2e6454e9` (+4)
- column `assessment_papers.status` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:177:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:157:71e60a4b` (+4)
- … 11 more → `CLAUDE.index.md`

## Never (human)
- Writes only with --yes --expect-ref <ref>; dry run is default (backfill-paper-versions.js:7)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/assessment/repair-backfilled-v1-created-at.test.js` (backfill-paper-versions.js, repair-backfilled-v1-created-at.js)
- `tests/assessment/backfill-paper-versions.test.js` (backfill-paper-versions.js)

## Related (generated)
- docs: `bot/scripts/CLAUDE.md`?
