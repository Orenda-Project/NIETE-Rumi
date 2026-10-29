# topics — Curriculum-matrix rows to the tickable topics of a chapter; pure grouping
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/assessment/topics kg=80ce0ee61448 gen=4ab383050eff overflow=44 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `group.js` — groupChapter/groupAll, the entry point
- `reconcile.js` — upsert/retire diff of stored versus imported topics
- `topics.repo.js` — the only DB read (assessment_topics)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `matrix-rows.js` | Parses a curriculum-matrix tab (2-D cells) into day rows, dropping grades above 5 |
| `group*` | 4 files; most used `group.js`: Entry point groupChapter/groupAll: turns matrix rows into the topics a teacher ticks per chapter |
| `short-name.js` | Builds short teacher-facing topic names and id slugs, counting Urdu in code points |
| `collect.js` | Unions the day rows behind one topic: sorted pages and SLO codes in first-seen order |
| `reconcile.js` | Diffs stored topics against a fresh import into upsert and retire lists, scoped per grade-subject |
| … | 13 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `short-name.js` ← imported by `bot/shared/services/assessment/topics/distinct-names.js:8:4ea89936` · `bot/shared/services/assessment/topics/group-language.js:13:22aff0f7` (+2)
- `collect.js` ← imported by `bot/shared/services/assessment/topics/group-language.js:14:3e2764e2` · `bot/shared/services/assessment/topics/group-maths.js:21:3e2764e2` (+1)
- `group-maths.js` ← imported by `bot/shared/services/assessment/topics/group-science.js:9:4b4fc200` · `bot/shared/services/assessment/topics/group.js:12:9fd2002e`
- `reconcile.js` ← imported by `bot/scripts/import-assessment-topics.js:27:ad877765` · `bot/shared/services/assessment/topics/topics.repo.js:8:8e75e826`
- … 14 more → `CLAUDE.index.md`

## Never (human)
- Don't treat a topics DB error as 'no topics': the repo throws (topics.repo.js:3-4)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/assessment/topics/group-language.test.js` (group-language.js, group.js, matrix-rows.js)
- `tests/assessment/topics/group-maths.test.js` (group-maths.js, group.js, matrix-rows.js)
- … 20 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/assessment/CLAUDE.md`?
