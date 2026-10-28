# assessment — Backfills for exam-paper versioning (edited_from families)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/assessment kg=c36f86a2837e gen=7c181082e0f5 overflow=11 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `backfill-paper-versions.js` — turns old edited papers into two versions
- `repair-backfilled-v1-created-at.js` — fixes timestamps that backfill wrote
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `backfill-paper-versions.js` | One-off dry-run-first backfill turning pre-versioning edited papers into two versions; needs --expect-ref guard |
| `repair-backfilled-v1-created-at.js` | Repairs v1 rows the first paper-versions backfill wrote with wrong created_at (bd-5ioto.11); dry run default |

## Who reads this (generated)
- table `assessment_papers` (written by `backfill-paper-versions.js` (+1)) ← read by `bot/shared/services/assessment/assessment-browse.service.js:161:d5e4566e`? · `bot/shared/services/assessment/assessment-orchestrator.service.js:128:5783e845`? (+4)
- column `assessment_papers.created_at` (written by `backfill-paper-versions.js` (+1)) ← read by `bot/shared/services/assessment/assessment-browse.service.js:162:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:414:2e6454e9` (+2)
- column `assessment_papers.edited_from` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:162:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:416:62e6c849` (+2)
- … 11 more → `CLAUDE.index.md`

## Never (human)
- Writes only with --yes --expect-ref <ref>; dry run is default (backfill-paper-versions.js:7)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/assessment/repair-backfilled-v1-created-at.test.js` (backfill-paper-versions.js, repair-backfilled-v1-created-at.js)
- `tests/assessment/backfill-paper-versions.test.js` (backfill-paper-versions.js)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/scripts/CLAUDE.md`? · `bot/scripts/assessment/CLAUDE.index.md`? · `bot/scripts/assessment/CLAUDE.md`? · `tests/assessment/CLAUDE.index.md`? · `tests/assessment/CLAUDE.md`?
