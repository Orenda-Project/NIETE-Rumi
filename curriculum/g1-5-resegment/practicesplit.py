# -*- coding: utf-8 -*-
"""Move one practice item to the day that already teaches its page.

bd-xd2uq. `wordbudget` caps a printed practice block at 350 words and says
what to do when a lesson goes over: "the fix is editorial -- `practice` over
cap splits across days rather than being compressed". Compressing is the one
thing that must not happen, because what pushed these four Maths lessons over
was bd-eakp8 writing the missing ANSWERS in; trimming the overrun trims the
answers back out and re-opens the complaint the repair was for.

So this module moves an item instead of shortening one. The whole of its
value is in the refusals, because the obvious version of this operation is
wrong in a way a word count cannot see:

  * a practice item is anchored to a printed page ("p.78 Q2a"), and a day
    teaches a span of pages. Moving an item into a day that is not on that
    page satisfies the cap by sending the class to a page it does not have
    open -- a worse defect than the one being fixed, and an invisible one.
  * a move that leaves EITHER lesson over cap has bought nothing; it has
    just moved the failure, so both ends are checked after the move, not
    before.
  * a lesson already under cap is never touched. There is no reason to
    reshape a passing lesson, and doing so would put a day's practice out of
    step with the SLO it was authored against.

The word count is injected rather than computed here. The budget is measured
on the RENDERED document (`wordbudget` is explicit about that), and rendering
needs the page truth, the segment row and a key-free but I/O-heavy path; the
decisions above need none of it. The caller supplies two counters, one per
lesson, and everything in this file runs in a unit test with no corpus.
"""
import copy
import re

#: The printed practice cap, from `lp_reviewer.wordbudget.CAPS["practice"]`.
#: Duplicated as a default, never as a second source of truth -- a caller
#: with the reviewer on its path should pass the real one.
CAP = 350

#: "p.78 Q2a", "p 206 Q1", "pp.94-95". The `p` is required: a bare number in
#: a prompt is nearly always the arithmetic, not a citation.
_PAGE = re.compile(r"\bpp?\.?\s*(\d+)")


class Refused(Exception):
    """The move was not made, and the message says which rule stopped it."""


def cited_page(problem):
    """The printed page a problem sits on, or None if it names none."""
    m = _PAGE.search((problem or {}).get("prompt") or "")
    return int(m.group(1)) if m else None


def move(donor, receiver, index, recv_pages, donor_words, recv_words,
         cap=CAP):
    """`donor[index]` moved to `receiver`, or `Refused` with the reason.

    `donor_words` and `recv_words` each take a problem list and return that
    lesson's rendered practice word count. Neither input list is mutated;
    the two new lists are returned.
    """
    if not 0 <= index < len(donor or []):
        raise Refused("problem %r is not in the donor's %d problems"
                      % (index, len(donor or [])))
    before = donor_words(donor)
    if before <= cap:
        raise Refused("the donor is already under cap (%d of %d) -- a "
                      "passing lesson is not reshaped" % (before, cap))
    item = donor[index]
    page = cited_page(item)
    if page is None:
        raise Refused("the item cites no page, so no day can be shown to "
                      "teach it: %r" % ((item.get("prompt") or "")[:60],))
    if page not in (recv_pages or []):
        raise Refused("page %d is not in the receiver's pages %r -- the "
                      "move would set work on a page the class is not on"
                      % (page, list(recv_pages or [])))
    out_donor = [copy.deepcopy(p) for k, p in enumerate(donor) if k != index]
    out_recv = [copy.deepcopy(p) for p in receiver or []] + \
        [copy.deepcopy(item)]
    after = donor_words(out_donor)
    if after > cap:
        raise Refused("the donor is still over after the move (%d of %d) -- "
                      "one item does not fix it" % (after, cap))
    landed = recv_words(out_recv)
    if landed > cap:
        raise Refused("the receiver would go over (%d of %d) -- the move "
                      "relocates the failure instead of clearing it"
                      % (landed, cap))
    return out_donor, out_recv
