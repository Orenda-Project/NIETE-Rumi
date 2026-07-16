#!/usr/bin/env python3
"""Generate 3 sample NBF lesson plans in Rawalpindi-v7 shape.

bd-2040 · Ramisha sample-first dispatch.

Pipeline: reads pre-captured page-truth (from Ramisha's Drive PDFs, downloaded
to /tmp/nbf_ingestion/pdfs/), holds enrichment JSON inline (Stage C output),
renders each LP to a Rawalpindi-v7-shape PDF via reportlab (Stage D), uploads
to R2, and prints public URLs.

Rawalpindi v7 shape (per curriculum-baked-lesson-plans SKILL.md):
    - SLO (specific, single-focus, one 40-min lesson)
    - I-Do (teacher-modelled explanation)
    - We-Do (guided practice — joint teacher-pupil per P6)
    - You-Do (independent practice — different item per P28)
    - CFU (embedded checks for understanding)
    - Exit Ticket (single quick assessment at end)
    - Per-page visuals (illustration prompts for now — kie render is a
      follow-up once Ramisha greenlights pedagogy)

Language routing:
    - Grade 9 Math (English) → English throughout
    - Grade 9 English (English) → English throughout
    - Grade 10 Gen Sci Urdu → Urdu body, English chrome fallback for reportlab
      font limits. Urdu rendered via arabic_reshaper + python-bidi.

Sources: NBF/FTB 2025 curriculum textbooks provided by Ramisha Riaz.
"""

from __future__ import annotations
import io
import json
import os
import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.lib.colors import HexColor, black, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, Flowable,
)
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER, TA_JUSTIFY

import arabic_reshaper
from bidi.algorithm import get_display

ROOT = Path("/Users/mashhoodr/dev/rumi/Rumi 10 April 2026")
OUT_DIR = Path("/tmp/nbf_samples")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── Fonts ─────────────────────────────────────────────────────────────────────
# Urdu Nastaliq font — NotoNastaliq (macOS) is a .ttc collection; subfontIndex=1
# gives the "Noto Nastaliq Urdu" (the display-oriented Nastaliq shape, aligned
# with the NBF Urdu textbook rendering).
URDU_FONT_NAME = "Helvetica"  # fallback
# SFArabic.ttf is a Modern Naskh with excellent glyph coverage; NotoNastaliq.ttc
# subfont extraction produced empty glyphs in reportlab (missing cmap on subset).
# For a Nastaliq-authentic look, install Jameel Noori Nastaleeq and route here.
_URDU_CANDIDATES = [
    # SFArabic (Modern Naskh) is what actually renders reliably through
    # reportlab's TTF subsetter — NotoNastaliq extraction produces empty
    # glyphs even though the .ttc is present. For a Nastaliq-authentic
    # rendering install Jameel Noori Nastaleeq and add it as the first
    # candidate here.
    ("SFArabic", "/System/Library/Fonts/SFArabic.ttf", None),
    ("NotoNastaliq", "/System/Library/Fonts/NotoNastaliq.ttc", 1),
]
for name, path, subidx in _URDU_CANDIDATES:
    if Path(path).exists():
        try:
            if subidx is not None:
                pdfmetrics.registerFont(TTFont(name, path, subfontIndex=subidx))
            else:
                pdfmetrics.registerFont(TTFont(name, path))
            URDU_FONT_NAME = name
            print(f"[fonts] Urdu → {URDU_FONT_NAME}", file=sys.stderr)
            break
        except Exception as e:
            print(f"[fonts] {name} failed: {e}", file=sys.stderr)
            continue

def shape_urdu(text: str) -> str:
    """Reshape + bidi Urdu/Arabic text for reportlab (which does no shaping)."""
    if not text:
        return text
    try:
        reshaped = arabic_reshaper.reshape(text)
        return get_display(reshaped)
    except Exception:
        return text


# ── Unicode-safety pipeline (bd-2045 · Ramisha round-1 fix) ──────────────────
# Round 1 shipped with two Unicode failure modes:
#   (a) Inline Arabic honorifics (عليه السلام, رضی اللہ عنہ) in English body
#       text rendered as black boxes — Helvetica has no Arabic glyph coverage.
#   (b) Math arrows (↔, →) and en-dashes hit the same missing-glyph path when
#       they landed in a table cell whose style was locked to Helvetica.
# Fix: (a) segment mixed-script paragraphs so Arabic runs are wrapped in a
# <font name=URDU_FONT> span (reportlab per-span font swap), (b) rewrite the
# few remaining exotic math glyphs to ASCII equivalents before rendering.

import re  # noqa: E402  (kept here so the Unicode block is self-contained)

_ARABIC_RANGE = (
    r'؀-ۿ'   # Arabic
    r'ݐ-ݿ'   # Arabic Supplement
    r'ࢠ-ࣿ'   # Arabic Extended-A
    r'ﭐ-﷿'   # Arabic Presentation Forms-A
    r'ﹰ-﻿'   # Arabic Presentation Forms-B
)
_ARABIC_RE = re.compile(f'[{_ARABIC_RANGE}]+(?:[  ][{_ARABIC_RANGE}]+)*')

# ASCII-safe replacements for exotic glyphs Helvetica cannot render.
_GLYPH_FIXES = [
    ('↔', ' <-> '),
    ('→', ' -> '),
    ('←', ' <- '),
    ('⇒', ' => '),
    ('⇐', ' <= '),
    ('×', ' x '),
    ('÷', ' / '),
    ('≈', ' ~ '),
    ('≥', ' >= '),
    ('≤', ' <= '),
    ('²', '^2'),
    ('³', '^3'),
    ('₀', '_0'), ('₁', '_1'), ('₂', '_2'), ('₃', '_3'),
    ('₄', '_4'), ('₅', '_5'), ('₆', '_6'), ('₇', '_7'),
    ('₈', '_8'), ('₉', '_9'),
    # ligature / typographic quotes — Helvetica CAN render these, but they
    # occasionally get double-encoded upstream. Normalise to ASCII.
    ('“', '"'), ('”', '"'), ('‘', "'"), ('’', "'"),
]


def sanitize_glyphs(text: str) -> str:
    """Replace non-Helvetica-safe glyphs with ASCII equivalents."""
    if not text:
        return text
    for src, dst in _GLYPH_FIXES:
        text = text.replace(src, dst)
    return text


def render_mixed_script(text: str) -> str:
    """Segment a Latin+Arabic string so Arabic runs are wrapped in <font> spans.

    ReportLab paragraphs support inline `<font name="X">...</font>` — we use that
    to route Arabic spans to the registered Urdu font while leaving Latin runs
    in Helvetica. Each Arabic span is also reshaped + bidi'd so it renders
    correctly (reportlab does no shaping).
    """
    if not text:
        return text
    text = sanitize_glyphs(text)
    if URDU_FONT_NAME == "Helvetica":
        # No Urdu font registered — strip Arabic runs to avoid black boxes.
        # Preserves everything else.
        return _ARABIC_RE.sub('', text).replace('  ', ' ').strip()

    def _repl(m):
        arabic = m.group(0)
        shaped = shape_urdu(arabic)
        return f'<font name="{URDU_FONT_NAME}">{shaped}</font>'

    return _ARABIC_RE.sub(_repl, text)


