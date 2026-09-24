"""bd-y7hst -- Opening-section peer-talk PASS-THROUGH FILTER.

Scope, settled by the operator and the swarm coordinator (not re-derived here):
Opening peer-talk is AUTHORED source content reaching the doc via
`d0_hook.hook_blocks()`, not generator-emitted -- Guided Practice keeps its own
authored student-to-student talk untouched (873 strings, out of scope). Only a
section whose `title` matches /opening/i, and only its already-assembled
`blocks` content, is in scope: `blocks[N].question`, `blocks[N].text`, and
`blocks[N].items[N]` (a plain string, or every string-valued key of a dict
EXCEPT `meaning` -- a vocabulary gloss is out of scope entirely; the live gate
now enforces the same `/meaning` skip at its own level).

This is a FILTER, not a generator/emitter rewrite: it never invents replacement
prose and never invents Urdu. REMOVAL is the preferred strategy over rewriting
-- a clean excision of the banned clause, keeping every legal word around it,
beats any paraphrase. Where excision is not clean (the banned span cannot be
isolated as one contiguous run touching the string's own edges or two legal
runs), or where it is a whole single-sentence item with nothing left to keep,
the text is left BYTE-FOR-BYTE UNCHANGED and a gap is recorded instead --
"a half-rewritten sentence is worse than a flagged one."

TEXTBOOK RULE (operator ruling, 2026-09-24): a banned move that only exists
because the text REPORTS or QUOTES what the textbook page asks/says (page
reference tight against the banned clause, e.g. "p.177, ... asks each
partner", or "Say: \"...textbook p.210... asks, 'With a partner...'\"") is
GAPPED, never rewritten, even when it would otherwise excise clean -- rewriting
would make the LP misdescribe or misquote the book the teacher holds. Checked
on the banned run's OWN text (or, when no single segment is individually
flagged -- the whole-string-only match `_is_textbook_report` also falls back
to -- the whole string), never on the field as a whole, so an unrelated page
reference elsewhere in the same paragraph (a glossary page, a chart page) does
not gap an otherwise-clean lead/trail/middle excision.

ONE closed-set, last-resort substitution (mirrors `d0_warmredirect`'s own
precedent: narrow, exact-match, never invented): the single whole-item banned
string "Whisper your first guess to your partner." has a natural whole-class
form the operator already blessed elsewhere ("Write the word in your copy.
When I clap, the whole class says it together and you tick or fix your own." )
-- gate-clean per `test_peer_talk_gate.py::test_allowed_move_passes_clean`.
No other whole-string-banned case gets a substitute; excision leaves nothing
to keep, so it is gapped.

WIRING (coordinator owns `d0_primary.py`; hand-back only, never edited here):
`apply_opening_peer_talk(sections)` mirrors `d0_warmitems.apply_one_strategy`'s
contract exactly -- find the Opening section by title, mutate `blocks` in
place, return `[]` when there is nothing to do, a list of gap-message strings
otherwise.
"""

from __future__ import annotations

import re

from d0_warmpeer import is_banned_move

_BOUNDARY = re.compile(r"(?<=[.!?۔؟:])\s+|(?<=\s)[-–—]{1,2}(?=\s)")

_PAGE_REF = re.compile(r"\bp\.\s*\d+\b", re.I)
_TEXTBOOK_FRAME = re.compile(
    r"\btextbook\b|\bthe\s+(?:page|book)\s+(?:asks|says)\b|\bp\.\s*\d+\s+(?:asks|says)\b",
    re.I,
)

# Closed-set, last-resort only (see module docstring) -- the operator's own
# blessed whole-class form, keyed on the exact whole-item text it answers.
_ALL_DROP_FALLBACK = {
    "Whisper your first guess to your partner.":
        "Write the word in your copy. When I clap, the whole class says it "
        "together and you tick or fix your own.",
}

