-- ROLLBACK V1.7.4 — child_test: drop the per-item review table (its rows: the agents' marks and the reviewers' marks).
-- Export the rows first if the reviewers' marks are still needed.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

DROP TABLE IF EXISTS child_test_sa_item_reviews;
