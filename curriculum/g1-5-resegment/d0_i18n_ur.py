"""Stage D0 -- Urdu print-string localisation (bd-p8g50, worker W1).

Amena's ruling, 25 Sep: a Grade 1 Urdu teacher must not meet an English word
anywhere on the printed plan. `d0_primary.to_lp_doc` calls
`translate_doc(doc, medium)` once, at the very end, on the fully-built doc.
It is a no-op when `medium != "ur"`, so every existing English-medium test
and render is byte-identical to before this module existed, by construction.

This module owns only strings BUILD itself bakes into the doc: block titles
it writes literally, the "Say:" label, the "Halfway check" paragraph, the
routine paragraph's "min." abbreviation, the design-pending sentinel, and the
video title/curator-note pair from d0_media.apply_video. `text_verbatim` (the
quoted SLO) is frozen -- never touched, same rule the renderer's own
ur_overlay enforces (lib/overlay.js FROZEN_POINTERS).

Several BUILD-baked titles never reach this module's table ON PURPOSE:
"Opening", "Explanation", "We Do · You Do", "Check", "Worked example",
"Teacher models", and the two practice-mode pills ("WE DO · class
practises together", "YOU DO · pupils work alone") are all rescued
automatically by the review renderer's `chromeText(title, L[id])`
(lib/template.js) against its own reviewed `LABELS.ur` table
(lib/overlay.js) -- confirmed by reading that code AND by their total
absence from scan_before.txt's 19-file census. So is `section.move`
("I DO"/"WE DO"/"YOU DO" as a structured field): the renderer normalises a
closed three-value vocabulary through `L.iDo`/`L.weDo`/`L.youDo` regardless
of what is authored (see the bd-yjmxh comment in lib/overlay.js). So is
`provenance.chapter`'s leading "Ch.N" token (lib/labels_ur.js
`chapterLabel`). Touching any of these here would risk a second,
inconsistent Urdu wording for the same concept -- leaving them is the
surgical choice, named in the W1 report as "left for W2" even though they
need no further action from either of us.

Also out of scope, confirmed enr/W3 content by direct inspection (not a
BUILD print site): materials defaults (`materials` is a pure passthrough of
`enr["generated"]["materials"]`), strand codes (embedded in enr's own
`slo_refs`), "model_solution"/"markScheme:" artifacts typed into enr prose,
and the pedagogy-jargon words in the census that grep confirms are nowhere
in BUILD's `d0_*.py`.
"""
from __future__ import annotations

import re

import d0_blocks as B

# ---- exact-match block-title fixes -----------------------------------------
# Every one of these is a `key_points`/`ask` block title BUILD writes
# literally, and the renderer prints it VERBATIM: unlike introduction/
# development/activity/conclusion (section ids) and worked_example/
# faded_example/practice (block types), a key_points/ask block has no
# id-keyed chromeText fallback (lib/template.js kpLabel: `b.title ===
# undefined ? L.keyPoints : b.title` -- defined titles print as-is).
_TITLE_UR = {
    "Set the task going": "کام کا آغاز کریں",
    "On the page · read aloud": "کتاب میں · بلند آواز سے پڑھیں",
    "Then read aloud": "پھر بلند آواز سے پڑھیں",
    "Set this up": "یوں شروع کریں",
    "Homework": "گھر کا کام",
    "Remember": "یاد رکھیں",
}

_DESIGN_PENDING_UR = "یہ حصہ ابھی تیار نہیں ہوا"

# "Say: <line>" -> "کہیے: <line>" (d0_lines.say_line's own label, matches
# lib/overlay.js LABELS.ur.say = "کہیے"). Preserves the remainder verbatim,
# origin-agnostic: this fires whether Stage C or say_line wrote the prefix.
_SAY_PREFIX = re.compile(r"^(\s*)Say:(\s*)")

# d0_routine.checkpoint_block's fixed sentence.
_HALFWAY = re.compile(
    r"^Halfway check · minute (\d+)\. By now the class should be "
    r"starting (I DO|WE DO|YOU DO)\.$"
)
# Same three words lib/overlay.js LABELS.ur uses for iDo/weDo/youDo, reused
# here rather than re-coined, so a teacher never reads two different Urdu
# names for the same move.
_MOVE_UR = {"I DO": "کر کے دکھائیں", "WE DO": "مل کر کریں", "YOU DO": "خود کریں"}

