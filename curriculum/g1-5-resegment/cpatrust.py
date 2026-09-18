"""When the section name and the page disagree about C, the page wins.

Grade 5 Maths printed 33 concrete days: more periods in children's hands than
any grade above Grade 1, in the board-prep year, and against 11 in Grade 4.
That is not what the book does. The division agent's `_meta.taxonomy` records
the rule it actually applied — "concrete/concept hard-start opens each new
concept" — and 32 of the 33 days carry one section heading, "Leap and Learn".
The same heading is read as concrete on 36 of 54 Grade 1 days and on none of
Grade 3's 34 or Grade 4's 37. The label tracks the heading, not the child.

The corpus already contradicts itself about those days, in its own second
column. `cpa_phase` is what the division agent read off the page, and on
those 33 days it says `pictorial` 28 times and `abstract` 4. Reading all 33
pages settles it: not one puts an object in a child's hands. They are a
context scene and a worked method — ch1 is a family-scene dialogue and a
colour-coded place-value chart, ch4 is the divisibility rule for 7 worked on
2632, ch5 is 1/6 + 5/8 + 1/2 scaled to 31/24. Grade 1's concrete days say the
opposite in the page text itself, 21 of 36 of them naming the material:
"Deal out real counters one-to-one", "Use a real balance and counters or
stones", "act out buying with play money", "Fold and cut real shapes".

So this rule believes the page column over the heading. It renames only the
strongest claim in the taxonomy — the one that says a child is holding
something — because that is the one that was read page by page. Every other
disagreement between the two columns (four Grade 3 days, six more in Grade 5)
is still open and is deliberately left alone rather than swept along with it.

It must run BEFORE cpaopen, and that is the larger half of the repair. The
false label did not only overstate the ramp on the sheet; it suppressed the
fix. cpaopen skips any chapter that already holds a concrete day, all twelve
Grade 5 chapters held one, so Grade 5 was the only grade it never touched:
Grades 2-4 gained 34 hands-on openers between them and the board-prep year
gained none, because of a heading. Corrected first, eleven of those twelve
chapters open in children's hands and the ramp descends 36/15/15/11/12.

The corpus is not edited. `cpa_phase` is the page's own reading and is left
exactly as the source wrote it, as in cparamp; what moves is `skill_type`,
which is what the sheet prints and what every count reads. And what moves is
marked, so a reviewer holding the book can see which days we re-read and to
what — a silent correction is beyond the reach of the person checking it.
"""
import cpaopen

CONCRETE = "concrete"
BRIDGE = "pictorial_abstract"
MARK = "page_phase"

# What the page column is allowed to overrule the heading with. `abstract` is
# not a skill_type the corpus uses — cparamp owns that rename, downstream and
# by section — so a day the page reads as abstract lands on the bridge and is
# named there or not, on the same evidence as every other bridging day.
FROM_PHASE = {"pictorial": "pictorial", "abstract": BRIDGE}


def trust_page(segments, subject):
    """Rename Maths days whose page reading denies their concrete label.

    Returns `(segments, renamed)`. Only Maths carries `cpa_phase`, so every
    other subject passes through untouched.
    """
    if subject != "Maths":
        return segments, 0
    out, renamed = list(segments), 0
    for i, seg in enumerate(out):
        if seg.get("skill_type") != CONCRETE or seg.get(cpaopen.MARK):
            continue
        phase = seg.get("cpa_phase")
        skill = FROM_PHASE.get(phase)
        if skill is None:
            continue
        out[i] = dict(seg, skill_type=skill,
                      **{MARK: f"page reads {phase} — concrete was the "
                                "section heading, not the page"})
        renamed += 1
    return out, renamed
