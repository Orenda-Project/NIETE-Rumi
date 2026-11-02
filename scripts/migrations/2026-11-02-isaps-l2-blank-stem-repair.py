#!/usr/bin/env python3
"""bd-arghnv.3 — repair the I-SAPS Level 2 questions seeded with a blank stem.

What went wrong: 2026-10-23-isaps-level2-seed.py read a stem line opening "A teacher…", "After…", "At…"
as option A (the dot and the space after the letter were both optional), so the stem lost its "A" and
the real "A. …" line was folded in after it. 43 active questions went in with question_text '' and

    options[0] = "<the stem minus its first A> A. <the real option A>"

e.g. "t what point during the lesson did students …? A. When the teacher explained the concept".
The parser is fixed in the same change; this repairs the rows already written.

The rule (operator, 2026-11-02):
    question_text = "A" + the text before " A. "   when the first word is fter / ccording / t / n /
                                                    nticipating (After, According, At, An, Anticipating)
                  = "A " + the text before " A. "  when it is teacher / student / school / principal /
                                                    university / purposeful (the article "A")
    options[0]    = the text after " A. "
Options B to D, their order and correct_option are untouched. Past answers to these questions stand.

The old parser joined a stem's lines with spaces, so a two-line stem (scenario, then the question) comes back
as one paragraph. With --content (the partner's Level 2 folder) the stem takes its line breaks from the fixed
seed's own reading of the source, and only when the words are identical; otherwise the rule's text stands.

A blank-stem row that does not fit (not exactly one " A. ", not starting lowercase, a first word outside
the two reviewed lists, not four options) is REFUSED and printed, never guessed at.

The same parser bug left two more rows (M4 quick checks) with their stem intact but its LAST line, "According
to the SAMR framework…", glued onto option A. They are listed as PROPOSED and written only with
--with-glued-tails, because the operator approved the 43 blank stems, not these.

Safety:
  * Writes nothing to a database. It reads rows you export and writes a review CSV and a SQL file.
  * The SQL is one transaction. Each UPDATE is guarded per row: still active, question_text still what it
    was (blank for the 43), options[0] still the glued text. Re-running it changes nothing.

Usage:
  psql "$DB" -X -At -c "$(python3 scripts/migrations/2026-11-02-isaps-l2-blank-stem-repair.py --export-sql)" > rows.json
  python3 scripts/migrations/2026-11-02-isaps-l2-blank-stem-repair.py --rows rows.json --csv review.csv --sql repair.sql \
      [--content "<bd-yef5iq investigation>/outputs/raw/Level 2 Training Content"]
  psql "$DB" -X -v ON_ERROR_STOP=1 -f repair.sql   # staging is pre-authorised; production needs the operator's go
"""
import argparse
import csv
import importlib.util
import json
import os
import re
import sys

MARKER = " A. "
# The word that lost its first letter -> "A" + word. Reviewed against production, 2 Nov.
JOIN_WORDS = {"fter", "ccording", "t", "n", "nticipating"}
# The article "A" was eaten -> "A " + word.
ARTICLE_WORDS = {"teacher", "student", "school", "principal", "university", "purposeful"}

EXPORT_SQL = """\
SELECT coalesce(json_agg(r ORDER BY r.id), '[]')
FROM (
  SELECT q.id, q.grand_quiz_id, q.training_module_id, q.order_index, q.question_text, q.options, q.correct_option,
         CASE WHEN q.grand_quiz_id IS NOT NULL THEN 'module exam' ELSE 'quick check' END AS served_in,
         coalesce(c.title, 'Module ' || (g.source_quiz_id - 900)) AS module, m.title AS unit
  FROM training_questions q
  LEFT JOIN training_modules m ON m.id = q.training_module_id
  LEFT JOIN training_courses c ON c.id = m.course_id
  LEFT JOIN training_grand_quizzes g ON g.id = q.grand_quiz_id
  WHERE q.is_active
    AND (coalesce(btrim(q.question_text), '') = ''
         OR (jsonb_typeof(q.options) = 'array' AND q.options->>0 ~ '^[a-z]' AND strpos(q.options->>0, ' A. ') > 0))
) r"""

LEFT_SQL = ("SELECT count(*) AS active_blank_stems_left FROM training_questions "
            "WHERE is_active AND coalesce(btrim(question_text), '') = '';")


class Refuse(Exception):
    """The row does not fit the pattern; it is printed and left alone."""


class AlreadyHasStem(Exception):
    """Not a blank-stem row."""


