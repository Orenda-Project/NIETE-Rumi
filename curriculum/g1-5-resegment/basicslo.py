"""The objective a basics period puts in front of the child.

A basics period rehearses the lesson it sits beside. So it states that
lesson's SLOs -- `basicseg` copies them onto the row -- and its objective is
one of them, said in the child's voice rather than the syllabus writer's.

Amena, 20 Sep 2026: *"slo codes should cover the SLOs that the lesson states,
support slos make sense, objective is student facing SLO."*

Two sentences, and both are needed.

The FIRST is the day's own SLO. Where the corpus already wrote it in the
child's voice -- every Maths and Science description opens "I can" or "I
know" -- it is used exactly as it stands, because rewriting it can only
change it. Where it was written as an instruction to the teacher, which is
how all 253 English ones are written, "I can " goes in front and the first
letter comes down. That is safe here and would not be in general: all 42
distinct opening words in the corpus are verbs. Urdu is left alone. The Urdu
SLO form (`... سکیں`) already states what the child can do, and Urdu's
first-person singular carries a grammatical gender the SLO does not.

The SECOND is the lens: what THIS period does with that SLO. Without it a
number-fluency period and the book lesson beside it carry word-for-word the
same objective, and nothing on the plan tells the teacher that one is a
ten-minute drill on numbers she has already taught. The Urdu lens speaks as
the class rather than as one child, for the same gender reason.

Separate from `basicseg` because this is one decision -- how a day's SLO is
said to a child -- that should be arguable on its own, and because it is the
part most likely to be re-worded after a teacher reads it.
"""
import re

# What this period does with the day's SLO, in the child's own words.
LENS = {
    "number_fluency": "Today I work on it fast and out loud, with a partner, "
                      "using this chapter's own numbers.",
    "concrete": "Today I build it with things I can hold before I meet it on "
                "the page.",
    "word_problem": "Today I turn this chapter's stories into a sum, and say "
                    "how I knew which one.",
    "communicative": "Today I say it to another child in my own words, and "
                     "they understand me.",
    "phonics": "Today I hear, say and blend the sounds in this chapter's own "
               "words.",
    # Urdu, and in the class's voice: Urdu's "I" is gendered and the SLO is
    # not, so the plural avoids picking a gender for the child reading it.
    "arkaan_saazi": "آج ہم اس باب کے اپنے الفاظ کو ارکان میں توڑتے اور جوڑتے ہیں۔",
    "investigate_handson": "Today I test it myself and say what I saw.",
    "engage_hook": "Today I ask my own question about it before anyone "
                   "answers it for me.",
}

# A sentence may end in any of these. Urdu's full stop is not a full stop.
ENDS = ".!?۔؟"

# The corpus appends a bracket to a description it derived rather than found.
# A note to us; not something a child reads.
NOTE = re.compile(r"\s*\[[^\]]*\]\s*$")

# Three descriptions in the corpus are not SLOs at all -- they are the record
# that the chapter roadmap has none. Reading one as an objective gives "I can
# chapter roadmap has no dedicated vocabulary SLO", which is worse than the
# lens standing alone.
ROADMAP = "roadmap has no dedicated"

ARABIC = re.compile(r"[؀-ۿ]")


def _is_urdu(text):
    """Does the sentence open in Arabic script? Urdu SLOs need no re-voicing."""
    return bool(ARABIC.search(text[:10]))


def lead(descriptions):
    """The first description that is actually an SLO, or None.

    Empty strings and roadmap notes are walked past rather than voiced.
    """
    for d in descriptions or []:
        t = NOTE.sub("", (d or "").strip()).strip()
        if t and ROADMAP not in t:
            return t
    return None


def student(text):
    """One SLO in the child's voice, or None if there is nothing to say."""
    t = (text or "").strip()
    if not t:
        return None
    if _is_urdu(t) or re.match(r"I\s+[a-z]", t):
        return t
    first = t.split()[0]
    if first.isupper():           # an acronym keeps its capitals
        return "I can " + t
    return "I can " + t[0].lower() + t[1:]


def objective(skill, descriptions):
    """The student-facing objective for one basics period, or None.

    None where the skill is not a basics skill -- a borrowed lens would read
    as an objective and pass every check that only tests for a string.
    """
    lens = LENS.get(skill)
    if lens is None:
        return None
    said = student(lead(descriptions))
    if not said:
        return lens
    if said[-1] not in ENDS:
        said += "."
    return "%s %s" % (said, lens)
