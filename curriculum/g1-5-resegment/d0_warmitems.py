"""bd-y7hst, REOPENED -- ONE strategy in `warmUp.items[]`, the field that actually ships.

`d0_warmpeer.py`/`d0_warmscript.py` operate on `warmUp.script`, which is empty in all
335 shipping lessons -- that fix is inert on real data. The real defect lives here, in
`warmUp.items`, the `[{"q","a","kind"}, ...]` array populated in 310 of 335 lessons: 295
of those carry MORE THAN ONE item, and 215 banned-talk instances sit across 118 lessons
(25 of 88 Urdu lessons among them). Confirmed against a shipping example,
`renders/g1_ch8/docs/Maths_seg4.lp.json`, `sections[0].warmup.items`:

    0  "Recall: yesterday we measured length/height with blocks, leaves, pencils, end
        to end, no gaps. Today: measuring how HEAVY something is. -- peer says it
        together."
    1  "Subitise: a 3-dot triangle flashed for 2 seconds -- how many? Partner-check
        before reveal."
    2  "Subitise: a 4-dot square flashed for 2 seconds -- how many? Partner-check
        before reveal."
    3  "Fact-fluency pair game: Partner A says a number 1-10; Partner B instantly says
        a bigger or smaller number (their choice which); swap roles. No counting on
        fingers, no timer."

CORRECTION THAT MATTERS MOST: the rule is ONE STRATEGY, not one item. A 12-14 item Urdu
word list (`renders/g1_ch8/docs/Urdu_seg5.lp.json`, `renders/g5_ch8/docs/Urdu_seg6.lp.json`)
is one strategy with many instances -- not fourteen strategies -- and `one_strategy()`
keeps every one of them. Capping by count, not by distinctness, would gut a lesson the
operator has said must not be cut.

`one_strategy(items)` is TWO STAGES, run in that order:

  1. PER ITEM, `_repair_or_drop` (reusing `d0_warmpeer.is_banned_move`, English AND
     Urdu). Text is cut into segments at `_BOUNDARY` -- sentence-enders (`.!?۔؟`), a
     LABEL-colon (`:`), or a space-flanked dash (`-`/en-dash/em-dash/`--`), each followed
     by whitespace or (for the dash) flanked by it. The colon and dash additions are
     WIDENED (bd-y7hst, reopened, alongside the vocabulary parity widening in
     `d0_warmpeer.py` -- see that module's docstring): the dash mirrors peertalk.js's own
     `isBoundary`, which treats a space-flanked dash as a clause boundary exactly like a
     sentence-ender; the colon mirrors the corpus's own "LABEL: content" convention,
     already legal shape elsewhere in these items. A clean run of segments -- ALL banned
     then ALL legal, or the reverse, with no interleaving -- is repaired two ways:
     a TRAILING banned run is stripped and closed with a repair (English: the operator's
     own "choral on a clap"; Urdu: no vetted replacement phrase exists in the copied
     peertalk.js vocabulary, so it is dropped whole rather than invented -- see below); a
     LEADING banned run (a banned protocol label fused to a legal question or instruction
     by a colon, e.g. "Whisper-check with your partner: which word means 'weighs
     MORE'?") is simply cut, no repair text needed, since nothing new is being said --
     the legal remainder was always there. Either shape falls back to a whole drop if the
     kept text would carry an unbalanced `(`/`)` (a boundary landing inside what was
     originally one parenthetical). Anything else `is_banned_move` catches -- the banned
     clause IS the whole item, or a banned run sits between two legal ones (banned
     interleaved with legal on both sides) -- is dropped whole. This is a SEGMENT-level
     test, not a clause-level one, and that is a real, admitted gap: `Maths_seg4` item 1's
     own "Partner-check before reveal" strips clean because it is its own sentence, but
     `renders/g5_ch10/docs/Urdu_seg6.lp.json` item 1 ("جوڑی میں ایک دوسرے سے پوچھیں: '...'
     ...؟") fuses the ban and a legal embedded question with no `_BOUNDARY` between them
     (the colon there sits INSIDE the banned run, not between it and the legal text), so
     the whole item -- legal question included -- is dropped. Reported, not patched:
     fixing every fused-clause shape in general means real clause-level parsing, out of
     this bead's scope; only the shapes `_BOUNDARY` names (colon, dash, sentence-end) are
     handled.

  2. ACROSS SURVIVORS, `_item_type` (deliberately narrow: "named_activity" only when the
     text names itself a game, else "plain"). If survivors split across both types, the
     FIRST survivor's type is kept whole and the other type is dropped whole, one gap
     note per drop. A homogeneous run -- a word list, same-form retrieval questions --
     is one type throughout and nothing is cut on this axis. HONEST LIMIT, stated as
     asked: text-only distinctness detection is not reliable in general, so this
     implements only the ONE shape named as an example ("a named game alongside plain
     questions"), not a broader activity-type taxonomy. A miss here leaves two strategies
     stacked (an under-cut); that is the side to be wrong on, not a false cut.

Composes with stage 1: in `Maths_seg4`, the "Fact-fluency pair game" item is ALREADY
fully banned (it opens on the banned family itself, no clean prefix) and dropped in
stage 1, so stage 2 never has to fire even though the lesson reads as two strategies.
`renders/g1_ch9/docs/Maths_seg7.lp.json` is the one real document that exercises BOTH
stages: item 0 is dropped as a whole-sentence ban, and item 6 ("Self-paced partner
fluency game...") survives stage 1 (it names no banned family) but is then cut in stage
2 against the five plain retrieval items ahead of it.

URDU REPAIR: peertalk.js's own Urdu vocabulary (copied into `d0_warmpeer._BANNED_MOVE_UR`,
see that module's docstring) lists bans, not a reveal move to repair with, and inventing
an Urdu replacement phrase would violate the standing "never invented/transliterated"
rule for Urdu text. A clean Urdu trailing-sentence ban (`renders/g5_ch9/docs/Urdu_seg7.lp.json`
item 0: "...تھا؟ (جوڑی میں پوچھیں، پھر کورس میں جواب دیں)") is therefore dropped whole
with its own gap reason (`urdu_tail_no_replacement`), not repaired -- a follow-up for
whoever owns that vocabulary, not a guess here.

UPDATE (bd-y7hst, reopened): `Maths_seg3` item 0 ("...peer says it together, then one
pair shares aloud") is NOW caught -- the widened `is_banned_move` names it via "peer
(talk verb, subject form)", and the widened `_BOUNDARY` isolates the "peer says it
together" trailing clause behind the item's own "(...)  --" shape, so it repairs rather
than drops. `English_seg6` item 0 was outside the 18-item gate-delta this bead measured
and was not re-checked here; if it still carries an uncaught banned move, that is a
separate, unverified gap, not one this pass closes.

TARGET REFRESH (bd-y7hst, reopened again): the sibling worker's peertalk.js widening
landed mid-round; the remaining miss narrowed from 18/18 to 10/8, all one family a
talk-adjacent verb (read/say/count/compare/point) followed by the bare addressee "with
a/your/their/the partner" -- see `d0_warmpeer.py`'s docstring for the vocabulary side.
This family gets DIFFERENT treatment from every other banned move above: the operator's
own ruling on "Point and chorally count the clock numerals from 1 to 12 with a
partner." -- "choral counting is an ALLOWED move ... strip the 'with a partner'
addressee and it becomes a legal whole-class choral count, which is the ideal repair
here, not a drop" -- generalizes to the whole family, since the verb phrase carrying it
is already a complete, legal instruction once the addressee is gone; nothing new is
said, same rationale as the "lead" shape's own comment. So `_strip_addressee` runs
FIRST, ahead of `_segments`/`_repair_or_drop`'s segment-level pipeline, and removes
just the closed-set phrase (plus its own joining comma/space) rather than banning the
segment it sits in. This is a NARROW, closed-set excision -- one fixed phrase, not a
slide into clause-level parsing -- and it composes cleanly with the existing machinery:
a single-sentence fusion ("Read the numeral 1 with a partner.") comes out the other
side already clean, so stage 1's segment flags are all-False and the (stripped) text
passes through unchanged; a two-sentence fusion ("Choose and solve ... Compare quietly
with a partner.") likewise comes out clean, with nothing left for the trail-shape
mechanism to even fire on. Verified against all 10 refreshed-miss items and all 5 of
the operator's protected strings (including the possessive trap, "Work with a
partner's written answer in your copy.", which `_strip_addressee`'s own negative
lookahead leaves untouched, same guard as `d0_warmpeer._BANNED_MOVE`'s new entry).

UPDATE (bd-y7hst, target refresh -- flagship re-audit): the "no clean prefix"/"dropped
whole" claims two paragraphs up predate the colon-`_BOUNDARY` widening this same
reopening landed. `Maths_seg4` item 3's "Fact-fluency pair game:" and `Maths_seg7` item
0's "Days chain:" are now each their own non-banned LABEL segment, so stage 1 repairs
both (lead-shape) instead of dropping them whole; same for `Urdu_seg6` item 1's
"جوڑی میں ایک دوسرے سے پوچھیں:". This is the segment-not-clause gap already admitted
above, not a new one -- `test_d0_warmitems.py`'s assertions are updated to match, with
before/after cited inline there.

LAST-RESORT ADDRESSEE REDIRECT (bd-y7hst, reopened again): six shipping lessons
(`g1_ch10 Maths_seg4`, `g2_ch10 English_seg4`, `g3_ch9 English_seg7`, `g4_ch8
English_seg2`/`seg3`, `g5_ch9 English_seg6`) end up with EVERY item dropped by stage 1
above, because in each of them the ban is not a trailing or leading clause but IS the
whole item -- a "tell your partner X" verb-addressee fusion with no `_BOUNDARY` between
verb and addressee, or a bare "Partner A"/"Partner B" role label. A zero-survivor
warm-up loses the lesson's entire retrieval slot, which is a worse defect than the
segment-granularity gap being guarded against, and every one of these six carries a
legal retrieval move once its addressee (never its subject matter) is redirected. See
`d0_warmredirect.py` for the two closed-set redirects this tries (split into its own
module -- this file was already 346 lines before this bead, past the 300-line house
limit even before this addition). `one_strategy()` below calls
`d0_warmredirect.redirect_dropped_items` ONLY when its own per-item pass leaves zero
survivors; a warm-up that keeps at least one item never reaches that module at all, so
every existing fixture with a legal survivor is completely unaffected by this bead.

WIRING (not done here -- another worker owns `d0_primary.py`/`d0_blocks.py` right now):

    kept, gaps = one_strategy(warmup.get("items") or [])

`items`/`kept` are lists of `{"q", "a", "kind"}` dicts, `q` repaired in place where a
tail was stripped, everything else passed through unchanged; `gaps` extends
`notes.gaps`, same convention as `d0_warmpeer._gap_banned`/`_gap_extra`.
"""

