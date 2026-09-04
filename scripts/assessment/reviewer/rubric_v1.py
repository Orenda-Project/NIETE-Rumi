"""
Assessment Generator Reviewer — v1 data-driven rubric (bd-60021).

TWO SOURCES, MERGED. Neither alone judges an exam paper.

  1. "Exam Generator Reviewer" sheet (1_2lFLcO4fS1iv8vE1sCLCdc7lb73C480TJLrH2EtOQc),
     tab `v2` — 15 checks in 5 categories, 1–4 scale, each already mapped to the
     Taleemabad Standard(s) it enforces, with the team's own "no direct standard"
     gaps recorded. This is the ITEM-QUALITY half: is this question correct, clear,
     fair, at the right cognitive level, and well formed?

  2. The LP pedagogical reviewer (`curriculum-baked-lesson-plans/reference/lp_reviewer/
     reviewer_rubric_v3.py`) — 51 checks in 9 criteria, the same 1–4 scale and the
     same standard codes. Most of it is lesson-plan machinery (gradual release,
     think-aloud, transitions, timing) and does NOT apply to an exam. Four of its
     criteria do, and they carry the checks the exam sheet has no equivalent for:
     textbook grounding (1D), cultural representation (C6), internal consistency
     (7A), and bias/balance (7C).

  Plus the two defects our own eval runs found that NEITHER rubric checks:
  answerability without pictures (Grade 1 English, 2026-09-02: "write the name of
  each object under its picture" on a paper with no pictures) and mark integrity
  (Flash Lite reaching a question count with one 4-word item while Pro wrote 13
  questions for the same request).

WHAT WE DELIBERATELY DO NOT SCORE. The exam sheet's standards tab lists 24
standards and its own coverage report scores the v2 rubric at 35%. Most of the
"not covered" ones are NOT reviewer checks at all — P2/P2a/P2b (untaught content),
P3/P3a/P3b (lesson-state awareness), P4/P4a/P4b/P4c (spaced retrieval), P5c
(coverage report), P3c (≥2 items per SLO) all need data the generator does not
have yet: a per-class taught-SLO history and an item bank. A judge cannot score
them from the paper alone, and a rubric that pretends to is a rubric that lies.
They are listed in NOT_YET_ASSESSABLE below so the gap stays visible rather than
being quietly dropped, and each names the data it waits on.

Scale is 1–4 ascending (4 = best), matching both sources so a score here is
directly comparable with an LP score. Each check carries a stable ID, its 1/2/3/4
descriptors, the standard codes it enforces, its scope (`item` = scored per
question, `paper` = scored once for the whole paper), and what it needs to be
assessable at all.
"""

SCALE_MAX = 4

# Standard names — the parents from the Taleemabad Standard Framework. Codes that
# appear in the exam sheet's v2 tab and in the LP rubric use the SAME names, which
# is what makes the two instruments comparable.
STANDARD_NAMES = {
    "P1c": "Gradual Release — Independent Practice",
    "P3d": "Cross-Lesson Scaffold Fading",
    "P5": "Standards Alignment",
    "P5a": "Standards Alignment — SNC Tagging",
    "P5b": "LP–Exam Coherence",
    "P7": "Assessment Rigour",
    "P7b": "Assessment Rigour — Objective–Assessment Alignment",
    "P7c": "Assessment Rigour — CFU Rigour by Phase",
    "P7f": "Formative Loop Closure",
    "P8": "Cross-Service Coherence",
    "T5": "Framework Interop — Bloom/HOTS Tagging",
    "T6": "Generation Consistency (regional bias)",
    # Proposed in the exam sheet's own Notes/Gaps column, adopted here so the
    # checks that currently map to "no direct standard" are not orphaned.
    "Q1": "Item-Writing Quality — Language Accessibility (PROPOSED, exam sheet gap)",
    "Q2": "Item-Writing Quality — Editorial Correctness (PROPOSED, exam sheet gap)",
    "Q3": "Item-Writing Quality — Output Completeness (PROPOSED, exam sheet gap)",
    "Q4": "Item-Writing Quality — Answerability (PROPOSED, ours — bd-60015)",
    "Q5": "Item-Writing Quality — Mark Integrity (PROPOSED, ours — bd-60021)",
    "P7g": "Assessment Fairness (PROPOSED in exam sheet; T6 is not a full match)",
}

