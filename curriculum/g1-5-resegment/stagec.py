"""Stage C enrichment — the controlled vocabulary and the derivations (bd-20n98).

Nothing here is invented. Sources, in order of authority:

* move phases      — production, `bot/shared/services/coaching/fidelity/
                     upload-extractor-prompt.js:22` (the vocabulary the fidelity
                     grader already scores teachers against)
* 10-15 moves,     — `docs/superpowers/specs/2026-09-15-g1-5-resegmentation-design.md` §5
  40 minutes,        (the period table), and bd-p4ulq which made the printed 40 real
  teacher ceiling
* interaction/gap  — `.claude/skills/curriculum-baked-lesson-plans/reference/
                     curriculum-matrix-sheet.md` §2
* the oral floor   — `reference/english-skill-types.md`, the communicative_beat rules

A column we cannot honestly derive stays "pending". A blank on an assessment or
review row is a legitimate not-applicable, never a gap to be filled.
"""
import json
import re

PENDING = "pending"
PERIOD_MIN = 40
MOVES_MIN = 10
MOVES_MAX = 15
TEACHER_PRIMARY_CEILING = 10
ORAL_PRODUCTION_FLOOR = 5

SEP = " | "
DOT = "·"

# upload-extractor-prompt.js:22 — do not extend without changing prod too.
PHASES = ("warm_up", "hook", "recall", "announce", "explain",
          "guided", "independent", "peer_review", "exit", "homework")

# Who is the primary actor. The design-spec period table calls I Do "yes",
# the opening "partly", and We Do / You Do / Exit "no".
# Calibrated against the spec's own reference day: I Do 8 min "yes" plus the
# 5-min opening "partly" must land on its stated <=10 ceiling. 8*1.0 + 5*0.5
# = 10.5, which rounds to exactly 10. `announce` is the "Set the task" routine
# step (d0_routine.SECTION) -- the teacher organising, not the teacher
# teaching -- so it weighs half. Putting it at full breaks that calibration
# and the ceiling becomes unreachable on every honest day.
_FULL = frozenset({"explain"})
_SHARED = frozenset({"warm_up", "hook", "recall", "announce"})
_STUDENT = frozenset({"guided", "independent", "peer_review", "exit", "homework"})

# Minutes in which the children, not the teacher, are producing.
_PRODUCTION = frozenset({"guided", "independent", "peer_review"})

VOCAB = {
    "Interaction": ("individual", "teacher↔class", "pair", "group", "mingle"),
    "Gap": ("none", "one-way", "two-way", "reasoning", "opinion"),
    "Reading strategy": (
        "activate-prior-knowledge", "predict", "set-purpose",
        "pre-teach-vocabulary", "decode-blend", "sight-word-recognition",
        "choral-echo-read", "repeated-read-fluency", "partner-read",
        "question-generate", "clarify", "visualise", "infer", "summarise",
        "retell", "text-structure", "skim-scan", "n/a"),
    "Collaboration structure": (
        "think-pair-share", "partner-dictation", "partner-sound-check",
        "describe-and-guess", "info-gap-pairs", "jigsaw", "numbered-heads",
        "round-robin", "peer-check", "group-task", "mingle-find-someone",
        "role-play", "whole-class-only", "individual-only"),
}

# Maths and Science have no `Reading strategy` column: it was "n/a" on all
# 785 of their rows, which is a question the subject does not answer.
CORE_COLUMNS = ("Moves", "Collaboration structure",
                "Prerequisite SLOs", "Teacher-primary min (of 40)")
LANG_COLUMNS = ("Moves", "Reading strategy", "Collaboration structure",
                "Function", "Interaction", "Gap", "Recycles",
                "Prerequisite SLOs", "Teacher-primary min (of 40)")

LANG_SUBJECTS = ("English", "Urdu")

# A day whose skill tag names speech or listening. Urdu tags are the book's own.
_ORAL = ("oral", "speaking", "listening", "تقریر",
         "گفتگو", "سننا",
         "بولنا")


# Row grammar. Column A is the ONLY witness -- an assessment row also carries a
# Topic reading "Chapter N Assessment Worksheet", and a classifier that consults
# the Topic files every assessment row as a chapter header. That bug dropped 171
# rows out of a 1,923-row census silently, which is why this lives under test.
_ROW_FORMS = (
    ("day", re.compile(r"^Day\s+\d+", re.U)),
    ("chapter_header", re.compile(r"^Chapter\s+\d+\s*:", re.U)),
    ("grade_banner", re.compile(r"^GRADE\s+\d+", re.U)),
    ("assessment", re.compile(u"^\u2705\\s*Ch\\.\\s*Assessment", re.U)),
    ("review", re.compile(u"^\U0001f4cb\\s*Ch\\.\\s*Review", re.U)),
)


def classify_row(col_a, topic=None):
    """Row kind from column A, or None if this is not one of the five forms.

    `topic` is accepted and deliberately ignored, so a caller that passes it
    cannot accidentally reintroduce the misclassification.
    """
    text = (col_a or "").strip()
    if not text:
        return None
    for kind, pattern in _ROW_FORMS:
        if pattern.match(text):
            return kind
    return None


