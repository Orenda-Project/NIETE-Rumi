"""The opening box splits a hookStory without losing a word of it."""

import d0_hook

# Verbatim from the G4 Ch9 English corpus, segment 1 -- the 76-word block that printed as
# one navy wall on page 1 and prompted the operator's readability complaint.
REAL = (
    "Show textbook p.102. Point to the girl avatar and read: “Before we twirl through "
    "our poem, let's first look at the title and the picture. What words do you think you "
    "will read about in a poem on dances?” Say: “The title is ‘The Dancing Poem’. The "
    "picture shows children making dance-like poses beside wooden stools or drums. We will "
    "use the title, picture, definitions, and actions to understand four new words before "
    "reading the poem.”"
)


def bare(w):
    """A word without the punctuation the split may legitimately move or add.

    Cutting "Point to the girl avatar and read:" at its connector leaves a fragment that
    needs its own full stop, so `avatar` prints as `avatar.` -- a word that moved
    sentence-final, not a word that was dropped.
    """
    return w.strip('.,:;!?\u201c\u201d\u2018\u2019"\'')


def words(blocks):
    """Every word the blocks will print."""
    out = []
    for b in blocks:
        out += (b.get("question") or "").split()
        for i in b.get("items") or []:
            out += i.split()
    return [bare(w) for w in out]


class TestTheSplit:
    def test_one_wall_becomes_do_ask_and_read_aloud(self):
        got = d0_hook.hook_blocks(REAL)
        assert [(b["type"], b.get("title")) for b in got] == [
            ("key_points", "Set this up"),
            ("ask", None),
            ("key_points", "Then read aloud"),
        ]

    def test_the_provocation_is_the_hook_and_there_is_exactly_one(self):
        got = d0_hook.hook_blocks(REAL)
        hooks = [b for b in got if b.get("hook")]
        assert len(hooks) == 1
        assert hooks[0]["question"].endswith("in a poem on dances?")

    def test_the_question_keeps_the_lead_in_that_introduces_it(self):
        # The cut falls AFTER the first question, so "let's first look at the title"
        # stays with the question it leads into rather than printing after it.
        q = [b for b in d0_hook.hook_blocks(REAL) if b.get("hook")][0]["question"]
        assert q.startswith("Before we twirl")
        assert q.count("?") == 1

    def test_the_teacher_does_not_read_the_stage_directions_aloud(self):
        setup = d0_hook.hook_blocks(REAL)[0]["items"]
        assert setup == ["Show textbook p.102.", "Point to the girl avatar."]
        # "and read:" pointed at a quote that is now its own block.
        assert not any("read:" in i for i in setup)

    def test_nothing_is_shortened(self):
        # Routing, not authoring: every word of the source still prints. The only
        # losses allowed are the quote marks and the connector that introduced them.
        printed = set(words(d0_hook.hook_blocks(REAL)))
        source = {bare(w) for w in REAL.split()}
        missing = {w for w in source - printed if w not in {"read", "Say", ""}}
        assert not missing


class TestItRefusesToGuess:
    def test_an_empty_hook_makes_no_block(self):
        assert d0_hook.hook_blocks("") == []
        assert d0_hook.hook_blocks(None) == []

    def test_an_unquoted_hook_stays_exactly_as_it_arrived(self):
        # Maths hooks are frequently one unquoted imperative. A partial split would be
        # a worse page than none, so the whole string goes back into the hook.
        plain = "Hold up ten straws and ask the class how many tens they can see."
        assert d0_hook.hook_blocks(plain) == [
            {"type": "ask", "id": "hook", "hook": True, "question": plain}
        ]

    def test_quoted_speech_with_no_question_in_it_stays_whole(self):
        told = "Say: “Today we count in tens. Watch my hands.”"
        got = d0_hook.hook_blocks(told)
        assert len(got) == 1 and got[0]["question"] == told

    def test_straight_quotes_split_the_same_as_curly_ones(self):
        got = d0_hook.hook_blocks('Point at the map. Ask: "Which river is longest?"')
        assert [b["type"] for b in got] == ["key_points", "ask"]
        assert got[1]["question"] == "Which river is longest?"


