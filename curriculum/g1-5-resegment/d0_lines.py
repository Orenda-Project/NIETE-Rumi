"""Stage D0 — a printable LINE, split into one line per sentence.

`d0_script` does this for the I-Do and We-Do scripts, which the renderer prints as
turn rows. Everything else the renderer prints as a LIST — `key_points.items`,
`worked_example.steps` — never got the pass, so the same paragraph that is ten rows
inside WORKED EXAMPLE is still one bullet inside YOU DO.

Measured over the 335-lesson ch9-10 corpus, words held in a single unbroken unit of
more than 40 words:

    key_points.item        43,396w   (`you-do-task` alone: 34,269w)
    practice.item.a        24,466w
    faded_example.prompt   22,351w
    turn.do, both moves    21,435w
    worked_example.step     9,682w   (d0_primary's `worked`)

NOTHING IS CUT. Splitting an item into several items is the same list with the same
words in the same order; it costs no schema change and no renderer change, because
`items` and `steps` were already lists of lines. `test_no_word_is_lost_over_the_corpus`
holds that over every printable line of all 335 lessons.

The split is not free: each new line costs a row, and the page budget is already the
binding constraint. So it applies only ABOVE a threshold. Over the corpus, lines of 25
words or fewer hold 25.1% of the script's words and are already one or two clauses —
the wall is above that, and splitting below it would buy nothing and spend paper.
"""

from __future__ import annotations

import re

import d0_clause
import d0_script

# Lines at or under this many words are left exactly alone. See the module note.
THRESHOLD = 25

# A sentence must stand on its own to earn a row. "Yes." does not; it belongs to the
# sentence it answers, which is how it reads on the page anyway.
MIN_SENTENCE_WORDS = 3

_SAY = re.compile(r"^(\s*Say:\s*)(.*)$", re.S)
# `Say: “Say: "...."”` — 111 strings over 37 corpus docs, all of this exact shape.
# Stage C authored `Say: "..."` itself; `d0_blocks.move_lines` could not see its own
# label through the leading S and wrapped the whole thing a second time. The ADDED
# pair comes off and the author's own stays, so the quote marks still match.
_DOUBLE_SAY = re.compile(r"^\s*Say:\s*([“‘\"'])\s*(Say:\s*.*?)\s*([”’\"'])\s*$", re.S)
_ADDED_PAIR = dict(zip("“‘\"'", "”’\"'"))

# bd-suk84: known abbreviations whose own period must never read as a sentence
# end. CENSUS, all 335 built lessons, counting a cut `_SENT` offers at a
# whitespace boundary with a tail of at least MIN_SENTENCE_WORDS that ONLY this
# guard refuses -- 156 suppressions in total:
#
#     p. 124    No. 11    pp. 11    e.g. 7    Mr. 1    i.e. 1    etc. 1
#
# (An earlier note here claimed `p.` 118 and `No.` "1 instance". Both were
# wrong: `p.` is 124 and `No.` is 11, an order of magnitude out. Counting every
# firing of the guard, including the ones the MIN_SENTENCE_WORDS rule would have
# refused anyway, the totals are 204 -- p. 153, pp. 25, No. 12, e.g. 7, Rs. 4,
# Mr. 1, i.e. 1, etc. 1. Over the SOURCE enrichment rather than the built docs
# it is 510 / 629 on the same two countings.)
#
# `Mrs.`/`Mr.`/`Ms.`/`Dr.` are guarded on the FIXWAVE brief's explicit minimum
# list even though none currently appears in this corpus.
#
# _TERMINAL_SENSE is the over-fire fix. Eleven of the 156 suppressions are real
# sentence ends, and every one is `No.` or `etc.` used as an ordinary WORD:
# `... any straight sides? No. | So we write 0 sides ...`. Those two, and only
# those two, stand down when the next word is capitalised. A TITLE must not --
# `Dear Mr. Ahmed` is the case the unconditional guard exists for -- and neither
# may `e.g.`/`i.e.`, whose whole job is to be followed by the example
# (`E.g. Bat, cat, hat.`), nor `p.`/`pp.`, where a capital can be a roman-numeral
# page (`p. XII`). Measured effect: 156 suppressions -> 145, +11 cuts taken, no
# word added or lost.
_ABBREV = {
    "p", "pp", "e.g", "i.e", "etc", "mrs", "mr", "ms", "dr", "vs", "fig", "no",
    "rs",
}
_TERMINAL_SENSE = {"no", "etc"}
_ABBREV_TOKEN = re.compile(r"([A-Za-z]{1,4}(?:\.[A-Za-z]{1,4})?)\.$")
_CLOSERS = "”’\"'"
# What a quoted sentence may open on before its first real letter.
_OPENERS = "“‘\"'(["


