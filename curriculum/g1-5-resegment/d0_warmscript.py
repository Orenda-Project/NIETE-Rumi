"""bd-t4iur -- seat the warm-up's METHOD on the page, without its prohibition.

`warmUp.script` is the only authored field that says HOW the retrieval questions are
run, and nothing rendered it. `template.js`'s `warmupBody` prints the `strategy` name
chip and the `items` rows; `lp_doc.schema.json`'s `warmup` object is
`additionalProperties: false` and has no `script`. So a teacher read a strategy NAME and
three questions and was never told the move: write in silence, walk the row, one clap,
whole class says it, each child marks their own.

OPERATOR: *"It should just hold the scriopt WRITE the word in your copy. When I clap,
the whole class says it together and you tick or fix your own"*. That is English_seg2's
script with three things gone -- the recap of yesterday, the announcement of what the
teacher is about to do, and `Do not call out and do not tell a neighbour`.

WHY THE PROHIBITION IS DROPPED AND NOT PRINTED. It is already ENFORCED: bd-c5miz put
lint gate 10e (`PEER_TALK`, `bot/vendor/lp-v9/lib/peertalk.js`) in front of every string
in the document, so a plan that tells children to talk to each other fails the gate
before it can be built. Printing the rule again on every page after that costs a teacher
a line of reading per lesson and buys nothing. And the standing instruction is to cut
script, not add it: *"there is alot of script to go through"*, *"save space Claude!!!"*,
*"NO duplication and repetition pls"*. `d0_crux._cut_tag_ban` is the same call made on
the same rule one field over (bd-xa8cf, *"You cant add No talking in the We Do tag"*);
`test_d0_warmscript.py` pins the two vocabularies together rather than refactoring
d0_crux, whose own fix is newer than this module.

WHY THE TEXT IS A `paragraph`. Same reason d0_routine gives: the v9 block enum is a
closed `oneOf` and `template.js` DROPS an unknown type with a warning, so a new
`warmup_method` type would need the vendored schema and all three copies of the renderer
forked -- to print one sentence. `paragraph` is already in the enum, already rendered,
and absent from `wordbudget.CAPS`. Seating it builder-side is also what keeps this bead
out of `template.js`, which another agent owns.

WHY THE METHOD STOPS WHERE IT STOPS. Every live script continues past the method into
the question-by-question run -- the same prompts and answers `warmUp.items` already
prints. Carrying that would print the warm-up twice on one page, which is the exact
duplication she asked to be rid of. So the method is the head of the script and the
item run is cut at its first marker.

WHAT IS REFUSED. A script with no written-action sentence in it is not a method -- three
live English documents put the STRATEGY NAME in this field ("A FINAL calm cumulative
retrieval ... silent write, walk, reveal"), and seating that prints the strategy chip a
second time. So is a method longer than `MAX_WORDS`: the house rule is that a spec which
cannot be seated is DROPPED WHOLE and says why in `notes.gaps` (d0_diagram, d0_crux),
because half a method read as a whole one is worse than a named gap.

bd-y7hst -- ONE STRATEGY, NOT SEVERAL STACKED, AND NEVER ONE THAT PAIRS CHILDREN UP.
The warm-up must seat exactly one method, never several stacked (a shipping example,
g1_ch8 Maths seg4, numbered FOUR items in the warm-up box) and never one that pairs
children up to talk ("Partner-check before reveal", "Partner A says a number..."). The
two selectors that enforce this -- `_candidates()` (splits a numbered/bulleted script
into its stacked items, first-to-yield-a-method wins) and `is_banned_move()` (her named
peer-talk families, phrase-level so it never trips on Urdu_seg6's gender-pair vocabulary
or Maths_seg2's solo fact-fluency game) -- live in `d0_warmpeer.py`, split out to keep
this file under the 300-line limit; see that module's docstring for the operator's
quotes and the full rationale. Every candidate `_method_and_gaps` below drops through
either selector says why in `notes.gaps`, same house rule as an over-cap method:
dropped whole, never silently.

bd-y7hst, REOPENED -- `warmUp.script` IS EMPTY IN ALL 335 SHIPPING LESSONS. Corpus
evidence, checked after this module shipped: the field this module and `d0_warmpeer.py`
act on is never populated on real data, so the fix above is correct in mechanism but
inert in practice -- it never fires. Left in place, unchanged, and still tested: the
mechanism is not wrong, and the day `warmUp.script` starts carrying content this is
still the right selector pair for it. The real, currently-live defect (295 of 335
lessons stack more than one warm-up item; 215 banned-talk instances across 118 lessons)
is in `warmUp.items[]` instead, and is handled by `one_strategy()` in the sibling module
`d0_warmitems.py`, which reuses `is_banned_move()` from `d0_warmpeer.py` but does not
touch this file.
"""

