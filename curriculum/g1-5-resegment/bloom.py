# -*- coding: utf-8 -*-
"""Rate a teaching day's cognitive demand from the words of its own SLO.

The shipped column did not do this. It tracked `Skill type`: 83.4% of the
2,039 segments carried the modal Bloom for their skill type, and eleven
skill types were 99-100% deterministic -- `duhrai` was `understand` 72
times out of 72, `oral_communication` `apply` 62 out of 62. Nothing in that
mapping reaches `remember`, so `remember` survived on 22 segments (1.1%),
none of them Urdu. Grade 1 qaida -- recognising the half-forms of letters --
came out `apply`.

The second symptom followed from the first: because the rating never read
the SLO, one SLO code could carry several levels. 819 of the 1,657 teaching
days sit on a code rated at more than one level, Maths worst at 123 of its
270 codes.

So the verb decides. Bloom's is taught as a verb hierarchy and the SLO
descriptions are written in verbs -- `Recognise`, `solve`, `پہچان`,
`بیان` -- which makes the rating reproducible and arguable, and lets the
same sentence rate the same way wherever it appears.

Where a description names several verbs the hardest one wins: a day that
asks children to recognise words AND use them AND classify them is an
`apply` day, because that is the hardest thing it asks. Where there is no
verb the skill type breaks the tie, and where neither speaks the row comes
back empty rather than guessed -- an unrated row is reviewable, an invented
one is not.
"""

LEVELS = ("remember", "understand", "apply", "analyze", "evaluate", "create")
RANK = dict((lvl, i) for i, lvl in enumerate(LEVELS))

# English verbs. Keys are matched as whole words against a lower-cased
# description, so a stem covers its inflections only where they are listed.
_EN = {
    "remember": (
        "recognise recognize recognises recognizes identify identifies name "
        "names naming recall recalls list lists label labels match matches "
        "state states repeat repeats pronounce pronounces memorise memorize "
        "point recite recites spell spells count counts"),
    "understand": (
        "understand understands explain explains describe describes discuss "
        "discusses summarise summarize interpret interprets classify "
        "classifies illustrate illustrates define defines retell retells "
        "translate translates paraphrase compare compares comprehend "
        "recognise-meaning answer answers"),
    "apply": (
        "use uses using apply applies solve solves demonstrate demonstrates "
        "calculate calculates add adds subtract subtracts multiply "
        "multiplies divide divides measure measures draw draws complete "
        "completes convert converts perform performs practise practice "
        "read reads write writes sort sorts group groups fill build builds "
        "act make makes"),
    "analyze": (
        "analyse analyze analyses analyzes differentiate differentiates "
        "distinguish distinguishes categorise categorize examine examines "
        "infer infers deduce deduces sequence sequences contrast contrasts "
        "investigate investigates explore explores organise organize"),
    "evaluate": (
        "evaluate evaluates judge judges justify justifies critique assess "
        "assesses argue argues defend defends recommend recommends decide "
        "decides review reviews"),
    "create": (
        "create creates compose composes design designs invent invents plan "
        "plans produce produces develop develops formulate formulates "
        "compile compiles construct constructs"),
}

# Urdu stems. Urdu inflects by suffixing, so these are matched as
# substrings -- `پہچان` catches `پہچانیں`, `پہچان سکیں` and `پہچاننا` alike.
_UR = {
    "remember": u"پہچان یاد نام لے دہرا شناخت",
    "understand": u"سمجھ بیان معانی مفہوم وضاحت جواب تعریف موازنہ",
    "apply": u"استعمال لکھ پڑھ سازی بنا حل مشق ادا تحریر",
    "analyze": u"تجزیہ فرق درجہ بندی امتیاز",
    "evaluate": u"جائزہ رائے پرکھ دلیل",
    "create": u"تخلیق ایجاد ترتیب دیں تصنیف",
}

LEXICON = {}
for _lvl, _words in _EN.items():
    for _w in _words.split():
        LEXICON[_w] = _lvl
URDU = {}
for _lvl, _words in _UR.items():
    for _w in _words.split():
        URDU[_w] = _lvl

# Only where the description has no verb at all. These are the defensible
# half of the old mapping -- a hands-on investigation really is `apply` --
# kept as a tie-break, never as an override.
BY_SKILL = {
    "concrete": "understand", "concept_build": "understand",
    "engage_hook": "understand", "pre_reading": "understand",
    "tafheem": "understand", "alfaaz_maani": "understand",
    "duhrai": "understand", "reading_comprehension": "understand",
    "phonics": "remember", "arkaan_saazi": "remember",
    "pictorial": "apply", "pictorial_abstract": "apply",
    "word_problem": "apply", "oral_communication": "apply",
    "investigate_handson": "apply", "qawaid": "apply",
    "buland_khwani": "apply", "vocabulary_grammar": "apply",
    "revision": "apply", "assessment": "apply", "review_assess": "apply",
    "writing": "create", "takhleeqi_likhai": "create",
    "apply_connect": "create",
}

_SPLIT = u" \t\n\r,.;:!?()[]{}\"'/—–’،۔"


# A lexicon word sitting behind one of these is a noun, not the day's verb:
# `in more than one group`, `keep a record`. `and`, `to` and `can` are
# deliberately absent -- `Recognise and design` must keep `design`.
_NOUN_MARKERS = frozenset((
    "a", "an", "the", "this", "that", "these", "those", "one", "two",
    "three", "four", "five", "each", "every", "some", "any", "many",
    "more", "most", "its", "their", "his", "her", "your", "our", "my",
    "in", "of", "per", "into", "about"))


def _words(text):
    out, cur = [], []
    for ch in text:
        if ch in _SPLIT:
            if cur:
                out.append("".join(cur))
                cur = []
        else:
            cur.append(ch)
    if cur:
        out.append("".join(cur))
    return out


def verbs(description):
    """Every Bloom verb the description names, in no particular order.

    English matches whole words so `read` does not fire inside `already`.
    Urdu matches stems, because the language builds its forms by suffixing
    and a whole-word list would need every one of them spelled out.
    """
    found = []
    words = _words(description.lower())
    for i, word in enumerate(words):
        if word in LEXICON and not (i and words[i - 1] in _NOUN_MARKERS):
            found.append((word, LEXICON[word]))
    for word in _words(description):
        for stem, level in URDU.items():
            if word.startswith(stem):
                found.append((stem, level))
    return found


# `Recognise the letter A` is recall. `Recognise the advantages of
# microorganisms` is comprehension with the same verb, so the object has to
# decide -- otherwise the rote-risk column calls whole science units rote.
_ABSTRACT = ("how", "why", "that", "whether", "reason", "reasons", "purpose",
             "purposes", "advantage", "advantages", "disadvantage",
             "disadvantages", "importance", "effect", "effects", "role",
             "roles", "difference", "differences", "relationship",
             "relationships", "meaning", "meanings")


def _points_at_an_abstraction(description):
    return any(w in _ABSTRACT for w in _words(description.lower()))


def rate(description, skill_type):
    """The day's level, and which of the two sources decided it.

    Returns ("", "none") when neither the SLO nor the skill type speaks,
    so the row is reviewable instead of quietly rated.
    """
    hits = verbs(description or "")
    if hits:
        level = max(hits, key=lambda h: RANK[h[1]])[1]
        if level == "remember" and _points_at_an_abstraction(description):
            level = "understand"
        return level, "verb"
    fallback = BY_SKILL.get((skill_type or "").strip())
    if fallback:
        return fallback, "skill"
    return "", "none"
