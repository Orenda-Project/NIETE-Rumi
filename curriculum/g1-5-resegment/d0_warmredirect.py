"""bd-y7hst, reopened again -- LAST-RESORT ADDRESSEE REDIRECT for a warm-up that
`one_strategy()` (in `d0_warmitems.py`) would otherwise leave EMPTY.

Split into its own module rather than grown into `d0_warmitems.py` (300-line file
limit; that file was already 346 lines before this bead). `one_strategy()` still owns
the decision of WHEN to call this -- only in the zero-survivor case, never otherwise --
see its own docstring for the composition; a warm-up that keeps at least one item under
the ordinary per-item pass never reaches this module at all.

THE DEFECT: six shipping lessons end with an empty warm-up because every one of their
items is student-to-student TALK with no clean prefix/label for `_repair_or_drop`'s
segment pipeline to strip -- the ban IS the whole item (a single-sentence "tell your
partner X" or a "Partner A"/"Partner B" role label), not a trailing or leading clause.
`_repair_or_drop` correctly drops these whole (the segment-level, not clause-level,
gap its own docstring already admits), but dropping every item in a warm-up loses the
lesson's retrieval slot entirely, which is a worse defect than the one being guarded
against.

  g1_ch10 Maths_seg4, g4_ch8 English_seg2/seg3: "tell your partner <retrieval>." -- the
  banned addressee "your partner" is fused directly onto the legal verb "tell" with no
  boundary between them. Redirected to "tell the class", the operator's own blessed
  whole-class fallback ("Hands up -- tell the class where you saw it." is measured
  clean).

  g2_ch10 English_seg4, g3_ch9 English_seg7, g5_ch9 English_seg6: "Partner A ...
  Partner B ..." -- the named-pair-protocol LABEL peertalk.js bans outright
  (`\\bPartner\\s+[AB]\\b`, case-sensitive), used here as a role label on an otherwise
  legal individual retrieval turn. Redirected to "One student"/"(a|A)nother student"
  (position-based casing: capitalised only when the label opens the string) -- turning
  a named PAIR into two individual turns, each a child speaking to the class or the
  teacher, which is explicitly legal.

BOTH transforms touch ONLY the addressee/role label, never the recalled content -- the
verbatim requirement this bead exists to protect. Deterministic, closed-set, no
invention: a string neither pattern matches comes back `None` and the caller drops it,
exactly as `_repair_or_drop` already does for an item it cannot repair.

WIRING: `one_strategy()` calls `redirect_dropped_items(dropped)` only when its own
per-item pass leaves zero survivors. `dropped` is `[(idx, item, q, reason), ...]` --
every item of that warm-up, each already established as individually unrepairable.

THE ANSWER FIELD ALSO CARRIES AN ADDRESSEE, sometimes: `g2_ch10 English_seg4` item 0's
own `a` ("...repeated by Partner B.") and both of `g5_ch9 English_seg6`'s items ("...
confirmed by Partner A/B.") name the same banned role label in their STORED ANSWER, not
just their question -- caught only by running the live gate over the full corpus, not
by a `q`-only unit test. `redirect_dropped_items` below checks and redirects `a` with
the exact same `redirect_addressee` the question uses (never a second, separate
pattern) whenever `is_banned_move(a)` fires, and falls back to dropping the whole item
if the answer cannot be redirected clean -- same "never invent, drop rather than guess"
rule as the question side. Verified this fallback does not fire for any of the six
named lessons: every affected answer redirects clean on the first try.
"""

from __future__ import annotations

import re

from d0_warmpeer import is_banned_move

# `\bPartner\s+[AB]\b` mirrors `d0_warmpeer._BANNED_MOVE`'s own "Partner A/B" entry
# exactly (case-sensitive on purpose, same precedent -- a lowercase "partner a/b" in
# the corpus would be the indefinite article, not the label, and is not what makes
# these six items unrepairable, so this stays exactly as narrow as the ban it answers).
_PARTNER_ROLE = re.compile(r"\bPartner\s+([AB])\b")