# Context tokens a check can depend on. A check whose context is absent is scored
# `null` + notAssessable and EXCLUDED from the denominator — never scored 1 as a
# penalty. This rule is inherited from the LP reviewer, where scoring an
# unjudgeable check as 1 was a measured source of false failures.
CONTEXT_BOOK = "book_content"      # the page-truth / textbook pages the exam was generated from
CONTEXT_SLO = "slo_map"            # the chapter's SLO list, for tagging checks
CONTEXT_ANSWER_KEY = "answer_key"  # the generated answer key document

# --------------------------------------------------------------------------- #
# Category 1 — Content & Accuracy   (from exam sheet v2 C1, + LP 1D and 7A)
# --------------------------------------------------------------------------- #
CONTENT_ACCURACY = {
    "criterion_id": "A1",
    "criterion": "Content & Accuracy",
    "checks": [
        {
            "id": "A1a",
            "name": "No factual errors in stem or answer options",
            "scope": "item",
            "requirement": (
                "Every fact in the question stem and in every option must be accurate. "
                "Weight the error by where it lands: an error in the CORRECT answer, or one that "
                "makes a distractor defensible alongside the correct answer, is the worst case."
            ),
            "descriptors": {
                1: "Factual error in the correct answer, or an error in a distractor that makes it defensible alongside the correct answer.",
                2: "Factual error affects one distractor, making it partially defensible.",
                3: "Minor factual error in the stem or a distractor — the correct answer is unaffected and the item remains usable with a note for revision.",
                4: "All facts in the stem and all answer options are accurate.",
            },
            "standards": ["P7", "P7b"],
            "requires_context": [],
            "source": "exam sheet v2 row 3 (verbatim)",
        },
        {
            "id": "A1b",
            "name": "Correct answer is verified and unambiguous",
            "scope": "item",
            "requirement": (
                "Exactly one answer must be defensible. Ambiguity usually means the item does not "
                "test the SLO's action verb precisely. COUNT the ambiguous items. An intentionally OPEN "
                "item ('write three action words') is NOT ambiguous when its key carries an 'accept any "
                "valid…' note; it IS a fault when keyed to one fixed answer as though it were closed."
            ),
            "descriptors": {
                1: "3 or more items admit a defensible answer the key rejects.",
                2: "2 items do.",
                3: "1 item does — or an open item is keyed to a single answer with no 'accept any valid…' note.",
                4: "Every item admits exactly one defensible answer, and every open item's key says what else to accept.",
            },
            "standards": ["P7", "P7b"],
            "requires_context": [],
            "source": (
                "exam sheet v2 row 4 (verbatim); bands made countable and the open-item case added after "
                "the 2026-09-03 drift run, where judges split 3/4 over whether a one-answer key on an "
                "open question counts as ambiguity"
            ),
        },
        {
            "id": "A1c",
            "name": "Covers the topic adequately",
            "scope": "paper",
            "requirement": "Questions must match the topic/chapter the paper was requested for.",
            "descriptors": {
                1: "Off-topic — doesn't match topic at all.",
                2: "Loosely related — significant drift from topic.",
                3: "Questions partially related to topic.",
                4: "Questions fully match the given topic.",
            },
            "standards": ["P5", "P5a", "P5b", "P8"],
            "requires_context": [],
            "source": "exam sheet v2 row 5 (verbatim)",
        },
        {
            "id": "A1d",
            "name": "Grounded in the textbook pages supplied",
            "scope": "item",
            "requirement": (
                "Content must be traceable to the pages the generator was given. A 'seen' item must "
                "be a real textbook exercise from those pages, reworded at most; an 'unseen' item "
                "must build on concepts those pages actually teach. An invented fact presented as "
                "textbook content is the single worst failure mode in the LP corpus and is worse "
                "here, because a child is marked on it."
            ),
            "descriptors": {
                1: "Content not present in the pages at all — invented, or lifted from a different chapter.",
                2: "Loosely related to the pages; a key fact or term does not appear in them.",
                3: "Clearly derived from the pages, with minor drift in wording or emphasis.",
                4: "Fully grounded: a seen item matches a real exercise on those pages; an unseen item builds only on concepts taught there.",
            },
            "standards": ["P5b", "P8"],
            "requires_context": [CONTEXT_BOOK],
            "source": "LP rubric 1D 'Aligned with Textbook Content' + 8C, adapted to items",
        },
        {
            "id": "A1e",
            "name": "Internal consistency & plausible references",
            "scope": "paper",
            "requirement": (
                "Does the paper contradict ITSELF? Three faults count: two items asserting conflicting "
                "facts; a key answer that answers a different question than its stem asks; a stem whose "
                "own parts disagree (plural 'the proper nouns' over a sentence containing one).\n"
                "⚠ DO NOT COUNT A MISSING PASSAGE HERE. An item pointing at text the paper does not print "
                "is scored by A5a (answerability) and by A5a ALONE. Charging it here too punishes one "
                "defect twice, and was the largest source of disagreement in the 2026-09-03 drift run — "
                "the same missing story drove this check to 1, 2, 3 and 4 across nine judgings. If a "
                "reference is absent, that is A5a's finding; ask only whether what IS present hangs "
                "together."
            ),
            "descriptors": {
                1: "Two or more items assert conflicting facts, OR a key answer answers a different question than its stem asks.",
                2: "One internal contradiction between items, or between a stem and its own key.",
                3: "Nothing contradicts; one or more cosmetic slips (a plural where the sentence holds one instance, a mis-numbered cross-reference).",
                4: "Fully self-consistent — no contradictions and no slips.",
            },
            "standards": ["P7", "P8"],
            "requires_context": [],
            "source": (
                "LP rubric 7A 'Internal Consistency & Plausible Textbook References'. SCOPE NARROWED after "
                "the 2026-09-03 drift run: it was overlapping A5a (cross-judge spread 2.0, the worst on the "
                "rubric) because a missing passage satisfied both checks' wording."
            ),
        },
    ],
}

