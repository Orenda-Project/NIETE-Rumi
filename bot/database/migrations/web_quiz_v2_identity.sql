-- Migration: the web quiz's hand-out → class binding (identity v2).
--
-- NON-DESTRUCTIVE. One new nullable column and one partial index.
--
--   quiz_share_codes.class_id   the class a hand-out (a class code) was for.
--       Children who open the code are matched by name inside this ONE class,
--       and the teacher's report lists the class's children who have not
--       played. NULL = not bound: the server resolves the class from the
--       quiz's list, the teacher's only class, or the quiz's grade, and asks
--       when none of those decides (old codes need no backfill).
--
-- Why a column on the code and not quizzes.list_id: one quiz can be handed
-- out twice (4-A, then 4-B), and the code is what the children open.
-- The code that reads it tolerates its absence (42703) until this is applied.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

ALTER TABLE public.quiz_share_codes ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES public.classes(id);
CREATE INDEX IF NOT EXISTS idx_quiz_share_codes_class ON public.quiz_share_codes (class_id) WHERE class_id IS NOT NULL;
COMMENT ON COLUMN public.quiz_share_codes.class_id IS
  'web quiz: the class this hand-out was for (children are matched inside it). NULL = resolved at read time';
