"""Day-integrity rules: who owns an SLO, and who owns a printed page.

Two rules decide everything a day row says about itself beyond its own text.

  Rule 1 — every SLO has exactly one introducing day. Later days on the same
           code develop it. A day that introduces more than one SLO in forty
           minutes is not a day, and gets flagged as one to split.
  Rule 2 — printed pages are never reassigned. Where two days both claim a
           page, both keep it and each names the other, so the overlap is a
           visible fact rather than a silent edit.
"""
from collections import defaultdict

import skills

PENDING = "pending"

STRAND_MAP = {
    "RD": "input", "LS": "input", "LC": "input", "TX": "input",
    "WR": "output", "OC": "output", "CO": "output",
    "GR": "language-focus", "VO": "language-focus", "VG": "language-focus",
    "PH": "language-focus", "PA": "language-focus", "EM": "language-focus",
    "LG": "language-focus",
}
# skill_type overrides strand where the skill is explicitly a fluency skill
FLUENCY_SKILLS = {"buland_khwani"}


# --------------------------------------------------------------------------
# Rule 1 — every SLO has one introducing day; later days develop it
# --------------------------------------------------------------------------

def _taught(day):
    """The codes a day teaches in its own right.

    Everything except what dayfold Rule 3 folded into it from a chapter
    revision: those are spiralled, and a spiral is by definition a second
    sighting even when it is the first one in the book. Excluding them from
    `first_seen` as well as from the primary keeps the introduction where the
    teaching is -- a later day that genuinely teaches the code still gets to
    say `introduces`.
    """
    folded = set(day.get("folded_slo_codes") or [])
    return [c for c in (day.get("slo_codes") or []) if c not in folded]


def assign_slo_roles(days):
    """Name each day's primary SLO and what the day does with it.

    Most books list fewer distinct SLOs than teaching days (G4 English: 23 SLOs
    across 99 days), so "one SLO per day" is not arithmetically available and
    would be a deletion in disguise. What is available, and is what the warm-up
    defect actually needs, is the introduce/develop distinction: the first day
    listing a code teaches it new, every later day builds on it.

    Nothing is dropped. The day's other codes stay in `supporting`.
    """
    first_seen = {}
    for idx, day in enumerate(days):
        for code in _taught(day):
            first_seen.setdefault(code, idx)

    out = []
    for idx, day in enumerate(days):
        codes = day.get("slo_codes") or []
        descs = day.get("slo_descriptions") or []
        by_code = dict(zip(codes, descs))
        own = _taught(day)
        new = [c for c in own if first_seen.get(c) == idx]
        primary = (new or own or codes or [None])[0]
        out.append({
            "primary_slo": primary,
            "primary_slo_desc": by_code.get(primary, ""),
            "slo_role": "" if primary is None
                        else ("introduces" if new else "develops"),
            "new_codes": new,
            "supporting_slos": [c for c in codes if c != primary],
            "supporting_descs": [by_code.get(c, "") for c in codes if c != primary],
        })
    return out


# --------------------------------------------------------------------------
# Rule 2 — printed pages are left alone; contested pages are named
# --------------------------------------------------------------------------

def page_overlaps(days):
    """Which other days claim this day's printed pages.

    Pages are not reassigned here. A shared page is sometimes real (one poem
    read across three Urdu days) and sometimes the boundary defect (a Maths day
    that starts on the page the previous day finished). Telling them apart needs
    the page text, which is the rebuild pass. This pass names the conflict.
    """
    claims = defaultdict(list)
    for idx, day in enumerate(days):
        for page in day.get("pages_printed") or []:
            claims[page].append(idx)

    out = []
    for idx, day in enumerate(days):
        shared = {}
        for page in day.get("pages_printed") or []:
            others = [i for i in claims[page] if i != idx]
            if others:
                shared[page] = others
        out.append(shared)
    return out


def overlap_label(shared, days):
    if not shared:
        return ""
    parts = []
    for page, others in sorted(shared.items()):
        who = ", ".join(sorted({days[i].get("day_label", "?") for i in others}))
        parts.append(f"p.{page} also {who}")
    return "; ".join(parts)


# --------------------------------------------------------------------------
# Derived fields
# --------------------------------------------------------------------------

def strand_for(primary_slo, skill_type):
    if skill_type in FLUENCY_SKILLS:
        return "fluency"
    if not primary_slo:
        return PENDING
    parts = primary_slo.split("-")
    if len(parts) < 3:
        return PENDING
    return STRAND_MAP.get(parts[2], PENDING)


def pages_label(pages):
    if not pages:
        return ""
    pages = sorted(pages)
    runs, start, prev = [], pages[0], pages[0]
    for p in pages[1:]:
        if p == prev + 1:
            prev = p
            continue
        runs.append((start, prev))
        start = prev = p
    runs.append((start, prev))
    return ", ".join(str(a) if a == b else f"{a}-{b}" for a, b in runs)