from __future__ import annotations

import re

from d0_warmpeer import _bare, _candidates, _gap_banned, _gap_extra, is_banned_move

BLOCK_ID = "warmup-method"

# Roughly four printed lines in the warm-up band. Past that the band has stopped being a
# method and become the lesson, which is the complaint this bead answers, not a thing to
# add to. Across the 20 live documents the seated methods run 6 to 71 words. A script
# over the cap is refused WHOLE and says why in `notes.gaps` -- the house rule
# (d0_diagram, d0_crux), because half a method read as a whole one is worse than a named
# gap, and the author can see the number and tighten two sentences.
MAX_WORDS = 80

# Sentence ends, in both scripts, with any closing quote that trails the stop.
_SENTENCE = re.compile(r'(?<=[.!?۔؟])["\'’”]?\s+')

# The em/en dash and the double hyphen the corpus uses to hang a clause off a sentence.
_CLAUSE = re.compile(r"\s+(?:--|—|–)\s+")

# `Say: '`, `Ask: "`, `and say: "` -- a colon-introduced teacher utterance. The FIRST one
# opens the framing instruction and is kept; the second opens the question-by-question
# run, which `warmUp.items` already prints.
_UTTERANCE = re.compile(
    r'\b(?:says?|asks?|shows?|finish|reveal)\s*(?:[^:"\']{0,40}:\s*)?["\'\u2018\u201C]',
    re.I)
_QUOTE_LEAD = re.compile(
    r"^(?:Say|Ask|Show|Finish|Reveal|Then\s+say)\b[^:]{0,40}:\s*[\"'‘“]?\s*", re.I)

# Where the method ends and the question-by-question run begins. `[ten seconds, walk a
# row]` and `[clap]` are the corpus's stage directions for ONE item; `Expected answer:`
# is that item's answer, which the item row already carries.
_ITEM_RUN = re.compile(r"\[|\bExpected\s+answers?\b|\bexpected:", re.I)

# A QUESTION is an item, never the method. Every retrieval prompt in the corpus ends in
# `?` (or `\u061F`), and every one of them is already a row in `warmUp.items`. This is the
# marker that catches the run when it is introduced by something other than `Say:` --
# *"Write 9,000 - 6,854 = ?"*, *"\u0633\u0648\u0627\u0644 \u06F1: ..."* -- which the dash-and-quote shapes miss.
_A_QUESTION = re.compile(r"[?\u061F][\"\'\u2019\u201D]?\s*$")

# `Write: 4,568 + 9; 3,989 + 12; 5,609 + 34.` -- the teacher putting item one on the
# board. It is an item, and the item row already carries it, but it is introduced by no
# `Say:` and ends in no question mark, so nothing else catches it. Only ever applied
# AFTER the method has started, so the instruction that opens the method is safe.
_BOARD_WRITE = re.compile(r"^(?:write|show)\b[^.]*\d", re.I)

# `(\u062c\u0645\u0627\u0639\u062a: \u062d\u0636\u0631\u062a \u0645\u062d\u0645\u062f \uFDFA \u06a9\u06cc \u062a\u064e\u0639\u0652\u0631\u0650\u06cc\u0641 \u0645\u06cc\u06ba)` -- "(class: ...)". The Urdu corpus prints the
# choral ANSWER to the previous question in a parenthesis at the head of the next
# sentence, so the method inherits an answer it did not ask for. Dropped from the
# opening sentence only.
_LEADING_ANSWER = re.compile(r"^\([^)]{0,120}\)\s*")

