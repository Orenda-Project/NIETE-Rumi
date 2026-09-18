"""The word budget, as a check rather than a paragraph in the spec.

`spec/07-lp-production.md` §4 (DECIDED B, operator 2026-09-18) caps five of the
ten lesson surfaces and deliberately leaves the other five alone. The numbers
are not style preferences: they were measured off the corpus, and the 80-word
`big_idea` cap is the one that keeps the p90 lesson inside the 5-8 phone-page
band — at 100 it tips out.

Two rules make this more than a `len()`:

  `key_points` is capped **per lesson, across all sections**. Three sections
  carrying 60 words each is 180, not 60, and the packaging surface is exactly
  the one that spreads. So this walks the whole body and sums every occurrence.

  **The renderer never trims.** Over cap is a failure, not a hint, and the fix
  is editorial — `practice` over cap splits across days rather than being
  compressed — so a finding names the surface, its count and its cap.

The surface names are this build's snake_case blocks. The imported reviewer's
`qa_checks.py` reads a different, camelCase body (`warmUp`, `keyWords`,
`exitTicket`); a checker pointed at the wrong schema finds nothing and passes
everything, which is the failure mode worth naming out loud.

Pure: no imports, no I/O. The budget is a property of the text, and it should
be provable without the corpus, a judge or a credential.
"""

# spec/07-lp-production.md §4, "The budget table (the law)".
CAPS = {"key_points": 120, "practice": 350, "big_idea": 80,
        "worked_example": 470, "faded_example": 470}

# Named, not merely absent: each already sits inside 1.5x its median, and the
# spec's point is that a budget listing every surface reads as a compression
# target for all of them.
UNCAPPED = ("ask", "warmup", "board", "keywords", "exit_ticket")


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


def _totals(node, into):
    """Sum each capped surface wherever it appears under `node`.

    A capped surface never nests another capped surface — they are siblings in
    the section registry — so a matched key's value is counted whole and not
    descended into. That is what keeps three sections' worth of `key_points`
    adding up instead of being counted once and again.
    """
    if isinstance(node, dict):
        for k, v in node.items():
            if k in CAPS:
                into[k] = into.get(k, 0) + count(v)
            else:
                _totals(v, into)
    elif isinstance(node, (list, tuple)):
        for v in node:
            _totals(v, into)
    return into


def totals(body):
    """Every capped surface the lesson actually carries, with its word count."""
    return _totals(body.get("generated", body), {})


def over(body):
    """The surfaces above their cap, worst overrun first.

    Empty means the lesson is inside the budget. A surface the lesson does not
    carry is not a finding here — absence is a different defect, and the
    deterministic QA checks already own it.
    """
    found = [{"surface": s, "words": w, "cap": CAPS[s], "over": w - CAPS[s]}
             for s, w in totals(body).items() if w > CAPS[s]]
    return sorted(found, key=lambda f: -f["over"])