# The other shape among the six: a legal "tell <retrieval>" verb fused to the banned
# "partner" addressee with no boundary between them for `_repair_or_drop`'s segment
# pipeline to use. `re.I` so it catches both a sentence-opening "Tell your partner" and
# a mid-sentence "tell your partner".
_TELL_PARTNER = re.compile(
    r"\btell\b\s+(?:your|the|a|an|their|his|her)\s+partner\b", re.I)


def _partner_role_repl(m):
    """"One student" for the first-named role, "Another student" for the second --
    capitalised only when the label opens the string, lower-case mid-sentence (e.g.
    the second half of "Partner A recalls X; Partner B repeats it.")."""
    label = "One student" if m.group(1) == "A" else "Another student"
    if m.start() != 0:
        label = label[0].lower() + label[1:]
    return label


def _tell_partner_repl(m):
    """"Tell the class" / "tell the class" -- the operator's own blessed whole-class
    fallback, addressee only, casing matched to the original "Tell"/"tell"."""
    return "Tell the class" if m.group(0)[0].isupper() else "tell the class"


def redirect_addressee(text):
    """The redirected string, or `None` when neither closed-set pattern applies --
    the caller's signal to drop the item rather than invent a repair for it."""
    redirected = _PARTNER_ROLE.sub(_partner_role_repl, text)
    redirected = _TELL_PARTNER.sub(_tell_partner_repl, redirected)
    return redirected if redirected != text else None


def gap_item_redirected(idx, original_q):
    """Audit line for a successful redirect -- same wording convention as
    `d0_warmitems._gap_item_dropped`, so every change to a warm-up is traceable
    whether the item survived or not."""
    words = " ".join(original_q.split()[:8])
    return ("warmUp.items[%d].q (%r...) named a banned peer-to-peer ADDRESSEE on an "
            "otherwise legal retrieval; every item in this warm-up would otherwise be "
            "dropped and the lesson would lose its retrieval slot entirely, so the "
            "addressee (never the recalled content) was redirected to a legal "
            "whole-class/individual form -- last resort, bd-y7hst." % (idx, words))


def redirect_dropped_items(dropped):
    """Only called by `one_strategy()` in the zero-survivor case (see module
    docstring). `dropped` is `[(idx, item, q, reason), ...]`. Returns
    `(survivors, still_dropped, redirect_gaps)`:

      survivors: `[(idx, new_item), ...]`, same shape `one_strategy` already builds
        from its own per-item pass.
      still_dropped: the subset of `dropped` this could not redirect without inventing
        content -- same 4-tuple shape as the input, for the caller to gap exactly as
        it already does for a normal drop.
      redirect_gaps: `[(idx, message), ...]` audit lines for the ones that WERE
        redirected, for the caller to merge into its own gap list in idx order.

    Redirects `q` first; when the item's stored `a` ALSO names a banned addressee (see
    module docstring), `a` is redirected too, with the same closed-set function and the
    same "can't invent, so drop whole" fallback -- an item is only kept once both fields
    are clean.
    """
    survivors = []
    still_dropped = []
    redirect_gaps = []
    for idx, item, q, reason in dropped:
        candidate = redirect_addressee(q)
        if candidate is None or is_banned_move(candidate):
            still_dropped.append((idx, item, q, reason))
            continue
        new_item = dict(item)
        new_item["q"] = candidate
        a = str((item or {}).get("a") or "")
        if a and is_banned_move(a):
            a_candidate = redirect_addressee(a)
            if a_candidate is None or is_banned_move(a_candidate):
                still_dropped.append((idx, item, q, reason))
                continue
            new_item["a"] = a_candidate
        survivors.append((idx, new_item))
        redirect_gaps.append((idx, gap_item_redirected(idx, q)))
    return survivors, still_dropped, redirect_gaps
