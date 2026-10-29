# -*- coding: utf-8 -*-
"""Stage D0 — Section O: the outcome, its SLO citation, then the objectives.

Split out of `d0_primary` (bd-f6gwv: that file was already 397 lines, ~100 over
the limit) so the outcome could be wired to the array splitter without making a
too-long file longer. One topic, nothing else moved.

v9 gives Section O three text slots -- `outcome`, `slo.text_verbatim` and
`objectives.items[].text`. A G6-12 author fills all three with DIFFERENT strings:
a pupil-facing outcome, the board-verbatim SLO, and two or three authored
objectives ("Two or three objectives... Each is modelled, practised in class AND
assessed today", schema).

Primary Stage-C authors two of the three. `keyFact` is the outcome and
`slo_statement` is the citation. There is no third: nothing in the 26 enrichment
fields is a lesson objective. An earlier pass filled the slot by reprinting
slo_statement, so the same sentence appeared twice inside one box, which is what
it looked like on paper.

The nearest candidates were checked and rejected as proxies: `scope_declaration`
is a generation guard ("ONE lesson, ONE class period..."), not something a pupil
does, and `keyFact` is already the outcome. So the slot goes dark and names what
is missing -- which is also the note Stage-C needs in order to author it.

ARRAY FORM. `outcome` is one of the nine widened slots, but it is the WEAKEST of
them: measured over the ch9-10 corpus only 69 of 335 outcomes carry a sentence
boundary at all, so 253 come back unchanged. It is wired because it is free and
lossless, not because it is a win.
"""

from __future__ import annotations

import d0_arrayfit as A
import d0_blocks as B


def build(g):
    statement = (g.get("slo_statement") or "").strip()
    codes = [c for c in (g.get("slo_refs") or []) if c][:5]
    outcome = (g.get("keyFact") or "").strip() or statement
    return {"outcome": A.fit(outcome, A.OUTCOME),
            "items": [{"text": B.DESIGN_PENDING,
                       "slo_code": codes[0] if codes else None}]}