# Latin run: any span of ASCII letters/digits/spaces/basic punctuation,
# terminated when we hit an Arabic-range character. Used inside Urdu-primary
# paragraphs to route Latin runs (e.g. "(Living organisms)", "40 min",
# "Lesson 1", "Bloom L3") to Helvetica so they render as text, not boxes.
_LATIN_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9 \-\.,;:!\?\(\)\[\]/\+\*&#°]*[A-Za-z0-9\)\]\.]')


def render_urdu_with_latin(text: str) -> str:
    """For Urdu-primary paragraphs: shape Arabic runs, route Latin runs to Helvetica.

    Urdu font (SFArabic / NotoNastaliq) has no Latin glyph coverage — any
    English word inside an Urdu line renders as black boxes if the paragraph
    style is locked to the Urdu font. We split the line into Arabic vs Latin
    spans, wrap Latin spans in <font name="Helvetica">, and reshape+bidi the
    surrounding Arabic. Reshape is applied to the WHOLE original line first
    (bidi needs full context to lay out RTL correctly), then the ASCII spans
    are re-injected via <font> tags so ReportLab picks up Helvetica for them.
    """
    if not text:
        return text
    text = sanitize_glyphs(text)
    if URDU_FONT_NAME == "Helvetica":
        return text
    # Split by Latin runs. Reshape each Arabic segment independently, then
    # concatenate with <font name="Helvetica">…</font>-wrapped Latin runs
    # in between. This trades some bidi-boundary correctness for legibility
    # (English inside Urdu displays as-is instead of as boxes).
    parts = []
    last = 0
    for m in _LATIN_RE.finditer(text):
        # arabic-ish chunk before the Latin match
        pre = text[last:m.start()]
        if pre:
            parts.append(shape_urdu(pre))
        latin = m.group(0)
        parts.append(f'<font name="Helvetica">{latin}</font>')
        last = m.end()
    tail = text[last:]
    if tail:
        parts.append(shape_urdu(tail))
    return "".join(parts)


# ── Rawalpindi v7 palette ─────────────────────────────────────────────────────
NAVY = HexColor("#1E293B")
AMBER = HexColor("#FBBF24")
TEAL = HexColor("#059669")
BLUE = HexColor("#2563EB")
CORAL = HexColor("#DC2626")
GREEN_LIGHT = HexColor("#DBEAFE")
PURPLE_LIGHT = HexColor("#EDE9FE")
CREAM = HexColor("#FEF3C7")
GREY = HexColor("#64748B")
GREY_LIGHT = HexColor("#F1F5F9")


# ── Enriched LPs (Stage C output) ─────────────────────────────────────────────
# Grounded in page-truth from the three NBF PDFs, chapter/lesson 1 each.

LP_G9_MATH = {
    "slug": "g9_math_ch1_currency_exchange",
    "region": "Pakistan (NBF)",
    "grade": "Grade 9",
    "subject": "Mathematics (Functional Math)",
    "language": "English",
    "chapter": "Unit 1 · Financial Arithmetic",
    "chapter_pages": "pp. 7–15",
    "lesson_title": "Currency Exchange — converting between PKR and international currencies",
    "source_pages": "pp. 7–9 (Section 1.1 Currency Exchange)",
    "duration_min": 40,
    "edition": "NBF/FTB, National Curriculum of Pakistan 2025",
    "slo": (
        "By the end of this 40-min lesson, students can convert a given amount "
        "between Pakistani Rupees and one international currency (USD or EUR) "
        "using a written exchange-rate formula, and show working step-by-step."
    ),
    "slo_bloom": "Apply (Bloom L3)",
    "key_words": [
        "Currency", "Exchange rate", "PKR", "USD (US Dollar)", "EUR (Euro)",
        "Conversion", "Rate", "Buying rate", "Selling rate"
    ],
    "materials": [
        "NBF Functional Math Grade 9 textbook, pp. 7–9",
        "Blackboard + chalk (colored chalk preferred for two-way arrows)",
        "One printed currency-rate table (or written on board) — see I-Do",
        "Students' notebooks"
    ],
    "hook_real_world": (
        "Ask: 'If your cousin sends 200 US Dollars from Dubai, how many "
        "Pakistani Rupees will your family receive today?' Let one or two "
        "students guess — write their guesses on the board (we come back to "
        "them in the Exit Ticket)."
    ),
    "warmup_review": (
        "5-min warm-up: quick multiplication drill on the board — "
        "278 × 4 = ?, 278 × 20 = ?, 278 × 200 = ? Elicit answers together. "
        "Tell class: 'Today we use exactly this multiplication to work with "
        "money from different countries.'"
    ),
    "i_do": {
        "duration_min": 10,
        "teacher_says": (
            "'Every country has its own money. In Pakistan we use Rupees, in "
            "USA they use Dollars. The RATE tells us how many Rupees ONE "
            "Dollar is worth today.' Write on board: 1 US Dollar = 278 PKR "
            "(today's rate). Draw a two-way arrow: PKR ↔ USD."
        ),
        "modelling_steps": [
            "STEP 1 — write the rule: 'Amount in PKR = Amount in USD × Rate'.",
            "STEP 2 — worked example (from p.7 Example 1): Convert 100 USD to PKR. "
            "100 × 278 = 28,000 PKR. Show the working line by line.",
            "STEP 3 — reverse example: 'What if I have 55,600 PKR — how many USD?' "
            "Write: Amount in USD = PKR ÷ Rate = 55,600 ÷ 278 = 200 USD. "
            "Underline: '× to go one way, ÷ to go back.'"
        ],
        "board_work": (
            "Draw a simple table on the board:\n"
            "  Currency  |  1 unit = ? PKR\n"
            "  USD       |  278\n"
            "  EUR       |  305\n"
            "  SAR       |  74\n"
            "(Rates rounded; tell students real rates change daily.)"
        )
    },
    "we_do": {
        "duration_min": 12,
        "activity": (
            "Solve Example 2 (p.7) together on the board — 'Convert 500 US "
            "Dollars to Pakistani Rupees.' Elicit each step from a DIFFERENT "
            "student. Ask: 'What operation do we use?' → wait for 'multiply'. "
            "Then compute: 500 x 278 = 139,000. Write 'PKR 139,000'. "
            "(Aligned to LO 1.1.a: convert between currencies using a rate.)"
        ),
        "joint_practice": (
            "Board relay (3 students): each student takes one row from the "
            "rate table and works it out on the board — 50 EUR to PKR; 1,000 "
            "SAR to PKR; 2,000 PKR to USD. Rest of the class works the same "
            "three in their notebooks. Teacher circulates, corrects arithmetic "
            "errors on the spot."
        ),
        "cfu_embedded": (
            "CFU (short written check): students write 'x' or '/' on scrap "
            "paper for two prompts — (a) 'I have 400 USD, how many PKR?' "
            "(answer: x) and (b) 'I have 27,800 PKR, how many USD?' (answer: "
            "/). Scan responses in 30 seconds. Re-teach if more than 3 "
            "students got either wrong."
        ),
    },
    "you_do": {
        "duration_min": 10,
        "activity": (
            "Students work individually in notebooks on 3 problems (different "
            "items from I-Do and We-Do per P28 — pull from Exercise 1.1 on p.8):\n"
            "  1. Convert 250 USD to PKR (Rate: 1 USD = 278 PKR).\n"
            "  2. Convert 1,500 SAR to PKR (Rate: 1 SAR = 74 PKR).\n"
            "  3. Convert 91,500 PKR to EUR (Rate: 1 EUR = 305 PKR)."
        ),
        "expected_answers": [
            "1) 250 × 278 = 69,500 PKR",
            "2) 1,500 × 74 = 111,000 PKR",
            "3) 91,500 ÷ 305 = 300 EUR"
        ],
        "support_scaffold": (
            "Support (struggling students) — pair them with a stronger neighbour; "
            "give them ONE problem, ask them to write the rate first, THEN circle "
            "'× or ÷' before computing."
        ),
        "challenge_extension": (
            "Challenge (fast finishers) — 'A shopkeeper buys 1 USD for 276 PKR "
            "and sells for 280 PKR. If he exchanges 500 USD in a day, what is "
            "his profit in Rupees?' (Answer: (280 − 276) × 500 = 2,000 PKR.)"
        )
    },
    "exit_ticket": {
        "duration_min": 3,
        "prompt": (
            "On a slip of paper, students answer ONE question: "
            "'Your family receives $200 from a relative abroad. If today's rate "
            "is 1 USD = 278 PKR, how many Rupees do they receive? Show your working.'"
        ),
        "expected_answer": "200 × 278 = 55,600 PKR",
        "success_criterion": (
            "The learner correctly identifies multiplication as the operation, "
            "sets up '200 × 278', and computes 55,600 PKR, as evidenced in a "
            "single-line working shown on the exit slip."
        ),
    },
    "closing_beat": (
        "Circle back to the hook question. Write the correct answer next to the "
        "students' guesses on the board. Celebrate whoever was closest."
    ),
    "next_topic_preview": (
        "Tomorrow: 'Profit and Loss' — Section 1.2. We keep using the same "
        "multiplication skill, but now to work out what a shopkeeper earns or "
        "loses on a sale."
    ),
    "teacher_corner": (
        "Common mistake: students multiply when they should divide (going from "
        "PKR back to USD). Watch for this in You-Do problem 3. If more than 5 "
        "students get it wrong, pause the class and re-model the reverse case."
    ),
    "visual_prompts": [
        "PAGE 1 — Header banner: 'RUMI · Lesson Plan · Grade 9 · Mathematics · 40 min' "
        "in navy on white, with a small currency-exchange icon (two arrows PKR↔USD). "
        "Below: amber SLO ribbon. Then a 2×2 grid of step cards (Warm-Up teal, I-Do teal, "
        "We-Do blue, You-Do blue). Each card shows the section title + time pill + first bullet.",
        "PAGE 2 — Continuation: full You-Do content, coral CFU ribbon, teal Exit Ticket ribbon, "
        "cream 'Teacher's Corner' callout with common-mistake note. Bottom: 'Tomorrow' arc strip "
        "pointing to Section 1.2."
    ],
    "references": [
        "NBF Functional Math Grade 9 (2025 edition), Unit 1 · Financial Arithmetic, "
        "Section 1.1 Currency Exchange, pp. 7–9, Example 1, Example 2, Exercise 1.1."
    ]
}


