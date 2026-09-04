-- ---------------------------------------------------------------------------
-- V1.3.7 — a lesson delivered OVER its page cap says so on its own row.
--
-- bd-vjk68. One boolean.
--
-- WHAT CHANGED ABOVE IT. The page cap used to be a way to lose a lesson: the worker's final
-- render throws on any renderer defect, and `PAGE COUNT: teach needs 6 pages; the cap is 5` is
-- one — so a document that had already been authored, rendered and written to disk became a
-- `failed` row and an apology. 9 of the 20 failures in the 59-lesson live window of 2026-09-04
-- were exactly that, 6 of them the identical teach-by-one overflow. The operator's call, verbatim:
-- *"we will stop cancelling or delaying lesson plans now because of the length issue"*. So the
-- caps went up one sheet per language (EN teach 5->6, UR support 5->6) AND a page-count-only
-- refusal now DELIVERS the document at whatever length it is.
--
-- WHY THE ROW HAS TO CARRY IT. Delivering over the cap silently would be a fallback that masks
-- itself (rule 24(b)) — and it would make the one open question about this change unanswerable.
-- The question is "cap as target": 23 of 27 English lessons printed at EXACTLY the old cap, and
-- the honest reading of that (the ladder trimming down to fit, not the author padding up) is a
-- hypothesis, not a finding. Raising the cap tests it. This column plus the `lp612.deliver.over_cap`
-- event — which carries teach/support pages AND the caps they were measured against, because a
-- page count is uninterpretable without the cap in force when it was written — are how that test
-- is read after ~40 post-#597 lessons. Today n = 0.
--
-- ANTI-SPRAWL (rule 15), against the live schema queried fresh before writing this:
--   * `page_count` cannot hold it. It is the PDF's TOTAL pages; the caps are PER PART, so a
--     10-page document is inside cap at 6+4 and over it at 7+3. Total pages cannot tell them apart.
--   * `lint_fails` cannot hold it. That column is the canon LINT's defect list and `lint_clean` is
--     computed from the same gate; a renderer finding written into it would corrupt both, and
--     lint_clean is already false on 37 of 39 delivered lessons for unrelated BUDGET lines.
--   * `error_code` MUST NOT hold it. This row is `status='ready'` and the lesson was delivered.
--     bd-7yxsu was precisely the bug of a delivered lesson reading as errored, and it inflated
--     every failure count quoted on 2026-09-04. Status and error code may never disagree.
--   * It cannot be computed. Pages are observed once, by the renderer, at render time; nothing
--     else in the schema witnesses them — the same argument that earned `picked_up_at` its column.
--   * No new status value, and no second column for the per-part pages. `status` stays
--     ('authoring','ready','failed') — an over-cap render IS ready and IS served. The per-part
--     distribution goes to telemetry (`lp612.deliver.completed.pagesByPart` on EVERY delivery,
--     plus the over_cap event), where the rest of this lane's measurement already lives; the row
--     needs only the flag that makes an over-cap delivery FINDABLE.
--
-- NOT NULL DEFAULT FALSE, matching `overlay_dropped` (V1.3.3): every row that exists today was
-- delivered inside the caps in force at the time, so false is exactly the truth for them. The
-- worker names this column on EVERY success patch, so a retry after an over-cap attempt cannot
-- inherit a stale `true` (an UPDATE that does not name a column leaves what was there — the
-- bd-7yxsu mechanism).
--
-- DEPLOYS DO NOT RUN MIGRATIONS ON NIETE (bd-tqkq9). This file must be applied to the staging
-- database BY HAND, before the code that writes the column ships. A merged column that does not
-- exist is a total lp612 outage.
-- ---------------------------------------------------------------------------

ALTER TABLE niete_lp612_renders
  ADD COLUMN IF NOT EXISTS over_cap BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN niete_lp612_renders.over_cap IS
  'True when this lesson was DELIVERED while a part ran past its hard page cap. Page-count overflow stopped being a delivery failure on 2026-09-04 (bd-vjk68); this is the honest record that it happened, and the filter behind the "does the page distribution refill to the raised cap?" measurement. Written by the lp612 author worker on every success patch. The per-part pages and the caps in force live on the lp612.deliver.over_cap event (V1.3.7).';

NOTIFY pgrst, 'reload schema';