# d0_routine.block's "<phase> · N min. <action>" paragraph -- only the
# "min." abbreviation is BUILD's; `phase`/`action` are the routine step's own
# text and stay out of this module's scope.
_ROUTINE_MIN = re.compile(r"(\d+) min\.")

# Same shape as wk_urdu_i18n/latin_scan.py's own RUN regex, so "is this
# Latin?" never disagrees between the census and the fix.
_LATIN_RUN = re.compile(r"[A-Za-z][A-Za-z .·'’,:()&/-]*[A-Za-z]")

# Corpus-scoped: the exact video titles d0_media/mediamap produce for this
# g1_ch8-10 Urdu corpus (verified by loading mediamap against the real 19 enr
# files, not reverse-engineered from pdftotext-mangled census text).
_VIDEO_TITLE_UR = {
    "Panch Harfi Alfaaz": "پانچ حرفی الفاظ",
    "Eeraab": "اعراب",
    "Bari Yaay Ki Awaaz": "بڑی یے کی آواز",
    "Noon Aur Noongunna Noon Aur Noon Gunna": "نون اور نون غنہ",
}


def _translate_video_title(title):
    """A video's `title` -> Urdu script. Corpus titles first; anything else
    (a mixed English/romanised + Urdu-script title, e.g. "Urdu Diacritics Or
    Accent Marks اعراب: پیش") has its
    Latin run(s) stripped, keeping the author's own Urdu-script remainder --
    curator notes are dropped entirely (see `_walk`), never translated, per
    BRIEF's "reviewer-facing notes are not teacher text" rule."""
    t = (title or "").strip()
    if t in _VIDEO_TITLE_UR:
        return _VIDEO_TITLE_UR[t]
    stripped = _LATIN_RUN.sub("", t)
    stripped = re.sub(r"^[\s·\-:]+|[\s·\-:]+$", "", stripped)
    stripped = re.sub(r"\s+", " ", stripped).strip()
    return stripped or t


def _fix_text(s):
    if not isinstance(s, str) or not s:
        return s
    if s == B.DESIGN_PENDING:
        return _DESIGN_PENDING_UR
    m = _HALFWAY.match(s)
    if m:
        minute, phase = m.groups()
        return "وقفہ جانچ · منٹ %s۔ اس وقت تک جماعت کو %s کا آغاز کر دینا چاہیے۔" % (
            minute, _MOVE_UR.get(phase, phase))
    if _SAY_PREFIX.match(s):
        return _SAY_PREFIX.sub(lambda m: m.group(1) + "کہیے: ", s, count=1)
    return s


def _looks_like_video(d):
    return isinstance(d, dict) and "url" in d and ("title" in d or "why" in d or "channel" in d)


def _walk(node):
    if isinstance(node, dict):
        if _looks_like_video(node):
            node.pop("why", None)
            if "title" in node:
                node["title"] = _translate_video_title(node["title"])
        is_routine = node.get("type") == "paragraph" and node.get("id") in ("routine", "halfway")
        # A block dict carries its own "type" (key_points/ask/paragraph/...);
        # a section dict never does (id/title/blocks/move only -- see
        # d0_close.py/d0_primary.py). _TITLE_UR is a block-title table, so it
        # must only ever fire on a block's own "title", never a section's --
        # otherwise a shared English spelling ("Homework") would relabel
        # chrome the renderer already rescues via chromeText/LABELS.ur.
        is_block = "type" in node
        for k, v in list(node.items()):
            if k == "text_verbatim":
                continue  # frozen: the quoted curriculum wording never changes.
            if isinstance(v, str):
                if k == "title" and is_block and v in _TITLE_UR:
                    node[k] = _TITLE_UR[v]
                    continue
                fixed = _fix_text(v)
                if is_routine and k == "text":
                    fixed = _ROUTINE_MIN.sub(lambda m: m.group(1) + " منٹ", fixed)
                node[k] = fixed
            else:
                _walk(v)
    elif isinstance(node, list):
        for i, item in enumerate(node):
            if isinstance(item, str):
                node[i] = _fix_text(item)
            else:
                _walk(item)


def translate_doc(doc: dict, medium: str) -> dict:
    """Localise every BUILD-baked English string in `doc` for Urdu print, in
    place, and return it. No-op when `medium != "ur"`."""
    if medium != "ur":
        return doc
    _walk(doc)
    return doc