# Closed-set, exact-match, last-resort excisions -- mirrors `d0_warmredirect`'s
# own precedent (`_PARTNER_ROLE`, `_TELL_PARTNER`): narrow, real corpus
# substrings, never a pattern, via plain `str.replace(needle, "", 1)`. Found
# by the coordinator's full-corpus validation (bd-y7hst, 2026-09-24) as two
# shapes the segment pipeline can't reach alone: `is_banned_move` doesn't
# flag "sit in a circle" at the whole-string level even though the live gate
# does (so this pass runs BEFORE that gate, unconditionally, not only once
# the pipeline has already decided a field is banned); and a clause fused to
# legal text on both sides, or glued to the next sentence by a closing quote
# right after a period (`_BOUNDARY`'s lookbehind never fires there). Plain
# substring removal never touches a quote/paren char, so it can't itself
# break the balance checks below; each needle is hand-verified against its
# one real corpus string, and collides with no other field in the corpus.
_KNOWN_CLAUSE_NEEDLES = [
    ", and tell a buddy which one made us laugh or think",  # g2_ch10/English_seg1
    "sit in a circle, ",                                     # g4_ch9/English_seg4
    ", guess with your partner",                             # g2_ch8/English_seg5
    "Say it out loud with your partner. ",                   # g2_ch8/English_seg5
]


def _strip_known_clauses(text):
    for needle in _KNOWN_CLAUSE_NEEDLES:
        if needle in text:
            text = text.replace(needle, "", 1)
    return text

_GAP_TEXT = {
    "embedded_clause_removed":
        "a banned clause was fused to legal text on both sides (or glued to an "
        "adjacent sentence by a quote mark) so the segment pipeline could not "
        "isolate it; excised via a closed-set exact-match substring instead, "
        "remainder kept",
    "textbook_quote_or_report": "reports/quotes the textbook page -- left unchanged, never rewritten",
    "dropped_whole_banned": "the banned move IS the whole string; excised to nothing",
    "redirected_to_blessed_whole_class_form":
        "the banned move was the whole string; redirected to the operator's own blessed whole-class form",
    "lead_clause_removed": "banned lead clause excised, legal remainder kept",
    "trailing_clause_removed": "banned trailing clause excised, legal remainder kept",
    "middle_clause_removed": "banned clause excised from the middle, both legal sides kept and joined",
    "multiple_banned_runs_no_clean_removal":
        "banned move recurs in more than one non-contiguous run; no clean excision, left unchanged",
    "whole_field_banned_no_safe_removal":
        "the banned move is the whole string with no blessed substitute; left unchanged rather than emptied",
    "unbalanced_delimiters_after_removal":
        "candidate excision left unbalanced quotes/parens; reverted, left unchanged",
    "residual_after_attempted_repair":
        "no segment isolates the banned move cleanly (or the repair still reads as banned); left unchanged",
}


def _is_textbook_report(text):
    return bool(_TEXTBOOK_FRAME.search(text) or _PAGE_REF.search(text))


def _segments(text):
    spans, pos = [], 0
    for m in _BOUNDARY.finditer(text):
        if m.start() > pos:
            spans.append((pos, m.start()))
        pos = m.end()
    if pos < len(text):
        spans.append((pos, len(text)))
    return [(s, e) for s, e in spans if text[s:e].strip()]


def _balanced_parens(text):
    depth = 0
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def _quotes_balanced(text):
    if text.count('"') % 2 != 0:
        return False
    if text.count("“") != text.count("”"):
        return False
    if text.count("‘") != text.count("’"):
        return False
    return True


def _finish(s):
    s = " ".join(s.split())
    if s and s[0].islower():
        s = s[0].upper() + s[1:]
    return s


