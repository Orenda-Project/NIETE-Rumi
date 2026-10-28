# topics — Tests for assessment topics: curriculum-matrix grouping, topic papers, topic answer key
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/assessment/topics kg=8cc74982249f gen=e8e60f01d4c2 overflow=16 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `group.test.js` — groupChapter dispatch by subject; fixtures/matrix-sample.json holds real matrix rows
- `topic-key.test.js` — by-topic answer key and student copy; `create-topic-paper.test.js` covers the create route
- Root jest: from repo root `node tests/run.js tests/assessment/topics --maxWorkers=2`; `pages-match-book.db.test.js` skips without sandbox DB URL
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 3 test files) |
| `CLAUDE.md` | (unmapped) |
| `import-cli.test.js` | Task 4: drives the topic importer CLI (bot/scripts/import-assessment-topics) with a fake Supabase and tmp CSVs |
| `CLAUDE.index.md` | (unmapped) |
| `group*` | 4 files; most used `group-science.test.js`: Task 3: pins Science grouping by 'Topic N' labels with per-SLO fallback for unlabelled chapters (group-science) |
| `no-duplicate-names.test.js` | Task 3 fix: pins that a teacher never sees two tick boxes with the same name in a chapter (group, matrix sample) |
| `topic*` | 4 files; most used `topic-revision.test.js`: Pins that editing a topic paper keeps its by-topic key summary and header, on rerender and versions paths |
| `collect.test.js` | Task 3: unit tests for topics/collect, the union of curriculum day rows behind one topic |
| `distinct-names.test.js` | Task 3 fix: pins distinctNames so topics in one chapter never share a name |
| … | 16 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `ASSESSMENT_TOPICS_DB_URL`

## Never (human)
- Chapter paper HTML must stay byte-identical when topics land (topic-key.test.js:3)
- The DB check only reads: SELECTs, no writes, sandbox only (pages-match-book.db.test.js:11)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/assessment/CLAUDE.index.md`? · `bot/shared/services/assessment/topics/CLAUDE.index.md`? · `bot/shared/services/assessment/topics/CLAUDE.md`? · `tests/assessment/CLAUDE.index.md`? (+3)