# --------------------------------------------------------------------------- #
# Category 2 — Clarity & Language   (exam sheet v2 C2, standards gap adopted)
# --------------------------------------------------------------------------- #
CLARITY_LANGUAGE = {
    "criterion_id": "A2",
    "criterion": "Clarity & Language",
    "checks": [
        {
            "id": "A2a",
            "name": "Language is simple, clear and free of negative phrasing",
            "scope": "item",
            "requirement": (
                "Grade-appropriate vocabulary and sentence length. A single 'NOT' is acceptable only "
                "where the SLO genuinely requires exclusion thinking."
            ),
            "descriptors": {
                1: "Complex vocabulary or long sentences that are hard to understand, OR two or more negatives in one stem (e.g. \"which is NOT incorrect\").",
                2: "Multiple complex phrases OR two negatives — readability noticeably reduced.",
                3: "1–2 complex words or phrases, OR a single avoidable \"NOT\" that could have been written positively.",
                4: "Simple vocabulary, short sentences, no negative phrasing — or a single \"NOT\" only where the SLO requires exclusion thinking.",
            },
            "standards": ["Q1"],
            "requires_context": [],
            "source": "exam sheet v2 row 7 (verbatim); its 'no direct standard' gap adopted as Q1",
        },
        {
            "id": "A2b",
            "name": "No grammar / spelling errors, and text is properly formatted",
            "scope": "paper",
            "requirement": (
                "Editorial correctness across the paper, in the paper's own language and script, "
                "including layout: no irregular indentation, no run-together items, nothing that "
                "makes the paper harder to read than its content warrants."
            ),
            "descriptors": {
                1: "5 or more errors.",
                2: "3–4 errors — some distraction to the reader.",
                3: "1–2 minor errors.",
                4: "Zero errors detected.",
            },
            "standards": ["Q2"],
            "requires_context": [],
            "source": (
                "exam sheet v2 row 8 (grammar/spelling) MERGED with row 19 (text alignment/formatting) — "
                "both are editorial quality on the rendered paper and a judge cannot separate them from "
                "the JSON; band 1 read as 5+ so bands 1 and 2 do not overlap (the sheet has 3+ in both)"
            ),
        },
        {
            "id": "A2c",
            "name": "Grade-appropriate register and script",
            "scope": "paper",
            "requirement": (
                "The paper must be written in the medium the subject is taught in, at the grade's reading "
                "level. Urdu-medium subjects (Urdu, Islamiat, GK, Social Studies) must be in Urdu script "
                "throughout; English-medium (English, Maths, Science) in English. A paper in the wrong "
                "language is unusable regardless of question quality."
            ),
            "descriptors": {
                1: "Wrong medium for the subject, or mixed script within items so the paper cannot be read by its intended class.",
                2: "Correct medium but register is clearly off-grade (secondary-level phrasing for a primary class, or vice versa).",
                3: "Correct medium and broadly grade-appropriate, with occasional off-register wording.",
                4: "Correct medium throughout, consistently at the grade's reading level.",
            },
            "standards": ["Q1"],
            "requires_context": [],
            "source": "ours — the Urdu-medium path is 4 of 7 subjects and was untested as of 2026-09-03",
        },
    ],
}

