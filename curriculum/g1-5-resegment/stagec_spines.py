# -*- coding: utf-8 -*-
"""Canonical 40-minute move spines, one per skill-type shape per grade band.

Why these are derived and not hand-written per day: a spine's information is
the *shape of the skill type*, not the day's topic. Hand-writing 1,657 of them
buys no extra signal and costs 1,657 chances to breach the period -- the one
defect the design spec says must never be papered over. Eleven shapes, checked
mechanically in test_stagec_spines.py, carry the same meaning and cannot drift.

The G1-2 band is the slow ramp Amena asked for: children arriving with no ECE
exposure get shorter exposition and more, shorter moves. Both properties are
asserted, not merely intended.
"""
import stagec

SHAPES = ("oral_heavy", "pre_reading", "decoding", "comprehension",
          "language_focus", "composition", "manipulative", "representational",
          "problem_solving", "assessment_day", "review_day")

BANDS = ("G1-2", "G3-5")

_RAW = {
 ("oral_heavy", "G3-5"):
   "warm_up·3|hook·3|announce·2|explain·4|guided·5|guided·4|"
   "peer_review·4|independent·5|independent·4|exit·3|recall·3",
 ("oral_heavy", "G1-2"):
   "warm_up·3|hook·4|recall·2|announce·2|explain·3|guided·3|"
   "guided·3|peer_review·4|independent·3|independent·4|guided·3|"
   "peer_review·3|exit·3",
 ("pre_reading", "G3-5"):
   "warm_up·3|hook·4|announce·2|explain·4|guided·5|guided·5|"
   "independent·5|independent·5|peer_review·3|exit·3|recall·1",
 ("pre_reading", "G1-2"):
   "warm_up·3|hook·4|recall·2|announce·2|explain·3|guided·3|"
   "guided·4|independent·3|independent·3|peer_review·3|guided·3|"
   "exit·3|recall·4",
 ("decoding", "G3-5"):
   "warm_up·2|recall·3|announce·2|explain·4|guided·4|independent·4|"
   "guided·4|independent·4|peer_review·3|guided·3|exit·3|recall·4",
 ("decoding", "G1-2"):
   "warm_up·2|recall·3|announce·2|explain·3|guided·3|independent·3|"
   "guided·3|independent·3|peer_review·2|guided·3|independent·3|"
   "recall·3|exit·3|hook·4",
 ("comprehension", "G3-5"):
   "warm_up·3|hook·3|announce·2|explain·5|guided·5|guided·4|"
   "independent·5|independent·5|peer_review·3|exit·3|recall·2",
 ("comprehension", "G1-2"):
   "warm_up·3|hook·3|recall·2|announce·2|explain·4|guided·3|"
   "guided·3|independent·3|independent·3|peer_review·3|guided·4|"
   "exit·3|independent·4",
 ("language_focus", "G3-5"):
   "warm_up·3|recall·3|announce·2|explain·5|guided·5|guided·4|"
   "independent·5|independent·5|peer_review·3|exit·3|hook·2",
 ("language_focus", "G1-2"):
   "warm_up·2|hook·3|recall·3|announce·2|explain·4|guided·3|"
   "independent·3|guided·3|independent·3|peer_review·3|recall·2|"
   "exit·3|independent·6",
 ("composition", "G3-5"):
   "warm_up·2|hook·3|announce·3|explain·5|guided·5|independent·6|"
   "independent·6|peer_review·4|exit·3|recall·3",
 ("composition", "G1-2"):
   "warm_up·2|hook·3|recall·3|announce·2|explain·4|guided·4|"
   "guided·4|independent·4|independent·4|peer_review·4|exit·3|"
   "independent·3",
 ("manipulative", "G3-5"):
   "warm_up·2|hook·4|announce·3|explain·4|guided·6|guided·5|"
   "independent·5|independent·5|peer_review·3|exit·3",
 ("manipulative", "G1-2"):
   "warm_up·2|hook·4|recall·2|announce·2|explain·3|guided·4|"
   "guided·4|independent·4|independent·4|peer_review·3|guided·5|exit·3",
 ("representational", "G3-5"):
   "warm_up·2|recall·3|announce·2|explain·5|guided·5|guided·5|"
   "independent·5|independent·5|peer_review·2|exit·3|hook·3",
 ("representational", "G1-2"):
   "warm_up·2|hook·3|recall·3|announce·2|explain·4|guided·4|"
   "guided·3|independent·3|independent·3|peer_review·3|guided·4|"
   "exit·3|independent·3",
 ("problem_solving", "G3-5"):
   "warm_up·2|hook·3|announce·3|explain·5|guided·6|guided·5|"
   "independent·5|independent·5|peer_review·3|exit·3",
 ("problem_solving", "G1-2"):
   "warm_up·2|hook·3|recall·2|announce·2|explain·4|guided·4|"
   "guided·4|independent·4|independent·4|peer_review·3|guided·5|exit·3",
 ("assessment_day", "G3-5"):
   "warm_up·2|announce·3|explain·2|independent·6|independent·6|"
   "independent·6|independent·6|peer_review·4|exit·3|recall·2",
 ("assessment_day", "G1-2"):
   "warm_up·2|announce·3|recall·2|explain·2|independent·5|"
   "independent·5|independent·5|independent·5|peer_review·4|exit·3|"
   "independent·4",
 ("review_day", "G3-5"):
   "warm_up·2|recall·4|announce·2|explain·3|guided·5|guided·5|"
   "independent·5|independent·5|peer_review·3|exit·3|hook·3",
 ("review_day", "G1-2"):
   "warm_up·2|hook·3|recall·4|announce·2|explain·3|guided·3|"
   "guided·3|independent·3|independent·3|peer_review·3|guided·4|"
   "exit·3|independent·4",
}

