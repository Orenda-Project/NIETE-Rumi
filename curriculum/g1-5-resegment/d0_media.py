"""Stage D0 — the video join.

Operator: *"I have the videos mapped in the new sheet, how can we bring that in this old
sheet that is live on prod?"*

Nothing here chooses a video. The choosing already happened: `Videos <-> SLOs` carries 1,461
mapped rows over 658 distinct SLO codes, each matched SLO-to-SLO against the video's own
transcript-derived SLO and carrying the evidence line that justifies it (spec/05-media.md).
This module is the wiring, and only the wiring.

WHY IT WAS MISSING. `template.js` has read `sections[<development>].video` since v9.3 and
`videoRow()` has rendered it correctly the whole time. No producer ever wrote the key, so the
PRIMARY branch fell through to its pending marker on every lesson -- including the ones whose
SLO is mapped. The G3 Maths Ch.2 Day 5 sample printed "no video mapped yet" while a
high-confidence match sat in the sheet. One missing assignment, 1,461 rows of work invisible.

KEYED ON SLO, NEVER ON DAY NUMBER (spec/05-media.md's opening line). That is what lets the
same map serve the old production segmentation and the new one: a boundary rebuild moves days
around, and the SLO travels with the content. The lookup itself is the caller's -- this module
takes the row already chosen for this lesson, so it stays free of I/O and of the sheet.

TWO LINK SHAPES, because the catalogue has two kinds of video. 617 rows carry a real url
(YouTube, Sabaq, Khan Academy); 844 carry a bare Taleemabad library key like
`Grade3MathsAdditionAndSubtractionAdditionAndSubtraction`, which the catalogue's own play
links resolve under `videos/<key>.mp4` on the student-library bucket. `videoRow()` refuses
anything that is not http(s) and returns an empty row, so an unresolved key is not a
cosmetic gap -- it is a mapped video silently lost on 58% of the mapped days.

ADDITIVE, so an unmapped day is untouched by construction: no row means no `video` key, and
`videoRow()` then takes the branch that prints nothing. That is deliberate. Operator, on the
pending marker: *"what is pending is not relevant for Primary."*

EVERY REFUSAL IS LOUD. A row whose link resolves to neither shape is dropped whole and says
so in `notes.gaps`, where a human reads it. A video the teacher cannot play is worse than a
row that admits it has none.
"""

from __future__ import annotations

import re

# The student video library. Taken from the catalogue's own "play" hyperlinks
# (`Taleemabad Videos & Quizzes` -> All Assets), not guessed from a pattern.
LIBRARY_BASE = "https://pub-0edccec5d5bd419782ba389c59faecac.r2.dev/videos"

# A library key is the file stem: letters and digits, no separators, no scheme.
# Anything with a colon in it is a url that failed the http(s) test above and must not be
# smuggled through as a "key" -- that is how a `javascript:` link would reach an href.
_KEY_OK = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")


def resolve_url(link) -> str | None:
    """The playable url for one map row's `Video - key / link` cell, or None.

    http(s) passes through untouched; a bare library key becomes its mp4 on the library
    bucket. Everything else -- a blank cell, another scheme, a key with punctuation in it --
    is None, because the renderer will refuse it anyway and a refusal the producer can
    explain beats one that silently empties a row.
    """
    s = str(link or "").strip()
    if not s:
        return None
    low = s.lower()
    if low.startswith("http://") or low.startswith("https://"):
        return s
    if s and all(c in _KEY_OK for c in s):
        return f"{LIBRARY_BASE}/{s}.mp4"
    return None


# bd-ht067. The map's `why` column carries TWO audiences in one string. The mapping run wrote
# the teacher's half, then ` || MANAGER: ...` -- its own confidence verdict, its live-check
# notes, the sid/yt ids of the video it thinks we should swap to, addressed to the ICT team.
# All of it printed into the lesson a teacher opens, and set LTR inside an RTL block besides.
#
# 135 of the corpus's 1,461 `why` fields are affected: 129 use the ` || ` convention and 6 are
# ours end to end, opening `MANAGER-SOURCED FILL`. So the marker is matched in the published
# form -- the delimiter, or the word in CAPS at a word boundary. A teacher-facing sentence
# about a shop manager is lower-case and survives; the pipeline's own voice does not.
_INTERNAL = re.compile(r"\|\||\bMANAGER\b")


def teacher_half(why) -> str:
    """A map row's `why` up to the first internal marker, or "" if none of it is the teacher's.

    Returning "" rather than the manager's text is the whole point: `video_block` drops a
    falsy field, so the video still renders with its link and title and simply carries no
    rationale. A video with no reason given is honest. A video whose reason is addressed to
    someone else is not -- and the operator asked for the opposite of that:
    *"for the video, just its URL and a description of what it entails is enough."*
    """
    s = str(why or "").strip()
    if not s:
        return ""
    m = _INTERNAL.search(s)
    if m:
        s = s[:m.start()]
    # The delimiter is usually written with a trailing dash or semicolon on the teacher side.
    return s.strip().rstrip("-\u2013\u2014;:,").strip()


