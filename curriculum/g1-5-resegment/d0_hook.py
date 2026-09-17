"""Stage D0 — the opening box: one hook, split into the three things it actually is.

Operator, on the rendered G4 English page: *"the current html view is not user friendly
in terms of reading, how would a priamry teacher who isnt necessarily an expert in the
subjects she teaches be ablke to read so much text?"*

Page 1 of that render answered her: the hook printed as ONE navy block of 100 words.
Measured across the 38-segment G4 Ch9 corpus, `hookStory` averages 84 words and every
one of them lands in a single `ask.question`. But a hookStory is never one thing. It is
reliably three, run together in one string:

    "Show textbook p.102. Point to the girl avatar and read:  <- what the teacher DOES
     “…What words do you think you will read about…?”          <- what she ASKS
     Say: “The title is 'The Dancing Poem'. …”"                <- what she READS ALOUD

A teacher scanning that block mid-lesson cannot tell which of the three she is looking
at, because they are set in one typeface at one indent inside one fill. Splitting them
removes not one word -- every character still prints -- and it is the difference between
a paragraph and a script.

The split is ROUTING, not authoring. Nothing here invents, shortens or rephrases; if the
text does not divide cleanly the whole string goes back into the hook exactly as it
arrived (see `_fallback`), because a hook that prints badly beats a hook that prints
wrong.

`say` would be the natural block for the read-aloud part and the v9 renderer implements
it -- but it is NOT in the schema's closed block enum, so it cannot be emitted from a
`lint_profile: full` document. The read-aloud lines take `key_points` instead, which is
the same list-of-lines surface `hook_character_block` already uses for the speech bubble
on the pupil's own page.
"""

from __future__ import annotations

import re

# Curly or straight double quotes. Primary Stage-C emits curly ~94% of the time but the
# corpus carries both, sometimes inside one field.
_QUOTED = re.compile(r"[“\"]([^”\"]+)[”\"]")

# "…and read:", "Say:", "Ask:" — the connector that introduces a quote. Once the quote is
# its own line the connector is pointing at nothing, so it comes off the narration tail.
_CONNECTOR = re.compile(
    r"\s*(?:,\s*)?(?:and\s+)?(?:then\s+)?(?:read|say|ask|tell(?:\s+(?:them|the\s+class))?)\s*:?\s*$",
    re.I,
)

_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def _sentences(text):
    return [s.strip() for s in _SENTENCE.split((text or "").strip()) if s.strip()]


def _clean_narration(chunk):
    """A between-quotes fragment, stripped of the connector that pointed at the quote."""
    out = []
    for s in _sentences(chunk):
        s = _CONNECTOR.sub("", s).strip(" ,:;")
        # A bare "Say" or "Point to the girl avatar and read" leaves nothing behind, and a
        # one-word leftover is not an instruction.
        if len(s.split()) >= 2:
            out.append(s if s.endswith((".", "!", "?")) else s + ".")
    return out


def _fallback(hook):
    return [{"type": "ask", "id": "hook", "hook": True, "question": hook}]


def hook_blocks(hook_story):
    """One hookStory -> the opening box's blocks, in the order a teacher performs them.

    Returns `[]` for an empty hook, and a single unsplit `ask` when the string carries no
    quoted speech or no question inside it -- both are common enough in the corpus (Maths
    hooks are frequently one unquoted imperative) that a partial split would be a worse
    page than none.

    The order is DO, then ASK, then READ ALOUD, and it is SOURCE order, not a reordering.
    The cut falls at the first quoted question: everything she says up to and including it
    is the provocation, everything after it is the framing that carries the class into the
    lesson. An earlier pass hoisted the question above its own lead-in, so the page read
    "What words do you expect?" and only then "let's first look at the title" -- correct
    content in an order no teacher would perform.

    The provocation keeps `hook: true`, so it holds the one landmark surface the schema
    allows per lesson -- exactly one per LP, and it is now the ASK rather than the ask plus
    everything around it.
    """
    hook = (hook_story or "").strip()
    if not hook:
        return []

    quotes = [m.group(1).strip() for m in _QUOTED.finditer(hook)]
    quotes = [q for q in quotes if len(q) >= 3]
    if not quotes:
        return _fallback(hook)

    # A quoted span can hold several sentences ("The title is X. What do you notice?"), so
    # the unit is the SENTENCE, not the span. Flatten every quote into one spoken sequence
    # and cut it at the first question.
    spoken = [s for q in quotes for s in _sentences(q)]
    cut = next((i for i, s in enumerate(spoken) if s.endswith("?")), None)
    if cut is None:
        return _fallback(hook)
    provocation = " ".join(spoken[: cut + 1])
    read_aloud = spoken[cut + 1 :]

    narration = []
    for chunk in _QUOTED.split(hook)[::2]:  # split() interleaves: text, group, text, ...
        narration += _clean_narration(chunk)

    blocks = []
    if narration:
        blocks.append({"type": "key_points", "id": "hook-setup",
                       "title": "Set this up", "items": narration})
    blocks.append({"type": "ask", "id": "hook", "hook": True, "question": provocation})
    if read_aloud:
        blocks.append({"type": "key_points", "id": "hook-say",
                       "title": "Then read aloud", "items": read_aloud})
    return blocks
