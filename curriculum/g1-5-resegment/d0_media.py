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
            val = teacher_half(val)
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
