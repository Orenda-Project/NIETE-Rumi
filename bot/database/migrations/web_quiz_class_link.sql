-- Migration: the standing class link /j/<code> (switch web_quiz_class_link, OFF by default).
--
-- ADDITIVE. One new table, two indexes, RLS on with no policy (only the service role reads or writes it).
--
--   class_links   one link per class per term (IDENTITY §17: '<YYYY>-<YY>a' 1 Apr–30 Sep, '<YYYY>-<YY>b'
--                 1 Oct–31 Mar, PKT; expires_at = the term's last second PKT). Minted by the bot only for a
--                 class the teacher teaches (class_teachers) with an enrolled roster (class_enrollments).
--                 The code is 10 characters of ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (crypto.randomInt), never
--                 derived from the class. "Make a new link" sets revoked_at on the old row, then inserts.
--
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

CREATE TABLE IF NOT EXISTS public.class_links (
  code        text PRIMARY KEY CHECK (code ~ '^[A-HJ-NP-Z2-9]{8,16}$'),
  class_id    uuid NOT NULL REFERENCES public.classes(id),
  teacher_id  uuid NOT NULL REFERENCES public.users(id),
  term_code   text NOT NULL CHECK (term_code ~ '^[0-9]{4}-[0-9]{2}[ab]$'),
  minted_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);

-- One active link per (class, term).
CREATE UNIQUE INDEX IF NOT EXISTS class_links_one_active
  ON public.class_links (class_id, term_code) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS class_links_teacher ON public.class_links (teacher_id);

ALTER TABLE public.class_links ENABLE ROW LEVEL SECURITY;
