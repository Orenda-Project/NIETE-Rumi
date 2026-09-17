"""Stage D0 — the teacher's move, parsed into TURNS.

A move arrives from Stage C as steps, each with an `action` (what she does) and a `say`
(what she says). `d0_blocks.move_lines` flattens the pair into printable strings, and the
string IS the text dump: over the 38-lesson G4 Ch9 corpus the 76 `Say:` steps hold 824
sentences -- median 10, max 28 -- each printed as one paragraph. This module does not
shorten them. It parses them, so the renderer prints one row per sentence. Reduction is
SCAN cost, not word count: nothing drops a word, held on every lesson by
`test_no_word_of_the_script_is_lost`.

Two measurements shaped the vocabulary, and both contradicted a guess (bd-rv2pk, SYNC §3.17):

1. The action is NOT a restatement of the script. Over the 114 steps carrying both, a
   median 33% of the action's content words appear in its `say`; 1 of 114 reaches 70%,
   none 80%. It is a stage direction -- what she does, with what, on which page -- so a
   verb chip would delete two thirds of it. `do` keeps it whole, marked by ROLE.

2. Call-and-response is real but SPARSE (see the response note below).

KINDS, in detection order. Each is a measured shape, not a category invented for tidiness.
Counts are turns over ALL steps of all 38 lessons -- the population this module can see:
228 printed paragraphs become 1,203 rows, a median of 29 per lesson. The RENDERER is
handed 954 of those, and the gap is wiring, not loss: `d0_blocks` scripts I-Do and We-Do,
You-Do's steps become `practice` items where the question already IS the row, and 68
`frame_turns` come from dialogue frames no `say` string holds. Both populations agree on
the one number the design turned on: 0.67% here, 0.73% there.
    routine  a run of named procedure steps        4 turns   (13 steps merged)
    ask      ends in `?` or `؟`, outside a routine 107 turns  -> may get `expect`
    frame    contains a `___` fill-in blank        31 turns
    calc     two numerals and an operator          28 turns
    do       the step's `action`, kept whole      114 turns
    say      everything else                      919 turns

THE RESPONSE COLUMN IS ALMOST ALWAYS EMPTY, and the renderer must be built for that: 8 of
1,203 rows (0.67%) carry an `expect`. A reserved column would spend width on every row to
serve eight, so the response belongs ON its row, at the reading edge. The plan does not
know what the class will say and must not guess -- an unanswered question gets a ruled
waiting space, not a proxy.

`turns()` returns None when there is nothing to parse, and every caller must then fall back
to the flat `steps` strings -- which stay in the document as the home every other reader
addresses (lint, Stage E voicenotes, the WhatsApp body).
"""

from __future__ import annotations

import re

# Sentence terminators include the Urdu full stop and question mark: three of the
# corpus's Say: steps are Urdu and end every clause with ۔, which a naive
# `[.!?]` split treats as one 34-word sentence.
_SENT = re.compile(r"[^.!?۔؟]+[.!?۔؟]+[”’\"']*|[^.!?۔؟]+$")
_ASIDE = re.compile(r"\[([^\]]+)\]")
_SENTINEL = "\x00%d\x00"
_SENTINEL_RE = re.compile(r"\x00(\d+)\x00")

# "class answers 2028" -> "2028". The lead-in names the speaker, which the response
# column already says by being the response column.
_SPEAKER = re.compile(
    r"^\s*(?:the\s+)?(?:class|students?|pupils?|children|chorus)\s+"
    r"(?:answers?|says?|responds?|replies|reply)\s*:?\s*", re.I)

_EXPECTED = re.compile(r"^\s*expected\s+(?:answers?|responses?)", re.I)
_EXPECTED_LEAD = re.compile(
    r"^\s*expected\s+(?:answers?|responses?)\s*"
    r"(?:include|includes|are|is|may\s+be)?\s*:?\s*", re.I)

_ENDS_Q = re.compile(r"[?؟][”’\"'\s]*$")
_BLANK = re.compile(r"_{2,}")
_CALC = re.compile(r"\d+\s*[+×÷−–*/-]\s*\d+|\b\d+\s+(?:plus|minus|times)\s+\d+\b", re.I)

# CUBES is the only named routine Stage C re-narrates (13 times over the corpus,
# spelled out in full each time). Its steps arrive as their own sentences.
_ROUTINE_STEP = re.compile(r"^\s*(Circle|Underline|Box|Solve)\b", re.I)
_ROUTINE_NAME = re.compile(r"\b(CUBES|See-Say-Show|Think-Pair-Share)\b")