def _redirect(text):
    """(new_text, gap_reason_or_None). Never invents replacement prose.

    `_strip_known_clauses` runs UNCONDITIONALLY, before the `is_banned_move`
    gate (see `_KNOWN_CLAUSE_NEEDLES`). Every bail-out below reverts to the
    ORIGINAL `text`, never the partially-stripped `working`.
    """
    if not text:
        return text, None

    working = _strip_known_clauses(text)
    if working != text and not is_banned_move(working):
        return working, "embedded_clause_removed"

    pipeline_text = working if working != text else text
    if not is_banned_move(pipeline_text):
        return text, None

    segs = _segments(pipeline_text)
    if not segs:
        return text, "residual_after_attempted_repair"

    flags = [is_banned_move(pipeline_text[s:e]) for s, e in segs]
    idxs = [i for i, f in enumerate(flags) if f]

    if not idxs:
        reason = "textbook_quote_or_report" if _is_textbook_report(pipeline_text) \
            else "residual_after_attempted_repair"
        return text, reason

    if idxs != list(range(idxs[0], idxs[-1] + 1)):
        return text, "multiple_banned_runs_no_clean_removal"

    start, end = idxs[0], idxs[-1] + 1
    run_text = pipeline_text[segs[start][0]:segs[end - 1][1]]
    if _is_textbook_report(run_text):
        return text, "textbook_quote_or_report"

    if start == 0 and end == len(flags):
        fallback = _ALL_DROP_FALLBACK.get(pipeline_text.strip())
        if fallback is None:
            return text, "whole_field_banned_no_safe_removal"
        candidate, gap = fallback, "redirected_to_blessed_whole_class_form"
    elif start == 0:
        suffix = pipeline_text[segs[end][0]:segs[-1][1]]
        candidate, gap = _finish(suffix), "lead_clause_removed"
    elif end == len(flags):
        prefix = pipeline_text[segs[0][0]:segs[start - 1][1]].strip()
        if prefix and prefix[-1] not in ".!?۔؟:":
            prefix += "."
        candidate, gap = prefix, "trailing_clause_removed"
    else:
        left = pipeline_text[segs[0][0]:segs[start - 1][1]]
        right = pipeline_text[segs[end][0]:segs[-1][1]]
        candidate = (left.strip() + " " + _finish(right)).strip()
        gap = "middle_clause_removed"

    if not _balanced_parens(candidate) or not _quotes_balanced(candidate):
        return text, "unbalanced_delimiters_after_removal"
    if candidate and is_banned_move(candidate):
        return text, "residual_after_attempted_repair"
    if not candidate and gap != "redirected_to_blessed_whole_class_form":
        return text, "residual_after_attempted_repair"

    return candidate, gap


def _gap_message(path, original_text, reason):
    words = " ".join(original_text.split()[:10])
    return "Opening/%s (%r...) %s -- bd-y7hst opening peer-talk filter." % (
        path, words, _GAP_TEXT.get(reason, reason))


def _process_field(block, key, bi, gaps, path_fmt):
    val = block.get(key)
    if not isinstance(val, str) or not val:
        return
    new_val, reason = _redirect(val)
    if reason is not None:
        gaps.append(_gap_message(path_fmt, val, reason))
    if new_val != val:
        block[key] = new_val


def apply_opening_peer_talk(sections):
    """Mirrors `d0_warmitems.apply_one_strategy`'s contract: find the Opening
    section by title, mutate its `blocks` in place, return `[]` when there is
    nothing to do, else the accumulated gap-message list."""
    gaps = []
    section = next(
        (sec for sec in (sections or [])
         if re.search(r"opening", str((sec or {}).get("title") or ""), re.I)),
        None,
    )
    if section is None:
        return gaps

    for bi, block in enumerate(section.get("blocks") or []):
        if not isinstance(block, dict):
            continue
        for key in ("question", "text"):
            _process_field(block, key, bi, gaps, "blocks[%d].%s" % (bi, key))

        items = block.get("items")
        if not isinstance(items, list):
            continue
        for ii, item in enumerate(items):
            if isinstance(item, str) and item:
                new_val, reason = _redirect(item)
                if reason is not None:
                    gaps.append(_gap_message(
                        "blocks[%d].items[%d]" % (bi, ii), item, reason))
                if new_val != item:
                    items[ii] = new_val
            elif isinstance(item, dict):
                for k, v in list(item.items()):
                    if k == "meaning" or not isinstance(v, str) or not v:
                        continue
                    new_val, reason = _redirect(v)
                    if reason is not None:
                        gaps.append(_gap_message(
                            "blocks[%d].items[%d].%s" % (bi, ii, k), v, reason))
                    if new_val != v:
                        item[k] = new_val

    return gaps