LP_G9_ENGLISH = {
    "slug": "g9_english_unit1_dignity_of_work",
    "region": "Pakistan (NBF)",
    "grade": "Grade 9",
    "subject": "English (Functional English)",
    "language": "English",
    "chapter": "Unit 1 · The Sacred Craft: Dignity of Work",
    "chapter_pages": "pp. 4–10",
    "lesson_title": "Pre-reading + Comprehending 'The Sacred Craft: Dignity of Work' — identifying main ideas",
    "source_pages": "pp. 4–7 (Article + Pre-/While-/Post-reading questions)",
    "duration_min": 40,
    "edition": "NBF/FTB, National Curriculum of Pakistan 2025",
    "slo": (
        "By the end of this 40-min lesson, students can identify TWO main ideas "
        "from the article 'The Sacred Craft: Dignity of Work' and explain, in "
        "one written sentence each, WHY the article calls honest work sacred — "
        "citing one specific detail from the passage for each idea."
    ),
    "slo_bloom": "Understand (Bloom L2) + Analyze (L4) — main idea + evidence",
    "key_words": [
        "Dignity", "Sincere / sincerely", "Honest / honesty", "Exploitation",
        "Livelihood", "Manual (work)", "Companion", "Prophet", "Trader"
    ],
    "materials": [
        "NBF Functional English Grade 9 textbook, pp. 4–7",
        "Blackboard + chalk",
        "One student per pair with a copy of the passage (or shared copy)",
    ],
    "hook_real_world": (
        "Show / describe: a farmer harvesting wheat, a shopkeeper at his till, "
        "a doctor examining a patient. Ask: 'Whose work is most respected in "
        "our society — and whose is least?' Let students shout out. Write their "
        "list on the board WITHOUT judging. Then say: 'Today's article says "
        "the opposite of what most of us just said.'"
    ),
    "warmup_review": (
        "3-min warm-up — write the two Pre-reading questions from the book "
        "on the board:\n"
        "  1. 'What do you think is meant by \"Dignity of Labour\"?'\n"
        "  2. 'Why should every kind of work be respected equally?'\n"
        "Give students 2 minutes to discuss with the person next to them "
        "(paired talk, not written). Take 2 quick answers."
    ),
    "i_do": {
        "duration_min": 8,
        "teacher_says": (
            "'The article you are about to read has ONE big message and TWO "
            "supporting ideas. My job right now is to MODEL how a good reader "
            "finds the main idea — I read, I stop, I ask: what is this "
            "paragraph telling me?' (Aligned to LO 1.1.a: identify main idea "
            "and supporting details in a short prose passage.)"
        ),
        "modelling_steps": [
            "Step 1 — Read the FIRST paragraph aloud slowly (from 'All "
            "religions of the world affirm that honest work...'). Think aloud: "
            "'The author is telling me every religion agrees that honest work "
            "matters.' Write on board: 'Main idea = honest work is respected "
            "by all religions.'",
            "Step 2 — Read the SECOND paragraph aloud (Islam and the "
            "Prophet's teaching on honest labour). Think aloud: 'This "
            "paragraph gives me a SPECIFIC religion (Islam) and TWO named "
            "examples: the Prophet worked as a shepherd and later as a "
            "trader.' Write: 'Supporting idea 1 = the Prophet himself worked "
            "with his hands.'",
            "Step 3 — Underline the technique on the board: 'MAIN IDEA + "
            "WHO/WHAT example supports it. Always both.'",
        ],
        "board_work": (
            "Draw a T-chart on the board with two columns: 'Main Idea' | "
            "'Detail from passage that proves it'. Fill the first row TOGETHER "
            "using Steps 1 and 2 above."
        )
    },
    "we_do": {
        "duration_min": 12,
        "activity": (
            "Guided reading of paragraph 3 (Prophet Musa working as a shepherd "
            "and Prophet Dawud as an armourer, per p.5). Read aloud yourself, "
            "then ask a DIFFERENT student each time: 'What is this sentence "
            "telling me?' Elicit the supporting idea from the students, not "
            "from you."
        ),
        "joint_practice": (
            "Think-Pair-Share: pairs discuss for 60 seconds, then two pairs "
            "share out. Prompt: 'What main idea is paragraph 3 making?' "
            "(Expected: even prophets did manual work.) Then: 'Which specific "
            "detail proves it?' Write row 2 of the T-chart on the board using "
            "the students' exact words."
        ),
        "cfu_embedded": (
            "CFU (structured written check): read TWO sentences aloud. "
            "Students write 'M' for main idea or 'D' for detail on scrap "
            "paper. (a) 'The Prophet Musa worked as a shepherd.' (D). "
            "(b) 'Islam teaches that all honest work is dignified.' (M). "
            "Scan responses in 30 seconds; re-teach if more than 3 students "
            "confuse the two."
        ),
    },
    "you_do": {
        "duration_min": 12,
        "activity": (
            "Students work in pairs (per P28 — different paragraph than what "
            "was modelled). Assign paragraph 4 ('the working principles of "
            "Islam are based on honesty, fairness, and kindness...'). Each "
            "pair produces ONE row of the T-chart in their notebook — one main "
            "idea + one supporting detail — for that paragraph."
        ),
        "expected_answers": [
            "Main idea: 'Islamic working principles are honesty, fairness, "
            "and kindness.'",
            "Detail (one of): 'Workers have the right to fair wages, just "
            "treatment, understanding.' OR 'Islam opposes exploitation and "
            "promotes equitable wealth distribution.'"
        ],
        "support_scaffold": (
            "Support — for weaker readers, give them ONE sentence highlighted "
            "and ask: 'Is this the main idea or a detail? Copy it into the "
            "correct column.'"
        ),
        "challenge_extension": (
            "Challenge — pair finds an ADDITIONAL detail from paragraph 5 "
            "(the two hadith quotations — Sahih al-Bukhari 30 / Sunan Ibn "
            "Majah 2443) that proves the SAME main idea. Write it as a third "
            "row."
        )
    },
    "exit_ticket": {
        "duration_min": 5,
        "prompt": (
            "On a slip of paper, students write ONE sentence answering: "
            "'According to the article, what is ONE reason honest work is "
            "called sacred? Cite ONE specific detail from the passage that "
            "supports your reason.' (Different question than the T-chart "
            "task — per P28 transfer-test.)"
        ),
        "expected_answer": (
            "Acceptable answer names any of: religion (Islam) teaches it; the "
            "Prophet himself did honest work; kindness to workers is commanded; "
            "fairness in wages is required — WITH a named detail from the "
            "passage (the Prophet as shepherd or trader; Sahih Bukhari hadith "
            "about paying wages; or the Jabir bin Abdullah scarred-hands "
            "story)."
        ),
        "success_criterion": (
            "The learner correctly names ONE main idea from the article AND "
            "cites ONE specific supporting detail from the passage, as evidenced "
            "in a single written sentence on the exit slip."
        ),
    },
    "closing_beat": (
        "Return to the board list from the hook. Ask: 'Now that we've read the "
        "article — do we want to change our list?' Let one student cross out "
        "'least respected' next to any job on the list."
    ),
    "next_topic_preview": (
        "Tomorrow: we move to the GLOSSARY (p.7) and the Oral Communication "
        "& Listening Skills section (p.8). We use today's main-idea skill to "
        "answer the Post-reading Questions."
    ),
    "teacher_corner": (
        "Watch for students copying LONG chunks of the passage into the 'main "
        "idea' column. A main idea is a SHORT sentence in the student's own "
        "words. If more than 5 pairs copy verbatim, pause and re-model."
    ),
    "visual_prompts": [
        "PAGE 1 — Header banner navy on white: 'RUMI · Lesson Plan · Grade 9 "
        "· English · 40 min'. Small book icon. Amber SLO ribbon: 'By the end...' "
        "Below: 2×2 grid of step cards. Include a small T-chart illustration in the "
        "I-Do card showing 'Main Idea | Detail'.",
        "PAGE 2 — You-Do task continued (support + challenge pills), coral CFU "
        "recall ribbon, teal Exit Ticket ribbon, cream Teacher's Corner. Arc strip "
        "to 'Tomorrow: Glossary + Oral Communication'."
    ],
    "references": [
        "NBF Functional English Grade 9 (2025 edition), Unit 1 · The Sacred Craft: "
        "Dignity of Work, article + Pre-reading + Post-reading questions, pp. 4–7."
    ]
}


