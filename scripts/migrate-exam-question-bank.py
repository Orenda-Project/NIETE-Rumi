#!/usr/bin/env python3
"""
NIETE-Rumi Exam Question Bank migration — one-shot fork of TALEEMABAD content
from the legacy Taleemabad platform (fde_production tenant).

What it does (all steps idempotent — ON CONFLICT DO NOTHING / UPSERT):
  1. Pull question_bank_questiongroup rows → exam_question_groups
     (comprehension passages, match-the-columns blocks, choice groups, ...)
  2. Pull question_bank_question rows joined to grade_subject, book_chapter,
     and (optionally) question_group → exam_question_bank
     Filters: question_status='onprod' AND is_active=true
     Language inferred from statement text (Urdu unicode → 'ur', else 'en')
  3. Pull question_bank_assessment rows joined to grade_subject and check_point
     → emit bot/shared/services/exam/exam-composer.blueprints.js as a JS constants file
     (Blooms or Skills breakdowns, seen/unseen percentages, duration hints)

What it does NOT do:
  - Re-host question media (question_media[].url stays pointing at Taleemabad's S3
    per the design decision D6 — proxy at render time, substitute placeholder on 404).
  - Import LP linkage (question_bank_question_lesson_plans is dropped —
    redundant with book_chapter FK per D3).
  - Import checkpoints / school_class / assessment table (out of scope per D3).

Reads: Taleemabad prod Postgres (read-only role from .env — TALEEMABAD_DB_*)
       via schema `fde_production`.
Writes: NIETE-Rumi Supabase via exec_sql RPC + PostgREST bulk inserts,
        PLUS emits a JS file to bot/shared/services/exam/exam-composer.blueprints.js.

Run: python3 scripts/migrate-exam-question-bank.py
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

import psycopg2
import psycopg2.extras

REPO = Path(__file__).resolve().parent.parent
ENV = REPO / ".env"
BLUEPRINTS_OUT = REPO / "bot" / "shared" / "services" / "exam" / "exam-composer.blueprints.js"


# ─────────────────────────────────────────────────────────────────────────────
# env + HTTP helpers (mirror migrate-teacher-training.py exactly)
# ─────────────────────────────────────────────────────────────────────────────


def env(k: str) -> str:
    for line in ENV.read_text().splitlines():
        if line.startswith(k + "="):
            return line.split("=", 1)[1]
    raise KeyError(f"{k} not in .env")


def exec_sql(query: str) -> None:
    url = env("SUPABASE_URL").rstrip("/") + "/rest/v1/rpc/exec_sql"
    body = json.dumps({"query": query}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "apikey": env("SUPABASE_SERVICE_ROLE_KEY"),
            "Authorization": "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY"),
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"exec_sql failed: {e.code} {e.read().decode()[:400]}")


def rest_bulk(table: str, rows: list[dict], on_conflict: str | None = None) -> None:
    if not rows:
        return
    path = f"/rest/v1/{table}"
    if on_conflict:
        path += f"?on_conflict={on_conflict}"
    url = env("SUPABASE_URL").rstrip("/") + path
    headers = {
        "apikey": env("SUPABASE_SERVICE_ROLE_KEY"),
        "Authorization": "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY"),
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    # PostgREST caps request size; chunk conservatively.
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i : i + CHUNK]
        req = urllib.request.Request(
            url, data=json.dumps(chunk).encode(), headers=headers, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(
                f"rest_bulk {table} chunk {i}-{i+len(chunk)} failed: "
                f"{e.code} {e.read().decode()[:400]}"
            )


# ─────────────────────────────────────────────────────────────────────────────
# source connection (Taleemabad Postgres, fde_production tenant)
# ─────────────────────────────────────────────────────────────────────────────


def source_conn():
    return psycopg2.connect(
        host=env("TALEEMABAD_DB_HOST"),
        port=int(env("TALEEMABAD_DB_PORT")),
        dbname=env("TALEEMABAD_DB_NAME"),
        user=env("TALEEMABAD_DB_USER"),
        password=env("TALEEMABAD_DB_PASSWORD"),
        sslmode="require",
        connect_timeout=10,
        # Point at the FDE tenant schema — same as migrate-teacher-training.py.
        options="-c search_path=fde_production",
    )


def q(cur, sql: str, params: tuple = ()) -> list[dict]:
    cur.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


# ─────────────────────────────────────────────────────────────────────────────
# language inference from statement text
# ─────────────────────────────────────────────────────────────────────────────
# Urdu / Arabic Unicode blocks:
#   ؀–ۿ  Arabic
#   ݐ–ݿ  Arabic Supplement
#   ࢠ–ࣿ  Arabic Extended-A
#   ﭐ–﷿  Arabic Presentation Forms-A
#   ﹰ–﻿  Arabic Presentation Forms-B
_URDU_RE = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")


def infer_language(statement: str) -> str:
    if statement and _URDU_RE.search(statement):
        return "ur"
    return "en"


def norm_bloom(tag: str | None) -> str | None:
    """Normalise Taleemabad Bloom tag strings to our UPPER convention."""
    if not tag:
        return None
    t = tag.strip().upper()
    # Taleemabad uses full names ('REMEMBER', 'UNDERSTAND', ...); already upper.
    return t if t else None


# ─────────────────────────────────────────────────────────────────────────────
# Step 1 — exam_question_groups
# ─────────────────────────────────────────────────────────────────────────────


def step1_groups(cur) -> dict[int, str]:
    """Return {taleemabad_group_id (int): our_uuid_str}."""
    print("→ step1_groups: pulling question_bank_questiongroup")
    rows = q(
        cur,
        """
        SELECT id, uuid, title_text, media, group_type
        FROM question_bank_questiongroup
        WHERE is_active IS NOT FALSE
        """,
    )
    print(f"  fetched {len(rows)} groups from source")

    # Fetch existing to preserve UUIDs across re-runs.
    existing = _fetch_existing_uuid_map("exam_question_groups")
    payload: list[dict] = []
    id_map: dict[int, str] = {}
    for r in rows:
        source_uuid = str(r["uuid"])
        our_uuid = existing.get(source_uuid)  # may be None on first run
        row = {
            "taleemabad_uuid": source_uuid,
            "title_text": r.get("title_text"),
            "media": r.get("media") or [],
            "group_type": r.get("group_type") or "comprehension",
        }
        if our_uuid:
            row["id"] = our_uuid
        payload.append(row)
        # our_uuid becomes known after upsert; we'll refresh below.
        id_map[r["id"]] = source_uuid  # temporarily by source_uuid; resolved next

    rest_bulk("exam_question_groups", payload, on_conflict="taleemabad_uuid")

    # After insert, fetch the (id, taleemabad_uuid) map so downstream inserts
    # can point group_ref at the right UUID.
    fresh = _fetch_existing_uuid_map("exam_question_groups")
    id_map = {tb_int: fresh[str(tb_uuid)] for tb_int, tb_uuid in id_map.items() if str(tb_uuid) in fresh}
    print(f"  upserted {len(payload)} groups; mapped {len(id_map)} source→dest ids")
    return id_map


def _fetch_existing_uuid_map(table: str) -> dict[str, str]:
    """Return {taleemabad_uuid_str: our_uuid_str} for all rows in `table`."""
    url = (
        env("SUPABASE_URL").rstrip("/")
        + f"/rest/v1/{table}?select=id,taleemabad_uuid&limit=100000"
    )
    req = urllib.request.Request(
        url,
        headers={
            "apikey": env("SUPABASE_SERVICE_ROLE_KEY"),
            "Authorization": "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY"),
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        rows = json.loads(resp.read())
    return {r["taleemabad_uuid"]: r["id"] for r in rows if r.get("taleemabad_uuid")}


# ─────────────────────────────────────────────────────────────────────────────
# Step 2 — exam_question_bank
# ─────────────────────────────────────────────────────────────────────────────


def step2_questions(cur, group_id_map: dict[int, str]) -> int:
    print("→ step2_questions: pulling question_bank_question (ONPROD only)")
    rows = q(
        cur,
        """
        SELECT
          q.id                AS q_id,
          q.uuid              AS q_uuid,
          q.question_statement,
          q.question_media,
          q.question_format,
          q.type              AS q_type,
          q.sub_type,
          q.score,
          q.marking_scheme,
          q.category,
          q.answer_options,
          q.question_tags,
          q.book_chapter_slo,
          q.index             AS index_in_chapter,
          q.group_id,
          gs.grade_id,
          s.name              AS subject_name,
          grd.value           AS grade_value,
          bc.index            AS chapter_index,
          bc.title            AS chapter_title,
          slo.tag             AS ncp_slo_tag
        FROM question_bank_question q
        LEFT JOIN book_library_gradesubject gs ON gs.id = q.grade_subject_id
        LEFT JOIN book_library_subject      s  ON s.id  = gs.subject_id
        LEFT JOIN book_library_grade        grd ON grd.id = gs.grade_id
        LEFT JOIN book_library_bookchapter  bc ON bc.id = q.book_chapter_id
        LEFT JOIN slo_ncpslo                slo ON slo.id = q.ncp_slo_id
        WHERE q.question_status = 'onProd'
          AND q.is_active = true
          AND bc.id IS NOT NULL          -- must be tied to a chapter to be pickable
        """,
    )
    print(f"  fetched {len(rows)} questions from source")

    payload: list[dict] = []
    skipped = {"no_grade": 0, "no_subject": 0, "no_chapter": 0, "no_statement": 0}
    for r in rows:
        stmt = (r.get("question_statement") or "").strip()
        if not stmt:
            skipped["no_statement"] += 1
            continue
        grade = str(r.get("grade_value") or "").strip()
        subject = str(r.get("subject_name") or "").strip()
        chapter_index = r.get("chapter_index")
        if not grade:
            skipped["no_grade"] += 1
            continue
        if not subject:
            skipped["no_subject"] += 1
            continue
        if chapter_index is None:
            skipped["no_chapter"] += 1
            continue

        # Correct answer: if MCQ, pick the is_correct=true option's statement.
        correct_answer = None
        opts = r.get("answer_options") or []
        if isinstance(opts, list):
            for o in opts:
                if isinstance(o, dict) and o.get("is_correct"):
                    correct_answer = o.get("statement") or o.get("text")
                    break

        # Bloom tags: normalise + strip Nones.
        tags = [norm_bloom(t) for t in (r.get("question_tags") or [])]
        bloom_tags = [t for t in tags if t]

        # Category: SEEN / UNSEEN (Taleemabad's 'fln' category is filtered out).
        cat_raw = (r.get("category") or "").split(".")[0].upper()
        if cat_raw not in ("SEEN", "UNSEEN"):
            # Fall back to UNSEEN — safer default than dropping the row.
            cat_raw = "UNSEEN"

        # Group ref: only set if the source group actually made it to our table.
        source_group_id = r.get("group_id")
        our_group_uuid = group_id_map.get(source_group_id) if source_group_id else None

        payload.append(
            {
                "taleemabad_uuid": str(r["q_uuid"]),
                "grade": grade,
                "subject": subject,
                "language": infer_language(stmt),
                "chapter_index": int(chapter_index),
                "chapter_title": r.get("chapter_title") or "",
                "question_statement": stmt,
                "question_media": r.get("question_media") or [],
                "question_format": r.get("question_format") or "statement",
                "type": r.get("q_type") or "MCQs",
                "sub_type": r.get("sub_type"),
                "score": float(r.get("score") or 1),
                "marking_scheme": r.get("marking_scheme"),
                "category": cat_raw,
                "answer_options": opts,
                "correct_answer": correct_answer,
                "bloom_tags": bloom_tags,
                "ncp_slo_ref": r.get("ncp_slo_tag"),
                "book_chapter_slo": r.get("book_chapter_slo"),
                "group_ref": our_group_uuid,
                "group_type": None,  # denormalised — filled from group_id_map lookup below if needed
                "index_in_chapter": int(r.get("index_in_chapter") or 1),
            }
        )

    print(
        f"  prepared {len(payload)} rows for upsert "
        f"(skipped: {skipped})"
    )
    rest_bulk("exam_question_bank", payload, on_conflict="taleemabad_uuid")
    print(f"  upserted {len(payload)} questions")
    return len(payload)


# ─────────────────────────────────────────────────────────────────────────────
# Step 3 — extract blueprints → JS constants file
# ─────────────────────────────────────────────────────────────────────────────


def step3_blueprints(cur) -> int:
    """
    Pull Assessment rows joined to grade/subject and dump as
    bot/shared/services/exam/exam-composer.blueprints.js.

    Assessment.criteria is a JSONField with two shapes:
      { type: 'blooms', breakdown: {remember: N, understand: N, apply: N} }
      { type: 'skills', breakdown: {reading: N, writing: N, listening: N, speaking: N} }
    """
    print("→ step3_blueprints: pulling question_bank_assessment")
    rows = q(
        cur,
        """
        SELECT
          a.id, a.name, a.total_marks, a.seen_marks, a.unseen_marks,
          a.seen_percentage, a.unseen_percentage, a.criteria,
          s.name  AS subject_name,
          grd.value AS grade_value,
          cp.name AS checkpoint_name
        FROM question_bank_assessment a
        LEFT JOIN book_library_gradesubject gs ON gs.id = a.grade_subject_id
        LEFT JOIN book_library_subject      s  ON s.id  = gs.subject_id
        LEFT JOIN book_library_grade        grd ON grd.id = gs.grade_id
        LEFT JOIN question_bank_checkpoint  cp ON cp.id = a.check_point_id
        WHERE a.is_active = true
        """,
    )
    print(f"  fetched {len(rows)} assessment blueprints from source")

    # Bucket by (grade, subject) — one entry per pair. Use the assessment
    # with the highest total_marks per pair as the "term" default; a smaller
    # weekly default is synthesised (~30% marks, seen-heavy) per D8.
    by_pair: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        grade = str(r.get("grade_value") or "").strip()
        subject = str(r.get("subject_name") or "").strip()
        if not grade or not subject:
            continue
        by_pair.setdefault((grade, subject), []).append(r)

    blueprints: dict[str, dict] = {}
    for (grade, subject), assessments in by_pair.items():
        # Term = the largest by total_marks (most comprehensive assessment).
        term = max(assessments, key=lambda a: (a.get("total_marks") or 0))
        term_criteria = _coerce_criteria(term.get("criteria"))
        seen_pct = _first_int(term.get("seen_percentage"), 30)
        unseen_pct = _first_int(term.get("unseen_percentage"), 100 - seen_pct)
        blueprints[f"{grade}::{subject}::TERM"] = {
            "duration_minutes": 120,
            "seen_pct": seen_pct,
            "unseen_pct": unseen_pct,
            "criteria": term_criteria,
        }
        # Weekly = derived (smaller, seen-heavy) — per D8.
        blueprints[f"{grade}::{subject}::WEEKLY"] = {
            "duration_minutes": 40,
            "seen_pct": 80,
            "unseen_pct": 20,
            "criteria": _scale_criteria(term_criteria, factor=0.3),
        }

    # Emit JS file.
    BLUEPRINTS_OUT.parent.mkdir(parents=True, exist_ok=True)
    js = _render_blueprints_js(blueprints)
    BLUEPRINTS_OUT.write_text(js)
    print(f"  wrote {len(blueprints)} blueprints → {BLUEPRINTS_OUT.relative_to(REPO)}")
    return len(blueprints)


def _coerce_criteria(criteria) -> dict:
    """Return a well-formed { type, breakdown } dict. Fallback to generic Blooms."""
    if isinstance(criteria, dict) and criteria.get("type") in ("blooms", "skills"):
        breakdown = criteria.get("breakdown") or {}
        if isinstance(breakdown, dict) and breakdown:
            return {"type": criteria["type"], "breakdown": breakdown}
    return {
        "type": "blooms",
        "breakdown": {"remember": 40, "understand": 40, "apply": 20},
    }


def _scale_criteria(criteria: dict, factor: float) -> dict:
    """Scale a breakdown by `factor`, rounding to ints, min 1 per non-zero bucket."""
    breakdown = criteria.get("breakdown", {})
    scaled = {}
    for k, v in breakdown.items():
        try:
            scaled[k] = max(1, round(float(v) * factor)) if v else 0
        except (TypeError, ValueError):
            scaled[k] = 0
    return {"type": criteria.get("type", "blooms"), "breakdown": scaled}


def _first_int(v, default: int) -> int:
    try:
        return int(round(float(v))) if v is not None else default
    except (TypeError, ValueError):
        return default


def _render_blueprints_js(blueprints: dict[str, dict]) -> str:
    lines = [
        "/**",
        " * Exam composition blueprints — generated by",
        " * `scripts/migrate-exam-question-bank.py`.",
        " *",
        " * DO NOT EDIT BY HAND. Re-run the migration to regenerate.",
        " *",
        " * Source: taleemabad-core question_bank_assessment (fde_production).",
        " * See docs/migration/05-exam-generator.md for the schema.",
        " */",
        "",
        "const BLUEPRINTS = {",
    ]
    for key in sorted(blueprints.keys()):
        bp = blueprints[key]
        lines.append(f"  {json.dumps(key)}: {json.dumps(bp, ensure_ascii=False)},")
    lines.append("};")
    lines.append("")
    lines.append("const GENERIC = {")
    lines.append("  duration_minutes: 60,")
    lines.append("  seen_pct: 40,")
    lines.append("  unseen_pct: 60,")
    lines.append("  criteria: {")
    lines.append("    type: 'blooms',")
    lines.append("    breakdown: { remember: 40, understand: 40, apply: 20 },")
    lines.append("  },")
    lines.append("};")
    lines.append("")
    lines.append("function getBlueprint(grade, subject, type) {")
    lines.append("  const key = `${grade}::${subject}::${type}`;")
    lines.append("  return BLUEPRINTS[key] || GENERIC;")
    lines.append("}")
    lines.append("")
    lines.append("module.exports = { BLUEPRINTS, GENERIC, getBlueprint };")
    return "\n".join(lines) + "\n"


# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────


def main() -> int:
    print("─" * 70)
    print("NIETE-Rumi exam question bank migration")
    print("─" * 70)
    with source_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        group_map = step1_groups(cur)
        n_questions = step2_questions(cur, group_map)
        n_blueprints = step3_blueprints(cur)
    print("─" * 70)
    print(f"Done: {len(group_map)} groups, {n_questions} questions, {n_blueprints} blueprints")
    print("─" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
