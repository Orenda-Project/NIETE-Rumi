"""How a lesson is SEATED on the rendered page, and what that costs in words.

`lessonrules` says what a period must teach. This says what survives the render.

The two are different, and an author who knows only the first writes a good
lesson that arrives truncated. The renderer does not lay out the artefact field
by field: it pours several fields into a small number of SURFACES, and each
surface is capped. Two fields that read as separate in the JSON can land in one
block and share one budget; a field that looks expensive can cost nothing;
and one surface is charged before the author has written a word.

The measured map, from `bodysurface.FEEDS` and `contentbudget.CAPS`:

    key_points      120   <- hookStory narration, hookCharacters,
                             steps[You-Do] (action AND say), homework,
                             and a hardcoded `remember` placeholder worth 10
    worked_example  470   <- steps[I-Do] AND workedExample, summed
    faded_example   470   <- steps[We-Do] AND partnerActivity, summed
    practice        350   <- problems ONLY
    big_idea         80   <- bigIdea
    uncapped              ask, warmup, board, keywords, exit_ticket

So the real author budget for `key_points` is 110, not 120, and the fields that
feel like the heart of a lesson -- `boardWork`, `keyFact`, `warmUp`,
`exitTicket`, `weakLearnerSupport`, `challengeExtension`, `flex_note`, `cfu` --
are free. Rules 32 and 33 came out of the summed surfaces. Rules 34 and 35 came
out of six failed gate cycles on grade_3_math chapter 14 and two wrong
hypotheses before the splitter was read rather than guessed; once written down,
chapter 15's two lessons gated first-pass and in one patch.

These are separated from `lessonrules` because they answer a different question
and will grow on their own schedule: they change when the RENDERER changes,
not when the rubric does.
"""

SURFACE = (
    "[7A] the I-Do script and `workedExample` share one word budget. The "
    "render seats both as `worked_example` blocks and the budget SUMS every "
    "block of a type, against a single cap of 470 -- so a full telling in "
    "the step and a second full telling in the field breaks the cap before a "
    "teacher has read a word. Measured on grade_3_math chapter 7, 20 Sep "
    "2026: the pair came to 558 against the 470. Let the step BE the "
    "teaching the teacher says out loud, and let `workedExample` be what she "
    "needs before she says it -- the model in her hands, the columns on the "
    "board, the order to take them in. Two tellings is one telling too many",

    "[7A] anything the lesson states twice is stated the same way twice. "
    "The phase plan in `scope_declaration` and the minutes on the steps; the "
    "round a number is worked in, in the script and in the partner activity; "
    "the page a task sits on. Write the plan LAST, off the finished steps, "
    "rather than writing it first and hoping the steps still agree",

    "[7A] put the hook's ONLY quoted question at the very END of its quoted "
    "speech. The renderer splits `hookStory` on quotation marks and charges "
    "the halves differently: quoted sentences up to and INCLUDING the first "
    "quoted question become an uncapped `ask` block and cost nothing, and "
    "everything else -- all narration outside the quotes, and every quoted "
    "sentence AFTER that first question -- is charged against the 110 words "
    "`key_points` leaves you. So a hook whose question comes early pays for "
    "all the speech that follows it. Write short narration, then one "
    "unbroken run of quoted speech, and end that speech on the question. "
    "Measured on grade_3_math chapter 15 seg802, 20 Sep 2026: the same 92-word "
    "hook charges 21 words with its question last and 72 with the question "
    "moved second -- same sentences, same order of ideas, 51 words of "
    "difference, against a room of 110",

    "[7A] when a surface is over, move the words to a field that is free "
    "before you cut them. `flex_note` and `cfu` on a step cost nothing, and "
    "so do `boardWork`, `keyFact`, `warmUp`, `exitTicket`, "
    "`weakLearnerSupport` and `challengeExtension` -- and a You-Do step "
    "charges its `action` AND its `say` together, so shuffling a sentence "
    "between those two saves nothing at all. An instruction for the teacher "
    "about how to run the task ('send back any slate that shows no count') "
    "belongs in `flex_note` on pedagogy as well as on budget: it is not what "
    "she says to the children. Cut only what no field wants",
)