LP_G10_SCIENCE = {
    "slug": "g10_gen_sci_urdu_sabaq1_mutalia_e_mowjoodat",
    "region": "Pakistan (NBF)",
    "grade": "Grade 10 (جماعت دہم)",
    "subject": "General Science (Urdu) — جنرل سائنس اردو",
    "language": "Urdu",
    "chapter": "سبق نمبر 1 · موجودات زندہ کا مطالعہ (Lesson 1 · Study of Living Organisms)",
    "chapter_pages": "pp. 6–7 (Lesson 1)",
    "lesson_title": (
        "موجودات زندہ کی درجہ بندی اور ماحولیاتی نظام (Ecosystem) کا تعارف — "
        "one-lesson introduction to classifying living organisms and the ecosystem concept"
    ),
    "source_pages": "pp. 6–7 · سبق نمبر 1",
    "duration_min": 40,
    "edition": (
        "NBF/FTB, قومی نصاب 2022-23 کے مطابق (National Curriculum 2022-23 aligned, "
        "supplementary reading material)"
    ),
    "slo": (
        "اس 40 منٹ کے سبق کے اختتام پر، طلبہ کم از کم تین گروہوں (جانور، پودے، "
        "خرد بین جاندار) میں جانداروں کی درجہ بندی کر سکیں گے اور ماحولیاتی نظام "
        "(Ecosystem) کی سادہ تعریف اپنے الفاظ میں لکھ سکیں گے۔"
        "\n\n"
        "(By the end of this 40-minute lesson, students can classify living "
        "organisms into at least three groups — animals, plants, microscopic "
        "organisms — AND write a simple definition of 'Ecosystem' in their own "
        "words.)"
    ),
    "slo_bloom": "Understand (L2) + Apply (L3) — classify + define",
    "key_words": [
        "موجودات زندہ (Living organisms)",
        "درجہ بندی (Classification)",
        "پودے (Plants)",
        "جانور (Animals)",
        "خرد بین جاندار (Microscopic organisms / Micro-organisms)",
        "ماحولیاتی نظام (Ecosystem)",
        "برادری (Community)",
        "حیاتی کرہ (Biosphere)"
    ],
    "materials": [
        "NBF جنرل سائنس (اردو) جماعت دہم، صفحہ 6-7",
        "بلیک بورڈ اور چاک",
        "3-4 حقیقی اشیاء کلاس میں لانے کے لیے: ایک پتا، ایک تصویر جانور کی، "
        "ایک پھل، پانی کا گلاس (Real objects: a leaf, an animal picture, a "
        "fruit, a glass of water — for the sorting hook.)"
    ],
    "hook_real_world": (
        "کلاس میں تین اشیاء لائیں: ایک پتا، ایک تصویر بلی کی، ایک گلاس پانی۔ "
        "ٹیبل پر رکھیں اور پوچھیں: 'ان میں سے کون کون سا 'زندہ' ہے؟' طلبہ "
        "کے جوابات سنیں، بورڈ پر لکھیں (فیصلہ نہ کریں)۔ کہیں: 'آج ہم سیکھیں "
        "گے کہ سائنس دان 'زندہ' اور 'غیر زندہ' میں کیسے فرق کرتے ہیں۔'"
        "\n\n"
        "(Bring 3 real items: a leaf, a picture of a cat, a glass of water. "
        "Ask: 'Which of these is ALIVE?' Take answers without judging. Say: "
        "'Today we learn how scientists classify living things.')"
    ),
    "warmup_review": (
        "3 منٹ — بورڈ پر لکھیں: 'زندہ چیز کی کم از کم دو خصوصیات کیا ہیں؟' "
        "طلبہ سے پوچھیں (پہلی جماعت میں انہوں نے یہ گزشتہ سال کے سبق میں پڑھا)۔ "
        "متوقع جوابات: سانس لیتی ہے، بڑھتی ہے، بچے پیدا کرتی ہے، خوراک لیتی ہے۔"
    ),
    "i_do": {
        "duration_min": 10,
        "teacher_says": (
            "'زمین پر لاکھوں جاندار ہیں — مچھلی سے شیر تک، گلاب سے آم کے درخت "
            "تک۔ سائنس دان انہیں گروہوں میں تقسیم کرتے ہیں تاکہ ہم ان کا "
            "مطالعہ آسانی سے کر سکیں۔ آج میں آپ کو تین بنیادی گروہ سکھاؤں گا۔'"
        ),
        "modelling_steps": [
            "قدم 1 — بورڈ پر تین دائرے بنائیں اور لکھیں: پودے (Plants) / "
            "جانور (Animals) / خرد بین جاندار (Micro-organisms)۔",
            "قدم 2 — ہر دائرے کی ایک مثال دیں: پودے = گندم، جانور = بلی، "
            "خرد بین جاندار = بیکٹیریا (بغیر خردبین نظر نہیں آتا)۔",
            "قدم 3 — بلند آواز میں تعریف: 'ماحولیاتی نظام (Ecosystem) = ایک "
            "علاقے میں تمام زندہ اور غیر زندہ چیزیں مل کر جو نظام بناتی ہیں۔' "
            "بورڈ پر ایک تالاب کا خاکہ بنائیں (پانی + مچھلی + پودے + سورج) "
            "اور کہیں: 'یہ ایک ماحولیاتی نظام ہے۔'"
        ],
        "board_work": (
            "بلیک بورڈ لے آؤٹ:\n"
            "  |  پودے (Plants)   |  جانور (Animals)  |  خرد بین (Micro)  |\n"
            "  |  گندم، آم، گلاب  |  بلی، مچھلی، پرندہ  |  بیکٹیریا، وائرس |\n"
            "دائیں طرف تالاب کا خاکہ + لفظ 'ماحولیاتی نظام'۔"
        )
    },
    "we_do": {
        "duration_min": 10,
        "activity": (
            "مشترک درجہ بندی کی مشق: استاد چھ اشیاء کے نام بورڈ پر لکھیں — "
            "گدھا، آم کا درخت، خمیر، شارک، دھان، مینڈک۔ ہر لفظ کے سامنے ایک "
            "جوڑا مختصر بحث کر کے (60 سیکنڈ) صحیح گروہ کا نام کاپی میں لکھے۔ "
            "پھر دو جوڑے کھڑے ہو کر جواب پڑھیں، استاد بورڈ پر تصدیق کریں۔ "
            "(LO 1.1.a سے مطابق: جانداروں کی درجہ بندی)"
        ),
        "joint_practice": (
            "Think-Pair-Share: طلبہ کو جوڑوں میں کریں۔ ہر جوڑا کتاب کے صفحہ "
            "6-7 پر 'برادری' (Community) کا لفظ ڈھونڈے اور اس کی تعریف پڑھے۔ "
            "60 سیکنڈ بحث کے بعد ایک جوڑا سوال کا جواب دے: 'برادری اور "
            "ماحولیاتی نظام میں کیا فرق ہے؟' استاد جواب کو بورڈ پر واضح "
            "کریں۔"
        ),
        "cfu_embedded": (
            "CFU (مختصر تحریری چیک): طلبہ کاغذ کے ٹکڑے پر ایک لفظ لکھیں — "
            "'اگر ایک درخت پر بیٹھا کوا، درخت، اور اس کا سایہ سب مل کر ایک "
            "____ ہیں، تو خالی جگہ میں کون سا لفظ آئے گا؟' متوقع جواب: "
            "'ماحولیاتی نظام' یا 'برادری'۔ 30 سیکنڈ میں جوابات کا معائنہ "
            "کریں؛ اگر تین سے زیادہ طلبہ کا جواب غلط ہو، تو دوبارہ سمجھائیں۔"
        ),
    },
    "you_do": {
        "duration_min": 8,
        "activity": (
            "طلبہ اپنی کاپی میں انفرادی طور پر (per P28 — different examples "
            "from I-Do and We-Do):\n"
            "1) ان چھ اشیاء کو ان کے صحیح گروہ میں لکھیں: کیلا، ہاتھی، "
            "ملیریا کا جراثیم، بھینس، پیاز، وائرس۔\n"
            "2) اپنے الفاظ میں 'ماحولیاتی نظام' کی ایک جملے کی تعریف لکھیں۔\n"
            "3) اپنے گاؤں یا شہر میں کسی ایک ماحولیاتی نظام کی مثال دیں "
            "(مثلاً: تالاب، کھیت، جنگل)۔"
        ),
        "expected_answers": [
            "1) پودے: کیلا، پیاز۔ جانور: ہاتھی، بھینس۔ خرد بین: ملیریا کا جراثیم، وائرس۔",
            "2) قابل قبول جواب: 'کسی جگہ کے سب زندہ اور غیر زندہ چیزیں مل کر ماحولیاتی نظام بناتے ہیں۔'",
            "3) قابل قبول جواب: کوئی بھی حقیقی مقامی مثال — تالاب، کھیت، باغ، جنگل۔"
        ],
        "support_scaffold": (
            "سپورٹ — کمزور طلبہ کے لیے: صرف پہلا سوال حل کریں، اور تین گروہوں "
            "کے نام بورڈ پر لکھے رہنے دیں۔"
        ),
        "challenge_extension": (
            "چیلنج — تیز طلبہ کے لیے: 'اگر ایک تالاب سے تمام مچھلیاں نکال دی جائیں "
            "تو ماحولیاتی نظام پر کیا اثر پڑے گا؟' ایک پیراگراف میں لکھیں۔"
        )
    },
    "exit_ticket": {
        "duration_min": 4,
        "prompt": (
            "کاغذ کے ٹکڑے پر ایک سوال کا جواب دیں: 'میرے دادا کے کھیت میں گندم "
            "کی فصل، چوہے، الو، سانپ، اور پانی کا نالہ ہے۔ کیا یہ ایک ماحولیاتی "
            "نظام ہے؟ ہاں یا نہیں — اور کیوں؟'"
            "\n\n"
            "(One-question exit slip — different scenario from I-Do/We-Do/You-Do "
            "per P28.)"
        ),
        "expected_answer": (
            "ہاں، یہ ایک ماحولیاتی نظام ہے کیونکہ اس میں زندہ چیزیں (فصل، "
            "چوہے، الو، سانپ) اور غیر زندہ چیزیں (پانی، مٹی) دونوں ایک ساتھ "
            "موجود ہیں۔"
        ),
        "success_criterion": (
            "طالب علم صحیح طور پر 'ہاں' کا انتخاب کرے اور کم از کم ایک زندہ "
            "اور ایک غیر زندہ عنصر کا حوالہ دے، جیسا کہ ایگزٹ سلپ پر ظاہر ہو۔"
        ),
    },
    "closing_beat": (
        "ہک پر واپس جائیں — ٹیبل پر رکھی چیزوں (پتا، بلی کی تصویر، پانی) کی "
        "طرف اشارہ کریں اور پوچھیں: 'اب بتائیں — کون سا زندہ ہے، کون سا غیر "
        "زندہ، اور کیا یہ سب مل کر ایک نظام بنا سکتے ہیں؟'"
    ),
    "next_topic_preview": (
        "کل: سبق نمبر 2 — 'سائنس کی نوعیت' (Nature of Science)۔ آج کے 'مطالعہ' "
        "کے تصور کو استعمال کر کے سیکھیں گے کہ سائنس دان مشاہدہ اور تجربے سے "
        "کیسے کام کرتے ہیں۔"
    ),
    "teacher_corner": (
        "عام غلطی: طلبہ اکثر 'زندہ' اور 'حرکت کرنے والا' کو یکساں سمجھتے ہیں "
        "(مثلاً وہ سوچتے ہیں کہ پودا زندہ نہیں کیونکہ وہ حرکت نہیں کرتا)۔ "
        "You-Do کے دوران اس غلطی پر نظر رکھیں — اگر پانچ سے زیادہ طلبہ پودے "
        "کو 'غیر زندہ' لکھیں، تو کلاس روک کر پودے کی زندہ خصوصیات (بڑھنا، "
        "خوراک بنانا، تولید) دوبارہ سمجھائیں۔"
    ),
    "visual_prompts": [
        "PAGE 1 — Header banner navy on white (Urdu RTL): "
        "'RUMI · اسباق کا خاکہ · جماعت دہم · جنرل سائنس · 40 منٹ'. Small "
        "leaf-and-cat icon. Amber SLO ribbon in Urdu Nastaliq. Below: 2×2 grid "
        "of step cards (Warm-Up teal, I-Do teal, We-Do blue, You-Do blue). "
        "The I-Do card contains a small flat-vector diagram of three overlapping "
        "circles labelled پودے / جانور / خرد بین with one example inside each.",
        "PAGE 2 — Continuation of You-Do (with support + challenge pills), "
        "coral CFU ribbon in Urdu, teal Exit Ticket ribbon, cream Teacher's Corner. "
        "Bottom: small pond-ecosystem illustration + 'کل: سبق نمبر 2 — سائنس کی نوعیت' arc."
    ],
    "references": [
        "NBF جنرل سائنس (اردو) جماعت دہم، سبق نمبر 1 — موجودات زندہ کا مطالعہ، "
        "صفحہ 6-7، قومی نصاب 2022-23 کے مطابق سپلیمنٹری ریڈنگ میٹریل۔"
    ]
}