# --------------------------------------------------------------------------- #
# Category 3 — Fairness & Bias   (exam sheet v2 C3, + LP C6 and 7C)
# --------------------------------------------------------------------------- #
FAIRNESS_BIAS = {
    "criterion_id": "A3",
    "criterion": "Fairness & Bias",
    "checks": [
        {
            "id": "A3a",
            "name": "No cultural / gender / racial bias",
            "scope": "item",
            "requirement": "No item may advantage or disadvantage a group.",
            "descriptors": {
                1: "Clearly favours or disadvantages a specific group.",
                2: "Reference present that could disadvantage a group in some contexts.",
                3: "Subtle reference — doesn't directly disadvantage any group.",
                4: "Completely neutral — no cultural, gender, or racial references.",
            },
            "standards": ["T6", "P7g"],
            "requires_context": [],
            "source": "exam sheet v2 row 10 (verbatim); its T6-is-a-partial-match note adopted as P7g",
        },
        {
            "id": "A3b",
            "name": "Not a trick question",
            "scope": "item",
            "requirement": (
                "The item must test the SLO's content, not the child's ability to parse wording. "
                "A trick item measures metalinguistic skill instead of the objective."
            ),
            "descriptors": {
                1: "Designed to confuse — tests wordplay not knowledge.",
                2: "Noticeably tricky wording; may confuse students unfairly.",
                3: "Slightly misleading but not intentionally tricky.",
                4: "Straightforward — directly tests knowledge of topic.",
            },
            "standards": ["P7", "P7b"],
            "requires_context": [],
            "source": "exam sheet v2 row 11 (verbatim)",
        },
        {
            "id": "A3c",
            "name": "Contextually relevant & inclusive representation",
            "scope": "paper",
            "requirement": (
                "Names, settings, foods, currency and activities should be recognisable to the children "
                "sitting the paper, and the cast across the paper should not be uniformly one gender or "
                "one social setting."
            ),
            "descriptors": {
                1: "Contexts are foreign to the children (imported names/settings/currency) or representation is uniformly one-sided.",
                2: "Mostly local but with imported contexts, or a noticeable representation skew.",
                3: "Locally recognisable contexts with a mild skew in who appears.",
                4: "Locally grounded throughout, with balanced representation across the paper.",
            },
            "standards": ["T6"],
            "requires_context": [],
            "source": "LP rubric C6 (6A/6B/6C/6D), condensed to one paper-level check",
        },
        {
            "id": "A3d",
            "name": "Sensitive content handled correctly",
            "scope": "paper",
            "requirement": (
                "Religious content must be treated with the conventions the curriculum uses. Never ask a "
                "child to draw or depict the Prophet ﷺ or any revered figure; never set a question whose "
                "answer is a contested religious or political claim. This is a hard rule in the LP "
                "pipeline (a QA hard-fail) and applies identically here."
            ),
            "descriptors": {
                1: "Asks a child to draw/depict a revered figure, OR the correct answer to some item is a contested religious or political claim.",
                2: "Names a revered figure without the curriculum's honorific, or asserts a sectarian/political claim as settled fact in a stem.",
                3: "Sensitive material handled correctly, with a register slip that a teacher would notice but no child would be harmed by.",
                4: "No sensitive material at all, OR it appears exactly as the textbook itself presents it (a festival as setting, an honorific carried through).",
            },
            "standards": ["P7g"],
            "requires_context": [],
            "source": (
                "LP rubric 6D + the curriculum-baked-LP G5c religious-content gate. Bands sharpened after "
                "the 2026-09-03 drift run: all 9 judgings agreed (4/4/4) but their rationales showed they "
                "were each inventing a threshold — band 4 now names the common case (a festival used as "
                "setting) so agreement is earned rather than lucky."
            ),
        },
    ],
}

