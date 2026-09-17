"""Stage D0 — the three anchored diagram slots.

Operator: *"the html LP formats are way too texy heavy, how do we get diagrams in?"* and
*"why dont we think of the render as an infographic on html?"*

Nothing here builds a diagram engine. One is already vendored at `bot/vendor/lp-v9/diagrams/`
with 28 renderers and 255 licensed pictograms, the schema already has a `diagram` block type
handed verbatim to `renderDiagram(spec)`, and `template.js` already sizes the figure so its
SMALLEST label stays above a legibility floor. Measured across all 38 corpus lessons, primary
calls it ZERO times. This module is the wiring, and only the wiring.

Two decisions the operator took, and what each one costs to honour:

DOSE — three anchored slots: the hook on page 1, the explanation, the practice. *Anchored*
is the load-bearing word. A diagram that can surface anywhere is a diagram the teacher
cannot learn to expect, so each slot is nailed to one section by `SLOT_SECTION` and a spec
that reaches across sections is refused rather than relocated.

COST — the diagram REPLACES the prose it illustrates. The paragraph's content moves into the
diagram's labels; the same words are carried by a shape instead of a sentence. That keeps
"no word may be deleted" intact, because nothing is dropped, it is re-homed — and it keeps
ONE HOME PER SOURCE FIELD, because the prose does not also stay. So the spec must name what
it replaces, the diagram takes that block's exact seat, and the block goes.

EVERY REFUSAL IS LOUD. Dark stages stay dark: a spec that cannot be placed does not get
placed *nearly*. It is dropped whole, the prose is left exactly where it was, and the reason
lands in `notes.gaps` where a human reads it. The one outcome worse than no diagram is a
diagram printed beside the paragraph it was drawn to replace, which makes the page say
everything twice — the exact defect this profile exists to remove.

ADDITIVE, so G6-12 is untouched by construction: the specs arrive on an optional
`generated.diagrams` key that no enrichment record carries today, and a record without it
takes a path that does not run.
"""

from __future__ import annotations

# Each slot, and the ONE section it may place a diagram in. The teacher learns three
# positions; she does not learn "somewhere in the middle".
SLOT_SECTION = {
    "hook": "introduction",
    "explanation": "development",
    "practice": "activity",
}

# `replaces` is routing and never reaches the engine — see `_spec_of`.
_ROUTING_KEYS = ("replaces",)


def _gap(slot, reason):
    return f"diagram slot '{slot}' not placed: {reason}"


def _spec_of(entry):
    """The spec as the author wrote it, minus the routing keys.

    renderDiagram dispatches on `type` and the builders read their own keys; an extra one
    is at best ignored and at worst drawn. The spec that reaches the engine is the spec,
    not the spec plus our bookkeeping.
    """
    return {k: v for k, v in entry.items() if k not in _ROUTING_KEYS}


def _section(sections, sid):
    for s in sections:
        if s.get("id") == sid:
            return s
    return None


def _index_of(section, block_id):
    for i, b in enumerate(section.get("blocks") or []):
        if b.get("id") == block_id:
            return i
    return -1


def _place(sections, slot, entry):
    """Seat one diagram, or explain why it could not be seated. Returns a gap string
    or None. Never leaves a section half-changed: every check runs before anything moves.
    """
    sid = SLOT_SECTION.get(slot)
    if sid is None:
        return _gap(slot, f"unknown slot (the three are {', '.join(sorted(SLOT_SECTION))})")
    if not isinstance(entry, dict):
        return _gap(slot, "the spec is not an object")
    if not (entry.get("type") or "").strip():
        return _gap(slot, "the spec carries no 'type', which is the key renderDiagram "
                          "dispatches on")
    target = (entry.get("replaces") or "").strip()
    if not target:
        return _gap(slot, "the spec names no 'replaces' block, so it would cost a page "
                          "and re-home nothing")

    section = _section(sections, sid)
    if section is None:
        return _gap(slot, f"section '{sid}' is not in this document")
    i = _index_of(section, target)
    if i < 0:
        # Say where we looked. A spec written against last week's block ids fails here,
        # and "not found" without the section name sends the reader to the wrong file.
        return _gap(slot, f"block '{target}' is not in section '{sid}' "
                          f"(it holds: {', '.join(b.get('id') or b.get('type') or '?' for b in section.get('blocks') or []) or 'nothing'})")

    section["blocks"][i] = {"type": "diagram", "id": f"dia-{slot}", "spec": _spec_of(entry)}
    return None


def apply_slots(sections, diagrams):
    """Seat every supplied diagram in `sections`, in place. Returns the gap lines.

    `diagrams` is the optional `generated.diagrams` map: slot name -> spec, where the spec
    also carries `replaces`. Slots are walked in a fixed order so two runs of the same
    record produce the same gap list in the same order — a gap list that reorders itself
    is a diff that lies.
    """
    if not isinstance(diagrams, dict) or not diagrams:
        return []
    order = list(SLOT_SECTION) + sorted(k for k in diagrams if k not in SLOT_SECTION)
    return [g for g in (_place(sections, s, diagrams[s]) for s in order if s in diagrams)
            if g]