ALL_LPS = [LP_G9_MATH, LP_G9_ENGLISH, LP_G10_SCIENCE]


# ── PDF renderer (Rawalpindi v7 shape) ────────────────────────────────────────

class ColorBar(Flowable):
    """A coloured section-marker bar the width of the page."""
    def __init__(self, width, height, color):
        Flowable.__init__(self)
        self.width = width
        self.height = height
        self.color = color

    def draw(self):
        self.canv.setFillColor(self.color)
        self.canv.rect(0, 0, self.width, self.height, stroke=0, fill=1)


def make_styles(is_urdu: bool):
    body_font = URDU_FONT_NAME if is_urdu else "Helvetica"
    body_font_bold = URDU_FONT_NAME if is_urdu else "Helvetica-Bold"
    align_body = TA_RIGHT if is_urdu else TA_LEFT
    styles = {
        "title": ParagraphStyle(
            "Title", fontName="Helvetica-Bold", fontSize=17, leading=22,
            textColor=white, alignment=TA_LEFT
        ),
        "subtitle": ParagraphStyle(
            "Subtitle", fontName="Helvetica", fontSize=10, leading=13,
            textColor=white, alignment=TA_LEFT
        ),
        "slo": ParagraphStyle(
            "SLO", fontName="Helvetica-Bold", fontSize=11, leading=15,
            textColor=NAVY, alignment=TA_LEFT
        ),
        "slo_body": ParagraphStyle(
            "SLObody", fontName=body_font, fontSize=10, leading=14,
            textColor=NAVY, alignment=align_body
        ),
        "section_label": ParagraphStyle(
            "SecLabel", fontName="Helvetica-Bold", fontSize=11, leading=13,
            textColor=white, alignment=TA_LEFT
        ),
        "section_time": ParagraphStyle(
            "SecTime", fontName="Helvetica-Bold", fontSize=9, leading=11,
            textColor=white, alignment=TA_RIGHT
        ),
        "step_body": ParagraphStyle(
            "StepBody",
            fontName=body_font,
            fontSize=11 if is_urdu else 9.5,
            leading=22 if is_urdu else 13,
            textColor=NAVY,
            alignment=align_body,
        ),
        "step_body_bold": ParagraphStyle(
            "StepBodyB",
            fontName=body_font_bold,
            fontSize=11 if is_urdu else 9.5,
            leading=22 if is_urdu else 13,
            textColor=NAVY,
            alignment=align_body,
        ),
        "meta": ParagraphStyle(
            "Meta", fontName="Helvetica", fontSize=8.5, leading=11,
            textColor=GREY, alignment=TA_LEFT
        ),
        "callout_label": ParagraphStyle(
            "CalloutLabel", fontName="Helvetica-Bold", fontSize=10, leading=13,
            textColor=white, alignment=TA_LEFT
        ),
        "callout_body": ParagraphStyle(
            "CalloutBody", fontName=body_font, fontSize=9.5, leading=13,
            textColor=NAVY, alignment=align_body
        ),
        "pill_label": ParagraphStyle(
            "PillLabel", fontName="Helvetica-Bold", fontSize=9, leading=12,
            textColor=NAVY, alignment=TA_LEFT
        ),
        "pill_body": ParagraphStyle(
            "PillBody", fontName=body_font, fontSize=9, leading=12,
            textColor=NAVY, alignment=align_body
        ),
        "ref": ParagraphStyle(
            "Ref", fontName="Helvetica-Oblique", fontSize=8, leading=11,
            textColor=GREY, alignment=TA_LEFT
        ),
    }
    return styles


