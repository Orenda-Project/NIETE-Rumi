# topics — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/assessment/topics -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `collect.js` | Unions the day rows behind one topic: sorted pages and SLO codes in first-seen order |
| `distinct-names.js` | Renames topics that collide within a chapter so teachers never see identical tick boxes |
| `group-language.js` | Groups English/Urdu matrix rows into topics under skill headings |
| `group-maths.js` | Groups Maths rows into one topic per SLO code, word problems per chapter |
| `group-science.js` | Groups Science days by 'Topic N' label, falling back to SLO codes |
| `group.js` | Entry point groupChapter/groupAll: turns matrix rows into the topics a teacher ticks per chapter |
| `headings.js` | Maps language skill types to teacher-facing headings and skill labels back to types |
| `matrix-rows.js` | Parses a curriculum-matrix tab (2-D cells) into day rows, dropping grades above 5 |
| `page-check.js` | Checks topic pages fall inside the chapter's textbook_toc page range; reports outside/spill/noRange |
| `reconcile.js` | Diffs stored topics against a fresh import into upsert and retire lists, scoped per grade-subject |
| `resolve.js` | Turns ticked topic ids into page ranges, SLOs and topics for a paper request |
| `short-name.js` | Builds short teacher-facing topic names and id slugs, counting Urdu in code points |
| `topics.repo.js` | Reads assessment_topics for one chapter; throws on DB error rather than returning empty |

## Who reads this (all, generated)
- `collect.js` ← imported by `bot/shared/services/assessment/topics/group-language.js:14:3e2764e2` · `bot/shared/services/assessment/topics/group-maths.js:21:3e2764e2` · `bot/shared/services/assessment/topics/group-science.js:8:3e2764e2`
- `distinct-names.js` ← imported by `bot/shared/services/assessment/topics/group.js:14:5c5ca106`
- `group-language.js` ← imported by `bot/shared/services/assessment/topics/group.js:11:1e4723fe`
- `group-maths.js` ← imported by `bot/shared/services/assessment/topics/group-science.js:9:4b4fc200` · `bot/shared/services/assessment/topics/group.js:12:9fd2002e`
- `group-science.js` ← imported by `bot/shared/services/assessment/topics/group.js:13:0ed20b58`
- `group.js` ← imported by `bot/scripts/import-assessment-topics.js:26:b675e084`
- `headings.js` ← imported by `bot/shared/services/assessment/topics/group-language.js:12:31076cfe`
- `matrix-rows.js` ← imported by `bot/scripts/import-assessment-topics.js:25:af44f523`
- `page-check.js` ← imported by `bot/scripts/import-assessment-topics.js:28:3e92da3e`
- `reconcile.js` ← imported by `bot/scripts/import-assessment-topics.js:27:ad877765` · `bot/shared/services/assessment/topics/topics.repo.js:8:8e75e826`
- `resolve.js` ← imported by `bot/shared/routes/internal-api.routes.js:1720:cbc65cf0`
- `short-name.js` ← imported by `bot/shared/services/assessment/topics/distinct-names.js:8:4ea89936` · `bot/shared/services/assessment/topics/group-language.js:13:22aff0f7` · `bot/shared/services/assessment/topics/group-maths.js:20:22aff0f7` · `bot/shared/services/assessment/topics/group-science.js:7:22aff0f7`
- `topics.repo.js` ← imported by `bot/shared/routes/internal-api.routes.js:1550:e4013beb`

## Tests (all, generated)
- `collect.js` ← `tests/assessment/topics/collect.test.js`
- `distinct-names.js` ← `tests/assessment/topics/distinct-names.test.js`
- `group-language.js` ← `tests/assessment/topics/group-language.test.js`
- `group-maths.js` ← `tests/assessment/topics/group-maths.test.js`
- `group-science.js` ← `tests/assessment/topics/group-science.test.js`
- `group.js` ← `tests/assessment/topics/group-language.test.js` · `tests/assessment/topics/group-maths.test.js` · `tests/assessment/topics/group-science.test.js` · `tests/assessment/topics/group.test.js` · `tests/assessment/topics/import-cli.test.js` · `tests/assessment/topics/no-duplicate-names.test.js`
- `headings.js` ← `tests/assessment/topics/headings.test.js`
- `matrix-rows.js` ← `tests/assessment/topics/group-language.test.js` · `tests/assessment/topics/group-maths.test.js` · `tests/assessment/topics/group-science.test.js` · `tests/assessment/topics/group.test.js` · `tests/assessment/topics/import-cli.test.js` · `tests/assessment/topics/matrix-rows.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/assessment/topics/matrix-rows.js`)
- `page-check.js` ← `tests/assessment/topics/page-check.test.js` · `tests/assessment/topics/pages-match-book.db.test.js`
- `reconcile.js` ← `tests/assessment/topics/import-cli.test.js` · `tests/assessment/topics/reconcile.test.js`
- `resolve.js` ← `tests/assessment/topics/resolve.test.js`
- `short-name.js` ← `tests/assessment/topics/short-name.test.js`
- `topics.repo.js` ← `tests/assessment/topics/topics.repo.test.js`

## Related (all, generated)
- docs: `bot/shared/services/assessment/CLAUDE.index.md`? · `bot/shared/services/assessment/CLAUDE.md`? · `bot/shared/services/assessment/topics/CLAUDE.index.md`? · `bot/shared/services/assessment/topics/CLAUDE.md`? · `tests/assessment/topics/CLAUDE.index.md`? · `tests/assessment/topics/CLAUDE.md`?
