# -*- coding: utf-8 -*-
"""The objective the DAY states, beside the SLO code the day rolls up to.

G4 English carries 23 SLO codes across 99 teaching days; G5 Urdu carries 22
across 108. The enrichment brief tells the author to target ONE SLO and to
echo `slo_refs`, so on those 207 days it hands over a sentence that belongs
to twelve, twenty or thirty-three other days as well -- and often does not
describe this one at all. `E-04-RD-01` "use pre-reading strategies to
predict" sits on a writing day; `U-05-WR-01` "make rhyming words" sits on
twenty days of essays, letters and diaries; `U-05-GR-01` "change
past/present/future sentences" sits on punctuation and on counting.

Amena's rule from the original brief is *"make sure the SLO matches the
activities, objectives of the day"*, and her rule about the codes is
*"dont remove the SLOs pls"*, said twice. Both hold at once only if the day
gets a sentence of its own that rolls up to the code it already carries.

WHY IT LIVES IN THE CORPUS AND NOT ONLY ON THE SHEET. `cbrief._envelope`
is built from the seg JSON. A column the sheet alone knows about never
reaches the author, and the author is the whole audience for this.

THE VOICE IS `basicslo`'s, for `basicslo`'s reasons. English in the child's
own "I can". Urdu in the CLASS's voice -- `ہم`, never the singular -- because
Urdu's first person singular carries a grammatical gender, and an objective
has no business choosing one for the child reading it. `ہوں` is that
singular's auxiliary and nothing else's, so it is the thing to ban; `میں`
is not, because `میں` is also the postposition "in".
"""
import dayfold

FIELD = "objective"

# A sentence a teacher reads out at the top of a period. Past this it is a
# lesson plan, not an objective, and it stops being said aloud.
MAX_CHARS = 160

# A sentence may end in any of these. Urdu's full stop is not a full stop.
ENDS = u".!?۔؟"

# Urdu's first-person singular auxiliary, and no one else's. "سکتا ہوں" is
# male and "سکتی ہوں" female; the class voice avoids the choice entirely.
SINGULAR = u"ہوں"
PLURAL = u"ہم"

ENGLISH_OPENER = "I can "

_ARABIC_LO, _ARABIC_HI = u"؀", u"ۿ"


def _is_urdu(text):
    return any(_ARABIC_LO <= ch <= _ARABIC_HI for ch in text[:12])


def key(segment):
    """The chapter and the segment. The segment index alone repeats."""
    s = segment or {}
    return "ch%ss%s" % (s.get("chapter_number"), s.get("segment_index"))


def teaching(segments):
    """The days that introduce something, so the days that need an objective.

    A revision or assessment day rehearses what its chapter already stated.
    `dayfold.BOOKKEEPING` holds all five spellings the corpus uses -- Grades
    1-4 write `duhrai`, Grade 5 writes `revision`, and a comparison against
    either one alone leaves the other in.
    """
    return [s for s in (segments or [])
            if (s or {}).get("skill_type") not in dayfold.BOOKKEEPING]


def _voice(k, text):
    """What is wrong with this one sentence, or None."""
    t = (text or "").strip()
    if not t:
        return "%s: the objective is empty" % k
    if len(t) > MAX_CHARS:
        return "%s: %d chars, too long to say aloud (max %d)" % (
            k, len(t), MAX_CHARS)
    if t[-1] not in ENDS:
        return "%s: does not end as a sentence" % k
    if _is_urdu(t):
        if SINGULAR in t:
            return ("%s: Urdu in the first-person singular picks a "
                    "grammatical gender for the child -- say it as the "
                    "class" % k)
        if PLURAL not in t:
            return "%s: Urdu objective does not speak as the class" % k
        return None
    if not t.startswith(ENGLISH_OPENER):
        return "%s: English objective does not open in the child's I can" % k
    return None


def check(segments, authored):
    """Everything wrong with one book's objectives, in the order found.

    Covered both ways on purpose. A missing objective leaves the day on its
    generic code without saying so; a spare one means the authoring was done
    against a corpus that has since moved.
    """
    authored = authored or {}
    out = []
    days = teaching(segments)
    seen = {}
    for s in days:
        k = key(s)
        if k not in authored:
            out.append("%s: no objective written for this teaching day" % k)
            continue
        bad = _voice(k, authored[k])
        if bad:
            out.append(bad)
            continue
        said = " ".join(authored[k].split())
        if said in seen:
            out.append("%s: says word for word what %s says -- that is the "
                       "SLO code again under another name" % (k, seen[said]))
        else:
            seen[said] = k
    known = {key(s) for s in days}
    for k in sorted(authored):
        if k not in known:
            out.append("%s: an objective with no teaching day" % k)
    return out


def apply(segments, authored):
    """Write the objective onto each teaching day. Returns how many.

    Nothing else on the row is touched, least of all `slo_codes`.
    """
    authored = authored or {}
    n = 0
    for s in teaching(segments):
        said = authored.get(key(s))
        if said:
            s[FIELD] = said
            n += 1
    return n
