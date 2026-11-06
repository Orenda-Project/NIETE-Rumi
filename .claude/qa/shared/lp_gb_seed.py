#!/usr/bin/env python3
"""The mock lane's Gilgit-Baltistan lesson-plan fixture (bd-rj6w0n.14.9) — LOCAL run database only.

lesson-plan L13/L15 need the QA driver to be a Gilgit-Baltistan teacher, and L13 needs one ready nbf_snc
grades 1-5 plan. The seed snapshot has neither, so the driver writes them into the run's own database
and puts everything back afterwards:

  seed    --user-id U            users.region -> 'Gilgit-Baltistan'; upsert one Grade 3 English nbf_snc
                                 segment and its ready gb_v10 render (a hosted .card.html r2_key).
                                 Prints {prev_region, segment_id, title, r2_key, grade, subject}.
  restore --user-id U --region R region back to R ('' = null); then delete the segment's deliveries,
                                 its render, the segment — children first (deliveries.segment_id has
                                 no cascade).

Creds come ONLY from NIETE_LOCAL_SUPABASE_URL / _SERVICE_ROLE_KEY (run-suite exports them) and the URL
must be 127.0.0.1/localhost: no creds-file fallback, so this can never reach sandbox, staging or prod.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import niete_training_db as db  # noqa: E402  (_req / _project_ref / _upsert_path)

ENV = "local"
GB_REGION = "Gilgit-Baltistan"
SEGMENT_ID = "nbf_snc_grade_3_english_qa_c01_s01"
TITLE = "QA GB lesson"


def creds():
    url = os.environ.get("NIETE_LOCAL_SUPABASE_URL")
    key = os.environ.get("NIETE_LOCAL_SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        sys.exit("lp_gb_seed: NIETE_LOCAL_SUPABASE_URL / _SERVICE_ROLE_KEY not set (run it from the mock lane)")
    if db._project_ref(url) != ENV:
        sys.exit("lp_gb_seed: REFUSING — the URL is not the local run database")
    return url.rstrip("/"), key


def segment_row():
    return {
        "segment_id": SEGMENT_ID, "book_stem": "nbf_snc_grade_3_english_qa", "grade": 3,
        "subject": "English", "language": "en", "chapter_number": 1, "chapter_title": "QA chapter",
        "chapter_key": "c01", "subtopic_title": TITLE, "menu_title": TITLE,
        "printed_page_start": 0, "printed_page_end": 0, "order_index": 1,
        "curriculum": "nbf_snc", "is_current": True, "is_religious": False, "corpus_version": "qa",
    }


def render_row():
    return {"segment_id": SEGMENT_ID, "lang": "en", "template_version": "gb_v10", "status": "ready",
            "r2_key": "gb-k5/qa/%s.card.html" % SEGMENT_ID}


def seed(c, user_id, req=None):
    req = req or db._req
    rows, _ = req("GET", "/rest/v1/users?id=eq.%s&select=region" % user_id, c)
    if not rows:
        sys.exit("lp_gb_seed: no users row for the driver")
    prev = rows[0].get("region")
    req("PATCH", "/rest/v1/users?id=eq.%s" % user_id, c, body={"region": GB_REGION}, prefer="return=minimal")
    merge = "resolution=merge-duplicates,return=minimal"
    req("POST", db._upsert_path("niete_lp612_segments", ["segment_id"]), c, body=[segment_row()], prefer=merge)
    req("POST", db._upsert_path("niete_lp612_renders", ["segment_id", "lang", "template_version"]), c,
        body=[render_row()], prefer=merge)
    return {"prev_region": prev, "segment_id": SEGMENT_ID, "title": TITLE, "r2_key": render_row()["r2_key"],
            "grade": 3, "subject": "English"}


def restore(c, user_id, prev_region, req=None):
    req = req or db._req
    req("PATCH", "/rest/v1/users?id=eq.%s" % user_id, c, body={"region": prev_region or None}, prefer="return=minimal")
    for table in ("niete_lp612_deliveries", "niete_lp612_renders", "niete_lp612_segments"):
        req("DELETE", "/rest/v1/%s?segment_id=eq.%s" % (table, SEGMENT_ID), c, prefer="return=minimal")
    return {"restored": True}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("cmd", choices=["seed", "restore"])
    p.add_argument("--user-id", required=True)
    p.add_argument("--region", default="")
    a = p.parse_args(argv)
    c = creds()
    out = seed(c, a.user_id) if a.cmd == "seed" else restore(c, a.user_id, a.region)
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
