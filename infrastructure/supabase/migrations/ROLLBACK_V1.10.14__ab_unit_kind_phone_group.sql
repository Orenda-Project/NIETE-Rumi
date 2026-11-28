-- ROLLBACK V1.10.14 — back to school and teacher units only (bd-dha3q0).
-- Refuses while any ab_card_lock row is a phone_group test: remove or re-key that row first, on purpose.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ab_card_lock WHERE unit_kind = 'phone_group') THEN
    RAISE EXCEPTION 'ROLLBACK V1.10.14: ab_card_lock still holds a phone_group test; remove it first';
  END IF;
END $$;

ALTER TABLE public.ab_card_lock DROP CONSTRAINT IF EXISTS ab_card_lock_unit_kind_check;
ALTER TABLE public.ab_card_lock
  ADD CONSTRAINT ab_card_lock_unit_kind_check CHECK (unit_kind IN ('school', 'teacher'));