from __future__ import annotations

import re

from d0_warmpeer import is_banned_move
from d0_warmredirect import redirect_dropped_items

# WIDENED boundary set (bd-y7hst, reopened) -- was sentence-enders only, duplicated from
# `d0_warmscript._SENTENCE` (not imported: that module imports FROM `d0_warmpeer`, never
# the reverse, and this file sits downstream of `d0_warmpeer` too). Now also a
# LABEL-colon and a space-flanked dash -- see the module docstring's rule-1 paragraph for
# why both are safe additions, not a slide toward clause-level parsing. An em-dash or
# hyphen with no space on at least one side ("2 seconds -- how many?"'s own kind is
# space-flanked and DOES split; "pp.206-207", "whisper-check", "->") is left inside its
# segment untouched -- only a boundary character with an actual space on both sides ends
# a segment here.
_BOUNDARY = re.compile(r"(?<=[.!?۔؟:])\s+|(?<=\s)[-–—]{1,2}(?=\s)")

_ARABIC = re.compile(r"[؀-ۿ]")

# The operator offered two: "choral on a clap, or write-walk-reveal." Chosen
# deterministically -- zero materials, zero setup, works in a 40+-student room, where
# write-walk-reveal needs slates and walking space this module cannot assume it has.
_TAIL_REPAIR_EN = "On a clap, the whole class reveals together."