# bd-v2ikv. Operator, twice: "urdu video caption too long", then in English, "the video still
# has too long a caption" -- so the cap is NOT a script-specific fix. `teacher_half` strips the
# internal half above; this caps what is left, because the corpus's longest KEPT caption still
# runs 860 code points, and `.vwhy` (lib/template.js) carries no CSS overflow rule of its own --
# unlike the video's title (`.vres a`), which IS clamped to one line for exactly this reason,
# `.vwhy` just wraps the row down the page as far as the string makes it go.
#
# The number is read off the page the caption sits on. `PAGE_FORMATS.phone` in lib/template.js
# is `{w: 520, padX: 21}` -- a 478px content column -- and `.vwhy` renders at
# `font-size:16px; font-style:italic`. Proportional Latin body text at that size averages
# roughly 0.5em (~8px) per glyph, so about 58 code points fit one line; three lines -- the most
# a caption under an already one-line-clamped title should cost -- is ~174. That lines up with
# the corpus's own 75th percentile (179 code points) almost exactly: the quarter of captions
# above it is the quarter this caps.
CAPTION_CAP = 175

# U+2026, one code point, bidi class ON (neutral) -- it takes its rendered position from
# whatever direction surrounds it rather than carrying one of its own. See `cap_caption`.
_ELLIPSIS = "…"


def cap_caption(text, cap=CAPTION_CAP) -> str:
    """`text` capped to `cap` CODE POINTS -- never a partial word, never a split grapheme.

    Measured with `len([*s])`, never `len(s)`: Rule 20 (language-protocol) is explicit that a
    string's length is taken in code points, never bytes and never a UTF-16-unit assumption --
    on the record of a WhatsApp field cap that took `/language` down for hours when it wasn't.

    Cuts on a WORD boundary by keeping whole space-separated tokens up to the budget, which is
    also the grapheme guarantee for free: a combining mark always sits INSIDE a token, never
    floating after a bare space, so a cut that never lands inside a token never lands inside a
    grapheme either.

    The ellipsis goes at the LOGICAL end, always -- `text[:cut] + "…"`, never reversed.
    That is correct for Urdu for the same reason it is correct for English: Unicode text is
    stored in logical (reading) order regardless of script, and a bidi-neutral mark appended
    there renders at the visually correct edge under the Unicode Bidi Algorithm without this
    function knowing or caring which script it is looking at. "Flipping" the ellipsis for RTL
    would be the bug, not the fix -- it would reverse word order on top of an already-neutral
    mark that did not need help.
    """
    if len([*text]) <= cap:
        return text
    budget = cap - len([*_ELLIPSIS])
    words = text.split(" ")
    kept, used = [], 0
    for w in words:
        add = len([*w]) + (1 if kept else 0)
        if used + add > budget:
            break
        kept.append(w)
        used += add
    if not kept:
        # No single word fits under the budget -- not observed anywhere in the 1,455-row
        # corpus, but keeping the whole first word beats cutting it mid-grapheme to comply.
        return words[0]
    return " ".join(kept).rstrip(",;:-–—") + _ELLIPSIS


def video_block(media) -> dict | None:
    """One map row -> the `video` object `videoRow()` reads, or None.

    `title` is the visible run and `url` the href; `confidence` and `why` ride along because
    spec/05-media.md makes both non-optional -- "low confidence is shown, not hidden", and
    the why-line quotes what the video itself says so a teacher who disagrees can see our
    reasoning and tell us we are wrong.
    """
    if not isinstance(media, dict) or not media:
        return None
    url = resolve_url(media.get("link") or media.get("url"))
    if not url:
        return None
    out = {"url": url}
    # The sheet's column names are NOT v9's property names, and `video` is a closed object
    # (`additionalProperties: false`), so every field is mapped deliberately: `source` ->
    # `channel`, both meaning who published it. A sheet column with no v9 property is dropped
    # here rather than passed through -- one unmapped key fails the whole render, lesson and all.
    for src, dst in (("title", "title"), ("source", "channel"),
                     ("confidence", "confidence"), ("why", "why"), ("duration", "duration")):
        val = str(media.get(src) or "").strip()
        if src == "why":
            val = cap_caption(teacher_half(val))
        if val:
            out[dst] = val
    return out


def apply_video(sections, media) -> list[str]:
    """Seat this lesson's video on the development section, in place. Returns the gap lines.

    The seat is `development` and not a section of its own because that is the key the
    renderer reads; `videoRow()` hoists it to the page-1 resources card itself, so the
    document says where the video belongs to the lesson and the renderer says where it
    belongs on the page.
    """
    if not isinstance(media, dict) or not media:
        return []
    block = video_block(media)
    if not block:
        link = str(media.get("link") or media.get("url") or "").strip()
        return ["video dropped: %s is neither an http(s) link nor a library key" %
                (repr(link) if link else "the mapped row carries no link")]
    dev = next((s for s in sections if isinstance(s, dict) and s.get("id") == "development"), None)
    if dev is None:
        return ["video dropped: this lesson has no development section to seat it on"]
    dev["video"] = block
    return []
