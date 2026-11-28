-- V1.10.14 — the A/B ledger takes phone_group units (bd-dha3q0, epic bd-9nb6s0). Needs V1.10.7.
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. ict-quiz-practice-door (live 30 Nov 2026) splits by the phone a child's quiz arrives on, so its ledger row
-- has unit_kind 'phone_group'. V1.10.7 created ab_card_lock with an inline CHECK allowing school and teacher only
-- (Postgres names it ab_card_lock_unit_kind_check), so card.py freeze could not write the test as planned.
-- WHAT. That one CHECK is replaced with one that also allows 'phone_group'. Nothing else changes: a phone_group test
-- gets no rows from ab_tracker_unit_teachers (it reads its own child measures), so the teacher metrics are unchanged.
-- WRITES. None (a constraint change on ab_card_lock; every existing row is school or teacher and passes).
-- DATA CLASSIFICATION (D6): '[Internal]'. No personal data.
-- IDEMPOTENT. DROP ... IF EXISTS then ADD. Rollback: ROLLBACK_V1.10.14__ab_unit_kind_phone_group.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE public.ab_card_lock DROP CONSTRAINT IF EXISTS ab_card_lock_unit_kind_check;
ALTER TABLE public.ab_card_lock
  ADD CONSTRAINT ab_card_lock_unit_kind_check CHECK (unit_kind IN ('school', 'teacher', 'phone_group'));