_NAMED_GAME = re.compile(r"\bgame\b", re.I)

# The one family repaired by PHRASE excision, not segment drop (bd-y7hst, target
# refresh -- see module docstring). Same phrase and possessive guard as
# `d0_warmpeer._BANNED_MOVE`'s own entry, kept in sync by hand since this is a fixed,
# closed-set phrase, not a moving vocabulary like peertalk.js. A trailing `,?\s*` also
# eats the phrase's own joining comma+space when it introduces the rest of the sentence
# ("quick count: with a partner, count the text types...") -- eating only the trailing
# side (never both) is what keeps a single separating space intact on either shape.
_ADDRESSEE = re.compile(
    r"\bwith (?:a|your|their|his|her|the) partner\b(?!['’]s),?\s*", re.I)

# Gate on the SAME talk-adjacent verb set as `d0_warmpeer._BANNED_MOVE`'s new entry,
# checked against the whole `q` before stripping -- a bare `_ADDRESSEE` match, unguarded,
# also fired on g1_ch10/English_seg6 item 0 ("With your partner, recall one detail...
# story."), a pre-existing, DELIBERATELY documented miss ("a real, unrelated gap ... not
# silently patched with an invented pattern" -- see ENGLISH_SEG6's comment in
# test_d0_warmitems.py). "recall" is not talk-adjacent; this guard keeps that fixture
# clean while still stripping all 10 refreshed-miss items (each has a gated verb
# somewhere ahead of the phrase in the same text, in order -- item 9's "quick count:"
# lead-in included).
_TALK_ADJACENT_VERB = re.compile(
    r"\b(?:read|reads|reading|say|says|saying|said|count|counts|counting|compare|"
    r"compares|comparing|point|points|pointing)\b", re.I)


