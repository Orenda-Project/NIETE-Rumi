"""Stage D0 — block builders for the primary lp_doc.

lp_doc's block list is a CLOSED enum (schema/lp_doc.schema.json, definitions.block).
Primary's move coding maps onto it natively and needs no schema extension:

    I Do    -> worked_example  ("teacher models")
    We Do   -> faded_example   ("WE DO -- guided, 1-2 steps blanked", schema's own words)
    You Do  -> practice mode=independent  ("YOU DO -- graded items with answers alongside")

An earlier pass mapped We Do onto `practice` too, which has no `steps` -- so the
teacher's script had to be forced into `items` as questions, and each one printed
a fabricated "design pending" answer beside the teacher's own words. The closed
enum already had the right block; nothing needed inventing.

ONE HOME PER SOURCE FIELD. The render is a printed page, and a field that appears
in two places costs paper twice. Each enrichment field below renders in exactly
one place; where two surfaces want it, the teach page wins and page2 goes dark.

The minutes on each move come from `steps[].minutes` in the enrichment, so the
per-move badges the format asks for are real numbers, not an author's guess.

Where the corpus cannot supply a required field, these builders emit an explicit
DESIGN_PENDING string rather than a plausible-looking proxy.
"""

from __future__ import annotations

import re

import d0_script

DESIGN_PENDING = "design pending — not carried by primary Stage-C enrichment"

MOVE_TITLE = {"I-Do": "I DO", "We-Do": "WE DO", "You-Do": "YOU DO"}


def steps_by_phase(steps, phase):
    return [s for s in steps or [] if (s.get("phase") or "").strip() == phase]


def minutes_of(items):
    return sum(int(s.get("minutes") or 0) for s in items)


def _with_turns(blk, turns):
    """Attach the parsed script to a block, keeping the flat `steps` as the fallback.

    The additive-field pattern proven by `board.panels` (SYNC §3.16): the structured
    field is OPTIONAL, the renderer prints it when present, and the flat string field
    stays as the home every other reader already addresses -- the lint profile, Stage
    E's voicenotes and the WhatsApp message body. G6-12 never emits `turns`, so its
    render is untouched by construction, not by promise.
    """
    if turns:
        blk["turns"] = turns
    return blk


def move_lines(steps):
    """Flatten a move's steps into printable lines, action then script."""
    out = []
    for s in steps:
        action = (s.get("action") or "").strip()
        say = (s.get("say") or "").strip()
        if action:
            out.append(action)
        if say:
            # Stage-C quotes the script itself about a third of the time, so an
            # unconditional wrap printed ““Look at the picture.”” on the page.
            quoted = say[0] in "“‘\"'" and say[-1] in "”’\"'"
            out.append(f"Say: {say}" if quoted else f"Say: “{say}”")
    return [l for l in out if len(l) >= 2]


def i_do_block(steps):
    """The modelled move. worked_example is the only block carrying title+minutes+steps."""
    lines = move_lines(steps)
    if not lines:
        return None
    return _with_turns({"type": "worked_example", "id": "i-do",
                        # NOT "I DO - teacher models": the move is now named on the section
                        # bar (d0_primary._development -> `move`), and ONE HOME PER SOURCE FIELD
                        # means it is not also named 25mm below it in the same amber pill. The
                        # box keeps the half that is about the BOX. We Do / You Do keep their
                        # prefixes -- their bands are named by the move itself (moveSplit), so
                        # the bar never says it for them.
                        "title": "Teacher models",
                        "minutes": minutes_of(steps), "steps": lines},
                       d0_script.turns(steps))


def we_do_block(steps, partner):
    """WE DO -- the schema's faded_example: guided, scripted, timed.

    The partner structure is the prompt and the dialogue frames are steps. Nothing is
    dressed as a question.

    `teacher_role` used to fill `answer`, and faded_example prints that field as
    "Answer: ...", so the page read "Answer: Circulate prompts:" -- a label naming the
    wrong thing about a field that answers nothing. It is what SHE does while they work,
    so it joins the prompt, which is the block's what-to-set-up line.
    """
    pa = partner or {}
    lines = move_lines(steps)
    frames = [f.strip() for f in (pa.get("dialogueFrameA"), pa.get("dialogueFrameB"))
              if f and len(f.strip()) >= 2]
    lines += frames
    if not lines:
        return None
    blk = _with_turns({"type": "faded_example", "id": "we-do",
                       "title": f"{MOVE_TITLE['We-Do']} · class practises together",
                       "minutes": minutes_of(steps), "steps": lines},
                      (d0_script.turns(steps) or []) + d0_script.frame_turns(frames))
    setup = [t for t in ((pa.get("structure") or "").strip(),
                         (pa.get("teacher_role") or "").strip()) if len(t) >= 3]
    if setup:
        blk["prompt"] = " · ".join(setup)
    return blk


def you_do_blocks(steps, problems):
    """YOU DO -- the task instruction, then the printed items with their answers.

    Returns a LIST. Only the textbook problems become practice items; the move's own
    script is what the teacher does to set the task going.

    That script used to be `" ".join(lines)` inside one paragraph, which on the G4
    English segment printed 153 unbroken words -- the single tallest wall in the render
    and the one the operator was looking at. `move_lines` already returns the moves as
    separate lines; joining them threw that structure away and the page paid for it.
    They are a numbered sequence now, which prints the same words in the same order.
    """
    out = []
    lines = move_lines(steps)
    if lines:
        out.append({"type": "key_points", "id": "you-do-task",
                    "title": "Set the task going", "items": lines})
    items = [_practice_item(p) for p in problems or [] if (p.get("prompt") or "").strip()]
    if items:
        out.append({"type": "practice", "id": "you-do", "mode": "independent",
                    "title": f"{MOVE_TITLE['You-Do']} · pupils work alone",
                    "minutes": minutes_of(steps), "items": items})
    elif out:
        out[0]["id"] = "you-do"
    return out


# "p.104, Pinky's Poem Puzzlers 1: Which dance is matched with..." -- a page, an exercise
# name and an item number, then the question. 93 of the corpus's 306 problems open this way.
_CITE = re.compile(r"^\s*(p\.?\s*\d+[^:]{0,60}?)\s*:\s*(\S.*)$", re.S)


def _practice_item(p):
    """One printed problem: the question, its answer, and its citation as a `ref`.

    The citation is how she finds the page, not part of what she reads out, and it was
    arriving glued to the front of the prompt -- pushing the question itself onto a second
    line on every cited item. `ref` is already in the schema for exactly this.
    """
    prompt = (p.get("prompt") or "").strip()
    item = {"a": (p.get("solution") or "").strip() or DESIGN_PENDING}
    m = _CITE.match(prompt)
    if m:
        item["ref"] = m.group(1).strip()
        item["q"] = m.group(2).strip()
    else:
        item["q"] = prompt
    return item


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
        lines.append(f"{name}: \u201c{bubble}\u201d")
    if not lines:
        return None
    return {"type": "key_points", "id": "hook-characters",
            "title": "On the page \u00b7 read aloud", "items": lines}


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
