"""bd-pcbed -- seat the authored crux line onto the blocks the DC scores.

OPERATOR: *"the crux of what should be done should be highlighted in the move
since there is alot of script to go through"*, and *"I want teachers to know
which moves are there, what is the main move to do in order to score well on
DC"*.

The renderer prints `block.crux` above the script at heading weight (bd-3jemp,
lp-v9 `movePill`). This is the one seam that puts it there, and it follows the
contract `to_lp_doc` already sets for the diagram slots and the video row:
ADDITIVE -- no `crux` key in the enrichment means no call does anything, which
is every corpus lesson today -- and a spec that cannot be seated is DROPPED
WHOLE and says why in `notes.gaps`.

WHY THE CRUX IS AUTHORED AND NEVER DERIVED. A crux derived from the script is a
summary of the script, and the operator's complaint is that there is too much
script to read. A summary does not fix that; a different, shorter instruction
does. So this module seats what an author wrote and refuses everything else --
it has no model, no heuristic and no fallback.

WHY ONLY DC-MAPPED IDS. `DC_IDS` is the renderer's own `DC_PHASE` key set. A
block outside it prints no phase chip, so a crux on it would read to the
teacher as "this is the scored thing to do" on a block the Digital Coach never
scores. `hook-characters` is the live example: a cast list, not the hook move,
which is exactly why the renderer's `dcPhaseOf` matches ids EXACTLY rather than
by prefix.
"""

from __future__ import annotations

import re

# The renderer's DC_PHASE keys, in its own normalised form (lowercased, every
# non-alphanumeric stripped). Duplicated rather than imported because that side
# is JavaScript; `test_d0_crux.py` reads DC_PHASE out of template.js and asserts
# the two sets are equal, so the duplication cannot drift silently.
DC_IDS = {"hook", "bigidea", "ido", "wedo", "youdo", "youdotask", "remember", "hw"}

# bd-rd65e. THE OPENING IS ONE MOVE, NOT FOUR. OPERATOR: *"If I see the Opening,
# there is a strategy, then 3 questions then a hook and then a open with this
# question, doesnt make sense what to do and what not to do"*, and *"the opening
# makes no sense when you have added strategies for the sake of it"*.
#
# Four labelled things shared one three-minute slot and two of them were the same
# move: the crux "See, Think, Wonder on the page 13 picture, written, before any
# reading" sat directly above the question that spells SEE, THINK and WONDER out
# in full. It was also a SECOND named strategy in a band the operator has ruled
# carries one -- *"it should be just 1 not multiple strategies since opening is a
# whole provocation on its own"* -- competing with the warm-up's own.
#
# THE REFUSAL IS ABOUT THE SHAPE OF THE BLOCK, NOT ABOUT SCORING. The charter
# above is that a crux is a DIFFERENT, SHORTER instruction and never a summary,
# because the complaint it answers is that there is too much script to read. The
# scripted moves earn one: `i-do`, `we-do`, `you-do` and `hw` each print several
# steps. An `ask` is a single utterance, so a line above it can only restate it.
# `hook` therefore stays in DC_IDS and keeps its phase chip; it just prints its
# provocation once.
NO_CRUX = {"hook"}

# bd-xa8cf. OPERATOR: *"You cant add No talking in the We Do tag"*.
#
# The renderer prints the crux inside the move's TAG CLUSTER, between the WE DO /
# Guided chips and `WE DO · class practises together` (lp-v9 `movePill`). A tag
# names the move. A prohibition set there reads as a label on the move itself --
# the teacher sees "WE DO" and "No talking" as one heading and cannot tell which
# of the two is the instruction.
#
# The rule is not lost with the clause. Every corpus crux that carried it opens
# "Chalk Talk, silent." and the block's own prompt says "Nobody stands and nobody
# speaks" -- the instruction text, which is where a classroom-management rule
# belongs. So the trailing clause is CUT and the crux is kept: rewrite, never
# empty. A crux that is nothing BUT the prohibition is left alone, because an
# empty crux renders a gap in the tag cluster and says less than the line did.
_BAN = re.compile(r"^(?:no\s+(?:talking|speaking)|nobody\s+(?:talks|speaks))\b", re.I)
_SENTENCE = re.compile(r"(?<=[.!?])\s+")

# The same rule said as what she DOES, anywhere in the block's own instruction.
_SAYS_IT = re.compile(r"\bsilent|\bsilence\b|no\s+talking|nobody\s+(?:speaks|talks)"
                      r"|without\s+talking|do(?:es)?\s+not\s+(?:talk|speak)", re.I)

# The schema's own cap. `crux` is one shared `definitions.crux`, `$ref`d from all 17
# block branches of lp_doc.schema.json -- the LIVE v9 file. Not lp_doc.v2.schema.json:
# that is the frozen v8 schema, `validate.js` only reaches it for `schema_version: "2.0"`,
# and putting the property there once shipped a document that could not render.
# Seating a longer line renders a sheet that then fails lint -- refused here,
# where the author can still read why.
MAX_LEN = 140


def _cut_tag_ban(text):
    """(line, cut) -- the crux without a trailing prohibition sentence."""
    parts = _SENTENCE.split(text)
    kept = list(parts)
    while len(kept) > 1 and _BAN.match(kept[-1].strip()):
        kept.pop()
    return " ".join(kept).strip(), len(kept) < len(parts)


def _instruction_of(block):
    """Everything on the block a teacher reads as the instruction, flattened."""
    out = [str(block.get("prompt") or ""), str(block.get("title") or "")]
    for key in ("steps", "items"):
        for v in block.get(key) or []:
            out.append(v if isinstance(v, str) else " ".join(
                str(x) for x in (v or {}).values() if isinstance(x, str)))
    return " ".join(out)


def _norm(block_id):
    """The renderer's normalisation, so `big-idea` and `bigIdea` both resolve."""
    return "".join(c for c in str(block_id or "").lower() if c.isalnum())


def apply_crux(sections, crux):
    """Seat each authored crux line on its block. Returns the gap notes.

    `sections`  the lp_doc sections, mutated in place
    `crux`      {block_id: line}, or None
    """
    if not isinstance(crux, dict) or not crux:
        return []

    blocks = {}
    for sec in sections or []:
        for blk in sec.get("blocks") or []:
            if isinstance(blk, dict) and blk.get("id"):
                blocks[_norm(blk["id"])] = blk

    gaps = []
    for block_id, line in crux.items():
        key = _norm(block_id)
        text = str(line or "").strip()
        if not text:
            continue
        if key in NO_CRUX:
            gaps.append(
                f"crux dropped for '{block_id}': the opening prints this "
                f"provocation in full, so a line above it is the same move twice")
        elif key not in DC_IDS:
            gaps.append(
                f"crux dropped for '{block_id}': not a move the Digital Coach "
                f"scores, so it would print as scored when it is not")
        elif key not in blocks:
            gaps.append(
                f"crux dropped for '{block_id}': this lesson has no such block")
        elif len(text) > MAX_LEN:
            gaps.append(
                f"crux dropped for '{block_id}': {len(text)} characters, "
                f"over the {MAX_LEN} the schema allows")
        else:
            text, cut = _cut_tag_ban(text)
            if cut and not _SAYS_IT.search(_instruction_of(blocks[key])):
                gaps.append(
                    f"crux for '{block_id}': the tag cannot carry a prohibition, "
                    f"and this block's own instruction does not say it either -- "
                    f"author it there as what the teacher DOES")
            blocks[key]["crux"] = text
    return gaps
