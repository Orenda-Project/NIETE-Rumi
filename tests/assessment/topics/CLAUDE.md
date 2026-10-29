# topics — Tests for assessment topics: curriculum-matrix grouping, topic papers, topic answer key
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/assessment/topics kg=3327983f11f6 gen=80aa29fd580c overflow=14 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `group.test.js` — groupChapter dispatch by subject; fixtures/matrix-sample.json holds real matrix rows
- `topic-key.test.js` — by-topic answer key and student copy; `create-topic-paper.test.js` covers the create route
- Root jest: from repo root `node tests/run.js tests/assessment/topics --maxWorkers=2`; `pages-match-book.db.test.js` skips without sandbox DB URL
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 3 files: 0 test + 3 support) |
| `topic*` | 9 files; most used `topic-oral.test.js`: (unmapped) |
| `import-cli.test.js` | Task 4: drives the topic importer CLI (bot/scripts/import-assessment-topics) with a fake Supabase and tmp CSVs |
| `oral-g35.test.js` | (unmapped) |
| `group*` | 4 files; most used `group-science.test.js`: Task 3: pins Science grouping by 'Topic N' labels with per-SLO fallback for unlabelled chapters (group-science) |
| `no-duplicate-names.test.js` | Task 3 fix: pins that a teacher never sees two tick boxes with the same name in a chapter (group, matrix sample) |
| `collect.test.js` | Task 3: unit tests for topics/collect, the union of curriculum day rows behind one topic |
| `distinct-names.test.js` | Task 3 fix: pins distinctNames so topics in one chapter never share a name |
| `pages-match-book.db.test.js` | Task 5: read-only DB check that topic pages exist in textbook_pages; skips unless ASSESSMENT_TOPICS_DB_URL names sandbox |
| `create-topic-paper.test.js` | Task 6: pins POST /assessment/create with topicIds: all = today's request, a subset resolves pages (paper_kind topic) |
| … | 25 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Chapter paper HTML must stay byte-identical when topics land (topic-key.test.js:3)
- The DB check only reads: SELECTs, no writes, sandbox only (pages-match-book.db.test.js:11)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/assessment/patterns/CLAUDE.md`? · `bot/shared/services/assessment/patterns/early/CLAUDE.md`? · `bot/shared/services/assessment/topics/CLAUDE.md`? · `tests/assessment/CLAUDE.md`?
