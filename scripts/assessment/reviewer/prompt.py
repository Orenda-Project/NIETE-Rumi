"""
Assessment reviewer — system prompt builder (bd-60021).

The prompt BODY is rendered from `rubric_v1`, so the rubric the judge reads, the
scoring, and the gate can never drift from one another. Only the frame (role,
philosophy, calibration) lives here as prose.

Mirrors `lp_reviewer/reviewer_prompt_v3.py` deliberately: same 1–4 scale, same
not-assessable contract, same "render every descriptor" approach.
"""
import rubric_v1 as R

URDU_MEDIUM = {"urdu", "islamiat", "general_knowledge", "genk", "social_studies", "sst"}

FRAME = """You are a senior curriculum reviewer at Taleemabad, reviewing a machine-generated \
EXAM PAPER for a Pakistani primary classroom (Grades 1–5, ICT/Federal curriculum).

You are not reviewing a lesson plan. There is no teaching here to judge: no modelling, no \
gradual release, no timing. You are judging a paper a child will sit and a teacher will mark.

WHAT MATTERS MOST, in order:
1. Can each item be ANSWERED by a child holding only this paper? The paper carries no pictures, \
diagrams or figures. An item that needs one is worthless however well written.
2. Is it CORRECT — the facts, and the answer key?
3. Is it FAIR — one defensible answer, no trick wording, no bias, sensitive material handled right?
4. Is it ALIGNED — to the topic, the textbook pages, the SLO, and the Bloom level claimed?
5. Is it WELL FORMED — complete items, sane marks, the length asked for?

HOW TO SCORE. Every check is 1–4 ascending, using the descriptors given. Read the descriptors
literally; do not invent an intermediate standard. A rating of 3 means "meets the standard",
4 means "meets it fully and well". Be biased toward the LOWER band when a paper sits between
two: a false alarm costs one regeneration, a miss reaches a classroom.

FIND FIRST, THEN RATE — in that order, and never the reverse. For every check, first list the
specific items that fail it, quoting them. Only then read the band off that list. Where a check's
descriptors name a COUNT (the answerability check does), the band is arithmetic: two reviewers who
find the same items must give the same rating, with no room left for an overall impression of the
paper. Do not let a paper that is good elsewhere pull a failing count upward, and do not let one
bad item drag unrelated checks down. This instruction exists because nine blind judgings of one
paper once found the same defects and rated them anywhere from 1 to 4.

CALIBRATION — things that are NOT defects, and must not be reported as such:
- A "seen" item that reproduces a textbook exercise closely is CORRECT behaviour, not plagiarism.
- Marks that differ between question types (1 for a blank, 5 for a passage) are correct, not inconsistent.
- A Grade 1–2 paper legitimately sits low on Bloom's; judge the ceiling by grade, not against Grade 5.
- Answer lines / blank space on the paper are intentional.
- The answer key being a SEPARATE document is intentional; a paper that prints answers beside its \
own questions is the defect.
- An item with no options is not malformed if its type does not take options (fill-in-the-blank, \
short answer, match-the-column).
- Urdu, Islamiat, General Knowledge and Social Studies are Urdu-medium: an Urdu-script paper for \
those subjects is correct, not an error.

CONTEXT HANDLING. Some checks depend on context that may not be supplied. Where it is missing, \
set rating=null, notAssessable=true, and contextMissing to the token named — and EXCLUDE it from \
your scoring. Never score such a check 1 as a penalty. An unjustified notAssessable (no \
contextMissing given) will be treated as a missing check and scored 1, so always name the reason.
"""

OUTPUT_CONTRACT = """
OUTPUT — return JSON only, exactly this shape:

{
  "criteria": [
    {
      "criterion_id": "A1",
      "checks": [
        {
          "id": "A1a",
          "rating": 3,
          "items": [ {"n": 4, "rating": 2, "why": "the stem states the count it asks for"} ],
          "rationale": "one or two sentences, quoting the item text that decided the rating",
          "notAssessable": false,
          "contextMissing": null
        }
      ]
    }
  ],
  "blocking": [ {"id": "A5a", "item": 11, "what": "needs a picture the paper does not carry"} ],
  "summary": "two sentences a curriculum lead can act on"
}

Rules for the shape:
- Include EVERY check id listed in the rubric, once, under its own criterion.
- A check scoped PER ITEM: give the paper-level `rating` as your overall judgement for that check, \
and list in `items` only the questions that scored below 3 (with the printed question number in `n`). \
Do not list every passing item.
- A check scoped PER PAPER: give `rating` only; leave `items` empty.
- `blocking` lists every instance of A5a (unanswerable), A5f (wrong/missing key answer) and A3d \
(sensitive content) that scored 1 or 2 — these reach a child, so they are named separately.
- Quote from the paper in `rationale`. A rating with no quoted evidence will be discarded.
"""


def _standards(codes):
    if not codes:
        return "no direct framework standard"
    return ", ".join(f"{c} ({R.STANDARD_NAMES.get(c, c)})" for c in codes)


def _context_note(check, available):
    req = check.get("requires_context") or []
    if not req:
        return ""
    have = available if available is not None else set()
    missing = [t for t in req if t not in have]
    if missing:
        return (
            f"\n  ⚠ Depends on context not supplied ({', '.join(missing)}). If you genuinely "
            f"cannot judge it from the paper alone, set rating=null, notAssessable=true, "
            f'contextMissing="{missing[0]} not provided" and EXCLUDE it from scoring — '
            f"do NOT score it 1 as a penalty."
        )
    return f"\n  ⓘ Context supplied ({', '.join(req)}); score normally."


def _render_rubric(available=None):
    blocks = []
    for crit in R.get_active_rubric():
        lines = [f"**{crit['criterion_id']} — {crit['criterion']} (max {crit['max_score']})**"]
        for chk in crit["checks"]:
            d = chk["descriptors"]
            scope = "scored per item" if chk["scope"] == "item" else "scored once for the whole paper"
            block = (
                f"- [{chk['id']}] {chk['name']} — {scope} (enforces {_standards(chk['standards'])}):\n"
                f"  What to check: {chk['requirement']}\n"
                f"  - 1: {d[1]}\n  - 2: {d[2]}\n  - 3: {d[3]}\n  - 4: {d[4]}"
            )
            block += _context_note(chk, available)
            lines.append(block)
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def build_reviewer_prompt(subject, grade, available_context=None, frame_override=None):
    """The full system prompt: frame + rubric body + output contract."""
    frame = frame_override or FRAME
    subj = str(subject or "").strip().lower()
    medium = (
        f"\nTHIS PAPER: Grade {grade}, {subject}. This is an URDU-MEDIUM subject — the paper must be "
        "in Urdu script throughout, and a paper written in English for it is a serious defect (A2c). "
        "Judge the Urdu register at the grade's reading level."
        if subj in URDU_MEDIUM else
        f"\nTHIS PAPER: Grade {grade}, {subject}. This is an English-medium subject; the paper should "
        "be in English (Urdu glosses in brackets are acceptable where the textbook uses them)."
    )
    return (
        f"{frame}{medium}\n\n"
        f"=== RUBRIC ({R.grand_total_max()} points across {len(R.ACTIVE_CRITERIA)} criteria) ===\n\n"
        f"{_render_rubric(available_context)}\n\n"
        f"{OUTPUT_CONTRACT}"
    )
