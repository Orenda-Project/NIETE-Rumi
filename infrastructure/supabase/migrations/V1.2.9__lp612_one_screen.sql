-- ---------------------------------------------------------------------------
-- V1.2.9 — store the lesson's one-screen body on the render row.
--
-- `one_screen` is a field the authoring brief already required on every 6-12
-- lesson plan: 150-260 words, the plan as it reads on one phone screen, sized
-- by the lint gate as "the WhatsApp body". It was authored on every document
-- and then dropped on the floor — the teacher got a PDF and a caption, and the
-- one artefact designed to be read WITHOUT opening a file never left the worker.
--
-- It is stored on the RENDER rather than re-derived at send time for the reason
-- the whole cache exists: the first teacher pays for the authoring run and
-- every teacher after her is served entirely from this row. Without a stored
-- copy she would get the summary and they would get only the file — the same
-- lesson arriving in two different shapes depending on who asked first.
--
-- Nullable on purpose. Renders cached before this migration have no summary and
-- must keep serving; the sender treats empty as "send the document alone"
-- rather than as an error, and back-filling would mean re-authoring ~$1.50 of
-- lesson to recover a paragraph.
--
-- Anti-sprawl (Rule 15): one column on a table this feature already owns. No
-- new table, and nothing computed that a query could answer instead — this is
-- authored prose, so there is nothing to derive it from.
-- ---------------------------------------------------------------------------

ALTER TABLE niete_lp612_renders
  ADD COLUMN IF NOT EXISTS one_screen TEXT;

COMMENT ON COLUMN niete_lp612_renders.one_screen IS
  'The authored one_screen body (150-260 words) sent as the WhatsApp message beside the PDF. Null for renders cached before V1.2.9, which serve the document alone.';