# A trailing page citation is the only part of an action line that moves: it goes
# to a chip on the reading edge, exactly as a practice item's `ref` does. Anything
# that is not this shape stays in the sentence, because moving it would reword her.
_TRAIL_REF = re.compile(
    r"[\s,;(]*\b(?:on|from|see|at)?\s*(p{1,2}\.?\s?\d+(?:\s*[-–]\s*\d+)?)\s*\)?\s*\.?\s*$", re.I)

_OUTER_QUOTES = ("“”", "‘’", '""', "''")
_QUOTE_CHARS = "“”‘’\"'"
_OPEN_Q, _CLOSE_Q = "“‘", "”’"

# Residue, in curly marks only (the corpus is curly throughout; straight-quote
# wrappers are handled by the balanced _OUTER_QUOTES pass). A CLOSING mark at the
# head of a sentence belongs to the one before it; an OPENING mark at the tail
# belongs to the one after. Stripping only those leaves every balanced inner quote
# alone -- the textbook phrase names (‘Gather Materials.’) are inner quotes.
_LEAD_RESIDUE = re.compile(r"^[”’\s]+")
_TAIL_RESIDUE = re.compile(r"[“‘\s]+$")
# "Then ask:" is narration about the speech that immediately follows it. The row's
# own styling says the row is speech, so the lead-in states what the page shows.
_LEAD_IN = re.compile(r"^(?:and\s+)?then\s+(?:ask|say|tell\s+them)\s*:?\s*", re.I)


def _clean(s: str) -> str:
    """One sentence, with quote scaffolding and speech lead-ins taken off."""
    s = _TAIL_RESIDUE.sub("", _LEAD_RESIDUE.sub("", (s or "").strip()))
    s = _LEAD_IN.sub("", s).strip()
    for a, b in _OUTER_QUOTES:
        if len(s) > 2 and s[0] == a and s[-1] == b:
            return s[1:-1].strip()
    # A mark with no partner in this sentence opened a segment that runs past it,
    # or closed one that began before it. Either way it is punctuation for a
    # paragraph that no longer exists once each sentence is its own row.
    if s[:1] in _OPEN_Q and not any(c in s[1:] for c in _CLOSE_Q):
        s = s[1:].strip()
    if s[-1:] in _CLOSE_Q and not any(c in s[:-1] for c in _OPEN_Q):
        s = s[:-1].strip()
    return s.strip()


def _strip_say(text: str) -> str:
    """`Say: “...”` -> the speech itself.

    `move_lines` adds the `Say:` lead-in and wraps the script in quotes when Stage C
    has not already done so. Both come off here: the renderer marks speech by role,
    and a quote mark printed at the head of every row is noise once each sentence is
    its own row.
    """
    t = (text or "").strip()
    if t.lower().startswith("say:"):
        t = t[4:].strip()
    for a, b in _OUTER_QUOTES:
        if len(t) > 2 and t[0] == a and t[-1] == b:
            t = t[1:-1].strip()
            break
    return t


def _split_ref(text: str):
    """(sentence, page-ref-or-None), splitting only a TRAILING citation."""
    m = _TRAIL_REF.search(text)
    if not m or m.start() == 0:
        return text, None
    head = text[:m.start()].rstrip(" ,;(")
    if len(head.split()) < 3:          # the citation IS the line; leave it alone
        return text, None
    return head + ".", re.sub(r"\s+", "", m.group(1))


def _aside_pills(raw: str):
    """`[class answers 2028]` -> `["2028"]`. One aside is one response."""
    one = _SPEAKER.sub("", raw or "").strip(" .,۔" + _QUOTE_CHARS)
    return [one] if len(one) >= 1 else []


def _expected_pills(s: str):
    """`Expected answers include: “A” and “B”` -> `["A", "B"]`.

    Split on the conjunction, not on quote marks: the second clause of the corpus's
    own example is "We visit our grandparents’ village every few years", and a
    quote-pair reader ends it at the apostrophe and silently drops four words.
    """
    out = []
    for p in re.split(r"\s+(?:and|or)\s+|;\s*", _EXPECTED_LEAD.sub("", s)):
        p = p.strip().strip(" .,۔" + _QUOTE_CHARS)
        if len(p) >= 2:
            out.append(p)
    return out


def _kind(s: str) -> str:
    if _ROUTINE_STEP.match(s):
        # BEFORE `ask`: "Underline: what year would our capsule open?" and "Solve
        # together -- what is 2023 plus 5?" both end in a question mark, and letting
        # `ask` take them splits one named procedure into four unrelated rows.
        return "routine"
    if _ENDS_Q.search(s):
        return "ask"
    if _BLANK.search(s):
        return "frame"
    if _CALC.search(s):
        return "calc"
    return "say"


