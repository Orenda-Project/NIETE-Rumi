"""What the judge asked for twice, written where the author sees it first.

`cbrief` already gives a lesson author its grounding and its budget. It never
gave them the eleven things the rubric actually withholds marks for, so the
same marks came off in the same places. Measured on grade_1_english chapter 1,
19 Sep 2026 -- seven artefacts judged, six passed, and every 2-rating traced
back to a field that was missing rather than a field that was wrong:

    9G  x3   the teacher's own words for running the partner activity
    9B  x2   a dictation of the pattern the lesson just taught
    5D  x2   an exit ticket in a context the children have not already seen
    8A  x2   one primary skill per period

Three times in seven is not three authors slipping. It is a brief that asked
for a partner activity and never said whose words it meant.

These are not new standards. Every line restates a check the v3 rubric already
scores, in the imperative and with its code attached, so that a rule can be
traced back to the thing that scores it -- and so that a rule nothing scores
any more can be deleted rather than accumulating.

What is deliberately NOT here: a rule telling the author to cover fewer SLOs.
Two of the findings (8A and 0F on segment 5) are a SEGMENTATION fact -- that
row genuinely carries onset-rime rhyming and days-of-the-week sequencing, two
strands with nothing to do with each other. An author who quietly drops one to
score better breaks the SLO-to-activity match the operator asked for by name.
So the rule below says SURFACE it, and the fix belongs upstream in the row.

The third pass, later the same day, found something different and worth saying
plainly: every finding left on segment 5 -- 5D new context, 5D self-prediction,
1F Bloom's -- broke a rule that was ALREADY on this list. Nothing was missing.
So only one clause was added, to the 5D new-context rule, because "an item the
children have not already met" turned out to be abstract enough to be read as
satisfied by a word that had been chalked on the board for twenty minutes.
"""