# --------------------------------------------------------------------------- #
# Category 4 — Cognitive Level & SLO Alignment   (exam sheet v2 C1 row 2 + C4)
# --------------------------------------------------------------------------- #
COGNITIVE_ALIGNMENT = {
    "criterion_id": "A4",
    "criterion": "Cognitive Level & SLO Alignment",
    "checks": [
        {
            "id": "A4a",
            "name": "Every item tagged to a specific SLO — no untagged items",
            "scope": "paper",
            "requirement": (
                "Every item must map to an SLO from the chapter's roadmap, with the code as the source "
                "gives it — never a fabricated code."
            ),
            "descriptors": {
                1: "SLO tagging absent or applied to fewer than half the items.",
                2: "Several items untagged or misaligned — a pattern of errors.",
                3: "Most tagged but 1–2 items missing or incorrectly tagged.",
                4: "Every item tagged, mapping verified, no untagged items.",
            },
            "standards": ["P5", "P5a", "P8"],
            "requires_context": [CONTEXT_SLO],
            "source": (
                "exam sheet v2 row 2 (SLO tagging, verbatim) MERGED with row 20 (topic tag correctly "
                "assigned) — both are 'is this item labelled with what it actually tests', and both cite P5/P5a"
            ),
        },
        {
            "id": "A4b",
            "name": "Bloom's tag matches the question",
            "scope": "item",
            "requirement": (
                "The declared Bloom level must match the cognitive demand the item actually makes. COUNT "
                "the mistagged items and read the band off that count; do not form an overall impression. "
                "A tag inflated by one level (Understand claimed for pure recall) counts as one; a tag two "
                "or more levels off (Analyze claimed for a lookup) is severe."
            ),
            "descriptors": {
                1: "Over a third of items are mistagged, OR any tag is 2+ levels off.",
                2: "3 or more items mistagged by one level.",
                3: "1–2 items mistagged by one level.",
                4: "Every tag matches the demand the item actually makes.",
            },
            "standards": ["P7b", "P7c", "P7f", "T5"],
            "requires_context": [],
            "source": (
                "exam sheet v2 row 13 (verbatim); bands made countable after the 2026-09-03 drift run, "
                "where judges finding the same mistags split 2/3/4 on 'partially matches'"
            ),
        },
        {
            "id": "A4c",
            "name": "Items go beyond recall and span a balanced range",
            "scope": "paper",
            "requirement": (
                "The paper must not be uniformly recall. Grade band sets the ceiling, not the floor: a "
                "Grade 1 paper is not expected to reach Evaluate, but it should still move beyond "
                "Remember into Understand and Apply."
            ),
            "descriptors": {
                1: "Recall only — no higher cognitive levels present.",
                2: "Minimal range — two levels at most, predominantly recall.",
                3: "Some range but leans heavily toward one level.",
                4: "Questions span multiple cognitive levels — not recall only.",
            },
            "standards": ["P1c", "P7", "P7c", "P7f"],
            "requires_context": [],
            "source": (
                "exam sheet v2 row 14 (verbatim) MERGED with v1 tab's 'Balanced spread across exam' — "
                "v1 split spread and cognitive range into two checks with near-identical descriptors"
            ),
        },
        {
            "id": "A4d",
            "name": "Scaffolded and unscaffolded items both present — unscaffolded dominant (≥70%)",
            "scope": "paper",
            "requirement": (
                "An assessment measures independent capability, so most items must stand alone: no hints, "
                "sentence stems, or worked examples carried into the item."
            ),
            "descriptors": {
                1: "Only one type — entirely scaffolded or entirely unscaffolded.",
                2: "One type heavily dominates (>80%); minimal presence of the other.",
                3: "Both types present but roughly equal split — no clear dominance.",
                4: "Both types present; unscaffolded clearly dominant (≥70%).",
            },
            "standards": ["P1c", "P3d"],
            "requires_context": [],
            "source": "exam sheet v2 row 15 (verbatim)",
        },
    ],
}

