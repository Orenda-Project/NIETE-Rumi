# Lesson-plan data model: known design debt (Nov 2026)

**Status:** known debt, consolidation planned. Tracked on bead `bd-42mo0w`; an audit of the
lesson-plan tables (live vs dead, every reader and writer, migration steps) is planned and has not run yet.
**Ask first:** the operator (Hataf) approves any new lesson-plan table.

Every file that reads or writes the lesson-plan tables carries a short `KNOWN DESIGN DEBT (Nov 2026)`
comment pointing here. `rg -n "KNOWN DESIGN DEBT" --glob '!node_modules'` lists them all. Remove those
comments in the same PR that retires the debt they describe.

## The rule for now

You will be tempted to give a new region or a new generation of lesson plans its own table, its own R2
prefix and its own env flag, because that is how every earlier lane was built. Don't.

1. **Do not add another per-region or per-generation lesson-plan table, cache table, R2 prefix or env flag.**
2. **Extend the existing table, with the book as the separator.** A region's books are data
   (`region_features.book_keys`; `niete_lp612_segments.book_stem` and `.curriculum`), and a 6-12 or GB
   `segment_id` is already book-scoped: a non-ICT `book_stem` must start with its curriculum
   (`nbf_snc_grade_1_english`), and the segment id is built from the stem
   (`bot/scripts/import-lp612-segments.js`, `toRow`). Book-scoped keys never collide, so a second table
   separates nothing.
3. **Say so in the PR description**, for example: "extends `niete_lp612_renders`; book is the separator; no new LP table".
4. **Ask the operator (Hataf) before adding any new lesson-plan table.** If you think you need one, write
   down why the existing table cannot carry it and ask before you write the migration.

## What is wrong

Lesson plans are spread over about twenty tables, one set per product generation (the K-5 v8/v9 PDFs,
the 6-12 runtime plans, the GB lane, the legacy generated plans, two imported corpora). Each set was the
fastest safe way to ship a new lane without touching the one already serving teachers. That was a
reasonable call each time. The total is now debt:

- **A duplicated table.** `niete_gb_lp_renders` (V1.9.3) is a column-for-column copy of
  `niete_lp612_renders`: the same foreign key to `niete_lp612_segments(segment_id)`, the same
  `UNIQUE (segment_id, lang, template_version)`, its own copies of the waiter functions
  (`gb_lp_join_waiters` / `gb_lp_claim_waiters`), its own R2 prefix (`gb-lp/`) and its own job type
  (`gb_lp_author`). Because `segment_id` is already book-scoped, the GB rows would never collide with
  ICT rows in the original table. Every reader that wants "the ready file for this lesson" now has to know
  which of the two to ask.
- **A lesson has no single identity.** It depends on the generation:

  | Generation | Lesson identity |
  |---|---|
  | K-5 v8/v9 PDFs | `niete_lp_assets.lesson_id` + `version_stamp` + `content_hash` |
  | 6-12 and GB runtime plans | `niete_lp612_segments.segment_id` (+ `lang`, `template_version`, render id) |
  | Legacy generated plans | `lesson_plans.id` (a UUID per request, free-text `topic`) |
  | Imported corpora | `lesson_plan_catalog (source, source_row_id)`; `curriculum_lp_ast.source_lp_uuid` |
  | Portal opens | `niete_lp_opens (plan_kind, plan_ref)` with `plan_kind` in `k5`, `g612`, `fln` |

  The quiz cache shows the cost: it keys a lesson differently per generation
  (`bot/shared/services/quiz/lp-quiz-cache.js`):

  ```
  lp_v8  lp_v8|<lesson_id>|<version_stamp>|<content_hash>|<language>
  lp612  lp612|<segment_id>|<render_id>|<template_version>|<language>
  ```

  Every consumer (quizzes, the coaching link, dashboards, reports) carries one branch per generation, and
  each new generation adds a branch to all of them.
- **Usage is split across several event tables** with different keys: `lesson_plan_requests`,
  `niete_lp_downloads`, `niete_lp612_deliveries`, `niete_lp_opens`, `lp_feedback`. "Did this teacher use a
  lesson plan this week?" is a union over four or five tables.