RULES = (
    "[9G] write the teacher's own words for every pair or group activity -- "
    "the verbatim sentence that sets it up, the one that starts it, the one "
    "that stops it, and one repair line for a pair that has stalled. The "
    "children's sentence frames are not enough: the teacher reading this may "
    "be an A1 English speaker, and anything you leave out they must improvise",

    "[9B] a lesson that teaches a spelling or sound pattern ends by asking "
    "the children to PRODUCE it -- a short dictation of three or four words "
    "using that pattern, with the mark scheme beside it. Matching, circling "
    "and copying are recognition, and recognition is not encoding",

    "[5D] the exit ticket asks the skill in a NEW CONTEXT -- an item the "
    "children have not already met in the I-Do or the We-Do, and one that is "
    "not still on the board in front of them. A word copied off the board "
    "twenty minutes after it went up is not a new context; take a word from a "
    "family the class was taught and never wrote down. Re-asking a worked "
    "example measures memory of the last ten minutes, not the skill",

    "[5D] `self_prediction` is the CHILD rating themselves -- thumbs up, "
    "sideways or down against the success criteria. A sentence describing the "
    "order the child should think in is a strategy note, not a self-rating",

    "[5D] tell the teacher, in words, to read the success criteria aloud "
    "before the children start the exit ticket",

    "[4A] differentiation serves both ends of the room. Name the support for "
    "a child who is stuck AND the stretch for a child who is already secure, "
    "and let the stretch earn credit -- an extension a child cannot be marked "
    "right on is decoration",

    "[7B] check every answer key against its own stimulus, item by item. On "
    "an ordering or sorting task, confirm which items are ALREADY correct "
    "before writing a blanket key: a key that contradicts a child who is "
    "right is worse than no key at all. Read the page truth's `exercises` "
    "list and not its flattened `text_verbatim` -- the list says which "
    "digit is UNDERLINED and what a picture shows, and the flattened "
    "text loses both. Grade 2 Maths page 8 prints 199 with the ONES "
    "nine underlined, worth 9, and it flattens to \"199 9 90 100\"",

    "[7A] every page reference is the number PRINTED in the book, and every "
    "key describes the stimulus the child is actually looking at -- words if "
    "the item shows words, pictures if it shows pictures",

    "[9H] state the child-facing function in one can-do line -- what a child "
    "can do after this lesson that they could not do before, in the words a "
    "child would use",

    "[0A] every learning outcome is a statement with an action verb in it. An "
    "SLO code alone names a row in a curriculum document; it does not tell a "
    "teacher what the children will do today",

    "[1F] the Bloom's level describes what the lesson MOSTLY demands. One "
    "'apply' task inside forty minutes of naming and matching is a remember "
    "lesson, and tagging it 'apply' misdescribes the paper",

    "[6B] name Pakistani children in the examples -- Ayesha, Bilal, Hina, "
    "Usman. Leaning on the textbook's own character for the whole lesson "
    "leaves no child in this classroom named in it",

    "[8A] one period names ONE primary skill, and everything in it serves "
    "that skill. If the segment you were handed carries two strands that have "
    "nothing to do with each other, say so in `notes` and teach both honestly "
    "-- do not drop one to look focused. That is a segmentation fault and it "
    "is fixed in the segment row, not here",

    "[1E] every phase answers the objective the lesson states. An activity "
    "that measures nothing the SLO asked for is an orphan however good it is "
    "-- either give it a matching item in the exit ticket, or leave it out",

    "[9F] a pair task either has an information gap or says in one line that "
    "it has none. Give A something B cannot see and a checkable outcome, or "
    "declare `information gap: none -- controlled practice`. The rubric takes "
    "the honest line; what it will not take is a pair task with nothing to "
    "find out",

    "[8C] find the question the chapter asks and never answers, and answer "
    "it out loud. Nearly every chapter opens with one -- where have you seen "
    "such numbers, how do these help us every day, who in your house does "
    "this -- and then walks straight past it. Give it a minute: children turn "
    "to a bench partner and name a place from their own life, two or three "
    "say it aloud by name, and you close it once yourself using a number or "
    "word already on the page, so the drill has somewhere to land. The "
    "children supply the CONTEXT and nothing else -- the anchor rule still "
    "governs every number and word the class then works on, so do not write "
    "a child's own example on the board as the thing to drill",

    "[7A] the We-Do does not repeat the You-Do word for word. If the same "
    "sentence appears in both, the release never happens -- the We-Do is the "
    "part done WITH the class, and what the children then do alone has to be "
    "the next thing, not the same thing",
    "[2I] the concrete and the pictorial belong in the MAIN arc and they "
    "fade inside the period -- model it pictorially in the I-Do, make and "
    "draw it in the first guided round, then digits alone for the rest. A "
    "manipulative handed out only to the child who has already failed is a "
    "repair, not CPA, and the rubric scores the bridge every child crosses. "
    "Use what the chapter PRINTS before inventing anything: the block "
    "pictures, the draw-or-make task, the picture-only question everybody "
    "skips. It costs no money, it breaks no anchor rule, and it is already "
    "in front of the children",

    "[6C] a period owes TWO student-voice moments, not one. The rubric reads "
    "a single beat as one opportunity rather than a habit. Put the first in "
    "the warm-up -- name someone in your own house who does this -- and the "
    "second INSIDE a round the lesson is already running, half a beat before "
    "the pairs swap: in one word, what could this number be counting here? "
    "The second costs no minutes because it rides on a round that was "
    "already timed. Children supply the context only; the anchor rule still "
    "governs every number and word the class works on",

    "[3B] the You-Do gets at least 30% of content time -- nine minutes of "
    "thirty. Below that the release reads as token however good the task "
    "is. The I-Do wants about a sixth and no more, and the minute the You-Do "
    "needs comes out of the We-Do, never out of the exit ticket. The shape "
    "that measured well: warm-up 5, I-Do 5, We-Do 8, You-Do 9, exit 3",

    "[7A] anything the lesson states twice is stated the same way twice. "
    "The phase plan in `scope_declaration` and the minutes on the steps; the "
    "round a number is worked in, in the script and in the partner activity; "
    "the page a task sits on. Write the plan LAST, off the finished steps, "
    "rather than writing it first and hoping the steps still agree",
)
