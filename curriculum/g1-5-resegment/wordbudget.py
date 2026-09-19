"""The word budget, as a check rather than a paragraph in the spec.

`spec/07-lp-production.md` §4 (DECIDED B, operator 2026-09-18) caps five of the
ten lesson surfaces and deliberately leaves the other five alone. The numbers
are not style preferences: they were measured off the corpus, and the 80-word
`big_idea` cap is the one that keeps the p90 lesson inside the 5-8 phone-page
band — at 100 it tips out.

Three rules make this more than a `len()`:

  **A surface is a block TYPE, not a dict key.** It arrives as
  `{"type": "key_points", "items": [...]}` — the name is the VALUE of `type`.
  This module read it as a key until 18 Sep 2026 and therefore matched nothing
  at all: on the first lesson of the approved slice it reported no findings
  against a render carrying `faded_example` 627 (cap 470), `worked_example`
  515 (cap 470) and `key_points` 367 (cap 120). Three of five caps broken,
  scored as clean. Matching the key also produced a false positive that hid
  it — `generated.instance_ledger.worked_example` is a genuine dict key
  holding five words of provenance, so the result was non-empty and the gate's
  "nothing was measured" net never fired.

  `key_points` is capped **per lesson, across all sections**. The real render
  carries five of them — the hook setup, the key fact, Remember, the homework
  and the coaching corner — so this walks the whole document and sums every
  occurrence. Reading one section's block would have called 367 words 60.

  **The renderer never trims.** Over cap is a failure, not a hint, and the fix
  is editorial — `practice` over cap splits across days rather than being
  compressed — so a finding names the surface, its count and its cap.

The artifact measured is the RENDERED document, not the Stage-C body. The
budget is a property of the printed page (§4's 5-8 phone-page band), and the
Stage-C body is camelCase v9 carrying no blocks at all.

Pure: no imports, no I/O. The budget is a property of the text, and it should
be provable without the corpus, a judge or a credential.
"""

# spec/07-lp-production.md §4, "The budget table (the law)".
CAPS = {"key_points": 120, "practice": 350, "big_idea": 80,
        "worked_example": 470, "faded_example": 470}

# Named, not merely absent: each already sits inside 1.5x its median, and the
# spec's point is that a budget listing every surface reads as a compression
# target for all of them.
#
# Measured 19 Sep 2026: `ask`, `board` and `keywords` are block types, while
# `warmup` and `exit_ticket` are section-level extras the renderer appends
# after a section's blocks (`d0_close.py:47` seats the exit ticket as
# `sec["exit_ticket"]`). Nothing here turns on the difference — the whole
# tuple is uncapped either way — but a reader who assumes all five are block
# types is one step from the mistake that made this module ship broken.
UNCAPPED = ("ask", "warmup", "board", "keywords", "exit_ticket")

# A block's wiring, not its words. `id` and `type` are slugs the renderer
# keys on and `mode` selects a layout; none is read by a teacher, and counting
# them would make a well-formed block look longer than it is.
SCAFFOLDING = ("id", "type", "mode")


def count(node):
    """Words of teacher-facing prose anywhere under `node`.

    Only strings count. A surface's structural metadata — minute counts,
    hoisting flags, page numbers — is not text anybody reads, and counting it
    would make a well-formed lesson look long.
    """
    if isinstance(node, str):
        return len(node.split())
    if isinstance(node, dict):
        return sum(count(v) for v in node.values())
    if isinstance(node, (list, tuple)):
        return sum(count(v) for v in node)
    return 0


def block_words(block):
    """The prose of one block, with its wiring left out."""
    return sum(count(v) for k, v in block.items() if k not in SCAFFOLDING)


def surface_of(node):
    """The capped surface `node` is, or None if it is not a capped block."""
    if isinstance(node, dict):
        t = node.get("type")
        if isinstance(t, str) and t in CAPS:
            return t
    return None


def _totals(node, into):
    """Sum each capped surface wherever it appears under `node`.

    A capped block never nests another capped block — they are siblings in the
    section registry — so a matched block is counted whole and not descended
    into. That is what keeps five sections' worth of `key_points` adding up
    instead of being counted once and again.
    """
    surface = surface_of(node)
    if surface is not None:
        into[surface] = into.get(surface, 0) + block_words(node)
        return into
    if isinstance(node, dict):
        for v in node.values():
            _totals(v, into)
    elif isinstance(node, (list, tuple)):
        for v in node:
            _totals(v, into)
    return into


def totals(doc):
    """Every capped surface the document actually carries, with its word count.

    An empty result means no capped block was found anywhere — which on a
    rendered lesson is not "inside budget", it is "this is not a render". The
    caller has to draw that distinction; `gate4.compose` does.
    """
    return _totals(doc, {})


def over(doc):
    """The surfaces above their cap, worst overrun first.

    Empty means the lesson is inside the budget. A surface the lesson does not
    carry is not a finding here — absence is a different defect, and the
    deterministic QA checks already own it.
    """
    found = [{"surface": s, "words": w, "cap": CAPS[s], "over": w - CAPS[s]}
             for s, w in totals(doc).items() if w > CAPS[s]]
    return sorted(found, key=lambda f: -f["over"])
