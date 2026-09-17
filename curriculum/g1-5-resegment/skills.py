"""One `Skill type` column for all four subjects — CPA included, not parallel.

The previous matrix already carried a single skill-type chip per subject
(RC/VG/WR… for English, C/P/PA for Maths). Our `CPA phase` column was a second
copy of the Maths chip, and the two copies disagreed on 42 days. So CPA is not
a sibling of skill type: in Maths it IS the skill type. Here there is one
column, one vocabulary per subject, and the Maths vocabulary is the CPA ramp.

The colours are the original sheet's, read back from it, and they turn out to
be one semantic ramp that already holds across subjects:

    peach   entry / concrete      pale blue  the code itself (phonics, qawaid)
    blue    receptive / pictorial sage       build / bridge
    lilac   productive / abstract tan        oral, applied
    pink    revision              amber      assessment

Reading a Maths row and an English row side by side, the same colour means the
same kind of cognitive work. That is the whole point of keeping one column.
"""

PEACH = "#FCE7C8"   # entry, concrete, hook
BLUE = "#C8E6F4"    # receptive, pictorial
SAGE = "#D9E4D6"    # build, bridge, consolidate
LILAC = "#EAD7F0"   # productive, abstract, apply
TAN = "#F4E1C8"     # oral, applied word work
PALE = "#E7F0FD"    # the code itself
PINK = "#F4C7C7"    # revision
AMBER = "#FBE3B8"   # assessment

# key -> (label, chip colour, what the day actually is)
SKILL = {
    # English
    "pre_reading": ("Pre-reading", PEACH,
                    "Before the text: predicting, picture walk, key words up front."),
    "phonics": ("Phonics", PALE,
                "The code itself — sound-letter work, blending, segmenting."),
    "reading_comprehension": ("Reading comprehension", BLUE,
                              "Working inside a text: retrieval, inference, response."),
    "vocabulary_grammar": ("Vocabulary & grammar", SAGE,
                           "Language focus — words and structures taken out and examined."),
    "oral_communication": ("Oral communication", TAN,
                           "Speaking and listening as the lesson's main work."),
    "writing": ("Writing", LILAC,
                "Children produce text, from sentence to paragraph."),
    # Urdu
    "buland_khwani": ("بلند خوانی · Reading aloud", BLUE,
                      "Fluency: accuracy, pace, expression on a known text."),
    "tafheem": ("تفہیم · Comprehension", BLUE,
                "Meaning-making from the passage."),
    "qawaid": ("قواعد · Grammar", PALE,
               "The rules of the language, taught explicitly."),
    "alfaaz_maani": ("الفاظ و معانی · Vocabulary", SAGE,
                     "Word meaning, word families, usage."),
    "arkaan_saazi": ("ارکان سازی · Syllables", PEACH,
                     "Decoding by syllable — the Urdu route into print."),
    "takhleeqi_likhai": ("تخلیقی لکھائی · Creative writing", LILAC,
                         "Children produce their own text."),
    "duhrai": ("دہرائی · Revision", PINK,
               "Consolidation of taught material."),
    "jaiza": ("جائزہ · Assessment", AMBER,
              "Formative check against the chapter's SLOs."),
    # Maths — the CPA ramp
    "concrete": ("Concrete", PEACH,
                 "CPA concrete: children handle objects before any symbol appears."),
    "pictorial": ("Pictorial", BLUE,
                  "CPA pictorial: the object is replaced by a drawing or model."),
    "pictorial_abstract": ("Pictorial → Abstract", SAGE,
                           "CPA bridge: picture and symbol side by side."),
    "abstract": ("Abstract", LILAC,
                 "CPA abstract: symbols alone, no picture to lean on."),
    "word_problem": ("Word problem", TAN,
                     "CPA abstract, applied: the maths arrives wrapped in language."),
    # Science
    "engage_hook": ("Engage", PEACH, "5E engage: the phenomenon that raises the question."),
    "investigate_handson": ("Investigate", BLUE,
                            "5E explore: children do the thing and record what happens."),
    "concept_build": ("Concept build", SAGE,
                      "5E explain: the observation is named and organised."),
    "apply_connect": ("Apply & connect", LILAC,
                      "5E elaborate: the idea is carried somewhere new."),
    # Gap-fill — periods the timetable has and the textbook does not fill.
    # The books are shorter than the year: teaching every page of every book
    # still leaves 10-79 periods a subject. These name what goes in them.
    "communicative": ("Communicative language", TAN,
                      "Language for a real purpose — asking, describing, "
                      "instructing, agreeing — in pairs and groups, not as a "
                      "text to read. The textbook barely carries it."),
    "number_fluency": ("Number fluency", PEACH,
                       "Short daily number work — counting, bonds, tables, "
                       "estimation. Not a chapter; the thing a chapter "
                       "assumes children already have and many do not."),
    "board_prep": ("Board prep", LILAC,
                   "Grade 5 only, January onwards: SLO-by-SLO preparation "
                   "for the recalled Grade 5 board examination."),
    # All subjects
    "revision": ("Revision", PINK, "Consolidation of taught material."),
    "assessment": ("Assessment", AMBER, "Formative check against the chapter's SLOs."),
    "review_assess": ("Review & assess", AMBER, "Chapter close: review then check."),
}