class TestASingleQuotedHookIsStillAScript:
    """bd-zrl25 -- the splitter only ever saw DOUBLE quotes, so half the corpus walled up.

    OPERATOR, twice, in different words: *"the kie.ai LPs had images, here its just so
    much text dump, we need to reduce the script"* and *"there is alot of script to go
    through"*.

    `_QUOTED` was `[“"]([^”"]+)[”"]`. Measured on the 30 authored `hookStory` fields of
    the G3 Ch2 trio, the straight SINGLE quote is the corpus's commonest quote mark by a
    factor of nearly four (75 occurrences against 20 straight doubles and no curly doubles
    at all), so a hook that quoted with `'` never matched, fell through `_fallback`, and
    printed as one block.

    The naive repair -- adding `'` to the character class -- is worse than the bug. The
    same character is the English apostrophe, and it is the MORE common use: 563 of the
    corpus's straight singles sit between two letters (`can't`, `let's`, `Explorer's`)
    against 348 in a delimiter position. A character-class fix cuts `'I can't wear these.'`
    at the `n't` and prints broken English to a teacher. The curly `’` is no safer: the
    corpus uses it for both jobs too (`aunt’s bazaar` alongside `‘in total’`).

    So the delimiter is decided by CONTEXT, not by the character: a quote OPENS only after
    the start of the string or a space/bracket and before a non-space, and CLOSES only
    after a non-space and before the end, a space or closing punctuation. An apostrophe is
    neither, because it has a letter on both sides. Where that test cannot settle it -- an
    opening mark that never closes, or a possessive plural inside an open span -- the hook
    falls back whole. A wall is ugly; a word cut in half is wrong.
    """

    SINGLE = (
        "Point to the textbook picture on page 26. Ask: 'Which of these two numbers is "
        "bigger?' Say: 'We will add them in columns today.'"
    )

    def test_a_single_quoted_hook_splits_like_a_double_quoted_one(self):
        got = d0_hook.hook_blocks(self.SINGLE)
        assert [(b["type"], b.get("title")) for b in got] == [
            ("key_points", "Set this up"),
            ("ask", None),
            ("key_points", "Then read aloud"),
        ]

    def test_the_single_quoted_provocation_is_the_question_itself(self):
        got = d0_hook.hook_blocks(self.SINGLE)
        assert got[1]["question"] == "Which of these two numbers is bigger?"

    def test_a_contraction_inside_the_span_is_not_a_quote_boundary(self):
        # Verbatim shape of English_seg2's hookStory: an apostrophe inside the quoted
        # speech. A character-class fix closes the quote at `can` and loses `'t wear these`.
        hook = (
            "Hold up the new glasses. Ask: 'Jojo whispers, I can't wear these. Why would "
            "a boy be scared of a pair of glasses?'"
        )
        q = [b for b in d0_hook.hook_blocks(hook) if b.get("hook")][0]["question"]
        assert q == (
            "Jojo whispers, I can't wear these. Why would a boy be scared of a pair of "
            "glasses?"
        )

    def test_a_contraction_with_no_quotes_at_all_is_left_whole(self):
        plain = "Hold up ten straws and ask how many tens they can't see yet."
        assert d0_hook.hook_blocks(plain) == [
            {"type": "ask", "id": "hook", "hook": True, "question": plain}
        ]

    def test_typographic_single_quotes_split_and_their_apostrophe_does_not(self):
        # The corpus writes `‘in total’` in Maths and `aunt’s bazaar` in the same files,
        # so U+2019 has to be read by context exactly like the straight one.
        hook = "Point at the board. Ask: ‘Which word doesn’t belong here?’"
        got = d0_hook.hook_blocks(hook)
        assert [b["type"] for b in got] == ["key_points", "ask"]
        assert got[1]["question"] == "Which word doesn’t belong here?"

    def test_an_unclosed_quote_falls_back_whole_rather_than_half_splitting(self):
        broken = "Point at the board. Ask: 'Which word does not belong here?"
        assert d0_hook.hook_blocks(broken) == [
            {"type": "ask", "id": "hook", "hook": True, "question": broken}
        ]

    def test_a_possessive_plural_inside_a_span_falls_back_rather_than_guessing(self):
        # `friends'` is indistinguishable from a closing quote by character AND by
        # context. Closing there would make the hook read "Which of your friends" --
        # a question the author never wrote. Unsure means fall back.
        hook = "Point at the board. Ask: 'Which of your friends' names is longest?'"
        assert d0_hook.hook_blocks(hook) == [
            {"type": "ask", "id": "hook", "hook": True, "question": hook}
        ]

    def test_a_single_quote_nested_in_a_double_quoted_span_does_not_close_it(self):
        # The G4 fixture at the top of this file already does this with curly marks;
        # the straight pairing has to behave the same way.
        hook = "Say: \"The title is 'The Dancing Poem'. What will we read? Listen.\""
        got = d0_hook.hook_blocks(hook)
        assert got[0]["question"] == "The title is 'The Dancing Poem'. What will we read?"
        assert got[1]["items"] == ["Listen."]


