-- requires: child_identity.sql
-- Migration: the web quiz's direct ping (switch web_quiz_sample_ping, OFF on every tier): who consented, and who was
-- pinged this term.
--
-- NON-DESTRUCTIVE. Two new tables; nothing existing changes (message_ledger and its CHECKs are untouched, so a
-- ping's ledger row is still refused and no ping can be sent). Re-runnable (IF NOT EXISTS).
-- The tables below are mirrored in infrastructure/supabase/00_complete-schema.sql.
--
--   sample_ping_consents   one row per live binding whose family consented to one direct ping a term, at consent
--                          text version consent_v. Keyed by the binding; goes with it (on delete cascade). Written by
--                          nothing yet: the consent sentence and its writer come later.
--   sample_pings           one row per phone tombstone per term (unique): reserved before the ledger row and the send,
--                          then sent (sent_at) or failed. class_id is the class the ping was for (the per-class cap).
--                          No phone, no name, no child id.
-- Service role only (RLS on, no policy). Written only by bot/shared/services/quiz/web-quiz-sample-ping.js.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.
-- No BEGIN/COMMIT here: the tool that applies migrations runs each in its own transaction.

create table if not exists public.sample_ping_consents (
  binding_id   uuid        primary key references public.child_phone_bindings(id) on delete cascade,
  consent_v    smallint    not null check (consent_v >= 1),
  consented_at timestamptz not null default now()
);

create table if not exists public.sample_pings (
  id         uuid        primary key default gen_random_uuid(),
  term_code  text        not null,                  -- '2026-27b' (the sampler's term)
  phone_tomb text        not null,                  -- the binding's tombstone (a keyed hash), never the phone
  class_id   uuid,
  state      text        not null check (state in ('reserved','sent','failed')),
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  constraint sample_pings_once_a_term unique (term_code, phone_tomb)
);

alter table public.sample_ping_consents enable row level security;
alter table public.sample_pings enable row level security;

comment on table public.sample_ping_consents is
  'web quiz direct ping: the consent version a live binding agreed to (no phone, no name); service role only';
comment on table public.sample_pings is
  'web quiz direct ping: one row per phone tombstone per term (no phone, no child id); written by the bot (service role)';
