"""
Decision logic for scripts/import-legacy-taleemabad.py (bd-s42dye.4): bring the 66 conducted legacy
TALEEMABAD courses of fde_production back as a separate provider, "Taleemabad"
(vendor key TALEEMABAD_LEGACY), for the coach Training Library.

Pure: no I/O. The runner reads fde_production and the target, calls build_plan(), and applies the
plan in one transaction. Everything that is a judgement lives here so it can be tested.

Decisions (operator, 2026-10-17; plan D6/D7 in bd-s42dye-coach-training-library/versions/v2_plan):
  * 66 courses (COURSE_IDS) with ALL their modules, deactivated ones included, imported active.
  * mcq and msq questions only. open-ended and poll are dropped, so are fde ids 5368 and 5375.
  * Visible to coaches only: no training_programs / training_program_scopes / assignments.
  * No certificates: the vendor copies unlock_logic='chain' and has no grand quiz, so no path
    issues one (see vendor_row and tests/training/bd-s42dye-4-legacy-vendor-no-certificate.test.js).
"""
from __future__ import annotations

VENDOR_KEY = "TALEEMABAD_LEGACY"
VENDOR_NAME = "Taleemabad"
BASE_VENDOR_KEY = "TALEEMABAD"
# training_vendors.cert_code_prefix is NOT NULL; the value is never used because no certificate is issued.
CERT_PREFIX = "TLB"

# The 66 conducted TALEEMABAD courses (inventory v1_fde-legacy-inventory/missing_summary.csv,
# was_conducted = "CONDUCTED (>=10 teachers)", vendor = TALEEMABAD). Excludes the 6 test-named courses,
# the 44 test/demo courses, the empty shells and the Beacon House duplicates 311 and 318.
COURSE_IDS = (
    3, 5, 6, 7, 9, 10, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
    35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 61, 64, 65,
    66, 67, 68, 69, 70, 71, 72, 79, 80, 81, 82, 83, 84, 86, 166,
)
LEVEL_IDS = (1, 2, 3)  # Aspiring Teacher, Emerging Practitioner, Skilled Practitioner
EXPECTED_MODULES = 397

# question 5368 / 5375: active mcq with answers=[0] (broken key)
EXCLUDED_QUESTION_IDS = frozenset({5368, 5375})
IMPORTED_QUESTION_TYPES = ("mcq", "msq")

# Identity / bookkeeping columns of the base vendor row that are never copied. Everything else is
# copied from the LIVE row, so a column one environment lacks (prod has no module_quiz_ungated) is
# not invented and a column added later is carried without a code change.
_VENDOR_NOT_COPIED = frozenset({
    "id", "key", "name", "created_at", "has_grand_quiz", "has_diagnostic", "cert_code_prefix", "is_active",
})


class ImportAbort(Exception):
    """A safety check failed; the runner aborts before writing."""


def vendor_row(base: dict) -> dict:
    """The new vendor: its own identity, rules copied from the current TALEEMABAD vendor."""
    row = {k: v for k, v in base.items() if k not in _VENDOR_NOT_COPIED}
    row.update({
        "key": VENDOR_KEY,
        "name": VENDOR_NAME,
        "has_grand_quiz": False,
        "has_diagnostic": False,
        "cert_code_prefix": CERT_PREFIX,
        "is_active": True,
        # The certificate lever. maybeIssueQuizScoreCertificate returns issued:false for 'chain' vendors,
        # and a chain vendor certifies only through a grand quiz or capstone, which this vendor has none of.
        "unlock_logic": "chain",
    })
    return row