def _strip_addressee(text):
    """Remove the closed-set "with a partner" addressee phrase when a talk-adjacent verb
    precedes it in the same text, then tidy the seam it leaves (collapsed whitespace, no
    orphaned space before punctuation). A no-op string in, string out unchanged -- safe
    to run unconditionally ahead of the segment pipeline below.
    """
    verb_match = _TALK_ADJACENT_VERB.search(text)
    addressee_match = _ADDRESSEE.search(text)
    if not (verb_match and addressee_match and verb_match.start() < addressee_match.start()):
        return text
    stripped = _ADDRESSEE.sub("", text)
    stripped = re.sub(r"\s+", " ", stripped)
    stripped = re.sub(r"\s+([.,;:!?])", r"\1", stripped)
    return stripped.strip()


def _is_urdu(text):
    return bool(_ARABIC.search(text))


def _balanced_parens(text):
    """False when a boundary cut left a dangling `(` or `)` -- the caller's signal to
    fall back to a whole drop rather than ship a malformed fragment (bd-y7hst; affects
    exactly one of the 18 gate-delta items, g2_ch9/English_seg1[2], whose banned lead-in
    opens a `(...)` that its own legal remainder only closes)."""
    return text.count("(") == text.count(")")


def _is_balanced_parenthetical(text):
    """True when `text` is itself ONE balanced `(...)` span from its first character to
    its last -- not just parenthesis-COUNT-balanced (`_balanced_parens` above), but
    WRAPPING the whole string, so "(a) and (b)" or "a (b)" both return False (the first
    closing paren that returns depth to zero must be the final character). Used only to
    decide whether a trailing banned run is safe to strip outright with nothing
    appended -- see `_repair_or_drop`'s Urdu "trail" branch below.
    """
    if len(text) < 2 or text[0] != "(" or text[-1] != ")":
        return False
    depth = 0
    for i, ch in enumerate(text):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i == len(text) - 1
    return False


def _segments(text):
    """[(start, end), ...] character-offset spans between `_BOUNDARY` matches.

    OFFSET-based on purpose: `_repair_or_drop` below always slices KEPT text straight
    out of the ORIGINAL string between two segment offsets, never rejoins fragments with
    an assumed separator. Any boundary landing INSIDE a kept run (an internal dash or
    colon between two legal clauses) is therefore preserved exactly as written, however
    many of them there are.
    """
    spans = []
    pos = 0
    for m in _BOUNDARY.finditer(text):
        if m.start() > pos:
            spans.append((pos, m.start()))
        pos = m.end()
    if pos < len(text):
        spans.append((pos, len(text)))
    return [(s, e) for s, e in spans if text[s:e].strip()]


