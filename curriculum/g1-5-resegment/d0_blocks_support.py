"""Stage D0 — supporting block builders, split out of d0_blocks.py.

Same pattern as d0_bigidea.py / d0_page2.py, both already split out at the
300-line limit: `from d0_blocks import DESIGN_PENDING`. This cut (bd-y7hst,
23 Sep 2026) grew d0_blocks.py to 316 lines while fixing the We-Do partner
prompt, so the warm-up items, the keywords block, the hook-character speech
line and the said-already dedup helper move here. None of them are called by
the three move builders (I Do / We Do / You Do) that stay behind, and none of
them carry teacher-to-student-talk content -- they are data shaping, not
script text.

Tests: test_d0_blocks_support.py.
"""
import re

from d0_blocks import DESIGN_PENDING


def keywords_block(key_words, page):
    items = [{"word": w.get("term") or "", "meaning": w.get("student_definition") or ""}
             for w in (key_words or [])[:8]]
    items = [i for i in items if i["word"] and i["meaning"]]
    if not items:
        return None
    blk = {"type": "keywords", "id": "keywords", "items": items}
    if page:
        blk["page"] = str(page)
    return blk


RETRIEVAL_MARKERS = ("retrieval", "cumulative", "spaced", "recall", "fluency", "drill")


def _answer_of(item):
    """Enrichment spells the expected answer four different ways."""
    for key in ("expected_answer", "expected_answers", "expected", "expected_spelling_check"):
        v = item.get(key)
        if isinstance(v, list):
            v = "; ".join(str(x) for x in v if x)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _kind_of(item, first):
    """v9's warm-up axis is scaffold | prerequisite | spaced.

    The primary corpus carries no such field -- only free-text pedagogy labels
    (`type`: "cumulative peer retrieval", "number-sense warm-up", ...). Derive
    it: anything the source calls retrieval/spaced practice IS spaced; the
    schema says the scaffold for today's concept comes first, so the leading
    item is the scaffold and the rest are prerequisite.
    """
    label = " ".join(str(item.get(k) or "") for k in ("type", "mode", "delivery")).lower()
    if any(m in label for m in RETRIEVAL_MARKERS):
        return "spaced"
    return "scaffold" if first else "prerequisite"


def warmup_items(warm):
    """Enrichment writes warm-up items either as dicts or as bare strings."""
    out = []
    for i in warm.get("items") or []:
        if isinstance(i, str):
            i = {"prompt": i}
        if not isinstance(i, dict):
            continue
        q = (i.get("prompt") or i.get("dictated_sentence") or "").strip()
        if len(q) < 3:
            continue
        out.append({"q": q,
                    "a": _answer_of(i) or DESIGN_PENDING,
                    "kind": _kind_of(i, not out)})
    return out


def _norm(s):
    """Loose form for containment checks: case, punctuation and spacing dropped."""
    return re.sub(r"[^a-z0-9 ]", "", re.sub(r"\s+", " ", (s or "").lower())).strip()


def hook_character_block(characters, hook_story=None):
    """The textbook character's own printed line, when the hook does not say it.

    Primary books are character-led -- Pinky stands beside the activity on p.102
    and asks the question in a speech bubble. The teacher reads that line aloud,
    so it is script, and it is on the pupil's open page whether or not the lesson
    plan carries it. G6-12 has no equivalent surface, which is why an earlier pass
    built from the G6-12 shape dropped `hookCharacters` entirely.

    Measured on the 38-segment G4 Ch9 corpus: 39 speaking-character lines, of
    which 16 are ALREADY quoted inside `hookStory` ("Point to the girl avatar and
    read: ...") and 23 are not. So the field is neither redundant nor free-
    standing, and a blanket rule either way is wrong. Each line is carried only
    when the hook does not already contain it -- ONE HOME, decided per line.

    Only `role: speaking` characters have a line. The illustrative ones are art
    direction for the book, not something a teacher says.
    """
    hs = _norm(hook_story)
    lines = []
    for c in characters or []:
        if not isinstance(c, dict):
            continue
        bubble = (c.get("speechBubble") or "").strip()
        name = (c.get("name") or "").strip()
        if not (bubble and name):
            continue
        if hs and _norm(bubble) in hs:
            continue
        lines.append(f"{name}: “{bubble}”")
    if not lines:
        return None
    return {"type": "key_points", "id": "hook-characters",
            "title": "On the page · read aloud", "items": lines}


def drop_lines_already_said(lines, already):
    """Lines minus the ones the teacher's script already says, and minus repeats.

    `workedExample` and the phase scripts are separate Stage-C fields that overlap
    by different amounts: measured on G4 Ch9, the Urdu worked examples are 100%
    restatement of the move scripts while Science's are 100% new, with 92% new
    overall. So neither printing it whole nor dropping it whole is right -- the
    decision is per line, and it loses nothing.

    A line goes only when some script line ALREADY CONTAINS it. The reverse (a
    worked line that contains a script line) is kept: there the worked line is the
    fuller one, and the script line it swallows carries the move's minutes.
    """
    out = []
    for l in lines:
        n = _norm(l)
        if not n:
            continue
        if any(n in _norm(a) for a in already):
            continue
        if any(n == _norm(k) or n in _norm(k) for k in out):
            continue
        out.append(l)
    return out
