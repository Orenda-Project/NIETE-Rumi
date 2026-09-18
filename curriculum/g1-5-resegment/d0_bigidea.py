"""Stage D0 — THE BIG IDEA, the block that opens EXPLANATION.

Split out of d0_blocks (which reached the 300-line limit) rather than trimmed:
this is one surface with one source field, and the reasoning below is the whole
reason the surface exists. Tests: test_d0_big_idea.py.
"""
from d0_blocks import DESIGN_PENDING


# The three paragraphs of THE BIG IDEA, in the order they are printed. Named, not a list:
# a free list lets an author write three restatements of the outcome, which is the defect
# this surface exists to remove. A named field makes an omission print as a labelled blank.
BIG_IDEA_PARTS = ("distinction", "misconception", "demo")


def big_idea_block(src):
    """THE BIG IDEA — the teaching behind Key fact, opening EXPLANATION ahead of I Do.

    Operator: *"give it its own surface on page 2 under EXPLANATION"*.

    Always emitted, even from nothing. Every one of the 38 corpus lessons carries no
    `bigIdea` today, so the absent case is the ordinary case and the surface's job right
    now is to show a teacher-shaped hole rather than hide one. Dark stages stay dark: the
    proxies within reach are all worse than a blank -- `keyFact` is the one-line outcome
    and `cfuExplain` is the in-the-moment error cue, and printing either here would say
    the same thing twice while making the gap invisible. ONE HOME PER SOURCE FIELD.
    """
    src = src if isinstance(src, dict) else {}
    blk = {"type": "big_idea", "id": "big-idea"}
    for k in BIG_IDEA_PARTS:
        blk[k] = (src.get(k) or "").strip() or DESIGN_PENDING
    return blk