def para(text: str, style: ParagraphStyle, is_urdu: bool = False) -> Paragraph:
    """Wrap text in a Paragraph, shaping Urdu if needed. Handles multi-line.

    Unicode safety (bd-2045):
      - is_urdu=True → reshape+bidi each line, use the Urdu-registered font.
      - is_urdu=False → sanitize exotic glyphs (↔/→/×/₂/etc.) to ASCII, then
        segment any inline Arabic runs into <font name=URDU_FONT> spans so
        they don't render as black boxes.
    """
    if not text:
        text = ""
    if is_urdu:
        # For Urdu-primary paragraphs, use the mixed script helper so any
        # inline English (parentheticals, dictionary glosses, section labels)
        # gets font-swapped to Helvetica instead of rendering as black boxes.
        lines = [render_urdu_with_latin(l) if l.strip() else l for l in text.split("\n")]
        text = "<br/>".join(lines).replace("  ", "&nbsp;&nbsp;")
    else:
        # Latin-primary body: split into lines, then per-line rewrite so any
        # Arabic runs get font-swapped. Order matters: split on \n FIRST (so
        # <br/> tags aren't accidentally created inside a <font> span).
        lines = [render_mixed_script(l) for l in text.split("\n")]
        text = "<br/>".join(lines).replace("  ", "&nbsp;&nbsp;")
    return Paragraph(text, style)