# A written action asked of the child. NOT a bare `write`: "silent write, walk, reveal"
# is the name of the strategy, and three live documents put exactly that in this field.
# The object after the verb is what separates the instruction from the label.
_ACTION_EN = re.compile(
    r"\bwrites?\b(?=\s+(?:on|in|it|one|two|three|four|five|the|an?|your|their|his|her|"
    r"down|silently|quietly|how|which|what|whether|why|that|only|both|these|this|each|"
    r"about)\b)", re.I)
# `لکھ` -- write -- is the stem of every Urdu form the corpus uses (لِکھیں، لِکھے، لکھ دیں).
_ACTION_UR = re.compile(r"لکھ")

# The rule said as a prohibition. Anchored at the start of a clause, because that is
# where the corpus puts it -- either ahead of the action behind a dash ("Do not call out
# and do not tell a neighbour -- WRITE the word in your copy") or hung off the end of it
# ("Write your answer on your slate -- do not call out and do not show a neighbour").
# Every phrase `d0_crux._BAN` matches is matched here too; the test pins that.
_PROHIBITION = [
    re.compile(r"^(?:and\s+)?do(?:es)?\s+not\s+(?:call\s*out|tell|talk|speak|show|"
               r"whisper|discuss|share)\b", re.I),
    re.compile(r"^(?:and\s+)?don'?t\s+(?:call\s*out|tell|talk|speak|show|whisper)\b", re.I),
    re.compile(r"^(?:and\s+)?(?:nobody|no\s+one)\s+(?:talks?|speaks?|calls?\s*out)\b", re.I),
    re.compile(r"^no\s+(?:talking|speaking|calling\s*out|chatting)\b", re.I),
    # Urdu negates AFTER the verb, so the speech verb comes first and `نہیں`/`نہ` follows.
    # A bare `نہیں` is NOT enough: *"وہ حُروف جو آگے نہیں جُڑتے"* -- the letters that do not
    # join -- is the lesson's own content.
    re.compile(r"^(?:کوئی\s+)?"
               r"(?:بولے|بولیں|"
               r"بات\s*کریں|بات)"
               r"\s*(?:نہیں|نہ|مت)"),
]


def is_prohibition(text):
    """True when this clause says the rule instead of the move."""
    t = _bare(text).strip().strip("\"'‘’“”")
    return any(p.match(t) for p in _PROHIBITION)


def _has_action(sentence):
    b = _bare(sentence)
    return bool(_ACTION_EN.search(b) or _ACTION_UR.search(b))


def _drop_prohibition(sentence):
    """The sentence with any prohibition clause cut out. '' if it is only that."""
    parts = [p for p in _CLAUSE.split(sentence) if p.strip()]
    kept = [p for p in parts if not is_prohibition(p)]
    if not kept:
        return ""
    out = " ".join(k.strip() for k in kept).strip()
    # A cut tail takes the full stop with it.
    if out and out[-1] not in ".!?۔؟":
        out += "." if _ACTION_UR.search(_bare(out)) is None else "۔"
    return out


def _unquote(s):
    """Drop a quote mark left unpaired by the cut, at either end."""
    s = s.strip()
    for q in ("'", '"', "‘", "’", "“", "”"):
        while s.startswith(q) and s.count(q) % 2:
            s = s[1:].lstrip()
        while s.endswith(q) and s.count(q) % 2:
            s = s[:-1].rstrip()
    return s