class TestACitedTitleIsNotSomethingTheTeacherSays:
    """bd-zrl25 (2) -- the quote-scanner reached a quoted TITLE and read it as speech.

    G3 English seg1 opens `Look at our new chapter's title, 'See? We're All Special!',`.
    Once single quotes were visible the splitter made the chapter title the lesson's one
    `hook: true` ASK -- the single word `See?` -- and demoted the real question (`Why might
    a boy not want to wear a new pair of glasses?`) into the setup list. Before the quote
    fix this lesson printed correctly, so this is a regression the fix caused.

    A word count cannot tell the two apart: `See? We're All Special!` is four words, and
    any threshold that rejects it also rejects real short speech. The narration in front of
    the mark can: a span introduced by a NAMING word is cited, not uttered. Measured over
    the 37 spans the scanner finds in the 30 authored hookStory fields, exactly one is
    title-introduced and 34 are introduced by a speech verb or a bare `Say:`/`Then ask:`,
    so the two populations separate cleanly on that word.
    """

    SEG1 = (
        "Look at our new chapter's title, 'See? We're All Special!', on page 13, and look "
        "only at the picture -- do not read the words yet. SEE: write one thing you can see "
        "in the picture. Here is the puzzle: Jojo stands beside his new glasses on the "
        "ground, looking worried. Why might a boy not want to wear a new pair of glasses?"
    )

    def test_a_cited_title_makes_the_hook_fall_back_whole(self):
        assert d0_hook.hook_blocks(self.SEG1) == [
            {"type": "ask", "id": "hook", "hook": True, "question": self.SEG1}
        ]

    def test_a_speech_verb_introducer_is_not_caught_by_the_citation_rule(self):
        hook = "Look at the board. Zainab says, 'Which of these two numbers is bigger?'"
        assert [b["type"] for b in d0_hook.hook_blocks(hook)] == ["key_points", "ask"]


class TestAnAttributionRidesWithTheSpeechItIntroduces:
    """bd-zrl25 (3) -- `Zainab says.` alone on a setup line, on every Maths lesson.

    `_CONNECTOR` matches the bare directions `read|say|ask|tell`, which are pure stage
    direction and come off. It does not match the INFLECTED `says|asks|replies|disagrees`,
    which are not stage direction at all: they name who is speaking. Once single quotes
    made the speech visible, the speech moved to the ASK and the naming clause stayed
    behind as a line reading `Zainab says.` -- on all 8 Maths hooks of the trio.

    Dropping the clause instead would lose `Zainab`, and this module routes rather than
    authors. So the attribution moves WITH its speech, carrying the source's own comma and
    its own quote marks.
    """

    SEG1 = (
        "Look at these two price tags now on the board. WONDER: write one question you want "
        "answered before we start. Zainab says, 'I can find the total without starting all "
        "over at 1.' Bilal asks, \"If we begin at 2,299, how can a number line show exactly "
        "eight moves to the total?\""
    )

    def test_the_setup_never_prints_a_speaker_with_nothing_to_say(self):
        setup = d0_hook.hook_blocks(self.SEG1)[0]["items"]
        assert not any(i in ("Zainab says.", "Bilal asks.") for i in setup)
        assert setup[-1] == "WONDER: write one question you want answered before we start."

    def test_the_attribution_leads_the_speech_in_the_ask(self):
        q = [b for b in d0_hook.hook_blocks(self.SEG1) if b.get("hook")][0]["question"]
        assert q.startswith("Zainab says, 'I can find the total without starting all over at 1.'")
        assert "Bilal asks, \"If we begin at 2,299," in q

    def test_the_ask_no_longer_opens_mid_sentence_in_lower_case(self):
        # Maths_seg2 printed `we can add the numbers straight down in columns. When 5
        # tens...` -- the same seam, seen from the other end.
        hook = (
            "Ayesha says, 'we can add the numbers straight down in columns.' Then ask: "
            "\"When 5 tens and 5 tens make 10 tens, where must the new hundred go?\""
        )
        q = [b for b in d0_hook.hook_blocks(hook) if b.get("hook")][0]["question"]
        assert q.startswith("Ayesha says,")

    def test_a_colon_attribution_moves_too_and_keeps_its_colon(self):
        hook = (
            "Write both numbers on the board. Fatima disagrees: 'Selling means the number "
            "should go back.' Then ask: \"WHY does subtraction move backward?\""
        )
        got = d0_hook.hook_blocks(hook)
        assert got[0]["items"] == ["Write both numbers on the board."]
        assert got[1]["question"].startswith(
            "Fatima disagrees: 'Selling means the number should go back.'"
        )

    def test_a_bare_stage_direction_is_still_stripped_and_never_moved(self):
        # `Then ask:` has no speaker, so it stays the connector it always was.
        hook = "Write 6,500 on the board. Then ask: \"WHY must we organise our thinking?\""
        got = d0_hook.hook_blocks(hook)
        assert got[0]["items"] == ["Write 6,500 on the board."]
        assert got[1]["question"] == "WHY must we organise our thinking?"
