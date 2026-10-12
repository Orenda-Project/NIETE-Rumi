-- Lane overrides, applied to the local golden database AFTER the seed snapshot (bd-z3ze4).
--
-- The snapshot copies app_settings from the sandbox as it stands, including GLOBAL switches someone set
-- there. The lane decides those itself: a scenario that tests a switch turns it on for its own run (safe —
-- every run has a private database), and everything else runs with it off.
--
-- app_redirect_*: on on the sandbox since 2026-10-01 18:22 PKT, which sends every /lesson-plan to a
-- Play Store card (lesson-plan L01–L10 and language LANG16 cannot reach the WhatsApp flow).
update public.app_settings set value = to_jsonb(false), updated_at = now() where key like 'app_redirect\_%';
