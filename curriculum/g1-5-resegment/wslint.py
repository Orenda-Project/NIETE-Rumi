"""Everything about a worksheet that can be checked before it costs anything.

`d0_route` refuses the wrong OBJECT: a 995 rendered as a four-page teacher
lesson plan. It cannot see the other half of the failure, which is a worksheet
that IS a worksheet and is the wrong shape -- six questions all of one type, a
question with no mark badge, an answer key with nothing in it, a picture
asking a six-year-old to count nine things in one heap. Every one of those is
only visible after generation unless something reads the authored envelope
first, and the skill says so in as many words: mirror every engine refusal in
the free pre-render lint, and write the shape into the authoring brief.

So this is the cheap half of the guard. It reads JSON, spends nothing, and is
what a wrapper is allowed to call as often as it likes. `d0_worksheet` calls
it too and refuses on findings, because a lint nobody runs is a comment.

Every rule below came off the skill's own worksheet contract or the page truth
of Grade 1 English Chapter 1, and the two that are easy to get backwards:

  "Groups of 4 or fewer" is about COUNTABLE OBJECTS IN A PICTURE, not about
  answer options. Diffusion cannot count past four or five, so seven apples
  are drawn as 4 + 3 and each group is spelled out. It is NOT a cap on match
  pairs -- Chapter 1's rhyming exercise has five, and its calendar exercise
  orders all seven days. A lint that capped those would force a worksheet that
  contradicts the book.

  A question with no answer is usually a defect and occasionally the point.
  "Write your name here" has no key and never will (SP-005 calls this
  open-personal). It still owes the teacher a model answer, because a key that
  silently skips six of fourteen questions is a key a teacher stops trusting.

`marks: null` is ABSENT, not zero, and not "handled elsewhere" -- the same
rule `d0_route` applies to a type word, applied to a number.
"""
import d0_route

# What a question can be. Variety is measured across these, and a type outside
# the set is a typo or a shape nothing downstream knows how to print.
TYPES = ("mcq", "fill", "match", "short", "draw", "compute", "word")

# The ones a child writes into. An mcq is answered by circling; asking for
# ruled lines under it wastes a third of the page a six-year-old has to work in.
NEEDS_SPACE = ("fill", "short", "draw", "compute", "word")
SPACES = ("lines", "box", "grid", "none")

MIN_Q, MAX_Q, MIN_TYPES = 8, 12, 3

# Diffusion cannot count past four or five. Seven is two groups, not one heap.
MAX_GROUP = 4

# Third-person referents. A child reads "Write your name"; a sentence that
# talks ABOUT the children is the teacher's instruction and belongs in
# `directive`, where it does not get printed on the sheet.
TEACHER_WORDS = ("the class", "the children", "the students", "the pupils",
                 "the learners", "each child", "each student", "the teacher")


def _val(d, key):
    """`key` from `d`, treating a present-but-null the same as missing."""
    v = (d or {}).get(key)
    return v if v not in (None, "") else None


def _find(code, name):
    return {"id": code, "name": name}


def _shape(gen, out):
    """The sheet as a whole: how many questions, of how many kinds, worth what."""
    qs = gen.get("questions") or []
    if not MIN_Q <= len(qs) <= MAX_Q:
        out.append(_find("WS-02", "a worksheet carries %d-%d questions, this "
                                  "one carries %d" % (MIN_Q, MAX_Q, len(qs))))

    kinds = {q.get("type") for q in qs if _val(q, "type")}
    if len(kinds & set(TYPES)) < MIN_TYPES:
        out.append(_find("WS-03", "only %d kind(s) of question (%s) -- a "
                                  "worksheet needs at least %d so a child who "
                                  "cannot do one kind can still show what they "
                                  "know" % (len(kinds), ", ".join(sorted(kinds))
                                            or "none", MIN_TYPES)))

    total, want = _val(gen, "total_marks"), 0
    for q in qs:
        m = _val(q, "marks")
        if isinstance(m, int) and not isinstance(m, bool):
            want += m
    if total is None:
        out.append(_find("WS-06", "no total_marks: the child cannot see what "
                                  "the paper is out of"))
    elif total != want:
        out.append(_find("WS-06", "total_marks is %s but the questions add up "
                                  "to %d" % (total, want)))


