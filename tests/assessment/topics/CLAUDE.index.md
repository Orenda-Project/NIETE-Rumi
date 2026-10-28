# topics — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/assessment/topics -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 3 test files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `collect.test.js` | Task 3: unit tests for topics/collect, the union of curriculum day rows behind one topic |
| `create-topic-paper.test.js` | Task 6: pins POST /assessment/create with topicIds: all = today's request, a subset resolves pages (paper_kind topic) |
| `distinct-names.test.js` | Task 3 fix: pins distinctNames so topics in one chapter never share a name |
| `group-language.test.js` | Task 3: pins English/Urdu day rows grouped into topics under skill headings, using real matrix rows (group-language) |
| `group-maths.test.js` | Task 3: pins Maths grouping, one topic per SLO with word problems separate (group-maths, matrix-sample fixture) |
| `group-science.test.js` | Task 3: pins Science grouping by 'Topic N' labels with per-SLO fallback for unlabelled chapters (group-science) |
| `group.test.js` | Task 3: pins groupChapter: which rows can be topics, dispatch by subject, stable topic ids (topics/group) |
| `headings.test.js` | Task 3: pins headingFor/skillFromLabel: skill type to teacher heading and order, per language (topics/headings) |
| `import-cli.test.js` | Task 4: drives the topic importer CLI (bot/scripts/import-assessment-topics) with a fake Supabase and tmp CSVs |
| `matrix-rows.test.js` | Task 2: pins parseMatrixTab, one curriculum-matrix tab (2-D cell array) to day rows |
| `migration-rls.test.js` | SQL-text test of V1.6.19: RLS enabled on assessment_topics with no policies (bot uses the service role) |
| `migration.test.js` | SQL-text test of V1.6.18: assessment_topics table plus paper_kind on assessment_requests/assessment_papers |
| `no-duplicate-names.test.js` | Task 3 fix: pins that a teacher never sees two tick boxes with the same name in a chapter (group, matrix sample) |
| `orchestrator-topic-slos.test.js` | Task 6: pins buildPaper handing a topic job's SLOs to generateExam and nothing else changing for other jobs |
| `page-check.test.js` | Pins checkPages: topic pages versus the chapter's textbook_toc page range, using real 20 Oct audit cases |
| `pages-match-book.db.test.js` | Task 5: read-only DB check that topic pages exist in textbook_pages; skips unless ASSESSMENT_TOPICS_DB_URL names sandbox |
| `paper-kind-on-paper.test.js` | bd-6clakk.8: pins a topic paper's assessment_papers row carrying paper_kind 'topic' (orchestrator.service) |
| `prompt-slos.test.js` | Task 6: pins buildUserPrompt with slos for topic papers and byte-identical output without (generation.service) |
| `reconcile.test.js` | Task 4: pins reconcile and sameContent, the pure diff of stored topics against a fresh matrix grouping |
| `request-origin.test.js` | bd-pw1ccr.1: pins origin='report' stored on a request made from the Class Quiz report button (create route) |
| `resolve.test.js` | Task 5: pins resolveTopics: ticked topics of one chapter to page ranges and SLOs, using real G1 Maths Ch3 output |
| `short-name.test.js` | Task 3: pins shortName and id slugs for teacher-facing topic names, never ending on a dangling word |
| `topic-cta-flag.test.js` | bd-6clakk.6: pins the assessment_topic_cta_enabled switch hiding the WhatsApp topics button, fail closed (feature-flags) |
| `topic-key-orchestrator.test.js` | Task 7: pins the orchestrator passing ticked topics to the key and paperKind to the student copy |
| `topic-key.test.js` | Task 7: pins renderTopicSummary and a student copy with no total; chapter papers stay byte-identical (sha256) |
| `topic-revision.test.js` | Pins that editing a topic paper keeps its by-topic key summary and header, on rerender and versions paths |
| `topics-route.test.js` | Task 5: pins POST /api/internal/assessment/topics returning one chapter's topics for the portal picker, repo mocked |
| `topics.repo.test.js` | Task 5: pins topics.repo reading a chapter's assessment_topics in sort_order as camelCase, Supabase mocked |

## Who reads this (all, generated)
- env `ASSESSMENT_TOPICS_DB_URL` read at `tests/assessment/topics/pages-match-book.db.test.js:23:b46a441b`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/assessment/CLAUDE.index.md`? · `bot/shared/services/assessment/topics/CLAUDE.index.md`? · `bot/shared/services/assessment/topics/CLAUDE.md`? · `tests/assessment/CLAUDE.index.md`? · `tests/assessment/CLAUDE.md`? · `tests/assessment/topics/CLAUDE.index.md`? · `tests/assessment/topics/CLAUDE.md`?