def header_block(lp: dict, styles: dict, page_width: float):
    """Return a table representing the navy header banner."""
    is_urdu = lp["language"] == "Urdu"
    title = f"RUMI · Lesson Plan"
    meta_right = f"{lp['grade']}  ·  {lp['subject'].split(' — ')[0]}  ·  {lp['duration_min']} min"
    # Chapter title: for Urdu, split into (urdu part) + (english gloss in parens)
    chapter = lp["chapter"]
    if is_urdu and "(" in chapter:
        urdu_part, gloss = chapter.split("(", 1)
        chapter_urdu_p = Paragraph(render_urdu_with_latin(urdu_part.strip()),
                                   ParagraphStyle("HeaderUrdu",
                                                  fontName=URDU_FONT_NAME, fontSize=11,
                                                  leading=15, textColor=white, alignment=TA_RIGHT))
        chapter_en_p = Paragraph(f"({gloss.strip()}",
                                 ParagraphStyle("HeaderEn",
                                                fontName="Helvetica", fontSize=8.5,
                                                leading=11, textColor=white, alignment=TA_LEFT))
        chapter_cell = Table([[chapter_urdu_p], [chapter_en_p]], colWidths=[page_width * 0.55])
        chapter_cell.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
    else:
        chapter_cell = Paragraph(chapter, styles["subtitle"])
    inner = Table(
        [
            [Paragraph(title, styles["title"]),
             Paragraph(meta_right, styles["subtitle"])],
            [chapter_cell, Paragraph(lp["source_pages"], styles["subtitle"])],
        ],
        colWidths=[page_width * 0.55, page_width * 0.45],
    )
    inner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
    ]))
    return inner


def slo_ribbon(lp: dict, styles: dict, page_width: float, is_urdu: bool):
    label = para("<b>TODAY'S AIM · SLO</b>", styles["slo"])
    body = para(lp["slo"], styles["slo_body"], is_urdu=is_urdu)
    t = Table([[label], [body]], colWidths=[page_width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), AMBER),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEABOVE", (0, 0), (-1, 0), 0.6, NAVY),
        ("LINEBELOW", (0, -1), (-1, -1), 0.6, NAVY),
    ]))
    return t


def step_card(label: str, time_min: int, color, body_paragraphs: list,
              col_width: float, styles: dict):
    """One step-card (I-Do / We-Do / You-Do etc.). Returns a Table."""
    header_row = Table(
        [[Paragraph(f"<b>{label}</b>", styles["section_label"]),
          Paragraph(f"{time_min} MIN", styles["section_time"])]],
        colWidths=[col_width * 0.65, col_width * 0.35],
    )
    header_row.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), color),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    body_rows = [[p] for p in body_paragraphs]
    body_tbl = Table(body_rows, colWidths=[col_width])
    body_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), white),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    combined = Table([[header_row], [body_tbl]], colWidths=[col_width])
    combined.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, GREY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return combined


def ribbon(label: str, body: str, color, styles: dict, page_width: float,
           is_urdu: bool = False, body_style_key="callout_body"):
    """A full-width coloured ribbon (used for CFU, Exit Ticket etc.)."""
    label_p = Paragraph(f"<b>{label}</b>", styles["callout_label"])
    body_p = para(body, styles[body_style_key], is_urdu=is_urdu)
    t = Table([[label_p, body_p]], colWidths=[page_width * 0.22, page_width * 0.78])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), color),
        ("BACKGROUND", (1, 0), (1, 0), HexColor("#FFF7ED") if color == CORAL else HexColor("#ECFDF5")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t


def cream_callout(label: str, body: str, styles: dict, page_width: float,
                  is_urdu: bool = False):
    label_p = Paragraph(f"<b>{label}</b>", styles["slo"])
    body_p = para(body, styles["callout_body"], is_urdu=is_urdu)
    t = Table([[label_p], [body_p]], colWidths=[page_width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CREAM),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("BOX", (0, 0), (-1, -1), 0.4, AMBER),
    ]))
    return t


def build_step_body_paragraphs(step_dict: dict, styles: dict, is_urdu: bool):
    """Turn one of the phase dicts (i_do/we_do/you_do) into a list of Paragraphs."""
    ps = []
    if "teacher_says" in step_dict:
        ps.append(para("<b>Teacher says:</b>", styles["step_body_bold"]))
        ps.append(para(step_dict["teacher_says"], styles["step_body"], is_urdu=is_urdu))
    if "modelling_steps" in step_dict:
        ps.append(para("<b>Modelling steps:</b>", styles["step_body_bold"]))
        for s in step_dict["modelling_steps"]:
            ps.append(para(f"• {s}", styles["step_body"], is_urdu=is_urdu))
    if "board_work" in step_dict:
        ps.append(para("<b>Board work:</b>", styles["step_body_bold"]))
        ps.append(para(step_dict["board_work"], styles["step_body"], is_urdu=is_urdu))
    if "activity" in step_dict:
        ps.append(para("<b>Activity:</b>", styles["step_body_bold"]))
        ps.append(para(step_dict["activity"], styles["step_body"], is_urdu=is_urdu))
    if "joint_practice" in step_dict:
        ps.append(para("<b>Joint practice (P6):</b>", styles["step_body_bold"]))
        ps.append(para(step_dict["joint_practice"], styles["step_body"], is_urdu=is_urdu))
    if "cfu_embedded" in step_dict:
        ps.append(para("<b>CFU:</b>", styles["step_body_bold"]))
        ps.append(para(step_dict["cfu_embedded"], styles["step_body"], is_urdu=is_urdu))
    if "multi_sensory_beat" in step_dict:
        ps.append(para("<b>Multi-sensory beat (P17):</b>", styles["step_body_bold"]))
        ps.append(para(step_dict["multi_sensory_beat"], styles["step_body"], is_urdu=is_urdu))
    if "expected_answers" in step_dict:
        ps.append(para("<b>Expected answers:</b>", styles["step_body_bold"]))
        for s in step_dict["expected_answers"]:
            ps.append(para(f"✓ {s}", styles["step_body"], is_urdu=is_urdu))
    if "support_scaffold" in step_dict:
        ps.append(para("<b>Support:</b>", styles["step_body_bold"]))
        ps.append(para(step_dict["support_scaffold"], styles["step_body"], is_urdu=is_urdu))
    if "challenge_extension" in step_dict:
        ps.append(para("<b>Challenge:</b>", styles["step_body_bold"]))
        ps.append(para(step_dict["challenge_extension"], styles["step_body"], is_urdu=is_urdu))
    return ps


