"""The rubric and frame for a 995 — a student worksheet, not a teacher lesson.

Measured 19 Sep 2026 (bd-6ss5g, judge anthropic/claude-opus-5):
`grade_1_english_ch1_seg995` scored ZERO 1-ratings and ZERO 2-ratings — the
judge found nothing wrong with it — and still failed the production gate at
composite 90.55. Two independent causes, and the second is the worse one.

1. THE RUBRIC ASKED A WORKSHEET LESSON QUESTIONS. Eighteen checks came back
   `notAssessable` for one reason in eighteen wordings: there is no teaching
   phase here to look at. The denominator fell from 220 to 148 where the six
   sibling lessons sat at 204-216. The exclusions were not scattered — they
   cluster on C2 Instructional Flow, 48 of the lesson rubric's 220 points, so
   what survived was SKEWED, not merely smaller.

2. THE FRAME TOLD THE JUDGE TO FAIL IT. The default `_FRAME` lists "a chapter
   overview or full-chapter assessment" among the unit-plan red flags and says
   to treat it as a 0F failure and "do NOT reward the quality of the
   sub-lessons inside such a document". A 995 IS a full-chapter assessment. The
   lesson frame is not neutral about worksheets; it is against them. Swapping
   the rubric and keeping the frame would have fixed half the bug and hidden
   the rest.

So both are replaced here, together.

WHAT IS NOT DONE. Only English's C8 was measured, and its 8B/9A/9D/9E came
back unassessable too. The other subjects' C8 checks are NOT guessed at — they
are kept whole, and whatever a worksheet cannot answer will still surface as
`notAssessable`. A visible gap beats an invented proxy; bd-cds95 carries it.

The seam is `build_reviewer_prompt(active_override=..., frame_override=...)`,
the same one `build_multigrade_c9_prompt` uses. Nothing in the shared skill
tree is edited, so the lesson path and the other lineages that consume it are
untouched.
"""
import copy

import gate4

_rubric = gate4.reviewer("reviewer_rubric_v3")

# Every id here was reported `notAssessable` by the judge on the live 995, each
# with a reason of the same shape: a sat paper has no teaching phase. Pinned at
# fourteen by the tests — widening this list is how a rubric stops measuring.
LESSON_ONLY = frozenset((
    "0B",   # Hook Present & Non-Empty
    "0C",   # Explanation Present & Non-Empty
    "0E",   # Conclusion Present & Non-Empty
    "0F",   # Single-Lesson Scope (One Class Period)
    "2A",   # Opening Hook Relevant to SLO
    "2C",   # Modelling / Demonstration with Think-Aloud
    "2F",   # CFU Questions — Placed, Spaced & Open-Ended
    "2J",   # Gradual Release — I Do -> We Do -> You Do
    "2K",   # Prior Knowledge Activation
    "2L",   # Active Retrieval (Warm-Up Recall)
    "3A",   # Appropriately Timed Sections
    "3B",   # Adequate Time for Practice & Explanation
    "5B",   # Peer Interaction Opportunities
    "5D",   # Exit Ticket — New Context, Success Criteria & Self-Prediction
))

ASSESSMENT_CRITERION = "Assessment Quality"


def _check(cid, name, requirement, d1, d2, d3, d4):
    """One check in the shape `_render_rubric` and `_context_note` read."""
    # Integer keys: `_render_rubric` reads `d[1]`..`d[4]`, not `d["1"]`. A
    # string-keyed descriptor map is a KeyError at prompt-build time — i.e. at
    # the top of a paid batch, with every artefact's cost already committed.
    return {"id": cid, "name": name, "requirement": requirement,
            "descriptors": {1: d1, 2: d2, 3: d3, 4: d4},
            "standards": [], "requires_context": [], "status": "New (bd-cds95 — assessment rubric)"}


