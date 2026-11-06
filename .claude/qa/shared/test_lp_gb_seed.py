#!/usr/bin/env python3
"""Stdlib assert tests for lp_gb_seed — the mock lane's Gilgit-Baltistan lesson-plan fixture (bd-rj6w0n.14.9).
Run: python3 .claude/qa/shared/test_lp_gb_seed.py

lesson-plan L13/L15 need the driver to be a Gilgit-Baltistan teacher with one ready nbf_snc grades 1-5 plan.
The seed snapshot has neither, so the lane writes them into the RUN's own database and puts everything back.
Pinned here: it can only ever reach the local run database, the rows are the shape the GB product code
reads (curriculum nbf_snc, grade 1-5, a ready gb_v10 render whose r2_key is a hosted .card.html), and
restore deletes exactly what seed wrote, child rows first, and gives the driver back its region.
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lp_gb_seed as g


def test_only_the_local_run_database():
    assert g.ENV == "local"
    os.environ.pop("NIETE_LOCAL_SUPABASE_URL", None)
    os.environ.pop("NIETE_LOCAL_SUPABASE_SERVICE_ROLE_KEY", None)
    try:
        g.creds()
    except SystemExit:
        pass
    else:
        raise AssertionError("creds() must refuse without the run's NIETE_LOCAL_SUPABASE_*")
    os.environ["NIETE_LOCAL_SUPABASE_URL"] = "https://olvritwoqujtjvwfulbh.supabase.co"
    os.environ["NIETE_LOCAL_SUPABASE_SERVICE_ROLE_KEY"] = "x"
    try:
        g.creds()
    except SystemExit:
        pass
    else:
        raise AssertionError("creds() must refuse a non-127.0.0.1 URL under the local env")
    finally:
        os.environ.pop("NIETE_LOCAL_SUPABASE_URL", None)
        os.environ.pop("NIETE_LOCAL_SUPABASE_SERVICE_ROLE_KEY", None)


def test_segment_is_a_current_nbf_snc_grade_1_to_5_english_segment():
    s = g.segment_row()
    assert s["curriculum"] == "nbf_snc"
    assert 1 <= s["grade"] <= 5
    assert s["subject"] == "English" and s["language"] == "en"
    assert s["is_current"] is True and s["is_religious"] is False
    assert s["segment_id"].startswith("nbf_snc_") and s["book_stem"].startswith("nbf_snc_")
    for col in ("chapter_key", "subtopic_title", "menu_title", "printed_page_start", "printed_page_end", "order_index"):
        assert col in s, col


def test_render_is_a_ready_hosted_gb_card():
    r = g.render_row()
    assert r["segment_id"] == g.segment_row()["segment_id"]
    assert r["template_version"] == "gb_v10" and r["status"] == "ready" and r["lang"] == "en"
    assert r["r2_key"].startswith("gb-k5/qa/") and r["r2_key"].endswith(".card.html")


def test_seed_sets_region_and_upserts_rows_restore_undoes_it_children_first():
    calls = []

    def fake(method, path, creds, body=None, prefer=None):
        calls.append((method, path, body))
        if method == "GET" and path.startswith("/rest/v1/users"):
            return [{"region": None}], 200
        return None, 201

    g.seed(("u", "k"), "uid-1", req=fake)
    methods = [(m, p.split("?")[0]) for m, p, _ in calls]
    assert methods[0] == ("GET", "/rest/v1/users")
    assert ("PATCH", "/rest/v1/users") in methods
    patch = next(b for m, p, b in calls if m == "PATCH")
    assert patch == {"region": "Gilgit-Baltistan"}
    assert methods.index(("POST", "/rest/v1/niete_lp612_segments")) < methods.index(("POST", "/rest/v1/niete_lp612_renders"))
    assert all("id=eq.uid-1" in p for m, p, _ in calls if p.startswith("/rest/v1/users"))

    calls.clear()
    g.restore(("u", "k"), "uid-1", None, req=fake)
    order = [(m, p.split("?")[0]) for m, p, _ in calls]
    assert order == [("PATCH", "/rest/v1/users"), ("DELETE", "/rest/v1/niete_lp612_deliveries"),
                     ("DELETE", "/rest/v1/niete_lp612_renders"), ("DELETE", "/rest/v1/niete_lp612_segments")], order
    assert calls[0][2] == {"region": None}
    seg = g.segment_row()["segment_id"]
    assert all(("segment_id=eq.%s" % seg) in p for m, p, _ in calls[1:])


if __name__ == "__main__":
    n = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); n += 1; print("  ok  " + name)
    print("%d passed" % n)