def _opens_a_sentence(tail):
    """True when `tail` (the text a candidate cut would put on the next row)
    starts a capitalised word -- the only evidence available here that the
    period before it ended something."""
    w = words(tail)
    if not w:
        return False
    first = w[0].lstrip(_OPENERS)
    return bool(first) and first[0].isupper()


def _ends_in_abbreviation(head, tail=""):
    """True when `head` (everything up to a candidate cut) ends in a known
    abbreviation's own period -- `... p.`, `... Mrs.`, `... e.g.` -- so the
    period is not a sentence end.

    The `_CLOSERS` strip is load-bearing, not tidiness: `... an everyday object
    etc.”` and `Expected answer: “No.”` end in a quote, and over the built corpus
    plus the source enrichment the strip flips the verdict at four such
    positions.

    `_TERMINAL_SENSE` stands down in front of a capitalised word -- see the
    census note above.
    """
    head = head.rstrip()
    while head and head[-1] in _CLOSERS:
        head = head[:-1]
    m = _ABBREV_TOKEN.search(head)
    if not m:
        return False
    tok = m.group(1).lower()
    if tok not in _ABBREV:
        return False
    return not (tok in _TERMINAL_SENSE and _opens_a_sentence(tail))


def words(s):
    return [w for w in re.split(r"\s+", (s or "").strip()) if w]


def undouble_say(line):
    """`Say: “Say: "X."”` -> `Say: "X."`. The label lands once and the quotes match."""
    m = _DOUBLE_SAY.match(line or "")
    if m and _ADDED_PAIR.get(m.group(1)) == m.group(3):
        return m.group(2)
    return line or ""


def _wrapper(body):
    """(open, close, inner) for a body the author wrapped in a matched quote pair."""
    for a, b in d0_script._OUTER_QUOTES:
        if len(body) > 2 and body[0] == a and body[-1] == b:
            return a, b, body[1:-1].strip()
    return "", "", body


def _sentences(body):
    """Sentences, Urdu terminators included, with orphan fragments folded back.

    `d0_script._SENT` is reused rather than rewritten: it is the regex the corpus's
    three Urdu script families were measured against, and a second sentence splitter
    in the same document layer would drift from it.
    """
    starts = [m.start() for m in d0_script._SENT.finditer(body) if m.group().strip()]
    if not starts:
        return []
    # CUT POINTS, not matched spans. The body is sliced start-to-next-start so every
    # character is carried by exactly one line — `_SENT` skips a terminator that follows
    # a closing quote (`'!'.`), and reading only the matches drops it. It also means a
    # merge costs no join: `s...u...nn...y.` is one word the splitter sees as four
    # sentences, and re-joining those with spaces would print four.
    starts[0] = 0
    cuts = [0]
    for i, a in enumerate(starts[1:], 1):
        b = starts[i + 1] if i + 1 < len(starts) else len(body)
        # A cut inside a word is not a sentence boundary. The terminators sit inside
        # the corpus's own tokens -- `(p.127)`, `s...u...nn...y.`, `Mrs. Khan` -- and
        # cutting there would print `(p.` on one row and `127)` on the next. A real
        # boundary shows as WHITESPACE at the head of the next match (the terminator
        # itself closed the match before it), so a match opening on a letter is
        # mid-token.
        if not body[a].isspace():
            continue
        # bd-suk84: a real boundary also fails when the sentence ENDING here is
        # nothing but a known abbreviation's own period -- `p.`, `Mrs.`, `e.g.`
        # -- with the ordinary space after it that titles and citations always
        # carry. The no-space check above only ever caught `Mrs.Khan`/`p.127`.
        if _ends_in_abbreviation(body[:a], body[a:b]):
            continue
        if len(words(body[a:b])) < MIN_SENTENCE_WORDS:
            continue
        cuts.append(a)
    # A leading fragment has no sentence before it to join, so it joins the one after.
    if len(cuts) > 1 and len(words(body[cuts[0]:cuts[1]])) < MIN_SENTENCE_WORDS:
        del cuts[1]
    ends = cuts[1:] + [len(body)]
    return [body[a:b].strip() for a, b in zip(cuts, ends)]


