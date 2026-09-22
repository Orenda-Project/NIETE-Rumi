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

# The renderer's DC_PHASE keys, in its own normalised form (lowercased, every
# non-alphanumeric stripped). Duplicated rather than imported because that side
# is JavaScript; `test_d0_crux.py` reads DC_PHASE out of template.js and asserts
# the two sets are equal, so the duplication cannot drift silently.
DC_IDS = {"hook", "bigidea", "ido", "wedo", "youdo", "youdotask", "remember", "hw"}

# The schema's own cap. `crux` is one shared `definitions.crux`, `$ref`d from all 17
# block branches of lp_doc.schema.json -- the LIVE v9 file. Not lp_doc.v2.schema.json:
# that is the frozen v8 schema, `validate.js` only reaches it for `schema_version: "2.0"`,
# and putting the property there once shipped a document that could not render.
# Seating a longer line renders a sheet that then fails lint -- refused here,
# where the author can still read why.
MAX_LEN = 140


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
        if key not in DC_IDS:
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
            blocks[key]["crux"] = text
    return gaps
