"""A segment row for a period the book never claimed.

`basics` names the 366 basics periods. Nothing downstream can act on a name:
Stage C reaches a lesson through `corpus/seg/<book>.json`, so a period with
no row there has no route, no brief and no render. This mints the row.

Two constraints shape it, and they pull against each other.

THE INDEX MUST NOT MOVE. `judgerun` finds an authored artefact by
`<stem>_ch<n>_seg<i>.json`, so the index is the artefact's address. Numbering
basics rows by where they fall in the year would re-address all of them the
next time a chapter is folded, split or re-paced, and authored work would
re-attach to a different day without anything failing. The index is therefore
computed from (skill, ordinal) -- the identity `basics` already guarantees --
inside a band no real day occupies. Measured 20 Sep 2026: no real
`segment_index` exceeds 99, and the only values above it anywhere in the
corpus are the tail sentinels 990 (review) and 995 (assessment), 233 of each.
The band below them is free.

THE SLO MUST BE HONEST. A number-fluency period is not an FDE objective --
the syllabus has no such SLO -- so the row claims none. Stamping the anchor
chapter's codes on it would report the syllabus as covered by days that never
taught it, and would put the row in direct disagreement with the Coverage
Map, which deliberately shows these skills as zeros and invents no number for
them. Instead the row carries its own formative objective and names the
chapter SLOs it FEEDS in `supports_slo_codes`, a field no coverage
arithmetic reads. FDE's assessments are summative; ours are the formative
spiral underneath them, and the row says so rather than borrowing a code.
"""

# One 20-wide lane per skill, so an index depends only on (skill, ordinal)
# and never on the year. Adding a skill appends a lane; it never renumbers an
# existing one, which is the property that keeps authored work attached.
SLOT = {
    "number_fluency": 0,
    "concrete": 1,
    "word_problem": 2,
    "communicative": 3,
    "phonics": 4,
    "arkaan_saazi": 5,
    "investigate_handson": 6,
    "engage_hook": 7,
}

NAME = {
    "number_fluency": "Number Fluency",
    "concrete": "Concrete Maths",
    "word_problem": "Word Problems",
    "communicative": "Communicative Language",
    "phonics": "Phonics",
    "arkaan_saazi": "ارکان سازی / Syllables",
    "investigate_handson": "Investigate (hands-on)",
    "engage_hook": "Engage Hook",
}

# What the period is for, in the teacher's terms. Ours and formative, so it
# is worded as its own objective rather than borrowed from the syllabus.
OBJECTIVE = {
    "number_fluency": "Children work quickly and confidently with this "
                      "chapter's own numbers, out loud and in pairs.",
    "concrete": "Children build this chapter's idea with objects they can "
                "hold before they meet it on the page.",
    "word_problem": "Children turn this chapter's situations into a "
                    "calculation, and say how they knew which one.",
    "communicative": "Children use this chapter's language to say something "
                     "real to another child, and are understood.",
    "phonics": "Children hear, say and blend the sounds in this chapter's "
               "own words.",
    "arkaan_saazi": "بچے اس باب کے اپنے الفاظ کو ارکان میں توڑتے اور جوڑتے "
                    "ہیں۔",
    "investigate_handson": "Children test this chapter's claim themselves "
                           "and say what they saw.",
    "engage_hook": "Children raise their own question about this chapter "
                   "before it is explained to them.",
}

LANE = 20
BASE = 800
MAX_ORDINAL = LANE - 1          # 1..19; the largest real group is 16

# docs/05-basics-build.md assumes 40 minutes everywhere. No book does: the
# corpus holds 30 (1,635 days), 35 (372) and 25 (32), and nothing at 40. A
# basics period is a slot in the same timetable as the days either side of
# it, so it inherits their length and the spec is the thing that is wrong.
FALLBACK_MIN = 30


def index_of(skill, ordinal):
    """The stable `segment_index` for the nth basics period of one skill."""
    if skill not in SLOT:
        raise KeyError(
            "no index lane for basics skill %r -- add it to basicseg.SLOT; "
            "an invented lane would overlap another skill's" % skill)
    if not 1 <= ordinal <= MAX_ORDINAL:
        raise ValueError(
            "ordinal %d is outside the %d-wide lane for %r. Wrapping it would "
            "collide with the next skill's lane, which is the one failure "
            "nothing downstream would notice" % (ordinal, LANE, skill))
    return BASE + SLOT[skill] * LANE + ordinal


def _pages(rows, key):
    out = sorted({p for r in rows for p in (r.get(key) or [])})
    return out


def segment(record, chapter_rows):
    """A `corpus/seg`-shaped row for one `basics.records()` entry.

    `chapter_rows` are the real segments of the chapter the period is
    anchored to. They supply the grounding: the pages, the title, and the
    objectives this period feeds.
    """
    skill = record["skill"]
    if not chapter_rows:
        raise ValueError(
            "%s is anchored to chapter %s but that chapter has no segments, "
            "so there are no pages to teach it from. Every basics template "
            "works on the chapter's own words and numbers -- the class never "
            "leaves the book -- so an ungrounded basics row is not buildable"
            % (record["id"], record["chapter"]))

    printed, pdf = _pages(chapter_rows, "pages_printed"), _pages(chapter_rows, "pages_pdf")
    if not printed and not pdf:
        raise ValueError("%s: chapter %s carries no page numbers at all"
                         % (record["id"], record["chapter"]))

    titles = [r.get("chapter_title") for r in chapter_rows if r.get("chapter_title")]
    lengths = [r.get("duration_min") for r in chapter_rows if r.get("duration_min")]

    return {
        "segment_index": index_of(skill, record["ordinal"]),
        "day_label": "%s %d" % (NAME[skill], record["ordinal"]),
        "chapter_number": record["chapter"],
        "chapter_title": titles[0] if titles else "",
        "topic": "%s, anchored in %s" % (NAME[skill],
                                         titles[0] if titles else "this chapter"),
        "skill_type": skill,
        "pages_printed": printed,
        "pages_pdf": pdf,
        # Empty on purpose. See the module docstring: coverage arithmetic
        # reads this field, and this day did not teach the chapter's SLOs.
        "slo_codes": [],
        "slo_descriptions": [],
        "supports_slo_codes": sorted({c for r in chapter_rows
                                      for c in (r.get("slo_codes") or [])}),
        "objective": OBJECTIVE[skill],
        "duration_min": lengths[0] if lengths else FALLBACK_MIN,
        "new_or_revision": "new",
        "prev_segment_id": None,
        "next_segment_id": None,
        "is_basics": True,
        "basics_id": record["id"],
        "basics_kind": record["kind"],
    }