def _blank(text):
    return not (text or "").strip()


def split_glued(a0):
    """'<words minus their A> A. <option A>' -> ('<A-words>', '<option A>'), or Refuse."""
    if not isinstance(a0, str):
        raise Refuse("option A is not text")
    if a0.count(MARKER) != 1:
        raise Refuse(f"{a0.count(MARKER)} ' A. ' markers in option A, expected 1")
    head, tail = (s.strip() for s in a0.split(MARKER))
    if not head:
        raise Refuse("nothing before ' A. '")
    if not tail:
        raise Refuse("nothing after ' A. '")
    if not re.match(r"[a-z]", head):
        raise Refuse("option A starts with a capital, so no 'A' was cut off")
    word = re.match(r"[a-z]+", head).group(0)
    if word in JOIN_WORDS:
        return "A" + head, tail
    if word in ARTICLE_WORDS:
        return "A " + head, tail
    raise Refuse(f"first word {word!r} is in neither reviewed list")


def _options(row):
    opts = row.get("options")
    if not isinstance(opts, list) or len(opts) != 4 or not all(isinstance(o, str) for o in opts):
        raise Refuse("options is not a list of four strings")
    return opts


def repair_row(row):
    """A blank-stem row -> (question_text, options)."""
    if not _blank(row.get("question_text")):
        raise AlreadyHasStem(row.get("id"))
    opts = _options(row)
    stem, option_a = split_glued(opts[0])
    return stem, [option_a] + opts[1:]


def repair_tail(row):
    """A row whose stem is intact but whose last stem line sits on option A -> (question_text, options)."""
    if _blank(row.get("question_text")):
        raise Refuse("blank stem: repair_row's case")
    opts = _options(row)
    line, option_a = split_glued(opts[0])
    return row["question_text"].rstrip() + "\n" + line, [option_a] + opts[1:]


def plan(rows):
    out = {"fixed": [], "tails": [], "refused": []}
    for row in rows:
        try:
            if _blank(row.get("question_text")):
                stem, opts = repair_row(row)
                out["fixed"].append({**row, "new_stem": stem, "new_options": opts})
            else:
                stem, opts = repair_tail(row)
                out["tails"].append({**row, "new_stem": stem, "new_options": opts})
        except Refuse as e:
            out["refused"].append({**row, "reason": str(e)})
    return out


def _norm(s):
    return re.sub(r"\s+", " ", s or "").strip()


def source_stems(content):
    """The fixed seed's reading of the partner's workbooks: {(options A-D, key): [stem, ...]}."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "2026-10-23-isaps-level2-seed.py")
    spec = importlib.util.spec_from_file_location("isaps_level2_seed", path)
    seed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(seed)
    idx = {}
    for m in seed.collect(content)["modules"]:
        for it in m["formative"] + m["mcq"]:
            idx.setdefault((tuple(_norm(o) for o in it["options"]), str(it["key"])), []).append(it["stem"])
    return idx


def with_source_line_breaks(p, idx):
    """Give each repaired stem the source's line breaks when the source item is unique and its words match."""
    n = 0
    for it in p["fixed"] + p["tails"]:
        stems = idx.get((tuple(_norm(o) for o in it["new_options"]), str(it.get("correct_option"))), [])
        if len(stems) == 1 and _norm(stems[0]) == _norm(it["new_stem"]) and stems[0] != it["new_stem"]:
            it["new_stem"] = stems[0]
            n += 1
    return n


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def _values(items, with_stem):
    lines = []
    for i, p in enumerate(items):
        cast = "::bigint" if i == 0 else ""
        cols = [f"{int(p['id'])}{cast}", lit(p["new_stem"]), lit(p["new_options"][0]), lit(p["options"][0])]
        if with_stem:
            cols.append(lit(p["question_text"]))
        lines.append("  (" + ", ".join(cols) + ")")
    return ",\n".join(lines)