def transform_question(r: dict):
    """fde question -> (training_questions row | None, skip_reason | None)."""
    if r["id"] in EXCLUDED_QUESTION_IDS:
        return None, "excluded_id"
    if not r.get("is_active") or r.get("deleted_at") is not None:
        return None, "inactive"
    if r.get("type") not in IMPORTED_QUESTION_TYPES:
        return None, f"type:{r.get('type')}"
    opts, answers = r.get("options"), r.get("answers")
    if not isinstance(opts, list) or len(opts) < 2:
        return None, "options_count"
    if not isinstance(answers, list) or not answers:
        return None, "no_correct_answers"
    for a in answers:
        try:
            ai = int(a)
        except (TypeError, ValueError):
            return None, "correct_not_int"
        # fde stores keys 1-based; the runtime reads them 1-based too (same as migrate-teacher-training.py)
        if ai < 1 or ai > len(opts):
            return None, "correct_out_of_range"
    return {
        "source_question_id": r["id"],
        "question_text": r["question_statement"],
        "options": opts,
        "correct_option": ",".join(str(int(a)) for a in answers),
        "bloom_level": r.get("bloom_level"),
        "is_active": True,
    }, None


def course_order(courses: list[dict]) -> dict[int, int]:
    """fde course id -> dense 1..N order_index within its level, tie-break course.index then course id.
    (fde course.index is not unique per level: 30 Aspiring courses share 17 index values.)"""
    out: dict[int, int] = {}
    by_level: dict[int, list[dict]] = {}
    for c in courses:
        by_level.setdefault(c["level_id"], []).append(c)
    for rows in by_level.values():
        rows.sort(key=lambda c: (c["index"] if c["index"] is not None else 10**9, c["id"]))
        for i, c in enumerate(rows, start=1):
            out[c["id"]] = i
    return out


def transform_module(r: dict) -> dict:
    """fde training -> training_modules row, carrying media the way migrate-beacon-house.py does:
    video -> video_url + source_media_url; pdf -> source_media_url only."""
    media_url = r.get("media_url")
    media_type = (r.get("media_type") or "").lower()
    return {
        "source_module_id": r["id"],
        "title": r["title"],
        "content_html": r.get("content"),
        "duration_seconds": r.get("duration") or 0,
        "order_index": r.get("index") or 1,
        "is_active": True,  # deactivated fde modules are imported active (operator decision)
        "source_media_url": media_url,
        "video_url": media_url if media_type == "video" else None,
        "audio_url": None,
    }


def validate_source(src: dict, expect_full_scope: bool = True) -> None:
    got = {c["id"] for c in src["courses"]}
    stray = got - set(COURSE_IDS)
    if stray:
        raise ImportAbort(f"courses outside the 66-course scope: {sorted(stray)}")
    if expect_full_scope:
        missing = set(COURSE_IDS) - got
        if missing:
            raise ImportAbort(f"{len(missing)} of the 66 courses not found in fde_production: {sorted(missing)}")
        if len(src["modules"]) != EXPECTED_MODULES:
            raise ImportAbort(f"expected {EXPECTED_MODULES} modules, fde_production returned {len(src['modules'])}")


# ---------------------------------------------------------------------------------------------
# plan
# ---------------------------------------------------------------------------------------------

def _bucket() -> dict:
    return {"insert": [], "update": [], "unchanged": []}


def _diff(existing: dict, desired: dict, fields) -> dict:
    return {f: desired[f] for f in fields if existing.get(f) != desired[f]}


