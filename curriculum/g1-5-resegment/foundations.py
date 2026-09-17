"""The six-week Grade 1 Foundations block, and what pays for it.

Children reach Grade 1 with no ECE at all. The first six weeks cannot be the
textbook at a slower rate — they have to be integrated FLN work the book has
no page for: routines and oral language, then rhyme, then syllable, then
initial sound and print concepts, then pencil control and counting, then
consolidation.

Two things had to be true for that to be more than a wish.

  1. It cannot be a WEIGHT. Making content_rate() return 0.0 for those weeks
     was measured and does not work: _take_per_week's water-fill has an
     `or 1` guard and a one-at-a-time fallback that hand the overflow
     straight back to the six blocked weeks, so 33 book periods landed inside
     the block anyway and `dropped` stayed 0 while reporting a year that was
     not the year. A weight cannot express a prohibition. Absence can, so the
     weeks are removed from the share-out and filled by hand.
  2. It has to be paid for. Six weeks of Grade 1 cost 99 periods (English 29,
     Maths 35, Urdu 35) and the year's whole spare is 66, of which 53 already
     sit inside those weeks as on-ramp. That leaves 13 against a 46-period
     bill: a 33-period shortfall, E 4, M 15, U 14. dayfold.fold_revision pays
     it at the load door — every Grade 1 chapter's revision day folds into its
     last teaching day, SLOs and all, buying back E 12, M 15, U 18. It lives
     there and not here so that every tab counts the same Grade 1: a fold the
     allocator did alone gave the calendar 98 English periods while Coverage
     saw 110, and dropped the SLO codes the revision rows carried.
"""

# Grade 1's first six weeks, as week indices from the session's start.
# Children arrive with no ECE at all, and the on-ramp above cannot express
# that: it is a WEIGHT, and _take_per_week's water-fill hands the overflow
# back to whatever a weight tried to empty. Absence can, so these weeks are
# taken out of the share-out entirely and filled by hand.
FOUNDATION_WEEKS = {1: (0, 1, 2, 3, 4, 5)}

# One phase a week, per subject: routines and oral language, rhyme, syllable,
# initial sound and print concepts, pencil control and counting, then
# consolidation. Maths runs those weeks as oral counting into the CPA entry —
# the phase is about the child, not the subject. Every key is already in that
# subject's skills.ORDER; one outside it paints white and leaves the KEY.
# No Grade 1 Science book exists — Science is here so the table is total.
FOUNDATION = {
    "English": ["communicative", "oral_communication", "phonics",
                "pre_reading", "writing", "revision"],
    "Urdu": ["communicative", "alfaaz_maani", "arkaan_saazi",
             "buland_khwani", "takhleeqi_likhai", "duhrai"],
    "Maths": ["number_fluency", "number_fluency", "concrete",
              "pictorial", "pictorial_abstract", "revision"],
    "Science": ["engage_hook", "engage_hook", "investigate_handson",
                "investigate_handson", "concept_build", "revision"]}
