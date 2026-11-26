-- The web quiz audio daily cap (web-quiz-audio-store.js recordingAllowed) counts quizzes whose
-- meta.web.audio_day, or meta.web_one.audio_day, is today. With no index on those paths every count
-- unpacked the meta JSON of every quiz: 2.5-8.7 s on prod (26.5k quizzes, 17 Nov), and past the API
-- statement time limit PostgREST answered 500 with no body (web_quiz_audio.settings_failed step=count
-- status=500, 23 in 10-17 Nov). These two expression indexes let the count be answered from the
-- indexes (a BitmapOr). bd-ehz254.12.1.
--
-- The expressions must stay the ones PostgREST builds from the filter paths meta->web->>audio_day and
-- meta->web_one->>audio_day; bot/tests/quiz/web-quiz/web-quiz-audio-count-index.test.js checks that.
-- Most quizzes have no audio_day, so the indexes are partial on IS NOT NULL and stay small (an
-- equality filter implies NOT NULL, so the planner still uses them).
--
-- quizzes is live: run OUTSIDE a transaction (psql without BEGIN; not a migration wrapper that opens
-- one), one statement at a time. Additive only: no table, column or row changes.

-- migrate:up
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quizzes_web_audio_day ON public.quizzes (((meta -> 'web') ->> 'audio_day')) WHERE ((meta -> 'web') ->> 'audio_day') IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quizzes_web_one_audio_day ON public.quizzes (((meta -> 'web_one') ->> 'audio_day')) WHERE ((meta -> 'web_one') ->> 'audio_day') IS NOT NULL;

-- migrate:down
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_quizzes_web_audio_day;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_quizzes_web_one_audio_day;
