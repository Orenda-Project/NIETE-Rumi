# -*- coding: utf-8 -*-
"""Which tabs the sheet has, in what order, and who is allowed to write them.

Split out of `build.py`, which had grown past the file limit, but the split
earns its keep on its own: "who owns this tab" is now one question with one
answer in one place, and `--derived`'s safety property can be read without
reading the builder.

Three kinds of tab:

  * the four SUBJECT tabs, which carry Stage C enrichment a human and a
    model put there and which `--derived` must never touch;
  * the LIVE_OWNED tabs, built by a pass that reads the live sheet rather
    than the corpus, so `build.py` has no rows for them and repainting one
    would blank it; and
  * everything else, DERIVED -- computed from the corpus, holding nothing
    anyone typed, safe to drop and rebuild at any time.

DERIVED is the complement of the first two and is never written by hand,
so adding a tab to either protected list is enough to protect it.
"""
SUBJECT_TABS = {"English": u"English G1–5", "Urdu": u"Urdu G1–5",
                "Maths": u"Maths G1–5", "Science": u"Science G4–5"}

TAB_ORDER = ["Navigation", "Teaching Calendar",
             u"Calendar — assumptions", u"English G1–5",
             u"Urdu G1–5", u"Maths G1–5", u"Science G4–5",
             "Coverage Map", u"Coverage — gaps", "FLN Coverage",
             "Skills Map", "Move Spines", "SLO Sentences",
             "All Segments + SLOs", "Skill Taxonomy", "Pipeline Stages",
             "Samples Review", "QA Checklist"]

#: Built by `slorun` from the live sheet -- the pairing of a code with the
#: sentence a day row actually carries is knowable only there, so the
#: corpus cannot produce these rows and `--derived` must leave them be.
LIVE_OWNED = ("SLO Sentences",)

_PROTECTED = set(SUBJECT_TABS.values()) | set(LIVE_OWNED)

# The tabs computed from the corpus and holding nothing a human put there.
# `--derived` repaints exactly these, and `reset_tabs` drops only the titles
# it is handed, so a subject tab's Stage C enrichment is out of reach of the
# mode by construction — see test_build_derived.
DERIVED = tuple(t for t in TAB_ORDER if t not in _PROTECTED)

NAV_LABEL_TO_TAB = dict((t, t) for t in TAB_ORDER)