def split_line(line):
    """One printable line -> one line per sentence, or `[line]` unchanged.

    Unchanged when the line is at or under THRESHOLD words, or holds one sentence:
    both are already scannable, and a row spent on either is a row the page cannot
    spare.

    The `Say:` label and the speech quotes are furniture for the RUN, not for each
    sentence in it — the operator on repetition: *"why does it land twice? the name?
    just once should be enough"*. So the label opens the run, the quote opens with it
    and closes on the last line, exactly as a quotation spanning paragraphs is set.
    """
    line = (line or "")
    if len(words(line)) <= THRESHOLD:
        return [line]
    m = _SAY.match(line)
    label, rest = (m.group(1), m.group(2)) if m else ("", line)
    open_q, close_q, body = _wrapper(rest.strip())
    parts = _sentences(body) or [body]
    # A sentence can be a wall on its own, and `d0_clause` was meant to cut it at
    # the author's own clause marks. bd-1nndm: DECLINED after three arms — the
    # call is kept and returns the sentence unchanged. See d0_clause's docstring
    # for the measurement, and for where the over-long rows actually come from
    # (a routing hole above this function, not a missing splitter here).
    parts = [c for p in parts for c in d0_clause.split_clause(p)]
    if len(parts) < 2:
        return [line]
    parts[0] = label + open_q + parts[0]
    parts[-1] = parts[-1] + close_q
    return parts


def split_items(items):
    """A list of printable lines -> the same list with its walls broken up."""
    out = []
    for i in items or []:
        if isinstance(i, str):
            out.extend(split_line(undouble_say(i)))
        else:
            out.append(i)
    return out


def split_do_turns(turns):
    """A move's turns, with the STAGE DIRECTIONS split one sentence per row.

    `d0_script` splits the speech and keeps the `action` whole, which is right about
    the words -- the action is not a restatement of the script (median 33% overlap),
    so chipping it would delete. It is not right about the ROW: over the corpus, `do`
    turns hold 21,435 words inside rows of more than 40 words, and the turn table is
    the narrowest column on the page.

    Only `do` is touched. Every other kind already arrives one sentence per row, and
    `routine` is deliberately merged back into one (d0_script._merge_routine).

    `ref` and `expect` ride the LAST sentence. The ref is the page citation the action
    ends on and the pill is the answer it arrives at, both printed as chips on their
    row; copying either onto every row would print it three times, which is the
    repetition the operator has asked to stop.
    """
    ride_last = ("ref", "expect")
    out = []
    for t in turns or []:
        if t.get("kind") != "do" or not isinstance(t.get("text"), str):
            out.append(t)
            continue
        parts = split_line(t["text"])
        if len(parts) < 2:
            out.append(t)
            continue
        for i, p in enumerate(parts):
            new = {k: v for k, v in t.items() if k not in ("text",) + ride_last}
            new["text"] = p
            if i == len(parts) - 1:
                new.update({k: t[k] for k in ride_last if t.get(k)})
            out.append(new)
    return out


def say_line(say):
    """A script string -> the printable `Say:` line, with the label authored ONCE.

    Stage C quotes the script itself about a third of the time, so an unconditional
    wrap printed ““Look at the picture.”” on the page. It also writes the LABEL itself
    in 111 strings over 37 corpus docs, which the old test (first character is a quote)
    could not see through the leading S -- so those came out `Say: “Say: "...."”`, and
    `d0_script._strip_say` takes off only one, leaving a stray label mid-speech on the
    turn row. A script that already announces itself is already the line.
    """
    s = (say or "").strip()
    if _SAY.match(s):
        return s
    if len(s) > 1 and s[0] in "“‘\"'" and s[-1] in "”’\"'":
        return f"Say: {s}"
    return f"Say: “{s}”"