def build_plan(src: dict, existing: dict, base_vendor: dict) -> dict:
    """
    src      levels/courses/modules/questions read from fde_production (already scoped to the 66 courses)
    existing the target's legacy-vendor state keyed by source id:
               {"vendor": row|None, "levels": {source_level_id: row}, "courses": {source_course_id: row},
                "modules": {source_module_id: row}, "questions": {source_question_id: row},
                "foreign": [(table, source_id, vendor_key)]}   source ids owned by ANOTHER vendor
    Returns {"vendor": {action,row}, "levels"/"courses"/"modules"/"questions": {insert,update,unchanged},
             "skipped": {reason: n}}.  Child rows carry their parent's fde id (_level_src, _course_src,
             _module_src) for the runner to resolve to a target id.
    """
    if existing.get("foreign"):
        raise ImportAbort(f"source ids already owned by another vendor: {existing['foreign'][:5]}")

    plan = {"vendor": None, "levels": _bucket(), "courses": _bucket(), "modules": _bucket(),
            "questions": _bucket(), "skipped": {}}

    # vendor: created once, never reset (an operator may have tuned the rules since)
    if existing.get("vendor"):
        plan["vendor"] = {"action": "unchanged", "row": existing["vendor"]}
    else:
        plan["vendor"] = {"action": "insert", "row": vendor_row(base_vendor)}

    # levels: fde order is 0-based, order_index is 1-based and UNIQUE (vendor_id, order_index)
    for lv in sorted(src["levels"], key=lambda r: (r["order"], r["id"])):
        desired = {"source_level_id": lv["id"], "name": lv["name"], "order_index": lv["order"] + 1,
                   "cpd_level": None, "is_active": True}
        cur = existing["levels"].get(lv["id"])
        _place(plan["levels"], cur, desired, ("name", "order_index", "is_active"), lv["id"])

    # courses
    order = course_order(src["courses"])
    for c in sorted(src["courses"], key=lambda r: (r["level_id"], order[r["id"]])):
        desired = {"source_course_id": c["id"], "title": c["title"], "course_type": c["type"],
                   "order_index": order[c["id"]], "is_active": True, "_level_src": c["level_id"]}
        cur = existing["courses"].get(c["id"])
        _place(plan["courses"], cur, desired, ("title", "course_type", "order_index", "is_active"), c["id"])

    # modules
    known_modules = set()
    for r in sorted(src["modules"], key=lambda r: (r["course_id"], r["index"] or 1, r["id"])):
        desired = transform_module(r)
        desired["_course_src"] = r["course_id"]
        known_modules.add(r["id"])
        cur = existing["modules"].get(r["id"])
        fields = ["title", "content_html", "duration_seconds", "order_index", "is_active"]
        if cur is None or cur.get("source_media_url") != desired["source_media_url"]:
            # new row, or the source media changed. Otherwise leave video_url alone: the media re-host
            # repoints it at R2 and a re-import must not undo that.
            fields += ["source_media_url", "video_url", "audio_url"]
        _place(plan["modules"], cur, desired, fields, r["id"], key="source_module_id")

    # questions: dense order per module by (fde index, id)
    kept: dict[int, list[dict]] = {}
    for r in src["questions"]:
        if r["training_id"] not in known_modules:
            continue
        row, why = transform_question(r)
        if row is None:
            plan["skipped"][why] = plan["skipped"].get(why, 0) + 1
            continue
        row["_module_src"] = r["training_id"]
        kept.setdefault(r["training_id"], []).append((r.get("index") or 1, r["id"], row))
    for mod_id in sorted(kept):
        for pos, (_, qid, row) in enumerate(sorted(kept[mod_id], key=lambda t: (t[0], t[1])), start=1):
            row["order_index"] = pos
            cur = existing["questions"].get(qid)
            _place(plan["questions"], cur, row,
                   ("question_text", "options", "correct_option", "bloom_level", "order_index", "is_active"),
                   qid, key="source_question_id")
    return plan


def _place(bucket: dict, cur, desired: dict, fields, source_id, key: str | None = None) -> None:
    if cur is None:
        bucket["insert"].append(desired)
        return
    patch = _diff(cur, desired, fields)
    if patch:
        bucket["update"].append({"source_id": source_id, "id": cur.get("id"), "patch": patch})
    else:
        bucket["unchanged"].append(source_id)


def summarise(plan: dict) -> dict:
    out = {"vendor": plan["vendor"]["action"]}
    for k in ("levels", "courses", "modules", "questions"):
        b = plan[k]
        out[k] = {"insert": len(b["insert"]), "update": len(b["update"]), "unchanged": len(b["unchanged"])}
    out["skipped_questions"] = dict(sorted(plan["skipped"].items()))
    return out