# The questions a worksheet CAN answer. Written against what the deterministic
# suites already enforce structurally (wslint/wssoft check counts, variety,
# space and mark badges) — these ask whether the paper is a good ASSESSMENT,
# which no count can tell you.
ASSESSMENT_CHECKS = [
    _check(
        "AS1", "SLO Coverage Across the Chapter",
        "Every SLO taught in the chapter must be assessed by at least one "
        "item, and no item may test content the chapter did not teach.",
        "Most chapter SLOs are untested, or items test untaught content.",
        "Some SLOs are covered; at least one taught SLO has no item, or one "
        "item goes outside the chapter.",
        "Every chapter SLO has at least one item and nothing tests untaught "
        "content.",
        "Every SLO is covered with weight proportional to the teaching time "
        "it received, so the paper reports the chapter rather than a corner."),
    _check(
        "AS2", "Difficulty Spread",
        "Items must span recall through application — a paper pitched at one "
        "band reports nothing about who is where.",
        "Every item sits at one band (usually bare recall).",
        "Two bands present but heavily skewed; the paper cannot separate a "
        "secure child from a struggling one.",
        "Recall, understanding and application are all present in usable "
        "proportion.",
        "The spread is deliberate and laddered — an early item every child "
        "can start, and at least one that applies the SLO in a NEW context."),
    _check(
        "AS3", "Item Format Fits What Is Being Assessed",
        "The format must match the SLO. A production skill (writing, "
        "explaining, computing) cannot be assessed by recognition alone.",
        "Formats contradict the SLOs — production skills tested by MCQ only.",
        "Mostly recognition formats where the chapter taught production.",
        "Each item's format can actually evidence its SLO.",
        "Formats are chosen per SLO and the paper's variety follows from that "
        "rather than from a quota."),
    _check(
        "AS4", "Instructions a Child Can Follow Alone",
        "Each item must be doable by a child sitting alone: complete "
        "instruction, the child's register, and a worked example wherever the "
        "format is new.",
        "Instructions are missing, or assume a teacher will explain the task.",
        "Instructions present but above the grade's reading level, or a new "
        "format is introduced with no example.",
        "Every item states what to do in language the grade can read, with an "
        "example where the format is unfamiliar.",
        "Instructions are unambiguous, consistently phrased across items, and "
        "a child who missed the lesson could still attempt the paper."),
    _check(
        "AS5", "Markability and the Answer Key",
        "The answer key must give an unambiguous correct answer per item (or "
        "an explicit acceptable range for open items), with marking guidance "
        "and the common errors; mark badges must sum to the stated total.",
        "No key, or answers that do not match the items.",
        "Key present but open items have no acceptable range, or the badges "
        "do not sum to the total.",
        "Every item has a defensible answer, badges sum, guidance is present.",
        "Guidance names the common errors and says what partial credit looks "
        "like, so two teachers would mark the same paper the same way."),
    _check(
        "AS6", "Space and Layout for the Grade",
        "Writing space must match the length of the expected answer and the "
        "grade's handwriting size; nothing may require writing in a margin.",
        "No space to answer, or space bearing no relation to the task.",
        "Space present but cramped for the grade, or uneven across items.",
        "Each item's space fits its expected answer at the grade's hand size.",
        "Layout also supports the child's working — room to show a method, "
        "and items grouped so the page is not visually crowded."),
    _check(
        "AS7", "Reading Load Does Not Mask the Skill",
        "The paper's own reading demand must sit at or below the grade's "
        "decoding level, so an item measures its SLO rather than reading "
        "ability. Decisive at Grades 1-2 and for Maths word problems.",
        "The paper cannot be read by the grade it is for; it measures "
        "decoding whatever the SLOs say.",
        "Several items carry vocabulary or sentence length above the grade.",
        "Reading demand is at or below grade level throughout.",
        "Load is deliberately minimised — picture or symbol support where the "
        "SLO is not itself a reading SLO, so the construct stays clean."),
]


def assessment_rubric(subject, multigrade=False):
    """The lesson rubric with the lesson-only checks removed, plus C8-assessment.

    Deep-copied before filtering. `get_active_rubric` shares its check lists
    with module-level state, so filtering in place would corrupt the lesson
    rubric for every later caller in the same process — including the sibling
    lessons of the very batch this is scoring.
    """
    active = copy.deepcopy(_rubric.get_active_rubric(subject, multigrade))
    out = []
    for crit in active:
        crit["checks"] = [k for k in crit["checks"]
                          if k["id"] not in LESSON_ONLY]
        if not crit["checks"]:
            continue
        crit["max_score"] = _rubric.SCALE_MAX * len(crit["checks"])
        out.append(crit)
    out.append({
        "criterion": ASSESSMENT_CRITERION,
        "checks": copy.deepcopy(ASSESSMENT_CHECKS),
        "max_score": _rubric.SCALE_MAX * len(ASSESSMENT_CHECKS),
        "gate": False,
    })
    for i, crit in enumerate(out):
        crit["criterion_id"] = "C%d" % i
    return out


