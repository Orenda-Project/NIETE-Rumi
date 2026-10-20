-- ROLLBACK V1.6.18 — child_test: drop the self-administered battery's event log and per-task results.
--
-- Refuses while either table holds a row: they are a child's test evidence. Export them first, by
-- hand, on purpose.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

DO $$
BEGIN
  IF to_regclass('child_test_sa_events') IS NOT NULL AND EXISTS (SELECT 1 FROM child_test_sa_events) THEN
    RAISE EXCEPTION 'ROLLBACK_V1.6.18: child_test_sa_events holds rows; export them first' USING ERRCODE = 'check_violation';
  END IF;
  IF to_regclass('child_test_sa_results') IS NOT NULL AND EXISTS (SELECT 1 FROM child_test_sa_results) THEN
    RAISE EXCEPTION 'ROLLBACK_V1.6.18: child_test_sa_results holds rows; export them first' USING ERRCODE = 'check_violation';
  END IF;
END
$$;

DROP TABLE IF EXISTS child_test_sa_events;
DROP TABLE IF EXISTS child_test_sa_results;
