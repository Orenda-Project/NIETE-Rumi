-- V1.4.2 — where the answer key went.
--
-- The bot has been generating answer keys, uploading them to R2,
-- presigning them, sending them, and then writing the storage key into a LOG
-- LINE and nowhere else. The paper's location is persisted
-- (assessment_papers.file_r2_key); the answer key's was not, because there was
-- no column to put it in.
--
-- The only answer-key field in the schema before this is
-- assessment_requests.has_answer_key — a boolean recording that she ASKED for
-- one. That is a record of the request, not of the artefact.
--
-- What that costs today, on WhatsApp, with no portal involved: a teacher who
-- deletes the chat or loses the message has lost the answer key permanently.
-- The paper survives and can be handed to her again; the key cannot, and the
-- only route back to it is regenerating the whole paper — which runs the model
-- again and produces DIFFERENT questions, so the key she gets no longer matches
-- the paper she printed.
--
-- One column, patched at upload time beside file_r2_key.
--
-- Nullable, and honestly so: it is NULL for every paper generated before this
-- migration (the object may well still be in R2, but we never recorded where),
-- and NULL for every paper where she did not ask for a key. Neither is an
-- error, and a caller must treat absence as "not available" rather than "not
-- generated".

ALTER TABLE assessment_papers
  ADD COLUMN IF NOT EXISTS answer_key_r2_key TEXT;

COMMENT ON COLUMN assessment_papers.answer_key_r2_key IS
  'R2 storage key for the answer-key document, or NULL when she did not ask for '
  'one or the paper predates V1.4.2. Absence means "we cannot hand it over", '
  'never "it was not generated".';

-- PostgREST caches the schema. Without this the new column is invisible through
-- the API even though it exists — which reads as "the migration did not run".
NOTIFY pgrst, 'reload schema';
