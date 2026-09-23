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

# WHICH MARK OPENS A QUOTE IS A QUESTION ABOUT CONTEXT, NOT ABOUT THE CHARACTER.
#
# This started as `[“"]([^”"]+)[”"]` -- double quotes only -- and every hook that
# quoted with a single quote fell straight through to `_fallback` and printed as one
# wall. Counted over the 30 authored `hookStory` fields of the G3 Ch2 trio, the straight
# SINGLE quote is the corpus's commonest mark: 75 occurrences, against 20 straight
# doubles and no curly doubles at all.
#
# Adding `'` to that character class would be worse than the bug, because the same
# character is the apostrophe and the apostrophe is the MORE common use of it: 563 of the
# corpus's straight singles sit between two letters (`can't`, `let's`, `Explorer's`)
# against 348 in a delimiter position. A character class cuts `'I can't wear these.'` at
# the `n't`. Nor does preferring typographic marks rescue it -- the corpus writes
# `aunt’s bazaar` and `‘in total’` in the same files, so U+2019 is doing both jobs too.
#
# What DOES separate them is the neighbouring characters. A quote opens after the start
# of the string or a space or a bracket, and before a non-space. It closes after a
# non-space and before the end, a space or closing punctuation. An apostrophe is neither,
# because it has a letter on each side. Scored on all 4,177 strings in the enrichment
# corpus that rule finds 1,077 opening marks and 1,063 closing ones -- balanced to within
# 1.3%, with 18 strings unbalanced.
_OPEN_CHARS = "“\"‘'"
_CLOSE_CHARS = "”\"’'"
# Straight marks serve as both ends of their family, so the family -- not the character --
# is what a span must close on. That is also what keeps `‘The Dancing Poem’` nested inside
# a `“…”` span from closing the span it sits in.
_FAMILY = {"“": "d", "”": "d", '"': "d", "‘": "s", "’": "s", "'": "s"}
_PRE_OPEN = "([—/"
_POST_CLOSE = ",.;:!?)]—-/”\""

# "…and read:", "Say:", "Ask:" — the connector that introduces a quote. Once the quote is
# its own line the connector is pointing at nothing, so it comes off the narration tail.
_CONNECTOR = re.compile(
    r"\s*(?:,\s*)?(?:and\s+)?(?:then\s+)?(?:read|say|ask|tell(?:\s+(?:them|the\s+class))?)\s*:?\s*$",
    re.I,
)

# A NAMING WORD IN FRONT OF THE MARK MEANS THE SPAN IS CITED, NOT SPOKEN.
#
# G3 English seg1 opens `Look at our new chapter's title, 'See? We're All Special!',`. Once
# single quotes were visible the splitter made that chapter title the lesson's one ASK --
# the single word `See?` -- and pushed the real question down into the setup. A length test
# cannot separate the two: the title is four words, and so is plenty of real speech.
#
# The narration in front of the mark can. Of the 37 spans the scanner finds across the 30
# authored hookStory fields, 1 is introduced by a naming word and 34 by a speech verb or a
# bare `Say:`/`Then ask:`; the remaining 2 (`'Pakistan'`, `'two'` in English seg6) are words
# being talked ABOUT rather than said, which this rule does not catch and which is recorded
# as a known gap. A cited span is not routable, so the hook falls back whole.
_CITED = re.compile(r"\b(title|titled|called|named|chapter|book|story|poem|song)\W*$", re.I)

# AN ATTRIBUTION IS NOT A STAGE DIRECTION.
#
# `_CONNECTOR` above takes off `Say:`/`Then ask:`/`and read:` because once the speech is its
# own block that direction points at nothing. It matches the bare verb only, so the inflected
# `Zainab says,` slipped past it -- and when single quotes moved the speech to the ASK, the
# naming clause stayed behind as a setup line reading `Zainab says.` on all 8 Maths hooks of
# the trio. Stripping it instead would delete `Zainab`, and this module routes rather than
# authors, so the clause moves WITH the speech it introduces, comma and quote marks intact.
#
# Finite forms only. The corpus attests `says`, `asks`, `replies`, `whispers`, `disagrees`;
# `said/asked/replied/whispered/disagreed/tells/told/reads` are their tense partners and the
# inflections of the four verbs `_CONNECTOR` already owns. `-ing` is deliberately absent:
# English seg4's `this page opens by asking '...'` is narration, and moving it would leave
# `Here is today's puzzle: this page` behind.
_SPOKE = (r"says|said|asks|asked|replies|replied|whispers|whispered|disagrees|disagreed"
          r"|tells|told|reads")
_ATTRIBUTION = re.compile(
    r"(?:(?<=\s)|\A)((?:[\w'\u2019-]+\s+){1,3}(?:" + _SPOKE + r")\s*[,:]?)\s*\Z", re.I)


