-- V1.6.8 — niete_lp_taken: the ONE definition of "this teacher took this lesson plan" (bd-2wgr3d.22.2).
-- Versioned migration in infrastructure/supabase/migrations (applied per environment, in order).
-- Rollback: ROLLBACK_V1.6.8__niete_lp_taken.sql
--
-- WHY. On 12 Oct 2026 the "Open in app" link went on for every registered teacher. A plan she opens
-- in the teacher app is recorded in niete_lp_opens; a plan sent on WhatsApp in niete_lp_downloads
-- (grades 1-5) or niete_lp612_deliveries (grades 6-12). Every feature that asked "did she take a
-- plan?" read one of those on its own, so the ICT report, the survey, the quiz offer, the coaching
-- ask and some 15 more readers went blind to the app overnight, and the fixes since wrote three
-- different unions with three different rules. The operator decided (14 Oct 2026) on one definition,
-- in the database, that the bot, the portal and the RDF all read:
--   · every route counts — sent on WhatsApp, opened in the app's viewer, or handed from the app to
--     another app (a hand-off only ever starts inside the app);
--   · grades 1-5 and 6-12 alike;
--   · every open is kept: a reader decides whether it wants one entry per plan or one per day.
--
-- WHAT A ROW IS. One plan-taken EVENT: (user_id, plan_kind, plan_ref) taken at taken_at by route.
--   plan_kind  'k5'   — grades 1-5; plan_ref = the catalogue lesson_id (data/lp_catalog.json).
--              'g612' — grades 6-12; plan_ref = niete_lp612_segments.segment_id; lang = en | ur.
--   route      'whatsapp' — the bot sent it (k5: niete_lp_downloads 'sent'; g612: niete_lp612_deliveries
--                           'whatsapp', or 'backfill' = a render's first requester copied in by V1.5.5).
--              'app'      — opened in the teacher app (niete_lp_opens); app_source says how: 'viewer'
--                           (the app's own reader) or 'external' (handed to another app).
--   asset_id, version_stamp, content_hash — the version she was given, where the ledger records it:
--     k5 WhatsApp rows only (g612 WhatsApp rows carry template_version as version_stamp). App opens do
--     not store a version yet (parked by the operator, 14 Oct); lp-app-opens.store reconstructs it.
--   source_table, source_id — the ledger row behind the event, so a reader can always get back to it.
--
-- NOT A SOURCE, on purpose:
--   · niete_lp612_deliveries surface 'portal' — the bot's claim on a render the app requested; it is
--     not an open (the app's opens are niete_lp_opens). Measured on prod: 669 such rows 12-14 Oct.
--   · lesson_plans — in NIETE its rows are the survey's anchor: one per K-5 WhatsApp delivery (a twin
--     of a niete_lp_downloads 'sent' row) and, since bd-qvevax.2, one per first app open (a twin of a
--     niete_lp_opens row). Counting it would count the same plan twice. Measured on prod 12-14 Oct:
--     1,659 rows = 481 WhatsApp v8 + 1,177 app v8 + 1 non-catalogue plan. Reading it would also detoast
--     its fat `content` column on every scan (database-engineering §1.1).
--
-- WHY A VIEW, NOT A TABLE (root Rule 15). Every fact already lives in exactly one ledger; a view adds
-- no copy to drift and no writer. Nothing is moved. A reader's filter on user_id / taken_at is pushed
-- into each arm, where the existing indexes serve it: idx_lp_downloads_user_time (user_id,
-- created_at DESC), idx_lp612_deliveries_user_recent (user_id, delivered_at DESC),
-- idx_lp_opens_user_recent (user_id, opened_at DESC). A day-wide read with no user_id (the RDF)
-- scans the day's slice of three small tables (prod 12-14 Oct: ~6.7k opens, ~0.5k sends, ~0.7k 6-12).
--
-- SECURITY. security_invoker = true: the view runs with the CALLER's rights, so it never lets a role
-- see a row the underlying tables' RLS hides from it. Only the service role (bot, portal, RDF) reads
-- it; anon and authenticated get nothing.
--
-- ORDER. Apply to each environment BEFORE any reader that uses it reaches that environment:
-- sandbox -> staging -> production (production needs the operator's go). Readers:
-- bd-2wgr3d.22.3 (bot + portal), bd-2wgr3d.22.5 (RDF). After the DDL PostgREST is told to reload,
-- or it answers 404 for the new view until its next restart.

CREATE OR REPLACE VIEW public.niete_lp_taken WITH (security_invoker = true) AS
-- grades 1-5, sent on WhatsApp
SELECT d.user_id AS user_id,
       'k5'::text AS plan_kind,
       d.lesson_id AS plan_ref,
       NULL::text AS lang,
       'whatsapp'::text AS route,
       NULL::text AS app_source,
       d.created_at AS taken_at,
       d.asset_id AS asset_id,
       d.version_stamp AS version_stamp,
       d.content_hash AS content_hash,
       'niete_lp_downloads'::text AS source_table,
       d.id AS source_id
  FROM public.niete_lp_downloads d
 WHERE d.status = 'sent'
   AND d.user_id IS NOT NULL
UNION ALL
-- grades 6-12, sent on WhatsApp (render claims made for the app are excluded: see the header)
SELECT g.user_id AS user_id,
       'g612'::text AS plan_kind,
       g.segment_id AS plan_ref,
       g.lang AS lang,
       'whatsapp'::text AS route,
       NULL::text AS app_source,
       g.delivered_at AS taken_at,
       NULL::uuid AS asset_id,
       g.template_version AS version_stamp,
       NULL::text AS content_hash,
       'niete_lp612_deliveries'::text AS source_table,
       g.id AS source_id
  FROM public.niete_lp612_deliveries g
 WHERE g.surface IN ('whatsapp', 'backfill')
UNION ALL
-- every plan opened in the teacher app, in its viewer or handed to another app
SELECT o.user_id AS user_id,
       o.plan_kind AS plan_kind,
       o.plan_ref AS plan_ref,
       o.lang AS lang,
       'app'::text AS route,
       o.source AS app_source,
       o.opened_at AS taken_at,
       NULL::uuid AS asset_id,
       NULL::text AS version_stamp,
       NULL::text AS content_hash,
       'niete_lp_opens'::text AS source_table,
       o.id AS source_id
  FROM public.niete_lp_opens o;

COMMENT ON VIEW public.niete_lp_taken IS
  'One row per lesson plan a teacher TOOK, by any route (WhatsApp send, app viewer open, app hand-off), grades 1-12. The one definition the bot, portal and RDF read (bd-2wgr3d.22.2). See V1.6.8.';

REVOKE ALL ON public.niete_lp_taken FROM anon, authenticated;
GRANT SELECT ON public.niete_lp_taken TO service_role;

NOTIFY pgrst, 'reload schema';