def render_sql(p, with_tails=False):
    fixed = p["fixed"]
    tails = p["tails"] if with_tails else []
    sql = [
        "-- bd-arghnv.3 — I-SAPS Level 2 blank-stem repair, generated by",
        "-- scripts/migrations/2026-11-02-isaps-l2-blank-stem-repair.py. Do not hand-edit; regenerate.",
        f"-- {len(fixed)} blank-stem rows" + (f" + {len(tails)} glued-tail rows" if tails else "")
        + f"; {len(p['refused'])} refused (not written).",
        "-- Idempotent: each row is written only while its stem and option A still hold what was read.",
        "BEGIN;",
    ]
    if fixed:
        sql += [
            "UPDATE training_questions q",
            "SET question_text = v.stem,",
            "    options = jsonb_set(q.options, '{0}', to_jsonb(v.option_a))",
            "FROM (VALUES",
            _values(fixed, with_stem=False),
            ") AS v(id, stem, option_a, was_option_a)",
            "WHERE q.id = v.id",
            "  AND q.is_active",
            "  AND coalesce(btrim(q.question_text), '') = ''",
            "  AND q.options->>0 = v.was_option_a;",
        ]
    if tails:
        sql += [
            "UPDATE training_questions q",
            "SET question_text = v.stem,",
            "    options = jsonb_set(q.options, '{0}', to_jsonb(v.option_a))",
            "FROM (VALUES",
            _values(tails, with_stem=True),
            ") AS v(id, stem, option_a, was_option_a, was_stem)",
            "WHERE q.id = v.id",
            "  AND q.is_active",
            "  AND q.question_text = v.was_stem",
            "  AND q.options->>0 = v.was_option_a;",
        ]
    sql += [LEFT_SQL, "COMMIT;", ""]
    return "\n".join(sql)


def _letter(key):
    try:
        return chr(64 + int(str(key).split(",")[0]))
    except (TypeError, ValueError):
        return ""


REVIEW_COLUMNS = ["status", "id", "served_in", "module", "unit", "order_index", "question",
                  "option_a", "option_b", "option_c", "option_d", "correct_option", "correct_letter",
                  "was_question", "was_option_a"]


def review_rows(p, with_tails=False):
    rows = []
    groups = [("REPAIR", p["fixed"]), ("APPLY" if with_tails else "PROPOSED (not written; needs a go)", p["tails"]),
              (None, p["refused"])]
    for status, items in groups:
        for it in items:
            opts = it.get("new_options") or it.get("options") or []
            opts = list(opts) + [""] * (4 - len(opts))
            rows.append({
                "status": status or f"REFUSED: {it['reason']}",
                "id": it.get("id"),
                "served_in": it.get("served_in", ""),
                "module": it.get("module", ""),
                "unit": it.get("unit") or "",
                "order_index": it.get("order_index", ""),
                "question": it.get("new_stem", ""),
                "option_a": opts[0], "option_b": opts[1], "option_c": opts[2], "option_d": opts[3],
                "correct_option": it.get("correct_option", ""),
                "correct_letter": _letter(it.get("correct_option")),
                "was_question": it.get("question_text") or "",
                "was_option_a": (it.get("options") or [""])[0],
            })
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--export-sql", action="store_true", help="print the read-only query that exports the rows")
    ap.add_argument("--rows", help="the JSON the export query returned")
    ap.add_argument("--csv", help="write the review CSV here")
    ap.add_argument("--sql", help="write the repair SQL here")
    ap.add_argument("--content", help="the partner's Level 2 folder: take each stem's line breaks from it")
    ap.add_argument("--with-glued-tails", action="store_true",
                    help="also write the rows whose stem is intact but whose last line sits on option A")
    a = ap.parse_args()
    if a.export_sql:
        print(EXPORT_SQL)
        return
    if not a.rows:
        sys.exit("--rows is required (or --export-sql)")
    rows = json.load(open(a.rows, encoding="utf-8"))
    p = plan(rows)
    if a.content:
        print(f"line breaks restored from the source: {with_source_line_breaks(p, source_stems(a.content))}")
    print(f"blank stems to repair: {len(p['fixed'])}   glued tails: {len(p['tails'])}"
          f" ({'written' if a.with_glued_tails else 'proposed only'})   refused: {len(p['refused'])}")
    for r in p["refused"]:
        print(f"  REFUSED {r['id']}: {r['reason']} | option A: {str((r.get('options') or [''])[0])[:90]!r}")
    for t in p["tails"]:
        print(f"  GLUED TAIL {t['id']}: option A {t['options'][0][:70]!r}")
    if a.csv:
        with open(a.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=REVIEW_COLUMNS)
            w.writeheader()
            w.writerows(review_rows(p, with_tails=a.with_glued_tails))
        print(f"review CSV -> {a.csv}")
    if a.sql:
        with open(a.sql, "w", encoding="utf-8") as f:
            f.write(render_sql(p, with_tails=a.with_glued_tails))
        print(f"repair SQL -> {a.sql}")


if __name__ == "__main__":
    main()