def _method_from_one(text):
    """(the method in this ONE candidate, or ''; whether a banned move was cut from it).

    The sentence-by-sentence scan a single un-numbered script always was. A banned move
    ends the run exactly like `_ITEM_RUN` does -- if it opens the candidate (`started`
    still False) there is nothing clean to start from, so the whole candidate is skipped;
    if it arrives once the method is already under way, the run stops there and what was
    kept before it survives.
    """
    sentences = [s for s in _SENTENCE.split(text) if s.strip()]
    kept, started, quoting_seen, banned_hit = [], False, 0, False
    for s in sentences:
        if _UTTERANCE.search(_bare(s)):
            quoting_seen += 1
            if quoting_seen > 1:
                break
        if _ITEM_RUN.search(s) or (started and _BOARD_WRITE.match(s.strip())):
            break
        # Checked on the PROHIBITION-STRIPPED text, not the raw sentence (bd-y7hst,
        # target refresh): "Do not call out and do not tell a neighbour -- WRITE it in
        # your copy." names "tell a neighbour" only to forbid it, and the widened
        # `is_banned_move` -- correctly -- fires on that phrase as a POSITIVE
        # instruction. Checking the raw sentence therefore banned the whole clean
        # method behind every negated mention of a banned family; checking the
        # cleaned text still catches a genuine positive instruction (`_drop_prohibition`
        # only ever removes a `_PROHIBITION`-shaped negation, never a positive banned
        # move, so nothing a real ban depends on is stripped ahead of this check). An
        # all-prohibition sentence with nothing left after stripping is not a banned
        # MOVE -- just let it fall through the rest of the loop, which already drops it.
        cleaned = _drop_prohibition(s)
        if cleaned and is_banned_move(cleaned):
            banned_hit = True
            if started:
                break
            continue
        if _A_QUESTION.search(s.strip()):
            # A question AHEAD of the method is the teacher's own framing (*"Name as
            # many Wh-question words as you can"*); only the run that FOLLOWS the
            # method is the item list. So skip it while looking, stop on it once found.
            if started:
                break
            continue
        if not started:
            if not _has_action(s):
                continue
            started = True
            s = _LEADING_ANSWER.sub("", _QUOTE_LEAD.sub("", s, count=1), count=1)
        line = _drop_prohibition(s)
        if line:
            kept.append(line)
    if not kept:
        return "", banned_hit
    out = _unquote(" ".join(kept))
    return ("", banned_hit) if len(out.split()) > MAX_WORDS else (out, banned_hit)


def _method_and_gaps(script):
    """(the ONE method chosen, [why every other candidate this script offered was cut])."""
    text = str(script or "").strip()
    if not text:
        return "", []
    cands = _candidates(text)
    results = [_method_from_one(c) for c in cands]
    chosen_idx = next((i for i, (t, _) in enumerate(results) if t), None)
    gaps = []
    for i, (t, banned_hit) in enumerate(results):
        if i == chosen_idx:
            if banned_hit:
                gaps.append(_gap_banned(cands[i]))
            continue
        if banned_hit:
            gaps.append(_gap_banned(cands[i]))
        elif len(cands) > 1:
            gaps.append(_gap_extra(i + 1, len(cands), cands[i]))
    chosen = results[chosen_idx][0] if chosen_idx is not None else ""
    return chosen, gaps


def method_of(script):
    """The method the teacher runs, or '' when the script does not carry one."""
    return _method_and_gaps(script)[0]


def block(warm):
    """The one paragraph, or None."""
    line = method_of((warm or {}).get("script"))
    return {"type": "paragraph", "id": BLOCK_ID, "text": line} if line else None


def apply_method(sections, warm):
    """Seat the method in the Opening. Returns the gap notes.

    ADDITIVE, like every other `apply_*` in this stage: no `warmUp.script` means no call
    does anything. The block goes directly UNDER the routine line, which is what she
    does first; the warm-up band itself renders above every block in the section
    (`template.js` `before(s)`), so the method prints one line below the items it runs.
    """
    script = ((warm or {}).get("script") or "").strip()
    if not script:
        return []
    sec = next((s for s in sections or [] if s.get("id") == "introduction"), None)
    if sec is None:
        return []
    blocks = sec.setdefault("blocks", [])
    if any(b.get("id") == BLOCK_ID for b in blocks):
        return []
    text, drop_gaps = _method_and_gaps(script)
    if not text:
        return drop_gaps + [
            "warmUp.script carries no runnable method (a strategy restatement, or "
            "longer than %d words), so the Opening prints the questions without "
            "telling the teacher how to run them -- bd-t4iur." % MAX_WORDS]
    blk = {"type": "paragraph", "id": BLOCK_ID, "text": text}
    at = next((i + 1 for i, b in enumerate(blocks) if b.get("id") == "routine"), 0)
    blocks.insert(at, blk)
    return drop_gaps
