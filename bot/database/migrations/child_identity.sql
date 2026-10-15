-- Migration: the child identity store (one child, one identity).
--
-- NON-DESTRUCTIVE. Four new tables; nothing here touches `students`.
--
--   child_identity        the child's fixed grade per academic year ('2026-27'),
--                         and the promotion mark (confirmed_at / confirmed_by).
--   child_phone_bindings  a family phone the family confirmed for a child.
--                         Keyed on the canonical child id, never on a device.
--                         Undo, STOP and expiry ERASE phone_norm (set NULL);
--                         phone_tomb (a salted HMAC, first 32 hex) is what is
--                         kept, so a re-bind is recognised as a re-bind.
--   child_bind_codes      the single-use 'JUGNU-XXXXX' codes (1 hour). device_ref
--                         is an audit column only: never read to identify a child.
--   merge_log             the teacher's "same child?" decisions (audit).
--
-- Every statement is IF NOT EXISTS: applying it twice is a no-op.
-- Rollback: child_identity_rollback.sql.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

CREATE TABLE IF NOT EXISTS child_identity (
  canonical_id   uuid        NOT NULL,              -- the child (students.id after merged_into fold)
  year_code      text        NOT NULL,              -- '2026-27'
  fixed_grade    smallint    NOT NULL CHECK (fixed_grade BETWEEN 1 AND 5),
  grade_source   text        NOT NULL CHECK (grade_source IN ('roster_class','share_code_class','tapped','teacher')),
  fixed_at       timestamptz NOT NULL DEFAULT now(),
  confirmed_at   timestamptz,                       -- §1.2 promotion
  confirmed_by   text        CHECK (confirmed_by IN ('teacher','device_twice','class_round')),
  PRIMARY KEY (canonical_id, year_code)
);

CREATE TABLE IF NOT EXISTS child_phone_bindings (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id   uuid        NOT NULL,
  phone_norm     text,                              -- NULL after undo / STOP / expiry (erased, never kept)
  phone_tomb     text        NOT NULL,              -- hex(HMAC-SHA256(TOMB_SALT, phone_norm))[:32]
  via            text        NOT NULL CHECK (via IN ('save','learned','guest','teacher')),
  confirmed_at   timestamptz NOT NULL,              -- the family's / teacher's confirm
  bound_at       timestamptz NOT NULL DEFAULT now(),
  last_played_at timestamptz,
  expires_at     timestamptz NOT NULL,              -- 31 March 18:59:59Z of the academic year; renewed by play
  revoked_at     timestamptz,
  revoked_by     text        CHECK (revoked_by IN ('page_undo','stop','expiry','teacher','teacher_claim')),
  rebind_of      uuid        REFERENCES child_phone_bindings(id),
  CHECK (phone_norm IS NULL OR revoked_at IS NULL)  -- a revoked row never keeps the phone
);
CREATE UNIQUE INDEX IF NOT EXISTS cpb_active_pair
  ON child_phone_bindings (phone_norm, canonical_id) WHERE phone_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS cpb_phone_active ON child_phone_bindings (phone_norm) WHERE phone_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS cpb_expiry ON child_phone_bindings (expires_at) WHERE phone_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS cpb_tomb ON child_phone_bindings (phone_tomb);

CREATE TABLE IF NOT EXISTS child_bind_codes (
  code           text        PRIMARY KEY,           -- 'JUGNU-' + 5 of [A-Z2-9], single use
  canonical_id   uuid        NOT NULL,
  device_ref     text,                              -- AUDIT ONLY: never read to identify or to trust
  minted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,              -- minted_at + 1 h, enforced by the binder
  used_at        timestamptz,
  outcome        text        CHECK (outcome IN ('bound','max_kids','max_phones','teacher_phone','code_expired','code_used','child_unknown')),
  CHECK (expires_at <= minted_at + interval '1 hour')
);

CREATE TABLE IF NOT EXISTS merge_log (             -- §12, the teacher queue's audit
  id             bigserial   PRIMARY KEY,
  loose_id       uuid        NOT NULL,
  candidate_id   uuid        NOT NULL,
  teacher_id     uuid        NOT NULL,
  decided_at     timestamptz NOT NULL DEFAULT now(),
  decision       text        NOT NULL CHECK (decision IN ('same','no','undo')),
  source         text        NOT NULL CHECK (source IN ('queue','class_tab'))
);