def _clean_split(flags):
    """('trail', k) | ('lead', k) | None for a single contiguous run of banned segments.

    'trail': flags[:k] all legal, flags[k:] all banned (a banned run trailing the item).
    'lead' : flags[:k] all banned, flags[k:] all legal (a banned label leading the item).
    None: the banned segments aren't one contiguous block anchored to an end -- banned
    sits between two legal runs, or the reverse -- so the caller falls back to a whole
    drop, the documented segment-level-not-clause-level limit. Caller guarantees
    `any(flags)` and `not all(flags)` before calling this.
    """
    first_true = flags.index(True)
    last_true = len(flags) - 1 - flags[::-1].index(True)
    if any(not f for f in flags[first_true:last_true + 1]):
        return None
    if first_true == 0:
        return ("lead", last_true + 1)
    if last_true == len(flags) - 1:
        return ("trail", first_true)
    return None


def _repair_or_drop(q):
    """(repaired q, "") when clean or nothing banned; (None, reason) to drop whole.

    See module docstring for the full rule and its segment-level granularity limit.
    """
    q = _strip_addressee(q)
    segs = _segments(q)
    if not segs:
        return q, ""
    flags = [is_banned_move(q[s:e]) for s, e in segs]
    if not any(flags):
        return q, ""
    if all(flags):
        return None, "banned"
    split = _clean_split(flags)
    if split is None:
        return None, "banned"
    shape, k = split
    if shape == "trail":
        prefix = q[segs[0][0]:segs[k - 1][1]].strip()
        if not prefix:
            return None, "banned"
        if _is_urdu(prefix):
            # LAST-RESORT PARENTHETICAL STRIP (bd-y7hst, reopened again): normally
            # there is no vetted Urdu replacement phrase to append here, so this drops
            # whole (below). But when the banned trailing run IS, in its entirety, a
            # balanced parenthetical sitting at the end of the string (a bracketed
            # protocol note, not prose fused into the sentence), stripping it is a pure
            # REMOVAL -- nothing is appended, no Urdu is invented or transliterated,
            # and the legal question underneath survives verbatim. That is a strictly
            # narrower case than the general "trail" repair above (which always
            # appends `_TAIL_REPAIR_EN`), so it only fires as a fallback right where
            # this function would otherwise drop the item whole (g5_ch9/Urdu_seg7 item
            # 0's "(جوڑی میں پوچھیں، پھر کورس میں جواب دیں)").
            tail = q[segs[k][0]:segs[-1][1]].strip()
            if _is_balanced_parenthetical(tail) and not is_banned_move(prefix):
                return prefix, "protocol_note_stripped"
            return None, "urdu_tail_no_replacement"
        if not _balanced_parens(prefix):
            return None, "banned"
        if prefix[-1] not in ".!?۔؟:":
            prefix += "."
        return prefix + " " + _TAIL_REPAIR_EN, ""
    # shape == "lead": a banned protocol label fused to legal content by a colon or
    # dash. No repair text needed -- nothing new is being said, the legal remainder was
    # always there; just drop the banned run and keep it, capitalized as a sentence
    # start. Urdu is not special-cased here (unlike "trail"): nothing English is being
    # appended to it, so the "no invented/no vetted replacement" concern does not apply.
    suffix = q[segs[k][0]:segs[-1][1]].strip()
    if not suffix:
        return None, "banned"
    if not _balanced_parens(suffix):
        return None, "banned"
    if suffix[0].islower():
        suffix = suffix[0].upper() + suffix[1:]
    return suffix, ""


def _item_type(q):
    """"named_activity" only when the text names itself a game, else "plain".

    The narrowest shape of the distinctness test asked for -- see module docstring for
    why a broader activity-type taxonomy is deliberately not attempted.
    """
    return "named_activity" if _NAMED_GAME.search(q) else "plain"


def _gap_item_repaired(idx, q, reason):
    """Gap line for an item that SURVIVES via a repair worth flagging -- unlike the
    silent trail/lead strips above, the parenthetical strip removes banned Urdu text
    that had no vetted replacement, so the next reader should know it happened even
    though nothing was dropped.
    """
    words = " ".join(q.split()[:8])
    if reason == "protocol_note_stripped":
        return ("warmUp.items[%d].q (%r...) had a trailing banned Urdu protocol note "
                "stripped -- a balanced parenthetical at the end of the string, with no "
                "vetted replacement phrase to repair it with, so the bracketed note was "
                "removed rather than invented; the legal retrieval question underneath "
                "survives verbatim -- bd-y7hst." % (idx, words))
    return "warmUp.items[%d].q (%r...) repaired -- bd-y7hst." % (idx, words)