# A LIST THE SCHEMA CANNOT HOLD IS A SPLIT THAT CANNOT BE EXPRESSED.
#
# `key_points.items` caps at 6 in `schema/lp_doc.schema.json` -- the live v9 file the
# renderer and the lint gate share -- and ajv refuses the WHOLE document over it, so an
# overlong narration costs the lesson its PDF, not just its box. English seg4 came out at 8.
# Hardcoded rather than imported, so this module stays independent of the renderer tree;
# `test_d0_hook_fit.py` reads the schema and pins the two together.
MAX_ITEMS = 6

_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def _sentences(text):
    return [s.strip() for s in _SENTENCE.split((text or "").strip()) if s.strip()]


def _attribution(chunk):
    """`(chunk without its speaker-naming tail, that tail)`, or `(chunk, None)`.

    A bare direction is checked first and always wins: `Then ask:` names no speaker, so it
    stays the connector it has always been and `_clean_narration` takes it off.
    """
    chunk = chunk or ""
    if _CONNECTOR.search(chunk):
        return chunk, None
    m = _ATTRIBUTION.search(chunk)
    if not m:
        return chunk, None
    return chunk[: m.start(1)], m.group(1).strip()


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


def _is_open(text, i):
    if text[i] not in _OPEN_CHARS:
        return False
    if i + 1 >= len(text) or text[i + 1].isspace():
        return False
    return i == 0 or text[i - 1].isspace() or text[i - 1] in _PRE_OPEN


def _is_close(text, i):
    if text[i] not in _CLOSE_CHARS:
        return False
    if i == 0 or text[i - 1].isspace():
        return False
    return i + 1 == len(text) or text[i + 1].isspace() or text[i + 1] in _POST_CLOSE


def _is_possessive(text, i):
    """A plural possessive (`friends' names`) is a closing quote by every test above.

    Nothing in the character or its neighbours tells the two apart, so a hook that puts
    one inside an open span is not a hook this module can route. It says so rather than
    closing early on it and printing a question the author never wrote.
    """
    if text[i - 1] not in "sS":
        return False
    rest = text[i + 1:]
    stripped = rest.lstrip()
    return len(stripped) < len(rest) and stripped[:1].islower()


def _scan(hook):
    """`([(span, span with its marks)], the text between)`, or None when they do not settle.

    None is the whole point. An opening mark with no close, or an ambiguous close inside
    an open span, means the module cannot tell speech from punctuation -- and a hook that
    prints as one block beats a hook that prints a word cut in half.
    """
    quotes, narration, plain_from, i = [], [], 0, 0
    while i < len(hook):
        if not _is_open(hook, i):
            i += 1
            continue
        family, j = _FAMILY[hook[i]], i + 1
        while j < len(hook):
            if _FAMILY.get(hook[j]) == family and _is_close(hook, j):
                break
            j += 1
        else:
            return None  # opened and never closed
        if _is_possessive(hook, j):
            return None
        narration.append(hook[plain_from:i])
        quotes.append((hook[i + 1:j], hook[i:j + 1]))
        plain_from = i = j + 1
    narration.append(hook[plain_from:])
    return quotes, narration


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

    scanned = _scan(hook)
    if scanned is None:
        return _fallback(hook)
    spans, chunks = scanned
    chunks = list(chunks)

    # A quoted span can hold several sentences ("The title is X. What do you notice?"), so
    # the unit is the SENTENCE, not the span. Flatten every quote into one spoken sequence
    # and cut it at the first question. A span whose speaker was named stays whole instead,
    # because the name and the speech are one utterance.
    spoken = []
    for n, (inner, raw) in enumerate(spans):
        if _CITED.search(chunks[n]):
            return _fallback(hook)
        if len(inner.strip()) < 3:
            continue
        chunks[n], lead = _attribution(chunks[n])
        if lead:
            spoken.append(lead + " " + raw.strip())
        else:
            spoken += _sentences(inner)
    if not spoken:
        return _fallback(hook)
    cut = next((i for i, s in enumerate(spoken)
                if s.rstrip(_CLOSE_CHARS).endswith("?")), None)
    if cut is None:
        return _fallback(hook)
    provocation = " ".join(spoken[: cut + 1])
    read_aloud = spoken[cut + 1 :]

    narration = []
    for chunk in chunks:
        narration += _clean_narration(chunk)

    # Truncating would delete authored lines and merging the overflow would author a run-on,
    # so an unfittable split takes the same refusal `_CITED` and "no question" already take.
    if len(narration) > MAX_ITEMS or len(read_aloud) > MAX_ITEMS:
        return _fallback(hook)

    blocks = []
    if narration:
        blocks.append({"type": "key_points", "id": "hook-setup",
                       "title": "Set this up", "items": narration})
    blocks.append({"type": "ask", "id": "hook", "hook": True, "question": provocation})
    if read_aloud:
        blocks.append({"type": "key_points", "id": "hook-say",
                       "title": "Then read aloud", "items": read_aloud})
    return blocks
