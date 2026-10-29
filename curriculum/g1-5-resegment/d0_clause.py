"""The clause pass — DECLINED. `split_clause` returns the line unchanged.

bd-1nndm asked for a second pass under `d0_lines`: where the sentence pass leaves a
run that is ONE over-long sentence, cut it at the author's own clause punctuation.
The goal is real — the operator's words were "authoring needs to make it an easier
read Claude! its difficult to read these pages". Three arms were built. None of them
earns its rows, and the third one is the evidence that the approach itself does not
pay rather than that the first two were written badly.

    v1  cut at `m.end()` for every mark. Rejected: 884 new rows, 884 ending on a
        non-terminal mark, 437 opening on a bare "and"/"so"/"then".
    v2  moved the cut one token LEFT for `;`/`؛`/dashes so the mark opens the next
        row instead of closing this one. Rejected: 568 interior new rows and 568 of
        568 still failed to close a sentence (342 ended ON a coordinating
        conjunction, 226 on a bare determiner/preposition/auxiliary, 0 on a
        sentence-terminal mark). The fragment never moved — only the row's last
        character did, and both of v2's fragment predicates read only the last
        character. v2 also cut 225 Urdu source runs across 83 lessons against the
        operator's standing ruling, and made cap overflow WORSE.
    v3  semicolon only, cut AFTER the mark, Urdu excluded outright, balanced quotes
        and brackets guarded. Measured, then declined here.

v3 is the only arm whose rows close a clause — 0 of 108 fail — and it still does not
clear the bar the brief set, "do not ship a change that adds rows and reduces
nothing":

    arm    printed rows   rows >25w   runs cut   new rows   fail to close a clause
    base        16,852       1,733          —          —                        —
    v2          17,938       1,002        965      1,047            1,044 /1,047
    v3          16,961       1,653        104        108                0 /  108

    pages, 9 documents rendered base vs v3, ZERO changed:
        g1_ch8 Maths_seg5 5/5 · g4_ch9 English_seg7 8/8 · g5_ch8 Urdu_seg9 21/21
        g4_ch10 Urdu_seg2 10/10 · g2_ch8 English_seg1 6/6 · g3_ch8 Maths_seg5 7/7
        g4_ch8 Maths_seg4 6/6 · g5_ch9 Science_seg4 9/9 · g2_ch9 English_seg1 14/14

    teach blocks past the 8-page cap, base -> v2 -> v3, from the render reports:
        g5_ch8 Urdu_seg9  62 -> 70 -> 62      g2_ch9 English_seg1  61 -> 66 -> 61
        g5_ch9 Science_s4  5 ->  6 ->  5      g4_ch10 Urdu_seg2    10 -> 11 -> 10

v3 touches 60 of 335 documents, adds at most 4 rows in any one of them, moves 0.6%
of printed rows, and removes zero pages and zero blocks past the cap. It also cannot
grow much: of the 1,733 over-threshold printed rows, 692 are Urdu and exempt, and of
the 1,041 that remain only 136 carry a semicolon at all. The other clause marks are
exactly the ones v1 and v2 died on — 572 comma+conjunction, 215 spaced dash, and 266
rows with no clause mark of any kind, which no splitter can reach without authoring.
Even a perfect clause splitter is arguing over ~10% of the wall.

And some corpus semicolons are super-commas inside a list, not clause joins, so even
the semicolon-only rule is not uniformly safe. g5_ch9 Science_seg4 opens a row on
"the bookshelf back, one side, and one shelf with the textbook dimensions; and a
safe LED-to-2-volt-battery connection." — a list item, not an independent clause.

WHERE THE PAGES ACTUALLY ARE. The operator's complaint has a different cause, and
both judges' framing missed it. `renders/` was built at 11:41-11:44 on 24 Sep and
`d0_lines.py` was last changed at 14:43, so the shipped corpus predates the current
sentence pass. Of the 3,052 over-threshold printed rows in it, 2,573 (84%) are runs
the EXISTING sentence pass already splits and that never reached it, worth +10,292
rows. Only 479 are genuine one-sentence walls a clause pass could ever address. The
unsplit-but-splittable rows by surface:

    key_points.items 770 · worked_example.steps 684 · faded_example.steps 656
    faded_example.turn.do 254 · worked_example.turn.do 209

The 488-word row the judge found in g2_ch9/docs/English_seg1.lp.json is the clearest
case: it is a `Say:` line, and `d0_lines.split_line` breaks it into 44 rows of 25
words or fewer on its own. It survives because of a ROUTING hole — `d0_primary.py`
deliberately opts `worked_example.steps` out of `split_items` (bd-nuvtm, the
renderer numbers steps by position and authored "STEP N" labels exist), and
`d0_blocks.move_lines` never splits a flat `steps` list either. That is the bead
worth filing. It is not this module's, and it is not a clause problem.

So this module stands down and stays as the record of why, rather than being deleted
and re-attempted a fourth time. `d0_lines` still calls it, so the call site and its
tests keep working; it simply never changes anything. To revive it, beat "leave it
unsplit" on PAGES, not on a table of row counts.
"""

THRESHOLD = 25          # kept in step with d0_lines; test_d0_clause pins them equal


def split_clause(line):
    """One printable line -> `[line]`. The clause pass is declined; see above.

    Deliberately total and side-effect free: every caller gets a one-element list
    holding exactly the string it passed in, so no row is added, no character
    moves and Law 16 holds by construction rather than by measurement.
    """
    return [line or ""]