def grand_total_max(subject, multigrade=False):
    """Maximum grand total for a fully-assessable worksheet review."""
    return sum(c["max_score"] for c in assessment_rubric(subject, multigrade))


# The frame the judge is given INSTEAD of `_FRAME`. The role, the philosophy,
# the context-missing convention and the output contract are carried over
# because the parser depends on them; the lesson guardrails are replaced with
# the ones a paper needs. The removed red-flag line is the second half of the
# bug this module exists for — see the note at the top.
FRAME = """\
### ROLE AND CONTEXT
You are an expert AI Assessment Evaluator for primary-grade classrooms in Pakistan. You have deep
expertise in classroom assessment design, curriculum alignment, and the realities of Pakistani
government schools (limited resources, mixed teacher skill, Urdu/English medium).

The artefact below is a STUDENT WORKSHEET — a chapter-end paper a child sits, alone, with a pen.
It is NOT a teacher lesson plan and must NOT be judged as one. It legitimately has no hook, no
modelling, no I-Do/We-Do/You-Do, no phase timings, no peer interaction and no exit ticket: the
worksheet IS the summative task. Absence of teaching structure is the correct shape for this
artefact, never a defect. Covering a whole chapter is likewise correct and is not a scope failure.

Judge it as an assessment: does it measure what the chapter taught, can a child sitting alone
attempt it, and can a teacher mark it consistently?

### EVALUATION PHILOSOPHY
Be rigorous but fair. Do NOT invent improvements to fill space. If the worksheet genuinely meets a
criterion (scores 3-4 on all its sub-criteria), acknowledge its strengths and leave that
criterion's improvements array EMPTY. Only flag genuine gaps where sub-criteria score 1-2.

### HOW TO SCORE
- Score EVERY sub-criterion on the 1-4 scale using the descriptors below (4 = best).
- The Structural Completeness criterion is a GATE — evaluate it first.
- Read the whole worksheet AND its answer key before scoring. Cite specific items in each
  rationale, by their number.
- Use the IMAGES section (if provided in the user prompt) to judge layout and visual-support checks.

### CROSS-CUTTING GUARDRAILS (apply throughout)
- Judge the ITEMS, not the absence of teaching. "No explanation of the concept" is not a finding
  on a worksheet.
- An item that cannot be marked from the key without a judgement call the key does not make is a
  markability failure, however good the question is.
- Reading load is a construct threat, not a style note: where a child could fail an item for a
  reason other than the SLO it tests, say so and score AS7 accordingly.
- Directive, concrete instructions to the child ("Circle the correct answer", "Write two
  sentences") are GOOD. Vagueness ("Do the activity") is not.
- Do not reward decoration. Pictures earn credit only where they carry information the child needs
  or reduce reading load on a non-reading SLO.

### CONTEXT-DEPENDENT CHECKS
Some checks depend on context that may be absent (e.g. the textbook pages, or the chapter's SLO
list). Rule: score the check from the worksheet itself wherever you can. ONLY when a check
genuinely cannot be judged without the missing context, set its "rating" to null, add
"notAssessable": true and "contextMissing": "<token> not provided", and EXCLUDE it from that
criterion's denominator. NEVER score a check 1 just because context was not supplied. Checks you
can judge from the worksheet must be scored normally.

### IMPROVEMENTS — STRICT RULES
- A criterion's "improvements" array MUST be empty [] if all its sub-criteria score 3-4.
- Only add improvements for sub-criteria that scored 1-2; each MUST reference that sub-criterion
  by name and move it toward the higher descriptor.
- Each improvement object MUST have exactly these keys:
  {"subCriterion": "<name of the 1-2 sub-criterion>", "currentScore": "<1 or 2>",
   "targetScore": "<3 or 4>", "action": "<ADD | REPLACE | MODIFY | CLARIFY>",
   "location": "<Item N | Instructions | Answer Key | Layout | Marks | ...>",
   "instruction": "<precise, actionable change tied to the rubric descriptor>"}

### OUTPUT
Return ONLY a valid JSON object (no markdown fences, no prose outside the JSON), following the
OUTPUT FORMAT below exactly. Every sub-criterion MUST show its id, name, and rating. Return EVERY
sub-criterion for EVERY criterion — the per-criterion list is fixed; NEVER omit one. A check you
cannot judge (even from the worksheet) stays in the list with rating null, notAssessable true, and
contextMissing — it is flagged, never dropped."""