SPINES = {k: stagec.parse_moves(v.replace("|", " | ")) for k, v in _RAW.items()}

# The live tabs' own skill tags. Where a curriculum publishes its own tag, that
# tag is authoritative (english-skill-types.md) -- so these map, never override.
_SHAPE_OF = {
    ("English", "Oral communication"): "oral_heavy",
    ("English", "Pre-reading"): "pre_reading",
    ("English", "Phonics"): "decoding",
    ("English", "Reading comprehension"): "comprehension",
    ("English", "Vocabulary & grammar"): "language_focus",
    ("English", "Writing"): "composition",
    ("Urdu", u"بلند خوانی · Reading aloud"): "oral_heavy",
    ("Urdu", u"ارکان سازی · Syllables"): "decoding",
    ("Urdu", u"تفہیم · Comprehension"): "comprehension",
    ("Urdu", u"قواعد · Grammar"): "language_focus",
    ("Urdu", u"الفاظ و معانی · Vocabulary"): "language_focus",
    ("Urdu", u"تخلیقی لکھائی · Creative writing"): "composition",
    ("Urdu", u"جائزہ · Assessment"): "assessment_day",
    ("Maths", "Concrete"): "manipulative",
    ("Maths", "Pictorial"): "representational",
    ("Maths", u"Pictorial → Abstract"): "representational",
    ("Maths", "Abstract"): "representational",
    ("Maths", "Word problem"): "problem_solving",
    ("Science", "Engage"): "oral_heavy",
    ("Science", "Investigate"): "manipulative",
    ("Science", "Concept build"): "representational",
    ("Science", "Apply & connect"): "problem_solving",
}

_KIND_SHAPE = {"assessment": "assessment_day", "review": "review_day"}


def all_spines():
    return sorted(SPINES.keys())


def band(grade):
    return "G1-2" if int(grade) <= 2 else "G3-5"


def shape_for(skill_type, subject):
    """Raise on an unmapped skill type -- a silent generic fallback would fill
    the column plausibly and wrongly, which is the failure this whole module
    exists to prevent."""
    return _SHAPE_OF[(subject, (skill_type or "").strip())]


def shape_for_kind(kind):
    return _KIND_SHAPE.get(kind)


def spine_for(skill_type, subject, grade):
    return SPINES[(shape_for(skill_type, subject), band(grade))]