def _gap_item_dropped(idx, q, reason):
    words = " ".join(q.split()[:8])
    if reason == "urdu_tail_no_replacement":
        return ("warmUp.items[%d].q (%r...) carries a banned peer-talk clause on Urdu "
                "text with no legal alternative recorded -- peertalk.js's Urdu "
                "vocabulary lists bans, not a reveal move, so nothing to repair it "
                "with; dropped whole rather than invented -- bd-y7hst." % (idx, words))
    if reason == "distinct":
        return ("warmUp.items[%d].q (%r...) is a second, distinct strategy stacked in "
                "the same warm-up (a named activity beside the kept run); the warm-up "
                "seats exactly ONE strategy, so it is dropped whole, not stacked -- "
                "bd-y7hst." % (idx, words))
    return ("warmUp.items[%d].q (%r...) is a student-to-student talk move -- banned "
            "peer-to-peer talk, cut, not printed -- bd-y7hst." % (idx, words))


def one_strategy(items):
    """(kept items, [why every dropped one was dropped]) -- see module docstring.

    A ZERO-SURVIVOR warm-up (every item individually unrepairable under the per-item
    pass below) is handed to `d0_warmredirect.redirect_dropped_items` as a LAST RESORT
    before this returns the lesson with an empty warm-up -- see that module's docstring
    for the two closed-set redirects it tries. A warm-up that keeps at least one item
    under the per-item pass never reaches that branch and is completely unaffected
    (bd-y7hst).
    """
    survivors = []
    dropped = []
    repaired_notes = []
    for idx, item in enumerate(items or []):
        q = str((item or {}).get("q") or "")
        repaired, reason = _repair_or_drop(q)
        if repaired is None:
            dropped.append((idx, item, q, reason))
            continue
        if reason:
            # A non-empty reason on a SURVIVOR means a repair worth flagging (the
            # parenthetical strip) -- the silent trail/lead strips return "".
            repaired_notes.append((idx, _gap_item_repaired(idx, q, reason)))
        new_item = dict(item)
        new_item["q"] = repaired
        survivors.append((idx, new_item))

    redirect_gaps = []
    if not survivors and dropped:
        survivors, dropped, redirect_gaps = redirect_dropped_items(dropped)

    gap_pairs = list(redirect_gaps) + list(repaired_notes) + [
        (idx, _gap_item_dropped(idx, q, reason)) for idx, _, q, reason in dropped
    ]
    gap_pairs.sort(key=lambda pair: pair[0])
    gaps = [message for _, message in gap_pairs]

    if not survivors:
        return [], gaps
    first_type = _item_type(survivors[0][1]["q"])
    kept = []
    for idx, item in survivors:
        if _item_type(item["q"]) == first_type:
            kept.append(item)
        else:
            gaps.append(_gap_item_dropped(idx, item["q"], "distinct"))
    return kept, gaps


_OPENING_TITLE = re.compile(r"opening", re.I)


def apply_one_strategy(sections):
    """Filter the Opening section's `warmup.items` in place; return the gap lines.

    Thin wrapper over `one_strategy()` for the `d0_primary.py` call-site idiom (see
    `d0_diagram.apply_slots`/`d0_media.apply_video`/`d0_crux.apply_crux`/
    `d0_warmscript.apply_method` -- same shape). Finds the section whose `title`
    matches /opening/i, not by index (the Opening is not reliably first). Returns `[]`,
    not `None`, when there is no Opening section or it has no `warmup.items` to filter --
    nothing to say, not nothing to return.
    """
    for sec in sections or []:
        title = str((sec or {}).get("title") or "")
        if not _OPENING_TITLE.search(title):
            continue
        warmup = sec.get("warmup")
        if not isinstance(warmup, dict):
            return []
        items = warmup.get("items")
        if not items:
            return []
        kept, gaps = one_strategy(items)
        warmup["items"] = kept
        return gaps
    return []