- **GB serving depends on two deploy-wide env flags**, `LP_GB_K5_ENABLED` and `LP_GB_AUTHOR_ENABLED`
  (`bot/shared/config/lp612-flags.js`, `bot/shared/services/gb-lp-serving.service.js`), not on the books
  the region has. A flag is all-or-nothing for the whole deployment; it cannot say "GB has these books,
  the next region has those". Both flags are a temporary launch gate, to be retired after the GB switch.

## The tables today

| Layer | Table | What it holds | Target home |
|---|---|---|---|
| Content | `lesson_plans` | Legacy generated plans, one row per request (Gamma URL / PDF URL) | lesson files + events |
| Content | `pre_generated_lps` | Pre-generated chapter PDFs per textbook (Phase 4A path) | lesson files |
| Content | `lesson_plan_catalog` | Plans imported from the legacy system (HTML) | lessons (or retire) |
| Content | `curriculum_lp_ast` | Imported JSON step corpus, rendered to PDF on demand | lessons |
| Content | `niete_lp_assets` | K-5 v8/v9 PDF and card versions (`is_current` marks the served one) | lesson files |
| Content | `niete_lp_asset_sources` | The slide script behind a K-5 asset | lesson files (format = source) |
| Content | `niete_lp612_segments` | The 6-12 and GB menu tree, one row per teaching day, book-scoped | **lessons** (nearest to the target) |
| Content | `niete_lp_fidelity_moves` | A K-5 plan split into gradeable teaching moves | keyed by lesson id |
| Files | `niete_lp612_renders` | 6-12 generated PDFs, cache and authoring lock | **lesson files** |
| Files | `niete_gb_lp_renders` | GB copy of the table above | merge into lesson files (step 1) |
| Files | `niete_lp612_own_plans` | A teacher's own edited version of a 6-12 plan | lesson files, owned by a teacher |
| Events | `lesson_plan_requests` | Request queue and log for generated plans | events |
| Events | `niete_lp_downloads` | K-5 PDF sends (also the ✓/○ tick) | events |
| Events | `niete_lp612_deliveries` | 6-12 plans each teacher received | events |
| Events | `niete_lp_opens` | Plans opened in the portal | events |
| Events | `lp_feedback` | "Was this useful?" answers | events |
| Events | `niete_lp_ab_assignment` | K-5 A/B group per school (transitional) | drop when the test ends |
| Events | `pic_lp_sessions` | Photo-to-plan conversation state (no runtime code in this repo reads it today) | events, or retire |

The book tables (`textbooks`, `textbook_toc`, `textbook_pages`) hold book content, not lesson plans, so
they carry no warning. The audit decides whether one of them becomes the books table below.
`story_books` belongs to the child web-quiz app and is not part of this model.

## The target model

- **Books.** One row per book (curriculum, grade, subject, language). A region only picks books
  (`region_features.book_keys` already does this for Grades 1-5).
- **Lessons.** One table, book → chapter → lesson, with one stable, book-scoped lesson id.
  `niete_lp612_segments` is the closest existing shape.
- **Lesson files.** One generated-files table keyed by `(lesson_id, lang, template_version, format)`
  (format: PDF, card, answer key, source document, one-screen text ...), with the authoring status and
  waiter lock today's renders table already has.
- **Events.** One table for request, delivery, open, download and feedback, keyed by user, lesson id and
  event kind.
- **No region or generation flags in code.** What a teacher sees follows from her region's books: when a
  region has books, its lesson plans show.

## How we get there

The audit on `bd-42mo0w` writes the plan: which tables and code paths are live, every reader and writer
(including exports and reports), the data-standards check, and an expand/contract migration per step
with no downtime. The likely first step is the smallest: merge `niete_gb_lp_renders` into
`niete_lp612_renders` (the book is the separator) and retire `LP_GB_K5_ENABLED` / `LP_GB_AUTHOR_ENABLED`
in favour of the region's books, once GB has switched over.

Until then this document is a warning, not a plan: keep new work inside the existing tables.

## Not annotated yet

These files also read the lesson-plan tables but were being edited by another change when the warnings
were added; add the comment when you next touch them:
`dashboard/services/lp-engagement.service.js`, `dashboard/services/coach-school-card.service.js`,
`bot/shared/services/coaching/subject-resolution.js`, `bot/shared/services/quiz/lp-quiz-digest.service.js`.
