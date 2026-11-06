-- Lane overrides, applied to the local golden database AFTER the seed snapshot (bd-z3ze4).
--
-- The snapshot copies app_settings from the sandbox as it stands, including GLOBAL switches someone set
-- there. The lane decides those itself: a scenario that tests a switch turns it on for its own run (safe —
-- every run has a private database), and everything else runs with it off.
--
-- app_redirect_*: on on the sandbox since 2026-10-01 18:22 PKT, which sends every /lesson-plan to a
-- Play Store card (lesson-plan L01–L10 and language LANG16 cannot reach the WhatsApp flow).
update public.app_settings set value = to_jsonb(false), updated_at = now() where key like 'app_redirect\_%';

-- Region registry rows (bd-qg6j5s). The snapshot (8 Oct) predates V1.8.8__region_registry.sql and holds only the
-- deployment-wide 'niete' row, so on the lane region-registry.js found no region and book-curriculum read every
-- Gilgit-Baltistan teacher as ICT. These are V1.8.8's rows, as the live sandbox has them on 2026-11-05: GB's
-- curriculum_key is 'nbf_snc' there (V1.8.6 renamed V1.8.8's 'gb'). book_keys stays NULL (= the default ICT list):
-- the lane's book list is the code's to decide. tests/setup/mock-lane-region-registry.test.js keeps the rows equal
-- to V1.8.8's.
INSERT INTO public.region_features (region, organization, display_name, sort_order) VALUES
  ('b.k', 'niete', 'B.K', 1),
  ('sihala', 'niete', 'Sihala', 2),
  ('urban-i', 'niete', 'Urban-I', 3),
  ('nilore', 'niete', 'Nilore', 4),
  ('urban-ii', 'niete', 'Urban-II', 5),
  ('tarnol', 'niete', 'Tarnol', 6)
ON CONFLICT (region) DO UPDATE SET
  organization = EXCLUDED.organization,
  display_name = EXCLUDED.display_name,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();
INSERT INTO public.region_features (region, organization, display_name, sort_order, curriculum_key, pic_lp_enabled)
VALUES ('gilgit-baltistan', 'moawin', 'Gilgit-Baltistan', 1, 'nbf_snc', false)
ON CONFLICT (region) DO NOTHING;
