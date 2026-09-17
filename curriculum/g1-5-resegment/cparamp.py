"""The A in the CPA ramp: naming the days that work in symbols alone.

Concrete → Pictorial → Abstract is the spine of primary Maths teaching, and
the Maths tab's Skill type column IS that ramp. It was printing only the
first two thirds of it. The segmentation corpus never uses `abstract` as a
skill type anywhere in Grades 1–5: all 245 days whose `cpa_phase` reads
"abstract" were labelled `pictorial_abstract`, so the ramp ended at the
bridge. FLN Coverage showed Abstract at 0.0% in every grade, which read as a
curriculum with no symbolic destination (bd-f2z81).

The distinction is recovered from the textbook's own section names rather
than invented. The books separate sections that put something in front of
the child — Adventure Begins, Leap and Learn, Discovery Playground, Gather
and Grow, Connect and Create — from sections that are symbol practice:
Skill Sharpener, Copy Work, Practice Questions. A day built only out of the
second kind is working in symbols alone.

Two guards keep this conservative, because relabelling a teaching day is a
pedagogical claim:

1. The first bridging day in a chapter stays the bridge, even if its section
   is symbol-only. That day is where the picture meets the numeral —
   "Count the Group and Write the Numeral" is the bridge, not abstraction.
   You cross once per chapter; what follows is practice.
2. A section we do not recognise keeps its existing label. Some segments
   carry a topic sentence where the section name should be ("Rounding
   Decimals"), and no evidence is not the same as evidence of abstraction.

`cpa_phase` is left exactly as the source wrote it. This module renames the
skill type, which is what the sheet prints; it does not rewrite the corpus's
own view of the day.

Like the revision fold, this runs at the single load door in
`stageb.load_book`, so the subject tab, the calendar and every coverage tab
see the same ramp. Applied at one call site and not another, they would be
free to disagree about what a day teaches.
"""
import re

# Sections that put a thing, a picture or a situation in front of the child.
REPRESENTATIONAL = ("adventure begins", "leap and learn", "discovery playground",
                    "gather and grow", "memory lane", "connect and create",
                    "explore", "hands", "number line", "chart")

# Sections that are practice in symbols.
SYMBOLIC = ("skill sharpener", "copy work", "practice question", "practice",
            "skill builder")

BRIDGE = "pictorial_abstract"
ABSTRACT = "abstract"


def _sections(text):
    return [p.strip().lower()
            for p in re.split(r"[+;&]", text or "") if p.strip()]


def _has(parts, words):
    return any(word in part for part in parts for word in words)


def symbol_only(section):
    """True when every named section of the day is symbol practice."""
    parts = _sections(section)
    if not parts:
        return False
    return _has(parts, SYMBOLIC) and not _has(parts, REPRESENTATIONAL)


def name_abstract(segments, subject):
    """Rename post-bridge symbol-only Maths days. Returns (segments, named)."""
    if subject != "Maths":
        return segments, 0
    out, crossed, named = [], set(), 0
    for seg in segments:
        if not seg.get("day_label") or seg.get("skill_type") != BRIDGE:
            out.append(seg)
            continue
        chapter = seg.get("chapter_number")
        if chapter in crossed and symbol_only(seg.get("section")):
            seg = dict(seg, skill_type=ABSTRACT)
            named += 1
        else:
            crossed.add(chapter)
        out.append(seg)
    return out, named