def _weight(phase):
    if phase in _FULL:
        return 1.0
    if phase in _SHARED:
        return 0.5
    return 0.0


def format_moves(pairs):
    """The move spine as JSON, which is what the cell is for.

    A pairs array, not an object keyed by phase: every one of the 22 spines
    repeats a phase (two `guided` blocks either side of a `peer_review`, for
    instance), and an object would silently keep only the last of them.
    """
    return json.dumps([[p, int(m)] for p, m in pairs], separators=(",", ":"))


def parse_moves(cell):
    """'[["warm_up",5],["explain",8]]' -> [('warm_up', 5), ('explain', 8)].

    Raises ValueError on anything that is not a spine, so callers that need a
    verdict use check_moves() instead of guessing.
    """
    text = (cell or "").strip()
    if not text or text == PENDING:
        raise ValueError("not a move spine: %r" % cell)
    if text.startswith("["):
        try:
            loaded = json.loads(text)
            return [(str(p), int(m)) for p, m in loaded]
        except (ValueError, TypeError) as exc:
            raise ValueError("not a move spine: %r (%s)" % (cell, exc))
    # Cells written before 2026-09-21 hold the pipe-and-middot form. They
    # still have to read, or the verifier calls every existing row broken.
    out = []
    for part in text.split("|"):
        part = part.strip()
        if not part:
            continue
        if DOT not in part:
            raise ValueError("move %r has no %s minutes" % (part, DOT))
        phase, _, mins = part.partition(DOT)
        out.append((phase.strip(), int(mins.strip())))
    return out


def check_moves(cell):
    """Return a list of reasons this move spine is not shippable."""
    try:
        moves = parse_moves(cell)
    except (ValueError, TypeError) as exc:
        return [str(exc)]
    bad = []
    unknown = sorted({p for p, _ in moves if p not in PHASES})
    if unknown:
        bad.append("phase not in the production vocabulary: %s" % ", ".join(unknown))
    if any(m <= 0 for _, m in moves):
        bad.append("a move must carry at least one minute")
    total = sum(m for _, m in moves)
    if total != PERIOD_MIN:
        bad.append("the moves account for %d minutes, but the period prints %d"
                   % (total, PERIOD_MIN))
    if not MOVES_MIN <= len(moves) <= MOVES_MAX:
        bad.append("%d moves; the spec is %d-%d"
                   % (len(moves), MOVES_MIN, MOVES_MAX))
    return bad


def teacher_primary_min(moves):
    """Minutes the teacher is the primary actor. Derived, never defaulted."""
    if isinstance(moves, str):
        moves = parse_moves(moves)
    return int(round(sum(_weight(p) * m for p, m in moves)))


def check_teacher_primary(cell, declared):
    bad = []
    try:
        want = teacher_primary_min(cell)
    except (ValueError, TypeError) as exc:
        return [str(exc)]
    try:
        got = int(str(declared).strip())
    except (TypeError, ValueError):
        return ["teacher-primary minutes must be a number derived from the "
                "moves, not %r" % declared]
    if got != want:
        bad.append("declared %d teacher-primary minutes; the moves give %d"
                   % (got, want))
    if want > TEACHER_PRIMARY_CEILING:
        bad.append("FLAG teacher-led: %d of %d minutes are teacher-primary "
                   "(ceiling %d)" % (want, PERIOD_MIN, TEACHER_PRIMARY_CEILING))
    return bad


def check_enum(column, value):
    allowed = VOCAB.get(column)
    if allowed is None:
        return []
    value = (value or "").strip()
    if not value or value == PENDING:
        return ["%s is empty on a row that requires it" % column]
    if value not in allowed:
        return ["%r is not a %s value; allowed: %s"
                % (value, column, ", ".join(allowed))]
    return []


def is_oral(skill_type):
    low = (skill_type or "").lower()
    return any(k in low for k in _ORAL)


def check_oral_floor(skill_type, interaction, cell):
    """A Speaking/Listening day may not be individual or teacher-fronted."""
    if not is_oral(skill_type):
        return []
    bad = []
    if (interaction or "").strip() in ("individual", "teacher↔class"):
        bad.append("a %s day cannot be taught as %r"
                   % (skill_type, interaction))
    try:
        moves = parse_moves(cell)
    except (ValueError, TypeError):
        return bad
    produced = sum(m for p, m in moves if p in _PRODUCTION)
    if produced < ORAL_PRODUCTION_FLOOR:
        bad.append("only %d minutes of child production; the floor is %d"
                   % (produced, ORAL_PRODUCTION_FLOOR))
    return bad


def columns_for(kind, subject):
    if kind == "day":
        return LANG_COLUMNS if subject in LANG_SUBJECTS else CORE_COLUMNS
    if kind in ("assessment", "review"):
        return ("Moves",)
    return ()


def check_prereq(value, taught_earlier):
    value = (value or "").strip()
    if not value or value == PENDING:
        return ["prerequisite SLOs unresolved"]
    if value == "none":
        return []
    bad = [c for c in (p.strip() for p in value.split(","))
           if c and c not in taught_earlier]
    if bad:
        return ["cited as prerequisite but not taught earlier: %s"
                % ", ".join(sorted(bad))]
    return []