# --------------------------------------------------------------------------- #
# Category 5 — Answerability & Paper Mechanics
# The half neither source rubric had. Every check here is a defect we actually
# shipped and caught, named in its `source`.
# --------------------------------------------------------------------------- #
ANSWERABILITY = {
    "criterion_id": "A5",
    "criterion": "Answerability & Paper Mechanics",
    "checks": [
        {
            "id": "A5a",
            "name": "Answerable from the paper alone",
            "scope": "item",
            "requirement": (
                "A child holding ONLY this paper, with the textbook closed, must be able to attempt every "
                "item. That is the standard: a paper is sat under exam conditions, so 'the class read this "
                "story last week' does NOT make an item answerable. Three distinct failures count as "
                "UNANSWERABLE — apply them mechanically, do not weigh how good the rest of the paper is:\n"
                "  (a) PICTURE — the item needs a picture, diagram, figure or illustration. The paper "
                "carries none at all, so any such item fails.\n"
                "  (b) MISSING TEXT — the item points at a passage, story, poem, table or word bank that "
                "the paper does not print ('based on the story X', 'read the passage above', 'from the "
                "table'). A 'seen' item gets NO exemption here: if the text is not on the paper, the item "
                "is unanswerable even though the class was taught it.\n"
                "    ⚠ (b) IS NOT A BAN ON RECALL — this is the distinction that decides the check.\n"
                "      DURABLE KNOWLEDGE is a fact, rule or word the curriculum wants held for life: "
                "3 × 3 = 9; a proper noun takes a capital; the past tense of 'eat'; the meaning of a word "
                "from the chapter's vocabulary list; the seasons. Asking for it is the POINT of an "
                "assessment. Such items are FULLY ANSWERABLE and are NOT counted here, even though "
                "nothing printed on the paper supplies the answer.\n"
                "      TEXT DETAIL is a fact true only inside one particular story or passage: who "
                "spilled the kheer, what colour a character's dress was, which page a poem is on. A child "
                "who understood the chapter perfectly may never have stored it. These DO count under (b) "
                "unless the text is printed.\n"
                "      THE TEST: could a child who learned this concept well, but read a DIFFERENT story "
                "teaching it, still answer? Yes → durable knowledge, fair, do not count. No → text detail, "
                "count it.\n"
                "      A comprehension item is fixed by PRINTING its stimulus, not by deleting the item — "
                "two sentences of scenario suffice and are not an excerpt of the textbook.\n"
                "  (c) MISSING ANTECEDENT — the item assumes an object, event or prior item the paper "
                "never establishes ('write back to Dani' when no letter from Dani appears; 'the box "
                "above'; 'your answer to Q3' where Q3 asks something unrelated).\n"
                "COUNT the failing items, then read the band off that count. Two judges finding the SAME "
                "items must give the SAME rating — the band is arithmetic, not judgement."
            ),
            "descriptors": {
                1: "3 or more items fail (a), (b) or (c) — or any single failing item is worth 20%+ of the paper's marks.",
                2: "2 items fail.",
                3: "Exactly 1 item fails.",
                4: "0 items fail — every item is attemptable with the textbook closed.",
            },
            "standards": ["Q4"],
            "requires_context": [],
            "source": (
                "ours — Grade 1 English eval 2026-09-02 ('Label the Picture' with no pictures, bd-60015); "
                "The durable-knowledge vs text-detail split was ruled by the operator on 2026-09-03 "
                "against a 16-question Bloom-1 calibration set. REWRITTEN after the 2026-09-03 drift run, "
                "where 9 blind judgings of one paper found the "
                "same defects but rated them 1,1,2,2,2,3,3,3,4 — two runs naming the identical item set "
                "{2,3} scored it 1 and 3. The old bands described severity in prose and left the "
                "findings-to-rating mapping to the judge; these count items instead. The 'seen items are "
                "answerable from memory' reading (fable-r3, gemini-r2) is now explicitly ruled out."
            ),
        },
        {
            "id": "A5b",
            "name": "The stem does not give away its own answer",
            "scope": "item",
            "requirement": (
                "Delete any figure and re-read the stem: if the answer is still stated in the wording, the "
                "item tests transcription, not knowledge. 'There are 3 balloons. How many balloons?' is the "
                "canonical failure. Naming a target the child must still find or produce is legitimate "
                "('mark the water level at 300 mL')."
            ),
            "descriptors": {
                1: "The stem states the value it asks for — the item tests transcription.",
                2: "The answer is strongly implied by the stem's own wording or by only one grammatically possible option.",
                3: "The answer is not given, but a cue in the stem narrows it to a near-certainty.",
                4: "The stem supplies what is needed to work, and nothing that answers the item.",
            },
            "standards": ["Q4"],
            "requires_context": [],
            "source": "curriculum-baked-LP counting-question integrity rule (Grades 1–3), generalised to all items",
        },
        {
            "id": "A5c",
            "name": "Item is complete and well formed",
            "scope": "item",
            "requirement": "No truncation, no broken structure, options distinct and non-overlapping, no duplicated item.",
            "descriptors": {
                1: "Malformed — missing punctuation or structure broken.",
                2: "Partially truncated; some loss of intended meaning.",
                3: "Ends abruptly but still readable.",
                4: "Properly structured — no truncation.",
            },
            "standards": ["Q3"],
            "requires_context": [],
            "source": "exam sheet v2 row 18 (verbatim); its 'no direct standard' gap adopted as Q3",
        },
        {
            "id": "A5d",
            "name": "Marks are present and proportionate",
            "scope": "paper",
            "requirement": (
                "Every item carries a mark value; the values scale with the work asked (a one-word blank is "
                "not worth the same as a paragraph); the printed total equals the sum of the items. COUNT "
                "the out-of-step weightings and read the band off that count. A paper carrying no printed "
                "total is not a fault here — that is the renderer's job; this check judges the mark data."
            ),
            "descriptors": {
                1: "Any item carries no mark, OR the printed total does not equal the sum of the items.",
                2: "3 or more items are weighted out of step with the work they ask.",
                3: "1–2 items are weighted out of step.",
                4: "Every item marked, every weighting tracks the work asked, total correct.",
            },
            "standards": ["Q5", "P7"],
            "requires_context": [],
            "source": (
                "ours — Grade 3 eval 2026-09-03: same request scored 26 marks on one model and 18 on "
                "another; bands made countable after the same day's drift run, where judges finding the "
                "same weightings split 2/3/4 on 'one or two odd weightings'"
            ),
        },
        {
            "id": "A5e",
            "name": "Paper length matches what was requested",
            "scope": "paper",
            "requirement": (
                "The number of questions the teacher asked for is the size of the paper. Count what a child "
                "sees numbered on the page, not internal units: a Word Meanings item holding six words is ONE "
                "question on the paper even if it is six marks."
            ),
            "descriptors": {
                1: "Off by more than 30% of the requested count in either direction.",
                2: "Off by 15–30% of the requested count.",
                3: "Within 15% of the requested count.",
                4: "Matches the requested count exactly.",
            },
            "standards": ["Q5"],
            "requires_context": [],
            "source": (
                "ours — 15 asked / 26 delivered (Grade 1, 2026-09-02) and 20 asked / 64 delivered "
                "(staging, 2026-09-01); fixed in bd-60015, this check keeps it fixed"
            ),
        },
        {
            "id": "A5f",
            "name": "Answer key is complete and correct",
            "scope": "paper",
            "requirement": (
                "The key must cover every item on the paper, in the paper's own numbering, and each answer "
                "must be correct for the question actually asked. An item the generator could not answer must "
                "show as a gap, not be silently renumbered away.\n"
                "Rank the faults, worst first, and rate on the WORST one present:\n"
                "  WRONG — an answer is factually wrong, or answers a different question than the one asked.\n"
                "  MISNUMBERED — the key's numbering does not line up with the paper's.\n"
                "  MISSING — an item has no entry and no gap marker.\n"
                "  THIN — the answer is correct but under-specified for marking: an open item given one "
                "fixed answer with no 'accept any valid…' note, or a model answer that rests on a premise "
                "the paper does not establish. THIN is a 3, never lower: a teacher can still mark it."
            ),
            "descriptors": {
                1: "Key missing entirely, OR any answer is WRONG, OR the numbering does not correspond to the paper.",
                2: "Every answer that is present is correct, but one or more items are MISSING with no gap marker.",
                3: "Complete, correctly numbered and correct throughout, with one or more THIN entries.",
                4: "Every item answered, correct, correctly numbered, and specified well enough to mark consistently.",
            },
            "standards": ["P7", "P7f"],
            "requires_context": [CONTEXT_ANSWER_KEY],
            "source": (
                "ours — the key became a separate document in bd-60015; nothing checked it. Bands rewritten "
                "after the 2026-09-03 drift run, where runs finding the same 'thin' entries split 3/4 "
                "because 'thin or ambiguous' had no boundary against 'wrong'."
            ),
        },
    ],
}

