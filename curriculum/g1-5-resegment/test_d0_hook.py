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
