#!/usr/bin/env python3
"""
Score one generated exam paper against the v1 assessment rubric (bd-60021).

    python3 score.py --exam <exam.json> --subject english --grade 3 \
        [--requested 15] [--total-marks 26] [--book-content pages.txt] \
        [--answer-key key.json] [--judge google/gemini-3.1-pro-preview] [--out report.json]

Composite = mean(judge rubric %, deterministic soft-QA %). The judge is PINNED
per batch and recorded in the report: comparability requires one judge across a
batch, and the gate's bar shifts by judge.

Never generates. Only judges.
"""
import argparse
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rubric_v1 as R                                   # noqa: E402
from prompt import build_reviewer_prompt                # noqa: E402
from qa_checks import run_checks                        # noqa: E402
from gate import gate                                   # noqa: E402

OR_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_JUDGE = "google/gemini-3.1-pro-preview"
KEY_ENVS = ("OPENROUTER_API_KEY", "OPENROUTER_ICT_ENRICH_KEY")


def api_key():
    for e in KEY_ENVS:
        if os.environ.get(e):
            return os.environ[e]
    for path in (".env", "../../../.env"):
        p = os.path.join(HERE, path)
        if os.path.exists(p):
            for line in open(p, encoding="utf-8"):
                for e in KEY_ENVS:
                    if line.startswith(e + "="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit(f"no API key: set one of {', '.join(KEY_ENVS)}")


def call_judge(judge, system, user, key):
    body = {
        "model": judge,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        OR_URL, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as resp:
        d = json.load(resp)
    return d["choices"][0]["message"]["content"], d.get("usage", {})


def tally(review):
    """Sum the judge's ratings into (total, denominator, flags).

    Three rules, each one a lesson from the LP reviewer:
      * a justified notAssessable shrinks the denominator — it is not scored 1;
      * an UNJUSTIFIED notAssessable (no contextMissing) reverts to 1, so the
        escape hatch fails closed (SP-068);
      * a per-item check averages its item ratings into one check score, and
        every below-standard item is named in the flags.
    """
    total = denom = 0
    flags = []
    for crit in review.get("criteria", review.get("scores", [])):
        for chk in crit.get("checks", crit.get("subCriteria", [])):
            cid = chk.get("id") or chk.get("name") or "?"
            items = [i for i in (chk.get("items") or [])
                     if isinstance(i, dict) and isinstance(i.get("rating"), (int, float))]
            r = chk.get("rating", chk.get("score"))

            if chk.get("notAssessable") and r is None:
                if chk.get("contextMissing"):
                    flags.append(f"not-assessable: {cid} ({chk['contextMissing']})")
                    continue
                flags.append(f"unjustified not-assessable -> scored 1: {cid}")
                total += 1
                denom += R.SCALE_MAX
                continue

            if items and r is None:
                r = sum(i["rating"] for i in items) / len(items)

            if r is None:
                flags.append(f"missing rating -> scored 1: {cid}")
                r = 1

            total += int(round(float(r)))
            denom += R.SCALE_MAX
            if int(round(float(r))) <= 2:
                flags.append(f"LOW {cid}={int(round(float(r)))}")
            for i in items:
                if i["rating"] <= 2:
                    flags.append(f"{cid}#{i.get('n', '?')}={int(i['rating'])}: "
                                 f"{str(i.get('why', ''))[:80]}")
    return total, denom, flags


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--exam", required=True)
    ap.add_argument("--subject", required=True)
    ap.add_argument("--grade", type=int, required=True)
    ap.add_argument("--requested", type=int, default=None)
    ap.add_argument("--total-marks", type=float, default=None)
    ap.add_argument("--book-content", default=None)
    ap.add_argument("--answer-key", default=None)
    ap.add_argument("--slo-map", default=None)
    ap.add_argument("--judge", default=DEFAULT_JUDGE)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    exam = json.load(open(a.exam))
    qa = run_checks(exam, requested_count=a.requested, total_marks=a.total_marks)

    ctx = set()
    if a.book_content:
        ctx.add(R.CONTEXT_BOOK)
    if a.answer_key:
        ctx.add(R.CONTEXT_ANSWER_KEY)
    if a.slo_map:
        ctx.add(R.CONTEXT_SLO)

    system = build_reviewer_prompt(a.subject, a.grade, available_context=ctx)
    user = [f"GRADE: {a.grade}", f"SUBJECT: {a.subject}"]
    if a.requested:
        user.append(f"QUESTIONS REQUESTED BY THE TEACHER: {a.requested}")
    user.append(f"\nEXAM PAPER (JSON as generated):\n{json.dumps(exam, ensure_ascii=False, indent=1)}")
    if a.book_content:
        user.append(f"\nTEXTBOOK PAGES SUPPLIED TO THE GENERATOR:\n{open(a.book_content).read()}")
    if a.answer_key:
        user.append(f"\nANSWER KEY DOCUMENT:\n{open(a.answer_key).read()}")
    if a.slo_map:
        user.append(f"\nSLO MAP FOR THIS CHAPTER:\n{open(a.slo_map).read()}")

    raw, usage = call_judge(a.judge, system, "\n".join(user), api_key())
    try:
        review = json.loads(raw)
    except json.JSONDecodeError:
        review = json.loads(raw[raw.find("{"):raw.rfind("}") + 1])

    total, denom, flags = tally(review)
    judge_pct = round(100 * total / denom, 1) if denom else 0.0
    composite = round((judge_pct + qa["soft_pct"]) / 2, 1)

    out = {
        "exam": os.path.basename(a.exam),
        "subject": a.subject, "grade": a.grade,
        "judge": a.judge,
        "judge_pct": judge_pct, "soft_qa_pct": qa["soft_pct"], "composite_pct": composite,
        "total": total, "max": denom, "rubric_max": R.grand_total_max(),
        "qa_hard_pass": qa["hard_pass"], "qa_hard_failures": qa["hard_failures"],
        "qa_soft_failures": qa["soft_failures"],
        "item_count": qa["item_count"], "word_units": qa["word_units"], "marks_sum": qa["marks_sum"],
        "flags": flags, "blocking": review.get("blocking", []),
        "summary": review.get("summary", ""),
        "usage": usage, "review": review,
    }
    out["gate"] = gate(out)

    dst = a.out or (os.path.splitext(a.exam)[0] + ".score.json")
    json.dump(out, open(dst, "w"), ensure_ascii=False, indent=2)
    verdict = "PASS" if out["gate"]["pass"] else "FAIL"
    print(f"{verdict}  composite {composite}%  (judge {judge_pct}% · soft-QA {qa['soft_pct']}%)  "
          f"hard-QA {'ok' if qa['hard_pass'] else 'FAIL'}  -> {dst}")
    for r in out["gate"]["reasons"]:
        print(f"   · {r}")
    return 0 if out["gate"]["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