ACTIVE_CRITERIA = [
    CONTENT_ACCURACY,
    CLARITY_LANGUAGE,
    FAIRNESS_BIAS,
    COGNITIVE_ALIGNMENT,
    ANSWERABILITY,
]

# --------------------------------------------------------------------------- #
# Standards this reviewer CANNOT assess from a paper, and what each waits on.
# Kept here on purpose: the exam sheet's own coverage report scores its v2 rubric
# at 35% of 24 standards, and most of the shortfall is this list — work the
# generator has not built yet, not checks a judge forgot. Scoring them from the
# paper alone would be fabrication.
# --------------------------------------------------------------------------- #
NOT_YET_ASSESSABLE = {
    "P2": "Needs a per-class taught-SLO history to know what is untaught.",
    "P2a": "No-untaught-content enforcement belongs in a pre-generation gate on the taught-SLO history, not in a judge reading the paper.",
    "P2b": "Needs prior-assessment records per SLO.",
    "P3": "Needs live lesson state for the class.",
    "P3a": "Needs prior error patterns per SLO.",
    "P3b": "Needs post-exam scoring and the mastery thresholds (still TBD in the sheet).",
    "P3c": "≥2 items per SLO — computable only once SLO tagging ships (A4a's context).",
    "P4": "Spaced retrieval needs a session sequence.",
    "P4a": "Starter design — needs the question bank's spaced-item pool, which does not exist yet.",
    "P4b": "Needs retrieval-interval tags on an item bank.",
    "P4c": "Needs item-level retrieval history.",
    "P5c": "Coverage report is a product surface, not a property of one paper.",
    "P6": "Cross-curricular tagging not in the schema yet.",
    "P7d": "Exit-ticket validity — an LP concept; an exam has no exit ticket.",
    "P7 (facility/discrimination)": "Needs response data from real classes.",
    "C3": "Dose-response monitoring needs multi-class usage data.",
}


def get_active_rubric():
    """Every criterion with its checks, max_score computed from the check count."""
    out = []
    for crit in ACTIVE_CRITERIA:
        c = dict(crit)
        c["max_score"] = len(crit["checks"]) * SCALE_MAX
        out.append(c)
    return out


def grand_total_max():
    return sum(len(c["checks"]) for c in ACTIVE_CRITERIA) * SCALE_MAX


def check_ids():
    return [chk["id"] for c in ACTIVE_CRITERIA for chk in c["checks"]]


def find_check(check_id):
    for c in ACTIVE_CRITERIA:
        for chk in c["checks"]:
            if chk["id"] == check_id:
                return c, chk
    raise KeyError(check_id)


def item_check_ids():
    return [chk["id"] for c in ACTIVE_CRITERIA for chk in c["checks"] if chk["scope"] == "item"]


def paper_check_ids():
    return [chk["id"] for c in ACTIVE_CRITERIA for chk in c["checks"] if chk["scope"] == "paper"]