def render_lp_pdf(lp: dict, out_path: Path):
    is_urdu = (lp["language"] == "Urdu")
    styles = make_styles(is_urdu)

    doc = SimpleDocTemplate(
        str(out_path),
        pagesize=A4,
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=1.2 * cm, bottomMargin=1.2 * cm,
        title=f"Rumi LP · {lp['grade']} · {lp['subject']} · {lp['chapter']}",
        author="Rumi (NIETE-Rumi)",
    )
    page_width = A4[0] - 3 * cm
    story = []

    # HEADER
    story.append(header_block(lp, styles, page_width))
    story.append(Spacer(1, 4))

    # SLO ribbon
    story.append(slo_ribbon(lp, styles, page_width, is_urdu))
    story.append(Spacer(1, 4))

    # Metadata strip (materials + Bloom + key words)
    kw = ", ".join(lp["key_words"][:6])
    kw_rendered = render_urdu_with_latin(kw) if is_urdu else render_mixed_script(kw)
    meta_lines = [
        render_mixed_script(
            f"Source: {lp['chapter']} · {lp['source_pages']}    "
            f"|    Duration: {lp['duration_min']} min    |    Bloom: {lp['slo_bloom']}"
        ),
        f"Key words: {kw_rendered}",
    ]
    for line in meta_lines:
        story.append(Paragraph(line, styles["meta"]))
    story.append(Spacer(1, 6))

    # Hook + Warm-up (full-width teal card)
    hook_body = [
        para("<b>Hook (real-world opening):</b>", styles["step_body_bold"]),
        para(lp["hook_real_world"], styles["step_body"], is_urdu=is_urdu),
        Spacer(1, 3),
        para("<b>Warm-up review:</b>", styles["step_body_bold"]),
        para(lp["warmup_review"], styles["step_body"], is_urdu=is_urdu),
    ]
    story.append(step_card("Warm-Up / Hook", 5, TEAL, hook_body, page_width, styles))
    story.append(Spacer(1, 4))

    # I-Do card
    idoc_body = build_step_body_paragraphs(lp["i_do"], styles, is_urdu)
    story.append(step_card("I Do — Teacher Models", lp["i_do"]["duration_min"], TEAL, idoc_body, page_width, styles))
    story.append(Spacer(1, 4))

    # We-Do card
    wedoc_body = build_step_body_paragraphs(lp["we_do"], styles, is_urdu)
    story.append(step_card("We Do — Joint Practice", lp["we_do"]["duration_min"], BLUE, wedoc_body, page_width, styles))
    story.append(Spacer(1, 4))

    # PAGE BREAK — page 2
    story.append(PageBreak())

    # HEADER (again) on page 2 for continuity
    story.append(header_block(lp, styles, page_width))
    story.append(Spacer(1, 4))

    # You-Do card
    youdoc_body = build_step_body_paragraphs(lp["you_do"], styles, is_urdu)
    story.append(step_card("You Do — Independent Practice", lp["you_do"]["duration_min"], BLUE, youdoc_body, page_width, styles))
    story.append(Spacer(1, 6))

    # Exit Ticket ribbon
    et = lp["exit_ticket"]
    et_body = (
        f"<b>Prompt:</b> {et['prompt']}<br/><br/>"
        f"<b>Expected answer:</b> {et['expected_answer']}<br/><br/>"
        f"<b>Success criterion:</b> {et['success_criterion']}"
    )
    story.append(ribbon(
        f"Exit Ticket · {et['duration_min']} min",
        et_body, TEAL, styles, page_width, is_urdu=is_urdu
    ))
    story.append(Spacer(1, 6))

    # Closing beat + Next-topic preview (side by side)
    closing_p = para(f"<b>Closing beat:</b> {lp['closing_beat']}", styles["callout_body"], is_urdu=is_urdu)
    next_p = para(f"<b>Tomorrow:</b> {lp['next_topic_preview']}", styles["callout_body"], is_urdu=is_urdu)
    story.append(Table(
        [[closing_p, next_p]],
        colWidths=[page_width * 0.5, page_width * 0.5],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (0, 0), HexColor("#ECFDF5")),
            ("BACKGROUND", (1, 0), (1, 0), HexColor("#EFF6FF")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ])
    ))
    story.append(Spacer(1, 4))

    # Teacher's Corner (cream callout)
    story.append(cream_callout("Teacher's Corner — common mistake to watch",
                               lp["teacher_corner"], styles, page_width, is_urdu=is_urdu))
    story.append(Spacer(1, 4))

    # Materials + References
    materials_text = " · ".join(lp["materials"])
    materials_rendered = (
        render_urdu_with_latin(materials_text) if is_urdu
        else render_mixed_script(materials_text)
    )
    story.append(Paragraph(f"<b>Materials:</b> {materials_rendered}", styles["meta"]))
    story.append(Spacer(1, 3))
    for ref in lp["references"]:
        ref_rendered = (
            render_urdu_with_latin(ref) if is_urdu
            else render_mixed_script(ref)
        )
        story.append(Paragraph(f"Ref: {ref_rendered}", styles["ref"]))
    story.append(Spacer(1, 4))

    doc.build(story)


# ── R2 upload ─────────────────────────────────────────────────────────────────
def _load_env():
    """Load env vars from NIETE-Rumi/.env (preferred) or fall back to root bot env."""
    env = {}
    candidates = [
        ROOT / "NIETE-Rumi" / ".env",
        ROOT / "02_Main Rumi Bot" / ".env",
    ]
    for p in candidates:
        if p.exists():
            for line in p.read_text().splitlines():
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env.setdefault(k.strip(), v.strip().strip('"'))
    return env


def upload_to_r2(local_path: Path, key: str, filename: str = None) -> str:
    """Upload a PDF to R2 and return a 7-day presigned URL.

    Sets Content-Type: application/pdf and Content-Disposition: inline;
    filename="…" so the browser previews the file instead of downloading it.
    7-day TTL is Cloudflare R2's maximum ExpiresIn for pre-signed URLs.
    """
    import boto3
    from botocore.client import Config

    env = _load_env()
    if not filename:
        filename = local_path.name

    s3 = boto3.client(
        "s3",
        endpoint_url=env["R2_ENDPOINT"],
        aws_access_key_id=env["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    bucket = env["R2_BUCKET_NAME"]
    s3.upload_file(
        str(local_path),
        bucket,
        key,
        ExtraArgs={
            "ContentType": "application/pdf",
            "ContentDisposition": f'inline; filename="{filename}"',
        },
    )
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=60 * 60 * 24 * 7,  # 7 days — R2's max
    )
    return url


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    results = []
    for lp in ALL_LPS:
        pdf_path = OUT_DIR / f"{lp['slug']}.pdf"
        json_path = OUT_DIR / f"{lp['slug']}.enrichment.json"

        # Write enrichment JSON (Stage C output — auditable)
        json_path.write_text(json.dumps(lp, ensure_ascii=False, indent=2), encoding="utf-8")

        # Render PDF (Stage D — Rawalpindi v7 shape)
        print(f"[render] {lp['slug']} → {pdf_path}", flush=True)
        render_lp_pdf(lp, pdf_path)
        print(f"  ✓ PDF written ({pdf_path.stat().st_size} bytes)")

        # Upload to R2 (round-2 prefix — post-guardrail regeneration)
        r2_prefix = os.environ.get("R2_PREFIX", "nbf_samples/round2")
        r2_key = f"{r2_prefix}/{lp['slug']}.pdf"
        pretty_filename = f"Rumi_LP_{lp['slug']}.pdf"
        url = upload_to_r2(pdf_path, r2_key, filename=pretty_filename)
        print(f"  ✓ R2 uploaded — {url[:100]}...")

        results.append({
            "slug": lp["slug"],
            "grade": lp["grade"],
            "subject": lp["subject"],
            "chapter": lp["chapter"],
            "slo": lp["slo"][:200] + ("..." if len(lp["slo"]) > 200 else ""),
            "pdf_path": str(pdf_path),
            "r2_url": url,
            "enrichment_json_path": str(json_path),
        })

    out_summary = OUT_DIR / "SUMMARY.json"
    out_summary.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY written: {out_summary}")
    for r in results:
        print(f"  {r['slug']} → {r['r2_url'][:120]}")


if __name__ == "__main__":
    main()