def _sentences(body: str):
    """Sentences, with `[...]` asides lifted out and returned against their sentence.

    The asides sit BETWEEN quoted segments in the source, so they must be removed
    before splitting -- a bracketed clause carries no terminator and would otherwise
    glue two sentences together.
    """
    asides = []

    def take(m):
        asides.append(m.group(1))
        return _SENTINEL % (len(asides) - 1)

    marked = _ASIDE.sub(take, body)
    out = []
    for raw in _SENT.findall(marked):
        lead, mine = [], []
        for m in _SENTINEL_RE.finditer(raw):
            # An aside with nothing but quote marks before it opened this fragment,
            # which in the source means it sat between a closing quote and the next
            # opening one -- the class speaking in the gap. It answers the turn that
            # just ENDED, not the sentence it happens to precede.
            head = raw[:m.start()].strip(_QUOTE_CHARS + " \t")
            (mine if head else lead).append(asides[int(m.group(1))])
        s = _clean(_SENTINEL_RE.sub("", raw))
        if s or lead or mine:
            out.append((s, mine, lead))
    return out


def _say_turns(say: str):
    """One `say` string -> its ordered turns."""
    turns = []
    for s, asides, lead in _sentences(_strip_say(say)):
        for a in lead:
            if turns:
                turns[-1].setdefault("expect", []).extend(_aside_pills(a))
        pills = [p for a in asides for p in _aside_pills(a)]
        if not s:
            # An aside on its own line answers the turn before it.
            if pills and turns:
                turns[-1].setdefault("expect", []).extend(pills)
            continue
        if _EXPECTED.match(s):
            # "Expected answers include: “...” and “...”" -- pills on the last ASK,
            # which is the question they answer, not on the sentence that lists them.
            found = _expected_pills(s)
            target = next((t for t in reversed(turns) if t["kind"] == "ask"), None)
            if target is not None and found:
                target.setdefault("expect", []).extend(found)
                continue
        t = {"kind": _kind(s), "text": s}
        if pills:
            t["expect"] = pills
        turns.append(t)
    return _merge_routine(turns)


def _merge_routine(turns):
    """Collapse a run of `routine` turns into one, so the procedure reads as a unit.

    Stage C writes CUBES as four consecutive sentences ("Circle: ... Underline: ...
    Box: ... Solve together ..."). Four separate rows would say four times over that
    this is one named procedure the teacher already knows.
    """
    out = []
    for t in turns:
        if t["kind"] == "routine" and out and out[-1]["kind"] == "routine":
            out[-1]["parts"].append(t["text"])
            if t.get("expect"):
                # The class answers at the END of the procedure, so the pill belongs
                # to the merged turn, not to the step that happened to carry it.
                out[-1].setdefault("expect", []).extend(t["expect"])
            continue
        if t["kind"] == "routine":
            t = {"kind": "routine", "parts": [t["text"]],
                 **({"expect": t["expect"]} if t.get("expect") else {})}
            name = next((_ROUTINE_NAME.search(p["text"]) for p in reversed(out)
                         if p.get("text") and _ROUTINE_NAME.search(p["text"])), None)
            if name:
                t["name"] = name.group(1)
        out.append(t)
    return out


def turns(steps):
    """A move's steps -> the ordered turns of its script, or None if there are none.

    `None`, not `[]`: an empty list is a document that HAS a script of no turns,
    and the renderer must be able to tell that apart from one that was never parsed
    so it can fall back to the flat `steps` strings.
    """
    out = []
    for s in steps or []:
        action = (s.get("action") or "").strip()
        if len(action) >= 2:
            text, ref = _split_ref(action)
            t = {"kind": "do", "text": text}
            if ref:
                t["ref"] = ref
            out.append(t)
        said = (s.get("say") or "").strip()
        if len(said) >= 2:
            out.extend(_say_turns(said))
    return out or None


def frame_turns(frames):
    """`partnerActivity`'s dialogue frames -> `frame` turns.

    They are the pupils' words, not the teacher's, and they already carry `___`.
    They join the We-Do script as frames so the fill-in rows sit with the speech
    that sets them up rather than as two more paragraphs after it.
    """
    out = []
    for f in frames or []:
        f = _strip_say(f)
        if len(f) >= 2:
            out.append({"kind": "frame", "text": f})
    return out