def _marks(q, qid, out):
    m = _val(q, "marks")
    if not isinstance(m, int) or isinstance(m, bool) or m <= 0:
        out.append(_find("WS-05", "%s has no mark badge (marks=%r) -- the "
                                  "badge is how a child sees where the effort "
                                  "goes" % (qid, (q or {}).get("marks"))))


def _child_text(q, qid, out):
    text = _val(q, "childText")
    if text is None:
        out.append(_find("WS-07", "%s has nothing for the child to read" % qid))
        return
    low = text.lower()
    said = [w for w in TEACHER_WORDS if w in low]
    if said:
        out.append(_find("WS-08", "%s prints a teacher instruction as child "
                                  "text (%r) -- move it to `directive`"
                         % (qid, said[0])))


def _room_to_write(q, qid, out):
    if (q or {}).get("type") not in NEEDS_SPACE:
        return
    space = _val(q, "space")
    if space is None:
        out.append(_find("WS-09", "%s is written into and says nowhere to "
                                  "write it" % qid))
    elif space not in SPACES:
        out.append(_find("WS-09", "%s asks for space %r, which is not one of "
                                  "%s" % (qid, space, ", ".join(SPACES))))


def _key(q, qid, out):
    """The answer-key half of the same authored source."""
    open_personal = bool((q or {}).get("open_personal"))
    answer = _val(q, "answer")
    if open_personal:
        # No single right answer, so no key -- but the teacher still gets an
        # example of what a good one looks like, or the key has a hole in it.
        if answer is None and _val(q, "model_solution") is None:
            out.append(_find("WS-10", "%s is open-personal and gives the "
                                      "teacher no model answer" % qid))
    elif answer is None:
        out.append(_find("WS-10", "%s has no answer -- mark it open_personal "
                                  "if it genuinely has none" % qid))

    if _val(q, "marking") is None:
        out.append(_find("WS-11", "%s has no marking guidance" % qid))

    if not open_personal and not (q or {}).get("common_errors"):
        out.append(_find("WS-12", "%s lists no common errors -- a key without "
                                  "them tells a teacher what, never why" % qid))


def _picture(q, qid, out):
    ill = (q or {}).get("illustration")
    if not ill:
        return
    if _val(ill, "ascii") is None:
        out.append(_find("WS-14", "%s illustrates without an ASCII count, so "
                                  "nothing downstream knows what is drawn"
                         % qid))
    for n in (ill.get("groups") or []):
        if isinstance(n, int) and n > MAX_GROUP:
            out.append(_find("WS-13", "%s draws %d objects in one group -- "
                                      "split into groups of %d or fewer, the "
                                      "renderer cannot count past that"
                             % (qid, n, MAX_GROUP)))
            break


def _answer_shape(q, qid, out):
    t = (q or {}).get("type")
    if t == "mcq" and len(((q or {}).get("options") or [])) < 2:
        out.append(_find("WS-15", "%s is an mcq with fewer than two options"
                         % qid))
    if t == "match" and not (q or {}).get("pairs"):
        out.append(_find("WS-16", "%s is a match with no pairs" % qid))


def findings(enr, segment=None):
    """Everything wrong with this worksheet, cheapest check first.

    A list of `{"id", "name"}`. Empty means nothing here blocks a render --
    not that the worksheet is good, which is what the judge is for.
    """
    out = []
    what = d0_route.kind(enr, segment)
    if what != "assessment":
        out.append(_find("WS-01", "this is a %s segment, not a worksheet -- "
                                  "the lint has nothing to say about it" % what))
        return out

    gen = (enr or {}).get("generated") or {}
    _shape(gen, out)
    for i, q in enumerate(gen.get("questions") or []):
        qid = _val(q, "id") or "question %d" % (i + 1)
        if _val(q, "type") not in TYPES:
            out.append(_find("WS-04", "%s is of type %r, which is not one of "
                                      "%s" % (qid, (q or {}).get("type"),
                                              ", ".join(TYPES))))
        _marks(q, qid, out)
        _child_text(q, qid, out)
        _room_to_write(q, qid, out)
        _key(q, qid, out)
        _picture(q, qid, out)
        _answer_shape(q, qid, out)
    return out


def ok(enr, segment=None):
    """True when nothing blocks the render. The shape a caller usually wants."""
    return not findings(enr, segment)