# Which vocabulary each subject may draw on. Order is the teaching ramp.
ORDER = {
    "English": ["pre_reading", "phonics", "reading_comprehension",
                "vocabulary_grammar", "oral_communication", "communicative",
                "writing", "revision", "assessment"],
    "Urdu": ["arkaan_saazi", "qawaid", "buland_khwani", "tafheem",
             "alfaaz_maani", "communicative", "takhleeqi_likhai",
             "duhrai", "jaiza"],
    "Maths": ["concrete", "pictorial", "pictorial_abstract", "abstract",
              "word_problem", "number_fluency", "revision", "assessment"],
    # review_assess is a real Science label in the corpus — a chapter close
    # that reviews and checks in the same period. It was missing here, so
    # every ORDER-driven loop silently dropped those days.
    "Science": ["engage_hook", "investigate_handson", "concept_build",
                "apply_connect", "revision", "review_assess", "assessment"],
}

# The Maths keys that already name a CPA phase. `cpa_phase` in the source is a
# second copy of this; where the two disagree the day is flagged, not resolved.
CPA_FROM_SKILL = {"concrete": "concrete", "pictorial": "pictorial",
                  "pictorial_abstract": "abstract", "abstract": "abstract",
                  "word_problem": "abstract"}


# Grade 5 Urdu was tagged with the English keys for the same two skills.
# One vocabulary per subject means they read in Urdu like the rest of the tab.
ALIAS = {("Urdu", "revision"): "duhrai", ("Urdu", "assessment"): "jaiza"}


# Two letters, for the day-by-day calendar grid. The previous matrix used the
# same trick; a 30px column holds two characters and nothing more.
CODE = {"pre_reading": "PR", "phonics": "PH", "reading_comprehension": "RC",
        "vocabulary_grammar": "VG", "oral_communication": "OC",
        "writing": "WR",
        "arkaan_saazi": "AS", "qawaid": "QW", "buland_khwani": "BK",
        "tafheem": "TF", "alfaaz_maani": "AM", "takhleeqi_likhai": "TL",
        "duhrai": "DH", "jaiza": "JZ",
        "concrete": "C", "pictorial": "P", "pictorial_abstract": "PA",
        "abstract": "A", "word_problem": "WP",
        "engage_hook": "EN", "investigate_handson": "IN",
        "concept_build": "CB", "apply_connect": "AP",
        "communicative": "CL", "number_fluency": "NF",
        "board_prep": "BP",
        # "review_assess" had "AX" too, which is a real collision, not a
        # duplicate: Science teaches BOTH — a chapter-close review-and-check
        # day and a separate formative assessment day — and the KEY dedupes
        # by code, so one of the two silently vanished from the legend while
        # its chips went on appearing in the grid. RA reads naturally beside
        # RV and AX.
        "revision": "RV", "assessment": "AX", "review_assess": "RA"}


def code(key, subject=None):
    """The grid chip. Unknown keys fall back to their first two letters."""
    if not key:
        return ""
    return CODE.get(canonical(key, subject), key[:2].upper())


def canonical(key, subject=None):
    return ALIAS.get((subject, key), key)


def label(key, subject=None):
    """Display text for a skill-type key. Unknown keys pass through raw."""
    if not key:
        return ""
    key = canonical(key, subject)
    return SKILL.get(key, (key.replace("_", " ").capitalize(), None, ""))[0]


def colour(key, subject=None):
    """Chip colour. Canonicalises first — an aliased Urdu key (revision,
    assessment) has no entry of its own, so a raw lookup silently paints it
    white and the tab loses two colours out of nine."""
    return SKILL.get(canonical(key, subject), ("", None, ""))[1]


def gloss(key, subject=None):
    return SKILL.get(canonical(key, subject), ("", None, ""))[2]


def rgb(hexcode):
    h = hexcode.lstrip("#")
    return {"red": int(h[0:2], 16) / 255, "green": int(h[2:4], 16) / 255,
            "blue": int(h[4:6], 16) / 255}


def chip_requests(sheet_id, values, col, first_row=1):
    """Paint the skill-type column. One request per contiguous same-colour run."""
    runs, cur, start = [], None, first_row
    for i in range(first_row, len(values) + 1):
        row = values[i] if i < len(values) else []
        cell = row[col] if col < len(row) else ""
        c = LABEL_COLOUR.get(cell)
        if c != cur:
            if cur:
                runs.append((start, i, cur))
            cur, start = c, i
    return [{"repeatCell": {
        "range": {"sheetId": sheet_id, "startRowIndex": a, "endRowIndex": b,
                  "startColumnIndex": col, "endColumnIndex": col + 1},
        "cell": {"userEnteredFormat": {"backgroundColor": rgb(c)}},
        "fields": "userEnteredFormat.backgroundColor"}} for a, b, c in runs]


LABEL_COLOUR = {v[0]: v[1] for v in SKILL.values() if v[1]}

KEY_BY_LABEL = {v[0]: k for k, v in SKILL.items()}
