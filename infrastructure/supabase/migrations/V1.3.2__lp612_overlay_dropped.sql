-- ---------------------------------------------------------------------------
-- V1.3.2 — say so, on the row, when an Urdu render lost its overlay.
--
-- An English-medium book requested in Urdu is authored in English and carries a
-- `ur_overlay` — instruction strings swapped at render time. When the model's
-- overlay does not survive sanitization (dropped, or never written), the teacher
-- receives an essentially-English document in RTL chrome, silently labelled
-- Urdu. With a language menu that stops being a quirk of defaults and becomes a
-- chosen-and-broken promise.
--
-- This column is the honest record: the worker writes it when the render
-- completes, and EVERY delivery from the row — the first hit and each cache hit
-- after — appends the caption line that tells her what she is holding
-- («یہ سبق انگریزی کتاب سے ہے — ہدایات جزوی اردو میں»). A distinct persisted
-- state, not a log line: logs roll off, and serving reads the row.
--
-- NOT a new status value: `status` stays ('authoring','ready','failed') — an
-- overlay-dropped render IS ready and IS served; it is served honestly.
--
-- Anti-sprawl (Rule 15): one boolean on a table this feature already owns.
-- NOT NULL DEFAULT false: rows cached before V1.3.2 were EN-medium-only serving
-- days or Urdu-medium books, and false (no honesty line) is exactly yesterday's
-- behaviour for them.
-- ---------------------------------------------------------------------------

ALTER TABLE niete_lp612_renders
  ADD COLUMN IF NOT EXISTS overlay_dropped BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN niete_lp612_renders.overlay_dropped IS
  'True when this is an Urdu render of an English-medium book whose ur_overlay did not survive (dropped by sanitizeOverlay, or never authored) — the document is essentially English in RTL chrome. Deliveries from this row append the honest Urdu caption line. Written by the lp612 author worker at completion (V1.3.2).';

NOTIFY pgrst, 'reload schema';
