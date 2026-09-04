# LP-AUTHOR BRIEF v3 — **FLASH TIER**

> **This is the v3 brief with a longer run-up.** The contract, the schema, the gates and the
> definition of done are IDENTICAL to the standard tier — the whole v3 brief is reproduced below,
> unchanged, and it is the authority. What sits above it is the same information in a more
> copyable form: the shapes that get broken most often, a complete worked document to pattern-match
> against, and each section's word budget written where you are actually writing that section.
>
> Nothing here relaxes a rule. If anything above seems to disagree with the brief below, the brief
> below wins.

---

## F1 · THE EIGHT SHAPES THAT FAIL MOST — read these before you write anything

These eight accounted for nearly every mechanical rejection across twenty-seven documents. They
are not subtle rules; they are keys in the wrong place, or one habit applied where it does not
belong. Get them right and the rest is writing.

**① A `diagram` block has EXACTLY three keys: `type`, `id`, `spec`.**
Everything else — title, caption, steps, panels, rows — lives INSIDE `spec`.

```json
{"type": "diagram", "id": "dg-free-body",
 "spec": {"type": "free_body", "title": "Forces on the falling ball",
          "caption": "Only weight acts once air resistance is ignored."}}
```

✗ `{"type": "diagram", "caption": "…", "spec": {…}}` — caption OUTSIDE spec. Move it in.
✗ `{"type": "diagram", "title": "…", "spec": {…}}` — title OUTSIDE spec. Move it in.
✗ `{"type": "diagram", "diagram": {…}}` — the payload key is `spec`, never `diagram`.
✗ a `spec` whose inner `type` is null, missing or invented.

**② A `textbook_figure` is FLAT — no nested `spec`, no nested anything.**

```json
{"type": "textbook_figure", "id": "fig-2-4", "ref": "…/p049/fig_2_4_drop",
 "src": "…/fig_2_4_drop.jpg", "page": "49", "caption": "…",
 "legend": [{"label": "v", "means": "speed at impact"}]}
```

**③ The exit ticket holds AT MOST TWO items.** A third graded recall question goes in the you-do
with a `P` ref. The schema hard-rejects a third `X`.

**④ `video` is DEVELOPMENT-ONLY, and it is an OBJECT or it is ABSENT.** Never `"video": null`.
If you have no link, omit the key entirely.

```json
"video": {"url": "https://…", "title": "…", "channel": "…", "duration": "4:12", "why": "…"}
```

**⑤+⑥ SUBJECT-SPECIFIC RULES ARE IN §F5 BELOW.** Your lesson's family — maths/physics,
science, or language/prose — has its own short section there carrying only the rules that
family actually fails in practice. It is short because it is targeted; read it in full.

**⑦ A diagram SPEC TYPE IS NOT A BLOCK TYPE.** `flow`, `mindmap`, `cycle`, `grid`, `geometry`,
`free_body`, `panels`, `timeline`, `graph`, `atom`, `molecule`, `punnett`, `circuit`,
`ray_diagram`, `numberline`, `fraction_bar`, `chem_equation`, `cell`, `labelled_figure` are all
**spec** types. They go INSIDE a diagram block.

✗ `{"type": "flow", "steps": [...]}` — `flow` is not a block.
✓ `{"type": "diagram", "id": "dg-1", "spec": {"type": "flow", "steps": [...]}}`

The ONLY legal block types are: `paragraph` · `ask` · `watch_out` · `board` · `keywords` ·
`key_points` · `worked_example` · `faded_example` · `practice` · `support_extension` · `split` ·
`diagram` · `textbook_figure` · `latex` · `chem`.

**⑧ `slo_code` in a HOMEWORK item is a NON-EMPTY STRING — never `null`.** The schema requires it.
When the book prints no SLO codes at all, tag the item with the **objective ordinal** it tests —
`"O1"`, `"O2"` — never `null`, never an invented board code.

✗ `{"ref": "H1", "slo_code": null, …}`  ✓ `{"ref": "H1", "slo_code": "O1", …}`

(An *objective's* own `slo_code` may be `null` when the book prints none. Homework may not. They
are different rules and this is the one that catches people.)

---

## F2 · SECTION SKELETONS — the budget, where you are writing

Fill these slots in this order. **The word count in each slot is the aim, not the ceiling.**

> ## CONCISE BEATS COMPLETE
>
> **A teacher reads this on a phone, standing up, minutes before the bell.** She does not finish a
> long plan — she cuts its tail. So a shorter plan is not a compromised plan: **it is the one that
> gets taught.** Every word you add to a section is a word she is more likely to skip in the
> section after it.
>
> The aims below are **deliberately below** the standard-tier aims, for two reasons. First, every
> model measured overshoots its own target by 15–40%, so aiming low is how you land right. Second,
> and more important: **the operator's standing instruction is "the shorter the better."** The two
> places this was worst were the **outcome/SLO box** at the top (it was eating page 1) and
> **homework** (too many questions) — both are cut hard below.
>
> **Under-aim is not a failure.** Short sections only ever produce a warning. **Over-aim costs a
> revision round.** When you are unsure, write less.
>
> **What "shorter" must NEVER mean:** dropping a required element, compressing two ideas into one
> dense sentence, cutting an answer, or shrinking the body type. Keep every structural slot in the
> table below — the warm-up row, the I-do, the timed we-do and you-do, the mark scheme, the exit
> ticket, the re-teach threshold. **Cut words and examples, never structure.** One clean worked
> example beats three hurried ones.

| # | Section `id` | aim ~words | [hard] | The slots inside it — ALL of these stay |
|---|---|---|---|---|
| 1 | `A` Introduction | **aim ~90** | [170] | warm-up row (scaffold → prerequisite → spaced) · the hook · vocabulary pre-teach *with its page* · watch-out · board line |
| 2 | `B` Development | **aim ~135** | [243] | key points · the I-do worked example · the textbook page citation · the video line · the misconception · **closes the hook, `closes_hook: true`, in the FIRST block** |
| 3 | `C` Activity | **aim ~165** | [287] | the timed we-do (`faded_example`), THEN the timed you-do (`practice`) — every item carries its answer |
| 4 | `D` Conclusion | **aim ~85** | [166] | the board question **and its mark scheme** · the exit ticket (**≤2**) · the re-teach rule *with a threshold* |
| 5 | `E` Homework | **aim ~55** | [124] | **3 tagged items** (cap 5), ≥50% MCQ, today's content only, **no answers on the page** |
| — | **whole document** | **aim 800–900** | [800–1,200] | the measured five-page capacity at the 18px body floor |
| — | `one_screen` | **aim 180–210** | [**hard floor 150**] | not counted in the document total — this one must NOT be shortened past 150 |

**HOMEWORK: SET THREE ITEMS, NOT FIVE.** The cap is 5 and the aim is **3**. Homework is the tail a
teacher cuts first, and a pupil who does three tagged questions properly has learned more than one
who skips six. Three items, each tagged `[SLO, K/U/A]`, at least half MCQ, every one worked in full
in the reference block.

**THE OUTCOME BOX IS THE FIRST THING PRINTED, AND IT WAS THE WORST OFFENDER.** It was running
70–120 words and eating the top of page 1. Aim for **≤60 words for the whole box** — the ceiling is
80, but 60 is the target and 52 is comfortably achievable:

| Field | aim ~words | hard |
|---|---|---|
| `outcome` — the ONE thing the pupil can do | ~13 | **20** |
| `by_the_end` | ~16 | **22** |
| **each** objective | ~11 | **15** |
| **the whole box added up** | **~52 (never over 60)** | **80** |

Write the outcome as ONE clause. An objective needing a subordinate clause is two objectives —
split it or drop one. **Two objectives is the norm; three is usually one too many.** `OUTCOME_BOX`
is a hard gate, not a ±30% budget.

**Three counted bars, so hit them on the first pass:**
- **SEVEN graded items with answers** (bar is 6–8). You-do items and exit-ticket items count
  *together* — spread them across both, do not stack them in one block.
- **At least 2 MCQs** in `exam_bank.mcq` (aim 2–3), each with **one distractor code per wrong
  option**. One MCQ is a hard fail at grades 9–12.
- **Minutes sum to `period_minutes` exactly**, and `homework.minutes ≥ 1`.

---

## F3 · A COMPLETE WORKED EXAMPLE — a real document that passes every gate

Below is `PK_G9_PHYS_CH2_MOTION_UNDER_GRAVITY`, a genuine lp_doc that returns **zero errors** from
`node lint_lp.js` and renders clean. It is a Grade 9 Physics lesson on motion under gravity.

**Copy its SHAPE. Never copy its CONTENT.** Your lesson is a different subject, a different grade
and a different book. What you are reading it for is: which keys exist, how deep they nest, how a
`diagram` spec is written, where `ref`s go, how answers are attached to questions, how long each
section actually is when it fits the page, and what a finished `one_screen` looks like.

```json
{
 "lesson_id": "PK_G9_PHYS_CH2_MOTION_UNDER_GRAVITY",
 "schema_version": "3.0",
 "notes": {
  "supplied": [
   "supplied: a 20 kg re-solve of Example 2.5's own numbers for the We-Do — the book only prints the 2 kg case (see p.49)"
  ],
  "defects": [
   "Example 2.5 (p.49) gives the block's mass as 2 kg but the worked solution never uses it — used here as the lesson's central teaching point rather than corrected silently"
  ],
  "gaps": [
   "the chapter prints no numbered exercise for §2.5 on p.48-49, so today's practice and homework items are teacher-authored applications of the same method rather than cited exercise numbers",
   "Figure 2.11's vacuum-pump mechanism is not explained beyond its printed labels on p.49; the removal of air is inferred from the labelled parts"
  ]
 },
 "needs_human_review": false,
 "human_review_reason": null,
 "slo": {
  "code": "P-09-B-10",
  "text_verbatim": "Use the approximate value 9.8m/s2 for free fall acceleration near Earth to solve problems.",
  "source_page": "35",
  "cognitive_level": "A",
  "assessment_status": "Summative",
  "command_word": "calculate"
 },
 "lp_type": "STEM-1",
 "period_minutes": 40,
 "board_weight": "FBISE SSC-I · ~3 marks",
 "materials": [
  "board marker",
  "textbook p.48-49",
  "a coin and a sheet of paper (for the Figure 2.11 demonstration)"
 ],
 "sequence": {
  "previous": "Speed, velocity and acceleration (earlier in Ch. 2)",
  "this": "Motion due to gravity — g is the same for every freely falling body (§2.5, p.48-49)",
  "next": "2.6 Graphical analysis of motion — distance-time and speed-time graphs (p.49 onward)",
  "checkpoint": "Ch. 2 Kinematics assessment"
 },
 "objectives": {
  "outcome": "You can explain why g is equal for all falling masses and calculate fall time.",
  "by_the_end": "By the end you can answer a 3-mark question on the time a dropped object takes to reach a given speed.",
  "items": [
   {
    "text": "State that all freely falling bodies have the same acceleration g, regardless of mass.",
    "slo_code": "P-09-B-10"
   },
   {
    "text": "Calculate the time for an object dropped from rest to reach a stated speed.",
    "slo_code": "P-09-B-10"
   }
  ]
 },
 "sections": [
  {
   "id": "introduction",
   "minutes": 10,
   "warmup": {
    "items": [
     {
      "ref": "W1",
      "kind": "scaffold",
      "q": "Work out $y$ if $y=(a-b)/c$, $a=20$, $b=4$, $c=4$.",
      "a": "$y=4$."
     },
     {
      "ref": "W2",
      "kind": "prerequisite",
      "q": "State the formula linking acceleration, initial speed, final speed and time.",
      "a": "$a=(v_f-v_i)/\\Delta t$."
     },
     {
      "ref": "W3",
      "kind": "spaced",
      "q": "State one difference between speed and velocity.",
      "a": "Velocity also states direction; speed does not.",
      "from": "earlier in Ch. 2"
     }
    ]
   },
   "blocks": [
    {
     "type": "ask",
     "id": "hook",
     "hook": true,
     "closed_by": "close-hook",
     "question": "You drop a tennis ball and a large stone from the school roof together. Which lands first, and why?",
     "look_for": "Most guess the stone; both land together — g does not depend on mass."
    },
    {
     "type": "keywords",
     "page": "48",
     "items": [
      {
       "word": "acceleration due to gravity ($g$)",
       "meaning": "downward acceleration of a falling object, about $9.8\\,\\text{m/s}^2$"
      },
      {
       "word": "free fall",
       "meaning": "falling under gravity alone, air resistance ignored"
      }
     ]
    },
    {
     "type": "watch_out",
     "text": "Hold that guess — most predict the heavier stone falls faster."
    },
    {
     "type": "board",
     "text": "$g = 9.8\\,\\text{m/s}^2$ for every mass."
    }
   ]
  },
  {
   "id": "development",
   "minutes": 12,
   "textbook_page": "48-49",
   "blocks": [
    {
     "type": "paragraph",
     "id": "close-hook",
     "closes_hook": true,
     "text": "Both land together, at the same instant. Example 2.5 (p.49) proves it — the solution never uses the block's mass, since $g$ is mass-independent."
    },
    {
     "type": "key_points",
     "items": [
      "All falling objects share acceleration $g$ (p.48).",
      "Near Earth's surface, $g \\approx 9.8\\,\\text{m/s}^2$ (p.48).",
      "Falling: $g$ positive; thrown up: $g$ negative (p.49).",
      "Coin beats paper in air from air resistance, not mass (p.48).",
      "Air removed: coin, paper fall together (Fig. 2.11b, p.49)."
     ]
    },
    {
     "type": "diagram",
     "id": "dg-freebody-block",
     "spec": {
      "type": "free_body",
      "title": "FORCES ON THE BLOCK",
      "body": {
       "shape": "box",
       "label": "Block, m = 2 kg",
       "mass": "2 kg"
      },
      "forces": [
       {
        "name": "W",
        "label": "weight (only force)",
        "angle": 270,
        "magnitude": 80,
        "color": "var(--warn)"
       },
       {
        "name": "R",
        "label": "air resistance — ignored",
        "angle": 90,
        "magnitude": 15,
        "color": "var(--mut)"
       }
      ],
      "caption": "Weight alone acts here, so acceleration is g whatever the mass."
     }
    },
    {
     "type": "latex",
     "id": "lx-g-formula",
     "tex": "v_f = v_i + g\\Delta t \\quad\\Rightarrow\\quad \\Delta t = \\dfrac{v_f-v_i}{g}",
     "caption": "$v_f$ = final speed, $v_i$ = initial, $g = 9.8\\,\\text{m/s}^2$, $\\Delta t$ = time. Ex 2.5: $\\Delta t = 8$ s."
    },
    {
     "type": "worked_example",
     "id": "ido",
     "title": "I do — Ex. 2.5, p.49",
     "prompt": "A 2 kg block dropped from rest hits the ground at $78.5$ m/s. Find the time (ignore air resistance).",
     "steps": [
      "$g=(v_f-v_i)/\\Delta t$, so $\\Delta t=(v_f-v_i)/g$",
      "$v_i=0$, $v_f=78.5$ m/s, $g=9.8\\,\\text{m/s}^2$",
      "$\\Delta t=(78.5-0)/9.8$"
     ],
     "result": "$\\Delta t = 8$ s"
    },
    {
     "type": "watch_out",
     "misconception": true,
     "text": "The solution never uses the 2 kg mass — that's the point: $g$ is mass-independent, so a heavier block takes the same time."
    }
   ]
  },
  {
   "id": "activity",
   "minutes": 12,
   "blocks": [
    {
     "type": "faded_example",
     "id": "wedo",
     "minutes": 5,
     "title": "We do — on the board",
     "prompt": "A 20 kg block, dropped from rest, strikes the ground at $78.5$ m/s. Find the time taken.",
     "steps": [
      "$g=(v_f-v_i)/\\Delta t$, so $\\Delta t=(v_f-v_i)/g$",
      "$v_i=0$, $v_f=78.5$ m/s, $g=9.8\\,\\text{m/s}^2$",
      "$\\Delta t=(78.5-0)/9.8$ — complete this line"
     ],
     "answer": "$\\Delta t=8$ s — same as the 2 kg block; mass cancels out."
    },
    {
     "type": "practice",
     "id": "youdo",
     "mode": "independent",
     "minutes": 7,
     "cite": "adapted from Ex. 2.5, p.49",
     "items": [
      {
       "ref": "P1",
       "tier": "support",
       "level": "K",
       "q": "State $g$'s value near Earth and whether it depends on mass.",
       "a": "$g\\approx 9.8\\,\\text{m/s}^2$; mass-independent."
      },
      {
       "ref": "P2",
       "tier": "core",
       "level": "A",
       "q": "A stone dropped from rest strikes the ground at $49$ m/s. Find the time taken.",
       "a": "$\\Delta t=(49-0)/9.8=5$ s."
      },
      {
       "ref": "P3",
       "tier": "core",
       "level": "A",
       "q": "A mango dropped from rest strikes the ground at $9.8$ m/s. Find the time.",
       "a": "$\\Delta t=(9.8-0)/9.8=1$ s."
      },
      {
       "ref": "P4",
       "tier": "extension",
       "level": "A",
       "q": "A 10 kg stone and a 1 kg stone are dropped together. State whether the heavier lands first, or together, and why.",
       "a": "Together — $g$ is mass-independent, so both accelerate identically."
      }
     ]
    }
   ]
  },
  {
   "id": "conclusion",
   "minutes": 4,
   "checkpoint": {
    "ref": "C1",
    "marks": 3,
    "question": "A $0.06$ kg ball dropped from rest strikes at $19.6$ m/s. Find the time, and state it if mass doubles.",
    "mark_scheme": [
     "1 mark: formula $\\Delta t=(v_f-v_i)/g$",
     "1 mark: arithmetic, $\\Delta t=2$ s",
     "1 mark: time unchanged if mass doubles"
    ]
   },
   "exit_ticket": [
    {
     "ref": "X1",
     "q": "True or false: a heavier object falls faster when air resistance is ignored?",
     "a": "False — $g$ is the same for every mass."
    },
    {
     "ref": "X2",
     "q": "A ball dropped from rest reaches $29.4$ m/s. Find the time.",
     "a": "$\\Delta t=(29.4-0)/9.8=3$ s."
    }
   ],
   "reteach_rule": "If a third of the class still say heavier falls faster, redo the We-Do before §2.6.",
   "blocks": [
    {
     "type": "board",
     "text": "$g=9.8\\,\\text{m/s}^2$, same for every mass. $\\Delta t=(v_f-v_i)/g$."
    }
   ]
  },
  {
   "id": "homework",
   "minutes": 2,
   "homework": {
    "items": [
     {
      "ref": "H1",
      "format": "mcq",
      "level": "K",
      "slo_code": "P-09-B-10",
      "marks": 1,
      "text": "Which best describes $g$ for free fall? (A) depends on mass (B) same for all, ~$9.8\\,\\text{m/s}^2$ (C) zero for light objects (D) increases with mass"
     },
     {
      "ref": "H2",
      "format": "mcq",
      "level": "U",
      "slo_code": "P-09-B-10",
      "marks": 1,
      "text": "A coin and paper drop in a sealed tube with air removed. What happens? (A) coin first (B) paper first (C) both together (D) neither falls"
     },
     {
      "ref": "H3",
      "format": "short",
      "level": "A",
      "slo_code": "P-09-B-10",
      "marks": 3,
      "text": "A ball dropped from rest strikes the ground at $39.2$ m/s. Calculate the time (ignore air resistance)."
     },
     {
      "ref": "H4",
      "format": "short",
      "level": "U",
      "slo_code": "P-09-B-10",
      "marks": 2,
      "text": "Explain briefly why a stone and feather fall differently in air, though $g$ is equal."
     }
    ]
   },
   "blocks": [
    {
     "type": "key_points",
     "title": "",
     "items": [
      "Answers are checked at the start of the next period."
     ]
    }
   ]
  }
 ],
 "page2": {
  "board_final": {
   "draw_order": [
    "g = 9.8 m/s² — same for every mass",
    "$v_f = v_i + g\\Delta t \\Rightarrow \\Delta t = (v_f-v_i)/g$",
    "2 kg: Δt = 8 s",
    "20 kg: Δt = 8 s (mass cancels)",
    "v–t graph: line through origin, slope = g"
   ],
   "diagram": {
    "type": "graph",
    "title": "SPEED–TIME: FREE FALL",
    "xMin": 0,
    "xMax": 10,
    "yMin": 0,
    "yMax": 100,
    "xStep": 1,
    "yStep": 20,
    "functions": [
     {
      "expr": "9.8*x",
      "label": "v = gt",
      "color": "var(--navy)"
     }
    ],
    "points": [
     {
      "x": 8,
      "y": 78.4,
      "label": "(8 s, 78.5 m/s)",
      "color": "var(--warn)",
      "dx": -40,
      "dy": -10
     }
    ],
    "caption": "A straight line through the origin; slope = g for any mass."
   }
  },
  "model_answers": [
   {
    "ref": "P1",
    "answer": "$g\\approx 9.8\\,\\text{m/s}^2$; mass-independent."
   },
   {
    "ref": "P2",
    "answer": "$\\Delta t=(49-0)/9.8=5$ s.",
    "marking_note": "Needs the formula and substitution shown, not just the number."
   },
   {
    "ref": "P3",
    "answer": "$\\Delta t=(9.8-0)/9.8=1$ s."
   },
   {
    "ref": "P4",
    "answer": "Together — $g$ is mass-independent, so both accelerate identically."
   },
   {
    "ref": "C1",
    "answer": "$\\Delta t=(19.6-0)/9.8=2$ s; time is unchanged if mass doubles, since $g$ is mass-independent."
   },
   {
    "ref": "X1",
    "answer": "False — $g$ is the same for every mass."
   },
   {
    "ref": "X2",
    "answer": "$\\Delta t=(29.4-0)/9.8=3$ s."
   }
  ],
  "mistakes": [
   {
    "pupil_says": "The heavier stone hits first — it weighs more.",
    "you_ask": "Which line used the 2 kg mass?"
   },
   {
    "pupil_says": "The paper falls slower — less gravity acts on it.",
    "you_ask": "Is it gravity that differs, or the air?"
   },
   {
    "pupil_says": "$\\Delta t = (78.5 - 0) \\times 9.8$",
    "you_ask": "Check your rearrangement — what happens to the units?"
   }
  ],
  "differentiation": {
   "stuck": "Give $\\Delta t = (v_f - v_i)/g$ pre-written on a card; the pupil only substitutes numbers.",
   "barrier": "Read the mass and speed values aloud in Urdu; the pupil writes formula and digits, needing no translation.",
   "early": "Ask: can the speed at 5 s be found the same way, without knowing it hits at 8 s? ($v_f=0+9.8\\times5=49$ m/s)"
  },
  "exam_bank": {
   "mcq": [
    {
     "q": "A stone and a feather are dropped where there is no atmosphere. What happens?",
     "options": [
      "The stone lands first",
      "The feather lands first",
      "Both land together",
      "Neither falls"
     ],
     "answer": "C",
     "distractor_codes": [
      "mass-determines-speed",
      "lighter-object-floats",
      "no-air-means-no-gravity"
     ]
    },
    {
     "q": "On a speed-time graph for free fall, what does the slope represent?",
     "options": [
      "The distance fallen",
      "The acceleration due to gravity, g",
      "The object's mass",
      "The time taken"
     ],
     "answer": "B",
     "distractor_codes": [
      "slope-confused-with-area",
      "mass-treated-as-graph-quantity",
      "axis-value-confused-with-slope"
     ]
    }
   ],
   "srq": {
    "q": "A ball dropped from rest strikes the ground at $58.8$ m/s. Calculate the time (ignore air resistance).",
    "marks": 3,
    "mark_scheme": [
     "1 mark: formula $\\Delta t=(v_f-v_i)/g$",
     "1 mark: substitution, $\\Delta t=(58.8-0)/9.8$",
     "1 mark: answer, $\\Delta t=6$ s"
    ]
   },
   "erq_skeleton": {
    "q": "Explain why two objects of different mass reach the ground together, with one textbook example.",
    "marks_total": 6,
    "parts": [
     {
      "heading": "State the value and meaning of g",
      "marks": 2
     },
     {
      "heading": "Explain why g is mass-independent",
      "marks": 2
     },
     {
      "heading": "Describe the coin-and-paper experiment (Figure 2.11)",
      "marks": 2
     }
    ]
   },
   "how_marked": "Full marks need the formula and substitution with units; working-free answers score half marks."
  },
  "homework_key": [
   {
    "ref": "H1",
    "level": "K",
    "marks": 1,
    "answer": "B — $g \\approx 9.8\\,\\text{m/s}^2$ for every mass."
   },
   {
    "ref": "H2",
    "level": "U",
    "marks": 1,
    "answer": "C — with no air resistance, both fall under $g$ and land together."
   },
   {
    "ref": "H3",
    "level": "A",
    "marks": 3,
    "answer": "$\\Delta t=(39.2-0)/9.8=4$ s."
   },
   {
    "ref": "H4",
    "level": "U",
    "marks": 2,
    "answer": "Air resistance slows the light, flat paper more than the compact stone, due to shape and surface area."
   }
  ],
  "next_period": "2.6 Graphical analysis of motion — distance-time and speed-time graphs (p.49 onward).",
  "not_going": "The universal speed limit and average vs instantaneous speed come later in this chapter, not today.",
  "coaching_lookfor": "Notice whether you re-solve the We-Do's heavier mass on the board yourself, rather than just telling pupils the answer.",
  "coaching_reflection": "Which of my pupils changed their answer after the We-Do, and who still needs the 20 kg case solved again tomorrow?"
 },
 "one_screen": "Today's Physics lesson (Grade 9, Ch.2 §2.5, p.48-49) teaches that every freely falling object accelerates at the same rate, g ≈ 9.8 m/s², whatever its mass. Open by asking pupils to picture a heavy stone and a light ball dropped together from the school roof — which lands first? Most say the heavier one. Reveal both land together, then show the book's own Example 2.5: a 2 kg block dropped from rest reaches 78.5 m/s in 8 s, and the solution never uses the 2 kg. That unused number is the lesson — mass cancels out of g = (vf − vi)/Δt. On the board, re-solve the same example with a 20 kg block and get the same 8 s, so pupils see it, not just hear it. Cover Figure 2.11 honestly: a coin beats a paper sheet in air because of air resistance, not weight, but the two fall together once air is pumped out. Practice runs four items ending in a justify-in-words question. Homework is four items, half MCQ, on today's g-is-constant idea only, marked in full from the reference page.",
 "ur_overlay": {
  "/sections/0/blocks/0/question": "آپ اپنے سکول کی چھت سے ایک ٹینس بال اور ایک بڑا پتھر ایک ساتھ گراتے ہیں۔ کون سی چیز پہلے زمین پر گرے گی، اور کیوں؟",
  "/sections/0/blocks/0/look_for": "زیادہ تر طلبہ اندازہ لگائیں گے کہ پتھر پہلے گرے گا؛ دونوں ایک ساتھ گرتے ہیں، کیونکہ g کمیت پر منحصر نہیں ہوتی۔",
  "/sections/0/blocks/2/text": "ابھی اپنے اندازے کو ذہن میں رکھیں — زیادہ تر طلبہ یہی کہتے ہیں کہ بھاری پتھر تیزی سے گرے گا۔",
  "/sections/1/blocks/0/text": "دونوں ایک ساتھ، بالکل ایک ہی لمحے میں زمین پر گرتے ہیں۔ صفحہ 49 کی مثال 2.5 یہی ثابت کرتی ہے — حل میں بلاک کی کمیت کہیں استعمال نہیں ہوتی، کیونکہ $g$ کمیت پر منحصر نہیں ہوتی۔",
  "/sections/1/blocks/5/text": "حل میں 2 کلوگرام کمیت کہیں استعمال نہیں ہوئی — یہی اصل نکتہ ہے: $g$ کمیت پر منحصر نہیں ہوتی، اس لیے زیادہ بھاری بلاک بھی اتنا ہی وقت لے گا۔",
  "/sections/3/reteach_rule": "اگر جماعت کا ایک تہائی حصہ اب بھی کہے کہ بھاری چیز تیزی سے گرتی ہے، تو §2.6 سے پہلے 'We Do' دوبارہ حل کریں۔",
  "/page2/coaching_lookfor": "دیکھیں کہ کیا آپ نے زیادہ کمیت والا 'We Do' خود بورڈ پر حل کیا، یا صرف طلبہ کو جواب بتا دیا۔",
  "/page2/coaching_reflection": "میرے کون سے طلبہ نے 'We Do' کے بعد اپنا جواب بدلا، اور کسے کل 20 کلوگرام والی مثال دوبارہ دیکھنے کی ضرورت ہے؟",
  "/page2/differentiation/stuck": "$\\Delta t = (v_f - v_i)/g$ پہلے سے کارڈ پر لکھ کر دیں؛ طالب علم صرف اعداد رکھے۔",
  "/page2/differentiation/barrier": "کمیت اور رفتار کی قدریں اردو میں بلند آواز سے پڑھیں؛ طالب علم فارمولا اور ہندسے لکھے، جنہیں ترجمے کی ضرورت نہیں۔",
  "/page2/differentiation/early": "پوچھیں: کیا رفتار 5 سیکنڈ پر بھی اسی طریقے سے معلوم کی جا سکتی ہے، یہ جانے بغیر کہ وہ 8 سیکنڈ میں زمین سے ٹکرائے گا؟ ($v_f=0+9.8\\times5=49$ m/s)"
 }
}
```

---

## F4 · BEFORE YOU EMIT

Everything in §9 of the brief below applies. These nine are the ones that most often survive a
self-check and still fail the build — they are the measured top defect classes across 27
documents. Check them literally, key by key, against the JSON you are about to return:

1. **The maths check, BOTH directions (§F1⑤+⑥) — the #1 content failure, and it fails both ways:**
   - **(a) Inside every `spec`:** search for `$`. There must be NONE — not in `title`, `caption`,
     `label`, `lines`, `steps`. Rewrite as plain Unicode.
   - **(b) Everywhere ELSE (prose, titles, `q`, `a`, mark schemes):** every `\begin`, `\frac`,
     `\det`, `\ce`, `^`, `_` MUST sit inside `$…$`, and every string must contain an EVEN
     number of `$`. Bare `\begin{bmatrix}` in a paragraph is painted literally and fails.
   - **(c) Anywhere at all:** search for `[[`. A Python row-list like `[[1,0],[2,3]]` is never
     correct in any field. Rewrite it as `$\begin{bmatrix}…\end{bmatrix}$` in prose.
   **Do not "play safe" by avoiding LaTeX — in prose it is required.**
2. **Check every block's `type` against the 15-word legal list** (§F1⑦). Is `flow` or `mindmap`
   or `grid` sitting where a block type should be? Wrap it in a `diagram` block.
3. **Search for `"slo_code": null`.** In homework there must be none — use `"O1"`/`"O2"` (§F1⑧).
4. Open every `diagram` block. Does it have **exactly** `type`, `id`, `spec` and nothing else?
5. Count the exit-ticket items. Is it **≤ 2**?
6. Search for `"video"`. Is every one an **object with `url` and `title`**, in Development?
   Delete any that is `null`.
7. **Count the words in the outcome box** (outcome + by_the_end + every objective).
   **Aim ≤60. Hard ceiling 80.** This box is printed first and was the worst offender — if it is
   over 60, cut it before anything else.
8. **Count the homework items. Three.** (Cap is 5; the aim is 3.) Then count the words in
   `introduction` and `development` — your two most-overrun sections. Over the aim? Cut now; it
   is far cheaper here than in a revision round.
   **Cut words and examples — never a structural slot** (§F2).
9. **Read your questions back.** Is every one a full sentence that says what to do (no bare
   "Q3" or "the above")? Does any question appear **twice** across warm-up / practice / exit
   ticket / homework? Duplicates and unworded questions each fail their own gate.
## F5 · LANGUAGE, LITERATURE AND ISLAMIAT — the three that fail here

*(This section is in the prose/language brief only. There is deliberately NO maths section in
this brief: across the measured prose corpus `MATH_LEAK` occurred **zero** times, and carrying a
maths block here costs attention the rules below need.)*

**① VOCABULARY IS `{word, meaning}` — NEVER `{q, a}`.** A `keywords` block is a gloss list, not a
question list. This is the largest schema failure in this family.

```json
{"type": "keywords", "items": [
  {"word": "وقف", "meaning": "a pause taken while reciting", "page": "8"}]}
```
✗ `{"ref": "K1", "q": "What does waqf mean?", "a": "a pause"}` — that is a QUESTION. It belongs in
the you-do (`practice`) with a `P` ref, not in `keywords`.

**② RELIGIOUS CONTENT CARRIES ITS MARKS (`RELIGIOUS_MARKS`).** Every mention of the Prophet
carries **ﷺ**; every companion carries the honorific the book prints. No sacred name in Latin
script — write **اللہ** with the Urdu he (U+06C1), never "Allah" in a Roman transliteration. Every
quoted prophetic word carries its hadith reference or its printed page. Set `needs_human_review`.

**③ A DISTRACTOR CODE IS DATA, NOT TEXT (`DISTRACTOR_VISIBLE`).** In a language lesson the
distractor code is very often a real word from the lesson (`وقف`, `nazm`). If that same string is
also painted in the visible options, key words, or any teacher-facing line, the gate fires. Keep
the code in the teacher note under the question — never beside the option.

**④ Urdu-medium plans are authored DIRECTLY in Urdu** (`provenance.medium: "ur"`), reflect in
Urdu, and cost roughly **1.5× the space** of English at the same content because Nastaliq needs a
line-height ≥ 2.0. Aim shorter than you would in English.

---


---
---

# ⬇ THE CANONICAL v3 BRIEF FOLLOWS, UNCHANGED. IT IS THE AUTHORITY. ⬇

---
---

# LP-AUTHOR BRIEF v3 — one 40-minute Grades 6–12 lesson, as `lp_doc` **3.0** JSON

*(Forked from `reference/briefs/enrich_brief_v3.md` — that brief authors a K-5 executable body on the
GRR spine. This one authors a 6–12 lesson on the **closed heading system** with an **lp_type**
deciding what happens inside it. Where the two disagree, this brief wins for grades 6–12.)*

> **What changed in v3 (2026-09-01), and why.** An expert marked up a printed Grade 10 determinants
> LP the pipeline had produced, and the team reviewed four more on the sheet. The judge had scored
> the LP 100. Every defect below is from those pages, and every one now has a **blocking gate** in
> `lp_html/lint_lp.js` — so a v2 habit does not get a warning in v3, it gets a failed build.
>
> | What the expert ringed | The gate | What you must now do |
> |---|---|---|
> | `$…$`, `\begin{bmatrix}`, `\frac` printed as literal text — in panel bodies, in figure captions, in **section titles** | `MATH_LEAK` | Maths is **always** LaTeX inside `$…$`. **Never a row-list** `[[1,0],[2,3]]`. Balance every `$`. |
> | Matrices typeset at subscript height | (renderer) | Just write `$\begin{bmatrix}…\end{bmatrix}$` — the renderer promotes a matrix to display style for you. |
> | `\|B\|, B⁻¹: B = [ … ]` as a "question" | `UNWORDED_Q` | **Fully-worded questions.** "If $B = …$, find $B^{-1}$." |
> | An activity headed `$A^{-1}$ (p.68)` that never states the question | `UNWORDED_Q`, `REF_ABSENT` | **State every referenced question inline.** A page citation is a pointer, not a question. |
> | Model answers that never say what they answer | `REF_ABSENT` | Every question carries a `ref`; every reference-block answer names it. |
> | Distractor codes printed beside the options | `DISTRACTOR_VISIBLE` | Still author them — the renderer moves them into a teacher note. |
> | Homework with answers inline, off-topic items, items copied from the class, no tags | `HW_TAGS`, `HW_MCQ_WEIGHT`, `HW_ANSWER_INLINE`, `DUP_QUESTION` | Tagged `[SLO, K/U/A]`, MCQ-weighted, on today's content only, answers **only** in the reference block. |
> | A near-flat parallelogram for `det = 3` | `DIAGRAM_DEGENERATE` | Choose numbers that draw a shape a pupil can read an area off. |
> | `37 = 40 min`, and a `0 min` badge on homework | `PACING_SUM` | The section minutes sum to `period_minutes` exactly, and homework is never 0. |
> | `SAY "…"` boxes; a coaching corner that quizzes the teacher on the lesson's content | `NO_SAY_BOX`, `COACHING_CORNER` | The `say` block **no longer exists**. The corner's LOOK-FOR instructs; its REFLECTION asks her about her own class (§8b). |
>
> **v3 also carries forward, unchanged:** the MANDATORY VISUAL CONTRACT (§4b), the Islamiat rules
> (§4c), the lp_type checklists (§2) and the acceptance bar (§3). Read them; they still bind.

You are writing **ONE lesson plan** for **ONE class period** from the printed pages of a Pakistani
government textbook. You are given: this brief, the lesson metadata, and the **PAGE-TRUTH** — a
faithful block-by-block transcription of the printed pages (prose, headings, lists, tables, worked
examples, described illustrations, notes, MCQs).

Return **ONE JSON object and nothing else**. No prose before or after. No markdown fence.

---

## 0 · THE IRON RULE — GROUNDING

Every fact, definition, number, quotation, exercise, figure and answer you use must be traceable to
the PAGE-TRUTH you were given, or be a standard, checkable fact of the subject that a Pakistani
board examiner would accept (an atomic mass, `g = 9.8 m s⁻²`, a dengue vector's name).

- **Never invent a textbook fact, a page number, an exercise number, a figure number, an SLO code,
  a past-paper citation or an exam weighting.** If it is not verified, it does not go in the LP.
- If the pages lack something the lesson needs, **supply it and say so** in
  `notes.supplied` as `"supplied: <what> — the book never states it (see p.N)"`.
- Where the book is wrong, incomplete, or has an unused given, **that defect is the best lesson**
  — record it in `notes.defects` and build the teaching around it.
- Quote the printed SLO/learning outcome **verbatim, with its printed page**, in `slo.text_verbatim`.
- **"Does not exist" is an answer; "none" is not.** When the pages print no SLO code, no figure, no
  exercise for this outcome — say which, in `notes.gaps`, in words: *"the chapter prints no SLO code
  for this outcome"*. A bare `"none"` tells the next reader nothing about what was looked for.
- **Every string you write has an AUDIENCE, and you must know which.** A `paragraph`, a `board`, a
  `key_points` item and a warm-up answer are read by the TEACHER, in her classroom. A practice `q`,
  a homework `text` and an exam option are read out or copied to the PUPIL. An entry in `notes` is
  read by US and never printed. Writing a note to us into a teacher-facing block is how *"STEM-2:
  agreed conventions, no discoverable 'why'"* got printed on a real lesson plan.

---

## 1 · THE SPINE (fixed) — the CLOSED HEADING SYSTEM

The headings are a **closed list**, in this order, and nothing may be added, renamed or dropped.
A teacher opening any 6–12 plan finds the same thing in the same place; that is the whole point.

**Teaching flow** — `O` → `I` → `D` → `A` → `C` → `H`, then the materials/pacing strip:

| Slot | Minutes | What it is |
|---|---|---|
| **O** Learning outcome & objectives | (untimed) | **ONE BOX.** The outcome as what the pupil can do · a `✓ By the end you can answer…` line naming the question type and its marks · **two or three** objectives, each with **its own SLO code** |
| **I** Introduction | ~10 | **the warm-up is INSIDE this section**, one row · the hook · vocabulary pre-teach **with its page** · `Look for:` · `⚠ WATCH OUT` · `ON THE BOARD` |
| **D** Development | ~12 | **closes the hook in its FIRST sentence** · **cites the textbook by page** · `KEY POINTS` ≤5 · the I-do worked in front of the class · the video slot · the misconception |
| **A** Activity | ~12 | **we-do before you-do, both timed** · items tagged `SUPPORT`/`EXTENSION` · an answer for every item |
| **C** Conclusion | ~4 | one **board-phrased question with its mark scheme** · an **exit ticket** of 1–2 items · a **`Re-teach rule:`** naming the threshold and what to redo |
| **H** Home work | **≥1, never 0** | real FBISE/textbook items, each tagged `[SLO code, K/U/A]`, MCQ-weighted, **no answers here** |

**Reference block** — below the flow, clearly marked, explicitly not read aloud:
`A` board at the end · `B` model answers **naming their questions** · `C` common mistakes + the
question you ask back · `D` differentiation · `E` exam bank (distractor codes as data) ·
`F` homework solved in full · `G` next period + not-going-today · `H` **coaching corner —
the teacher's own square inch of the page**: the observable move from THIS lesson, then one
question she asks HERSELF about her own practice. (The record-and-send offer beside it is
printed by the renderer; you do not write it.)

**THE MINUTES RULE.** `introduction + development + activity + conclusion + homework` must equal
`period_minutes` **exactly**. The warm-up's minutes are **inside** the introduction's — it is a row,
not a section. Homework's minutes are **never 0**: setting the work and reading it back takes time.
A teacher counted our minutes and found 37 against a labelled 40. `PACING_SUM` now fails that build.

**THE SEQUENCE STRIP.** `sequence` is required: what came last, what this is, what comes next, and
the next checkpoint. A teacher who did not write the plan needs to know where in the chapter she is.

**ONE SKILL PER LP.** Several concepts in one lesson is the single most-repeated complaint across
every review round. Split them, sequence easiest first. Never six objectives — the schema caps them
at five and the reviewer's own check is "is it one skill, or more than one?"

**NEVER USE A CONCEPT BEFORE ITS TEACHING BEAT.** Walk the plan forwards once before you emit it: a
term, a symbol or a method may not appear in the warm-up, the hook or the I-do unless it was either
pre-taught in the vocabulary row or is prerequisite knowledge the warm-up has just retrieved. The
determinant LP used `A⁻¹` in an activity heading three beats before the inverse was taught.

---

## 2 · CHOOSE THE `lp_type` AND SATISFY ITS CHECKLIST

The checklist is a **coverage** list, not a section-naming template — an item may live anywhere in
the lesson, but every item must actually be there. State your choice and one sentence of reasoning
in the top-level `lp_type` field, and put the one-sentence reason in the first `paragraph` block of
`development` if it belongs on the page at all — the schema has no rationale field, so do not invent one.

**STEM-1 · Concept-Introduction Day** (Maths + Science 9–12; genuinely new content)
- real phenomenon/case presented **before** vocabulary or notation
- vocabulary/notation introduced only after the phenomenon has been explored
- a check for understanding built in before moving on
- closes on **one real FBISE command word**
- homework: SLO-coded past/model-paper-style question, cognitive level tagged
- coaching-corner look-for (Maths: a concrete/pictorial step before abstract notation; Science: did
  the teacher actually run the demo/observation rather than describe it from the book)

**STEM-2 · New-Procedure Day** (use **only** when the content is genuinely arbitrary — notation,
convention, an algorithm with no discoverable "why")
- state first that no discoverable "why" exists (else use STEM-1 or STEM-3)
- worked example (I do) · backward-faded practice (We do) · independent practice (You do)
- closes on an FBISE command word · SLO-coded homework · coaching-corner look-for

**STEM-3 · Investigation Day**
- hypothesis stated · data-collection method defined · an analysis step run on the collected data ·
  transfer back to the real phenomenon · FBISE command word · SLO-coded homework · look-for

**LL-1 · Discussion Day** (English/Urdu) — a genuinely contested text; pupils commit to a stance
before discussion; teacher facilitates, does not lecture; **every claim cites the text**; FBISE
command word; SLO-coded homework; look-for.

**LL-2 · Close-Reading Day** — a device-rich text; the **notice → name → explain-effect** sequence
run in full (spotting a device is not enough); teacher annotates one passage aloud (I do); class
annotates together (We do); pupils annotate unaided (You do); FBISE command word; homework; look-for.

**LL-3 · Craft + Write Day** — ONE named writing/grammar/vocabulary skill, never bundled; mini-lesson
precedes writing; sustained writing time protected; command word; homework; washback check; look-for.

**SS-1 Source-Analysis / SS-2 Data-Map / SS-3 Civics-Discussion / Recall-Floor Consolidation**
(Pakistan Studies) — Recall-Floor is the default: identify the facts to secure, run an active
retrieval drill (not passive review), only extend once the floor is secure. SS-1: a real source,
source-it → contextualise → corroborate, output is an evidence-based claim. SS-2: a real map/dataset,
read → interpret → conclude. SS-3: a civic issue with two defensible sides, argue both before taking
a position, cite evidence.

**Board-authenticity gates (do not get these wrong):**
- Grades 6–8: **no FBISE board component.** Do not invent a board label or a command-word close
  framed as board practice; you may still use exam-style question shapes taken from real paper
  patterns. Set `board_weight` to `null`.
- Grades 9–10: full board authenticity for Physics/Chemistry/Biology/Maths/English/Urdu.
  **General Science (9–10) has no FBISE framework — no board items.**
  **Pakistan Studies Grade 9 has no board component — no command-word close, no board homework.**
- Grades 11–12: full board authenticity for all three sciences, Maths, English, Urdu and Pak Studies
  (Grade 11 Pak Studies is examined *with* Grade 12 at HSSC-II, so it gets the same treatment).
- Do **not** close an English Competency-A (listening/speaking) or Urdu Skill-A/B lesson on a board
  command word — those are never examined.

**FBISE shape to write against (SSC/HSSC):** Section A MCQs ~20% · Section B short-response ~50% ·
Section C extended response ~30%. From the Second Annual 2026 the five core science/maths subjects
moved to **50% MCQ / 50% descriptive**. Papers are **SLO-based, not textbook-based**. Real command
words: *define, describe, explain, differentiate, calculate, derive, justify, identify, state,
compare, evaluate.*

---
---

## 3 · THE ELEVEN THINGS TEACHERS FAILED US ON — the acceptance bar

Every one of these is a real written complaint from an ICT teacher about a previous version. An LP
that repeats any of them is rejected.

1. **Textbook-aligned or nothing.** *"totally AI generated and not linked to our textbook at all …
   not following the syllabus breakdown."* Every section draws on the pages you were given; quote
   the page's own sentences and exercises, cite the printed page.
2. **The timings must sum.** 5+5+10+15+5 = 40. Count them before you emit.
3. **Close every hook you open.** If the introduction poses a mystery, a named, timed beat must
   resolve it. The schema has **no `close_the_hook` field** — do not invent one. Close the loop by
   writing a real `paragraph` block early in `development` (or in `conclusion`) that names
   the hook's own words and gives the answer.
4. **Teach every objective you state, in class.** An objective whose only practice is homework is a
   failure. Two of four named devices were never taught in the poetry LP — do not repeat it.
5. **Assess only what you taught.** The exit ticket, SRQ and MCQs test the devices/steps/skills that
   actually appeared in the lesson. No alliteration in the exit ticket if alliteration was never
   modelled.
6. **Complete diagrams.** If the objective names five vessel types, the diagram carries five. A
   partial diagram against a complete objective is a defect.
7. **Scope one lesson.** Six steps of the biological method across one period was called out
   explicitly: *"the whole method should have been divided into multiple LPs — this topic requires
   4–5 classes."* Take **one or two** steps, teach them properly, and say what the next period gets
   in `page2.next_period` and `page2.not_going`.
8. **No language or grammar errors, in either language.** *"the given the answer never uses"* and
   *"the hook? is why, but it is written book"* were both shipped. Read every sentence back. Urdu
   gets a first-language read: no gibberish, no self-translation.
9. **No insensitive or self-contradicting hooks.** The skydiver hook was rejected twice — for asking
   14-year-olds to compute which of two people hits the ground first, and because the physics that
   actually saves a skydiver (air resistance) is the exact factor the lesson tells them to ignore.
   Never use death, injury, disaster or communal identity as an icebreaker. Never write a hook whose
   own premise the lesson then contradicts.
10. **Every referenced item is solved.** Practice, guided work, exit ticket, homework, MCQs, ERQ —
    all carry model answers. The book prints no answer key; the reference block is the answer key.
11. **Instructions carry context and sit together.** *"The instructions for one activity are
    scattered"* · *"instructions do not build any context — the very first instruction is 'Do not
    summarise either sentence'."* Each activity block holds its own complete, ordered instructions,
    and the first one says what the pupils are about to do.

Teachers also told us, positively, what they want: the closed heading system; the teaching flow first, then the reference block =
resources; **examples not explanations of how to explain**; exam-format practice ("for English,
students have to write summaries, central idea, figures of speech — so a poem lesson should be built
around those"); K/U/A cognitive levels; targeted practice in common exam question types; frequent
marking errors named; differentiation.

---
---

## 4 · THE LAWS (from the corpus render-laws; they bind the author, not the renderer)

- **L12 · Openings hook; they do not teach.** The provocation is a question, a case, a puzzle — it
  does not begin explaining the topic. And per the 21-July meeting it must be a **provocation or
  mystery**, intellectually stimulating for the actual grade, tied to real local life, designed to
  generate pupils' own questions. Test: *would a real grade-9 subject teacher open with this?* If it
  would work unchanged in a grade-3 class, it fails. (Our rejected example: "look out of the window
  at two plants." Our accepted example: diagnosing a dengue case to teach the biological method.)
- **L13 · Brand-neutral naming.** No company, product or partner brand appears as content — not in
  a story town, a character, a school name or a sign. Use ordinary Pakistani place and person names.
  The **deployment's** brand is the one exception, and it goes in `provenance.brand`
  (`{name, primary_hex}`) — a config field the renderer prints in the hero kicker and the footer,
  never a string you write into content. `lint_lp.js` FAILS `BRANDLEAK` on any other brand's name
  anywhere in the document. For ICT/NIETE:
  `"brand": {"name": "NIETE Teaching Assistant", "primary_hex": "#333748"}`.
- **L14 · Authoring metadata is never teacher text.** The `lp_type` code, its checklist, a rubric
  name, a research citation and any instruction from this brief are notes to YOU. They must not
  appear in a `paragraph`, `board` or `key_points` block — the renderer cannot tell them from
  real prose and prints them verbatim to the teacher. This shipped: the G9 chemistry sample opened
  its Development with *"STEM-2: agreed conventions, no discoverable 'why'. Model directly: I do, we
  do, you do."* If the point is worth making to the teacher, say it in HER words and about HER
  lesson — *"these are conventions chemists agreed on, so watch one, do one together, then try one
  alone"* — and never name the type code.
- **L15 · Chemistry: put spaces around a `+` that is an operator.** `\ce{2H2+O2->2H2O}` is read by
  mhchem as an ionic CHARGE and prints `H₂⁺O₂` — wrong chemistry, and it renders without complaint.
  Write `\ce{2H2 + O2 -> 2H2O}`. A charge with nothing after it (`\ce{Na+}`, `\ce{Ca^2+ + 2Cl-}`) is
  correct as-is. `node lint_lp.js --fix <doc>` repairs the operator case mechanically.
- **L6 · Gender-neutral register.** Address the teacher neutrally. In Urdu, never use gendered
  second-person verb stems for the teacher or the pupil (`آپ سوچ رہی ہوں گی` / `آپ سوچ رہے ہوں گے`) —
  use imperatives or impersonal third-person reframes. Use «ٹیچر», never «اُستانی صاحبہ». Examples
  must name **both** girls and boys doing the actual work.
- **L1d · Never translate a language into itself.** An Urdu-medium lesson prints the teacher's line
  **once, in Urdu**. No Urdu "translation" under an Urdu line. Conversely, in an English-medium
  lesson any spoken-Urdu support line is **Roman Urdu only**.
- **L5 · Phone-first.** The teacher reads this on a phone. Short sentences, ≤4 lines per paragraph,
  no side-by-side text, no table wider than 3 columns. Word budgets in §6 are a hard ceiling: if a
  section will not fit, cut content — never compress by writing denser prose.
- **Honorifics.** `ﷺ` and every religious honorific are preserved exactly as printed, never
  transliterated, never stripped, never de-pointed.
- **M2 · Facilitation, not a script.** Middle/high teachers asked for *what questions should I ask*
  and *what resources go with the explanation* — not "now say this, now write that." Only the
  modelling talk and the questions are scripted. Everything else is an instruction to the teacher.
- **M6 · Rural and urban at once.** Enough structure for a rural government teacher, never
  patronising to an urban one. Resources are chalk/marker, board, textbook — no projector, no
  printouts, no internet in the required path. (A teacher noted teachers use **markers**, not chalk —
  write "board marker".)
- **R3 · Direct instruction to the teacher, never a story about a teacher.** No third-person
  narrative ("the teacher then walks around and…"). Imperatives.
- **M5 · Visuals are not decoration — see §4b, which is now a machine-checked contract.** The one v1
  sample with no figure was called *"a very bare bones lesson plan"*; the eight v1 samples that had
  one figure each were called *"bereft"* of them. A lesson that could be drawn and was not is a
  defect, in every subject.
- **R5 · Do not over-solve maths.** Maths teachers said there were too many solved examples: one
  worked, one faded, then practice. And per the worked-example research, when you show an
  **incorrect** example you must **mark the error explicitly** — never make pupils hunt for it.

---
---

## 4b · THE VISUAL CONTRACT — **MANDATORY, MACHINE-CHECKED, PER SUBJECT**

This section is the reason v2 exists. It is not a suggestion and it is not "add a picture if one
helps." The visual check (`visual_check.js` in the serving lane, `visual_check.py` in the authoring
lane — the same rules, asserted equal) runs on the emitted document, counts the blocks below, and
**FAILS** any lesson that misses its subject's minimum. A failed visual check is a revision round,
exactly like a schema error, and its defects are listed FIRST in that round.

> This paragraph was true of the authoring lane and **false of the serving lane from 2026-09-02 to
> 2026-09-04**: the checker was never vendored beside the lint, so the only visual rule that ran on
> a served lesson was "does the page carry at least one diagram, figure OR formula" — which a
> single `latex` block satisfies. 62 lessons went to teachers under that permission, and 48 of them
> fail this section. It runs now.

### 4b.1 · The floor every lesson must clear

1. **≥2 FIGURES — a `diagram` block or a `textbook_figure` block; `latex`/`chem` are not
   figures.** One of them lives **inside `development` or `activity`, at the point of use** —
   beside the sentence it explains, never parked at the end. The other may be the
   `page2.board_final.diagram`, which is the **final state of the board** and is the single most
   requested artefact a teacher asked for.

   > **A BOOK FIGURE COUNTS. This changed on 2026-09-04, and it changed because of a real
   > lesson.** The rule used to read *"`textbook_figure` does NOT count toward this two"*. On a
   > Grade 11 Biology lesson on the cell membrane, the book's own Figure 1.10 — the fluid mosaic
   > model — was cropped, staged, and named in that segment's notes. The lesson emitted two
   > `panels` text boxes and a `flow` instead, and then wrote an Activity telling the teacher to
   > *"label the two ends of a phospholipid molecule"* **with no picture on the page to label**.
   > Nothing was broken; the rule was telling the model that the real figure bought it nothing.
   >
   > So: where the book has the picture and this engine cannot draw it — a photograph, an
   > anatomical illustration, a map, a micrograph — **the book's figure is the better answer, not
   > the fallback.** It is the exact image the pupil is looking at in her own copy. It counts
   > toward these two, it satisfies the point-of-use requirement, and in §4b.2 it satisfies any
   > requirement that lists `labelled_figure`.
   >
   > What has not changed: **use it where it is genuinely better.** If the idea is one of the
   > twenty types this engine draws — a circuit, a graph, a punnett square, a free-body diagram —
   > draw it. A clean drawn circuit teaches the circuit; a photograph of one tells the pupil what
   > to expect on the bench. Ours leads where ours is good.
2. **`page2.board_final.diagram` is required**, not optional. `draw_order` alone is prose about a
   picture; the picture itself is the deliverable.
3. **At point of use** means: the block sits immediately after the `key_points` / `paragraph` /
   `worked_example` it illustrates, in the same section. A diagram at the bottom of `homework` is a
   decoration and is scored as absent.
4. **Every piece of mathematical notation is `$…$` or a `latex` block. Never prose.** Not
   "x squared minus two x minus three", not "the determinant of A", not "2 to the power 3". If a
   symbol exists for it, use the symbol. This applies in **every subject**, including a biology
   ratio and a geography percentage.
5. **Every chemical species and every equation is `\ce{…}` or a `chem` block** — `\ce{H2SO4}`,
   `\ce{2H2 + O2 -> 2H2O}` — **with spaces around any `+` that is an operator** (L15). `H2O` typed
   as plain text is a defect.
6. A diagram must be **complete against the objective** (acceptance bar §3.6): if the objective
   names five parts, the figure carries five labels.
7. Never emit `{"type":"illustrative"}`. It is an honest placeholder for art this engine does not
   draw, and it is not a visual.

### 4b.2 · The per-subject minimum (on top of §4b.1)

**How to read this table.** Where a row names TWO requirements, they are an **AND** — one diagram
cannot pay for both, and the gate reports each unmet requirement as its own defect. Where a
requirement lists several types it is an **OR** — any one of them satisfies it.

**And read this before you argue with a row.** Across 62 real lessons served to teachers,
**83.5% of every diagram emitted was a `flow`, a `mindmap` or a `panels`**, and **nine of the
twenty types never appeared once** — no `circuit` in any Physics lesson, no `molecule` or `atom`
in any Chemistry lesson, not one labelled structure in thirteen Biology diagrams. Those three
types win by default because they are the only ones constructible from *any* prose, with no
structured data. That is precisely why several rows below name a subject-specific type AND a
process map: the second requirement is where `flow` and `mindmap` belong, and the first is the
one the corpus proves does not happen on its own.

| Subject | What the lesson MUST carry | Why this row is this |
|---|---|---|
| **Mathematics** | `latex` on **every** expression, equation, matrix and result — inline `$…$` in prose, a `latex` block for anything displayed. **≥1** of `graph` · `numberline` · `geometry` · `grid` · `fraction_bar`. **A marked incorrect example**: one worked or faded example that shows the wrong step with the error **explicitly marked and named** (R5 — never make pupils hunt for it), plus the correct line beside it. | Every listed type is one this engine DRAWS, deliberately: 88% of maths pages carry a third-party watermark, so the book's own figure is not a clean fallback in this subject. |
| **Chemistry** | **≥1 `chem_equation` diagram** AND **≥1 `molecule` or `atom` diagram**. A **mole-ratio worked example in LaTeX** — the ratio written as `$\frac{n(\text{X})}{n(\text{Y})}$` or an equivalent display, with the arithmetic shown, not described. Every formula in `\ce{}`. | A reaction and the species in it are two different pictures; a lesson that shows only the equation never shows the pupil what a molecule *is*. |
| **Physics** | **≥1** of `circuit` · `ray_diagram` · `free_body` · `graph`, chosen to match the topic (a motion lesson gets `free_body` or a `graph`; an optics lesson gets `ray_diagram`; an electricity lesson gets `circuit`). **The governing formula as a `latex` block**, with its symbols defined, and the substitution shown in LaTeX. | Same as Mathematics: 80% of physics pages are watermarked, so these four drawn types are the clean route, and each is the standard figure of its own topic. |
| **Biology** | **≥1** of `cell` · `leaf_cross_section` · `heart_loop` · `labelled_figure` · `dna_helix` · `punnett` · `graph` — **a real biological figure**, drawn by this engine **or** the book's own crop as a `textbook_figure` (§4b.1.1). **AND ≥1** of `flow` (a process: photosynthesis, digestion, the biological method) or `mindmap` (classification, concept relations). Use a `punnett` wherever inheritance is in scope. | Two requirements because one was satisfiable by the other. The old row was a single list containing `flow`, so a flow chart alone passed it — which is how thirteen delivered Biology diagrams contained **zero** labelled structures while the gate reported nothing. |
| **General Science** | **≥1** of `cell` · `leaf_cross_section` · `heart_loop` · `labelled_figure` · `dna_helix` · `punnett` · `atom` · `molecule` · `chem_equation` · `circuit` · `free_body` · `ray_diagram` · `graph` — a `textbook_figure` counts here too (§4b.1.1). **AND ≥1** of `flow` or `mindmap`. | General Science 6–8 is biology AND chemistry AND physics in one cover — "push and pull", "signs of a chemical reaction" and "the plant cell" are all in it — so the first requirement is the science-specific set across all three, not the biology one. What it excludes is the point: `flow`, `mindmap` and `panels`. |
| **Computer Science / IT** | **≥1** of `flow` (an algorithm, a process) or `mindmap` (a classification: hardware/software, input/output/storage). **AND ≥1** of `panels` · `grid` · `graph` · `timeline` · `labelled_figure` — the contrast, the place-value table, the data chart or the labelled device the page actually shows. | Read off the CS pages themselves: of their printed figures, 702 are screenshots or interfaces, 414 tables and grids, 400 charts, 364 labelled devices, 88 side-by-side comparisons — and only **54** are flowcharts. `flow` is right for an algorithm chapter and stays first-class; it is not what this book is mostly made of. |
| **English / Urdu (LL-\*)** | **≥1 `mindmap`** for the devices, themes or characters at stake, **and ≥1 `flow`** running the **notice → name → explain-effect** sequence as three labelled steps. A narrative or a set text with a sequence gets a **`timeline`**. Poetry: the mindmap carries the devices actually taught, nothing else. | A literature lesson has no physical object to draw, so both requirements are relation maps — but they are two DIFFERENT maps: what the text contains, and what the reader does with it. |
| **Pakistan Studies / History / Geography** | **≥1 `timeline`** (dated spine, 4–6 events, never more) **and ≥1 `panels`** set as **evidence vs claim** — one panel holds what the source says, the other what someone concluded from it. Geography data lessons may substitute a `graph` for the timeline. | Chronology and interpretation are the two things this subject assesses, and neither shows up in the other's picture. |
| **Agricultural Education (زرعی تعلیم)** | **≥1** of `panels` · `grid` · `graph` · `timeline` · `labelled_figure` · `cell` · `leaf_cross_section`. **AND ≥1** of `flow` or `mindmap`. | `panels` leads the first requirement here and in no other row, because this book teaches by paired comparison — two pots, one watered and one not — and its printed figures are dominated by those pairs and by tables. |
| **Islamiat** | **≥1** of `flow` · `mindmap` · `panels` for the concept structure (the آداب of an act, the فوائد, the two sides of a معاملہ). Plus §4c. | The one row that is deliberately all-generic: §4c forbids figurative imagery, so a concept diagram is not the lazy choice here — it is the only permitted one. |

Subject is read from `provenance.subject`, matched case-insensitively as a substring, longest row
first. **A subject that matches no row above fails the gate outright** (V0) — and when it does,
nothing else in §4b.2 is checked either, so the lesson gets no visual feedback at all. If you are
authoring a subject that is not in this table, say so in `notes.gaps`; do not guess a row.

### 4b.3 · Choosing the right type — the two-second test

Ask what the *shape of the idea* is, and pick the type that has that shape:

| The idea is… | The type |
|---|---|
| a sequence of steps, a process, a decision | `flow` |
| a whole broken into named parts / a classification | `mindmap` |
| two things set against each other | `panels` |
| something that happened over time | `timeline` |
| a relationship between two quantities | `graph` |
| a physical structure with named parts | `cell` / `leaf_cross_section` / `heart_loop` / `labelled_figure` |
| forces on a body | `free_body` |
| a reaction | `chem_equation`, then `molecule` / `atom` for the species |
| part of a whole, a fraction, a percentage | `fraction_bar` / `grid` |
| a position, an interval, an inequality | `numberline` |
| a shape, an angle, a construction | `geometry` |

If none of them fits, the honest answer is that the paragraph did not need a picture — but then §4b.1
still binds, so find the beat in the lesson that *does*.

**Two traps, both caught on the G6 Islamiat plan (2026-08-31):**

**1 · A `flow` is for a SEQUENCE. If nothing happens first or last, it is not a flow.** Six آدابِ
مشاورت were written as a six-step `flow` — they are a classification, so they were a `mindmap` (or
at minimum an `lr` flow). And `direction: "tb"` stacks steps into one column at roughly 150px each:
six steps measured **935px**, 86% of an A4 page for one figure. It pushed the plan a whole page over
the cap and left the page above it 14% full. **`lr` is the default and wraps into rows** — the same
six steps then measure 408px. `visual_check.py` V14 now fails a `tb` flow with four or more steps.

**2 · A summary diagram must serve the objective it summarises (blocking defect B11).** That plan's
objective 2 read *"مشاورت کے کم از کم تین آداب بتا سکیں"* — state at least THREE — and the activity
mindmap's آداب branch carried **two**. The lesson taught six and the map showed two, so a student
working from the map could not meet the objective. **Count the parts your objective names, then
count the leaves/steps/panels in the diagram that is supposed to carry them.** If the objective says
three, the diagram shows at least three.

### 4b.4 · The exact spec shapes — COPY THESE, do not invent fields

Every spec may also carry `title`, `caption`, `source`, `note`, and `lang: "ur"`.

**Colour is a token, with NO fallback hex: `"var(--navy)"`, `"var(--amber)"`, `"var(--leaf)"`,
`"var(--warn)"`, `"var(--ink)"`, `"var(--mut)"`, `"var(--line)"`.** Three ways of writing a colour
are all wrong here and each was shipped once:
- **`"var(--cool, #1B6CA8)"` — a token with a HEX FALLBACK.** It is the form the diagram engine's
  own gallery examples use, because the fallback keeps a figure coloured when it is rendered
  STANDALONE. Inside an lp_doc the raw hex makes `lint_lp.js` **FAIL the whole document as a
  PLACEHOLDER** (`/#[0-9A-Fa-f]{6}/`). Every example below was written in that form until
  2026-09-04 — ten copyable specs handing you the one shape this paragraph forbids, and they were
  concentrated on the dense types (`graph`, `geometry`, `numberline`, `fraction_bar`). They have
  been rewritten. If you have seen that form somewhere, it is stale.
- `"cool"` — a bare short name. The engine passes a colour value through verbatim, so this emits
  `stroke="cool"`, which is not a colour and paints nothing.
- `"var(--cool)"` — a real token, but **the lesson-plan page does not define `--cool`, `--plum` or
  `--clay`**. Only `--navy --navy2 --amber --ink --mut --line --leaf --warn` (plus the `-soft`
  variants) exist on the page. Anything else resolves to nothing.

If you want a second and third hue, use `var(--amber)` and `var(--leaf)` against `var(--navy)`.

```jsonc
// flow — a process or a chain of reasoning
{"type":"flow","direction":"lr","title":"WHY BOTH BLOCKS LAND TOGETHER",
 "steps":[{"title":"v = u + gt","lines":["no mass anywhere in this equation"]},
          {"title":"2 kg BLOCK","lines":["u = 0, g = 9.8","t = 8 s"],"color":"var(--navy)"},
          {"title":"SAME TIME","lines":["mass never appears"],"color":"var(--leaf)"}],
 "caption":"…"}

// mindmap — a centre and its named branches
{"type":"mindmap","centre":{"label":"WATER"},
 "branches":[{"label":"SOLID","leaves":["fixed shape","ice at 0 C"]},
             {"label":"GAS","leaves":["fills the room"]}]}

// panels — 2 or 3 comparison cards
{"type":"panels","panels":[
  {"title":"OXYGEN ATOMS","sub":"one O atom at a time","glyph":"O",
   "lines":["atomic mass = 16"],"foot":"1 mole of O atoms = 16 g"},
  {"title":"OXYGEN MOLECULES","sub":"paired as O2","glyph":"O—O",
   "lines":["molecular mass = 32"],"foot":"1 mole of O2 = 32 g","color":"var(--amber)"}]}

// timeline — a dated spine; 4-6 events, never more
{"type":"timeline","orientation":"horizontal",
 "events":[{"date":"1906","label":"Muslim League founded, Dhaka"},
           {"date":"1940","label":"Lahore Resolution"}]}

// graph — a Cartesian plot; expr is a safe expression in x
{"type":"graph","xMin":-3,"xMax":5,"yMin":-6,"yMax":8,"xStep":1,"yStep":2,
 "functions":[{"expr":"x*x - 2*x - 3","label":"y = x² − 2x − 3","color":"var(--navy)"}],
 "points":[{"x":3,"y":0,"label":"(3, 0)","color":"var(--warn)"}]}
// `dx`/`dy` on a point are MANUAL label offsets and they are a trap: they can push a label onto
// an axis-tick plate and fail DIAGRAM_OVERLAP. Omit them unless you have looked at the render.
// AN INEQUALITY is a graph too: a function may set "shade":"above" or "shade":"below" to fill
// the half-plane on one side of itself. Dash the line when the inequality is STRICT — points on
// it do not count. Two shaded functions overlap into a visibly darker region, which is exactly
// how a system of inequalities should read, and it needs no extra field.
{"type":"graph","xMin":-3,"xMax":5,"yMin":-8,"yMax":10,"xStep":1,"yStep":2,"title":"y > 2x − 1",
 "functions":[{"expr":"2*x - 1","label":"y = 2x − 1","color":"var(--navy)","dash":"6 4",
               "shade":"above"}],
 "caption":"The line is dashed because the inequality is strict — points ON it don't count."}
// optional on a shaded function: "shadeColor" (defaults to the line's colour) and
// "shadeOpacity" (defaults to 0.16).

// numberline — integers, fractions, jumps, inequality rays
{"type":"numberline","from":-5,"to":5,"step":1,"labelFormat":"integer",
 "points":[{"at":-3,"style":"dot","color":"var(--warn)"}],
 "arcs":[{"from":-3,"to":1,"label":"+ 4","above":true}]}

// geometry — auto-fitted; triangle/polygon/circle/line/point + rightangle marker
{"type":"geometry","height":340,"shapes":[
  {"kind":"triangle","points":[[0,0],[4,0],[0,3]],"labels":["A","B","C"],
   "sides":["4 cm","5 cm","3 cm"],
   "angles":[{"at":1,"label":"θ","arcR":34,"color":"var(--amber)"}],
   "fill":"var(--navy)"},
  {"kind":"rightangle","vertex":[0,0],"a":[4,0],"b":[0,3]}]}

// grid — N x M with shaded cells (percent, area model, hundred square)
{"type":"grid","rows":10,"cols":10,"shaded":37,"majorEvery":5}

// fraction_bar — part-whole bars on a shared whole
{"type":"fraction_bar","barHeight":40,"bars":[
  {"parts":3,"shaded":2,"label":"2/3","color":"var(--navy)"},
  {"parts":4,"shaded":3,"label":"3/4","color":"var(--leaf)"}]}

// chem_equation — PLAIN TEXT, not \ce{}; spaces around the + operator
{"type":"chem_equation","equation":"2H2 + O2 -> 2H2O"}
// conditions above/below the arrow and word equations are supported:
{"type":"chem_equation","equation":"CaCO3 -> CaO + CO2","above":"heat"}

// molecule — 2D structure from SMILES; give formula and name too
{"type":"molecule","smiles":"O","formula":"H2O","name":"water"}
{"type":"molecule","formula":"NaCl","name":"sodium chloride","ionic":true}

// atom — Bohr shells, or dot-and-cross bonding
{"type":"atom","element":"Na","mode":"bohr"}
{"type":"atom","mode":"dot_and_cross","compound":"NaCl"}

// circuit — series or parallel; battery/resistor/lamp/switch/ammeter/voltmeter
{"type":"circuit","layout":"series","cells":[
  {"kind":"battery","label":"Battery","value":"6 V"},
  {"kind":"switch","label":"Switch","value":"closed","closed":true},
  {"kind":"resistor","label":"Resistor","value":"10 Ω"},
  {"kind":"lamp","label":"Lamp"}]}

// ray_diagram — SOLVED from the lens/mirror equation; give f, u, hObject
{"type":"ray_diagram","element":"convex_lens","f":20,"u":60,"hObject":14}
// element: convex_lens | concave_lens | concave_mirror | convex_mirror

// free_body — forces scaled by magnitude; angle in degrees, 90 = up
{"type":"free_body","body":{"shape":"box","label":"Box","mass":"5 kg"},
 "forces":[{"name":"W","label":"weight","angle":270,"magnitude":50,"color":"warn"},
           {"name":"N","label":"normal","angle":90,"magnitude":50,"color":"cool"}]}
// on an incline:
{"type":"free_body","body":{"shape":"block_on_incline","label":"m"},"incline":{"angle":30},
 "showComponents":true,
 "forces":[{"name":"W","label":"weight","angle":270,"magnitude":100,"color":"warn","decompose":true}]}

// cell and its siblings — parametric biology schematics
{"type":"cell","kind":"plant"}          // kind: plant | animal
{"type":"leaf_cross_section","gasArrows":true}
{"type":"heart_loop"}

// dna_helix — a double helix; give a real sequence and every rung is a real base pair
{"type":"dna_helix","sequence":"ATCGGA","title":"DNA — the base pairs hold the two strands together",
 "caption":"A pairs with T, G pairs with C. Every rung is one pair."}
// With no `sequence` it is the twisting-ribbon SHAPE only — honest for "what does DNA look like",
// useless for "how does it pair". Give the sequence whenever pairing is what is being taught.
// Aliases: rna_helix / nucleic_acid_helix / helix. Use `rna_helix` for RNA and it renders U for T
// and A-U rungs — the alias wins even if the sequence you pass still contains a T.
{"type":"rna_helix","sequence":"AUCGGA","title":"RNA — a single kind of base changes"}

// punnett — the square is COMPUTED from the genotypes; do not pre-fill it
{"type":"punnett","p1":"Rr","p2":"Rr",
 "trait":{"dominant":"R","recessive":"r","dominantName":"tall","recessiveName":"short"}}

// labelled_figure — a real crop whose labels become REAL TEXT; `at` is [0-1, 0-1]
{"type":"labelled_figure","image":"<repo-relative path>","imageWidth":400,
 "labels":[{"text":"carbon dioxide — from the air","at":[0.19,0.24]}]}
```

**Urdu inside a diagram.** Set `"lang":"ur"` on the spec and write the labels in Urdu script; the
engine mirrors the layout and renders them through a `foreignObject` with the Nastaliq stack. Digits
inside Urdu strings are **۰۱۲۳۴۵۶۷۸۹ (U+06F0–06F9)**, never ٠١٢٣. Formulae, chemical species and
component values stay LTR even on an Urdu page — that is how Pakistani textbooks set them.

**Keep labels short.** A diagram's canvas is sized so its smallest label still renders ≥13.5 px in a
750 px column; a long label widens the canvas and shrinks *everything*. Two short lines beat one
long one. Six branches on a mindmap read; twelve do not.

---
---

## 4c · ISLAMIAT AND RELIGIOUS CONTENT — the additional rules

These apply to any Islamiat lesson and to any سیرت / Quranic / hadith content appearing inside
another subject (a سیرت chapter in an Urdu book, for instance).

> **`RELIGIOUS_MARKS` now enforces the mechanical half of this section, and only that half.**
> It blocks on: a mention of the Prophet with no `ﷺ` after it · a sacred name or honorific written
> in Latin script (`Allah`, `Muhammad`, `PBUH`, `RA`) · a companion honorified in one line and
> left bare in another · quoted prophetic speech with no hadith or printed page behind it · and
> religious content that does not set `needs_human_review`. It warns on a religious quotation with
> no source in the same string.
>
> **A green build is NOT clearance.** The native-speaker review stays a hard hold before any
> teacher ever sees the page, `lint_lp.js --auto-send` still refuses a flagged document, and the
> gate says so in every message it prints. What a machine cannot check — whether a ruling is
> correctly stated, whether a سیرت narration is faithfully told, whether the register is
> respectful — is exactly what the reviewer is for.

1. **`needs_human_review: true` with a `human_review_reason`, always.** No Islamiat lesson is served
   on demand; `lint_lp.js --auto-send` refuses a flagged document, and that refusal is the design.
2. **NO figurative imagery of the Prophet ﷺ, of the companions رضی اللہ عنہم, of the Ahl al-Bayt, or
   of any prophet.** No `labelled_figure` of a person, no illustrative art, no silhouette, no
   symbolic stand-in. This is absolute. Diagrams carry **concepts, not people**: the آداب of
   consultation as a `flow`, the فوائد as a `mindmap`, امانت vs خیانت as `panels`. Where a person
   must be named, they are named in **text**, with the honorific intact.
3. **Calligraphic text only** where a visual carries sacred words. An آیت or a حدیث is set as text —
   in a `dua` block or in the block's own text — never as an image, never inside an SVG `<text>`
   element.
4. **The Arabic is a `dua` block of its own, separate from the Urdu.** Never interleave the Arabic
   and its Urdu meaning in one string, and never "translate" the Arabic into Arabic. The page-truth
   marks these `[DUA — reproduce exactly, never alter]`; reproduce them **character for character**,
   including every diacritic. If you cannot reproduce an آیت exactly, cite it by surah and verse in
   Urdu instead and say so in `notes.gaps`. **Never paraphrase Quranic text as if it were Quranic
   text.**
5. **Honorifics are never de-pointed, abbreviated, transliterated or dropped.** `ﷺ` stays `ﷺ`.
   `رضی اللہ عنہ` / `رضی اللہ عنہا` / `رحمہ اللہ` / `علیہ السلام` stay exactly as the book prints
   them, including after a name that appears inside a diagram label or an exam question.
6. **Urdu-medium book → author entirely in Urdu** (§7), with **no `ur_overlay`**. Both NBF Islamiat
   books are Urdu-medium.
7. **No fiqhi ruling the book does not print.** Islamiat is the subject where "supply what the book
   omits" does not apply: if the pages do not state a ruling, the lesson does not state it. Record
   the gap in `notes.gaps` and teach what is printed.
8. **No sectarian framing, no comparative-denomination content, no takfir, and no contemporary
   political application** — even where a pupil might reasonably ask. The lesson stays on the book's
   own ground.
9. **`board_weight`** follows §2 by grade like any other subject; Islamiat (Compulsory) at SSC is a
   real FBISE paper for grades 9–10.
10. The `dua` page-truth block sometimes arrives with an empty `text` (the OCR could not carry the
    script). **Do not invent its contents.** Refer to it as "the آیت printed on p.N" and note it in
    `notes.gaps`.

---
---

## 5 · THE OUTPUT — `lp_doc` **schema_version 3.0** (`lp_html/schema/lp_doc.schema.json`)

This is the artefact of record; the PDF is a cache. `additionalProperties` is **false** everywhere —
emit these keys and no others, and use exactly these `type` values inside `blocks`.

```jsonc
{
  "lesson_id": "PK_G9_MATH_CH1_MATRIX_MULTIPLY",   // stable, SHOUTY_SNAKE; also the render cache key
  "schema_version": "3.0",
  "template_version": "v9",
  "lint_profile": "full",

  "provenance": {
    "book_stem": "grade_9_mathematics", "grade": 9, "subject": "Mathematics",
    "medium": "en",                       // "en" | "ur" — the book's language of INSTRUCTION
    "chapter": "Ch. 1 · Matrices and Determinants", "topic": "Multiplying two 2×2 matrices",
    "printed_pages": "24-25", "pdf_pages": "34-35", "page_offset": 10,
    "version": "2026-09-01",              // ISO date; the footer prints it. Never invent one.
    "brand": {"name": "NIETE Teaching Assistant", "primary_hex": "#333748"},   // the DEPLOYMENT's
    "source_quality_flags": ["known defects in the SOURCE the LP must not propagate"]
  },

  "notes": {                              // an OBJECT with these three arrays, not a flat list
    "supplied": ["the molar mass of O2 is 32 g — the book never states it (checked pp.100-102)"],
    "defects":  ["the book prints no answer key for the §6.4 questions"],
    "gaps":     ["the chapter prints no SLO code for this outcome"]   // say WHAT is absent, not "none"
  },
  "needs_human_review": false,            // true for سیرت / Islamiat / any religious content
  "human_review_reason": null,

  "slo": {
    "code": null,                         // null unless the book/FBISE prints a real code — never invent
    "text_verbatim": "…the printed outcome, word for word…",
    "source_page": "24",
    "cognitive_level": "K" | "U" | "A",
    "assessment_status": "Summative" | "Formative" | "Summative-PBA" | "Internal",
    "command_word": "multiply"
  },

  "lp_type": "STEM-1|STEM-2|STEM-3|LL-1|LL-2|LL-3|SS-1|SS-2|SS-3|RECALL|GEN-6-8",
  "period_minutes": 40,
  "board_weight": "FBISE SSC-I · ~5 marks" | null,   // a BADGE: <= 50 code points, null for 6-8
  "materials": ["board marker", "textbook p.24-25"], // physical things only. NO video link here.

  // ── the sequence strip (required) ─────────────────────────────────────────
  "sequence": {
    "previous": "Adding and subtracting matrices (p.22)",
    "this": "Multiplying two 2×2 matrices (p.24-25)",
    "next": "The determinant of a 2×2 matrix (p.26)",
    "checkpoint": "Ch. 1 assessment, day 9"
  },

  // ── O · ONE BOX ───────────────────────────────────────────────────────────
  "objectives": {
    "outcome": "You can multiply two 2×2 matrices and say when the product is defined.",
    "by_the_end": "By the end you can answer a 4-mark short-response question that asks you to find the product of two 2×2 matrices.",
    "items": [                            // TWO or THREE. Never six — split the LP instead.
      {"text": "State whether a product is defined by comparing the inner orders.", "slo_code": "M-09-A-07"},
      {"text": "Find the product of two 2×2 matrices row by column.", "slo_code": "M-09-A-07"}
    ]
  },

  "sections": [
    { "id": "introduction", "minutes": 10,
      "warmup": {                         // ONE ROW, inside the Introduction. Not a section.
        "items": [
          // THE SCAFFOLD FOR TODAY COMES FIRST. Prior knowledge alone is not a warm-up.
          {"ref": "W1", "kind": "scaffold",      "q": "Work out $3 \\times 2 + 4 \\times 5$, saying each product out loud before you add.", "a": "$26$"},
          {"ref": "W2", "kind": "prerequisite",  "q": "…", "a": "…"},
          {"ref": "W3", "kind": "spaced",        "q": "…", "a": "…", "from": "p.22, adding matrices"}
        ]
      },
      "blocks": [
        {"type": "ask", "id": "hook", "hook": true, "closed_by": "close-hook",
         "question": "…the provocation…", "look_for": "…what a right answer sounds like…"},
        {"type": "keywords", "page": "24", "items": [{"word": "order", "meaning": "rows × columns"}]},
        {"type": "watch_out", "text": "…the predictable wrong turn…"},
        {"type": "board", "text": "…what stays visible…"}
      ]},

    { "id": "development", "minutes": 12,
      "textbook_page": "24",              // REQUIRED. Reviewer sign-off 7.
      "video": {"url": "https://…", "title": "…", "channel": "…", "duration": "4:12",
                "why": "Play once after the I-do, so the class sees the sweep a second time."},
      "blocks": [
        // The FIRST block closes the hook, in its first sentence, and says so.
        {"type": "paragraph", "id": "close-hook", "closes_hook": true, "text": "Yes — …"},
        {"type": "key_points", "items": ["…≤5 declarative sentences…"]},
        {"type": "latex", "tex": "…", "caption": "…"},
        {"type": "worked_example", "id": "ido", "title": "I do — p.24, worked example 1",
         "prompt": "Find the product $AB$ when $A = …$ and $B = …$.",   // FULLY WORDED
         "steps": ["…"], "result": "…"},
        {"type": "watch_out", "misconception": true, "text": "…"}
      ]},

    { "id": "activity", "minutes": 12,
      "blocks": [
        // WE DO first, and TIMED.
        {"type": "faded_example", "id": "wedo", "minutes": 5, "title": "We do — together on the board",
         "prompt": "…", "steps": ["…", "Row 1 with column 2: you fill this in."], "answer": "…"},
        // THEN you do, also TIMED. Every item carries a ref and an answer.
        {"type": "practice", "id": "youdo", "mode": "independent", "minutes": 7,
         "cite": "Ex 1.3 Q1(a)-(c), p.25",
         "items": [
           {"ref": "P1", "tier": "support",   "level": "K", "q": "…", "a": "…"},
           {"ref": "P2", "tier": "core",      "level": "A", "q": "…", "a": "…"},
           {"ref": "P3", "tier": "extension", "level": "A", "q": "…", "a": "…"}
         ]}
      ]},

    { "id": "conclusion", "minutes": 4,
      "checkpoint": {"ref": "C1", "marks": 4,
        "question": "…one question, in the board's own phrasing…",
        "mark_scheme": ["1 mark: …", "2 marks: …", "4 marks: …"]},
      "exit_ticket": [{"ref": "X1", "q": "…", "a": "…"}],
      "reteach_rule": "If more than a third of the class miss the row-2 entries, redo the I-do on p.24 before the next period.",
      "blocks": [{"type": "board", "text": "…the line that stays up…"}]},

    { "id": "homework", "minutes": 2,     // NEVER 0
      "homework": {
        "items": [                        // AT LEAST HALF ARE "mcq" (spec §6, the board's ratio)
          {"ref": "H1", "format": "mcq",   "level": "K", "slo_code": "M-09-A-07", "marks": 1,
           "text": "Which product is defined? (A) … (B) … (C) … (D) …"},
          {"ref": "H2", "format": "mcq",   "level": "U", "slo_code": "M-09-A-07", "marks": 1, "text": "…"},
          {"ref": "H3", "format": "short", "level": "A", "slo_code": "M-09-A-07", "marks": 4,
           "source": {"page": "25", "questions": "Ex 1.3 Q2(a)"},   // cite, do not rewrite
           "text": "…"},
          {"ref": "H4", "format": "short", "level": "U", "slo_code": "M-09-A-07", "marks": 2, "text": "…"}
        ]
      },
      "blocks": [{"type": "key_points", "title": "", "items": ["Answers are checked at the start of the next period."]}]}
  ],

  // ── the REFERENCE BLOCK (key stays `page2`; it PRINTS as "Reference") ──────
  "page2": {
    "board_final": {"draw_order": ["…", "…"], "diagram": { /* optional */ }},
    "model_answers": [                    // EVERY entry names the question it answers
      {"ref": "P1", "answer": "…", "marking_note": "…"},
      {"ref": "C1", "answer": "…"}
    ],
    "mistakes": [{"pupil_says": "…", "you_ask": "…"}],          // 3 pairs
    "differentiation": {"stuck": "…", "barrier": "…", "early": "…"},
    "exam_bank": {
      // AT LEAST 2 (aim 2-3). One MCQ is a HARD FAIL at grades 9-12 and a warning below that.
      "mcq": [{"q": "…", "options": ["…","…","…","…"], "answer": "B",
               "distractor_codes": ["one short misconception code per WRONG option, in option order"]},
              {"q": "…", "options": ["…","…","…","…"], "answer": "A",
               "distractor_codes": ["…","…","…"]}],
      "srq": {"q": "…", "marks": 4, "mark_scheme": ["…"]},
      "erq_skeleton": {"q": "…", "marks_total": 8, "parts": [{"heading": "…", "marks": 2}]},
      "how_marked": "…what scores nothing and what scores half…"
    },
    "homework_key": [                     // THE ONLY place a homework answer may appear
      {"ref": "H1", "level": "K", "marks": 1, "answer": "…worked in full…"}
    ],
    "next_period": "…", "not_going": "…",
    "coaching_lookfor": "…direct instruction about the observable move — NOT a question…",
    "coaching_reflection": "…ONE question she asks HERSELF about HER class — ends in \"?\"…"
  },

  "one_screen": "…~200 words (150-260), the WhatsApp body…",
  "ur_overlay": { "/sections/0/blocks/0/question": "…" }   // JSON Pointers -> Urdu
}
```

### `blocks[]` — the ONLY block vocabulary

`paragraph` · `ask` · `watch_out` · `board` · `keywords` · `key_points` · `worked_example` ·
`faded_example` · `practice` · `support_extension` · `split` · `diagram` · `textbook_figure` ·
`latex` · `chem`.

**`say` NO LONGER EXISTS.** Spec §8 bans scripted talk outright, and the schema now enforces it.
Give the teacher the example and the board line instead. `NO_SAY_BOX` also catches the shape
smuggled into prose — `SAY: "…"`, `کہیے: "…"`.

### EXACT BLOCK SHAPES — copy these key layouts, do not improvise them

Six documents in two days emitted the same illegal shapes and every one refused to render.
The schema allows EXACTLY these keys — nothing more:

```json
{"type": "diagram", "id": "dg-water-cycle", "spec": {"type": "cycle", "caption": "…", "…": "…"}}
```
A diagram block is `type` + `id` + `spec`, full stop. The spec object carries EVERYTHING else —
its own `type` (one of the 20), title, caption, steps, panels. The four shapes that FAIL:
`"diagram": {…}` as the key instead of `"spec"`; `"caption"` sitting OUTSIDE spec (it goes
caption INSIDE `spec`); a missing `id`; a spec whose inner `type` is null or invented.

**DRAW EACH FIGURE ONCE — `DUPLICATE_DIAGRAM` is a hard fail.** `page2.board_final.diagram` is a
SEPARATE spec you author, not a pointer back to a figure in the lesson body — so pasting the body's
diagram into it prints the same picture twice and burns roughly half a reference page the teacher
paid to print. (The first staging maths LP did exactly this: the same `y = 2x + 1` / `y = 2x − 1`
graph in Development and again on the board page.) The gate compares specs with captions set aside,
so **re-wording the caption does not make it a different figure**. Decide which single home it has:

* it teaches a step → keep it in the body, and let `board_final.draw_order` describe the end state
  **in words** (that list is what the board page is for — a teacher copies it onto her board);
* it IS the finished board → keep `board_final.diagram` and cut it from the body.

Two genuinely different figures are always fine — vary the data, the window or the labels, not just
the caption.

```json
{"type": "textbook_figure", "id": "fig-1-1", "ref": "grade_10_biology/pg_008_f0",
 "figure_label": "Fig. 1.1", "page": "8",
 "caption": "as in your book, Figure 1.1, p.8",
 "legend": "Mouth → oesophagus → stomach → small intestine → large intestine. The liver and pancreas sit beside the canal and pour into it."}
```

A textbook_figure is FLAT — `ref`/`page`/`caption`/`legend`/`figure_label` sit directly on the
block, no nested `spec` (no nested anything). Four rules, and each of them was a live defect:

1. **`ref` is copied VERBATIM from the FIGURES list in your segment notes.** Its shape is
   `{book_stem}/{page}_f{k}` — `"grade_10_biology/pg_008_f0"`. Do not construct one, do not guess
   a page number into one, and **never emit a `textbook_figure` whose ref is not on that list**:
   the ref is what fetches a real crop of a real page, so an invented one can only produce an
   empty box where the pupil's picture should be.
2. **Never write `src`.** The path to the crop is resolved mechanically from `ref` after you
   answer, exactly as the video link is. Anything you put there is discarded.
3. **`legend` is a STRING, and it is required whenever there is a real crop.** The figure's own
   printed labels are baked pixels: at phone scale they are unreadable, so the legend is how the
   figure's content reaches the teacher as text she can actually read. Write it **in the lesson's
   own language** from the description in your notes — do not paste that description in, it is an
   English note written for a machine, and an English legend on an Urdu page is a defect (§7).
   A crop with no legend fails the lint and costs the lesson a revision round.
4. **`textbook_figure` does not count toward §4b.1's two `diagram` blocks** — but it DOES satisfy
   the "real figure" requirement in the §4b.2 rows that list `labelled_figure`. When the book has
   the picture and this engine cannot draw it — a photograph, an anatomical illustration, a map —
   the book's own figure is the *better* answer, not the fallback: it is the exact image the pupil
   is looking at in front of her.

**The exit ticket holds at most TWO items.** A third graded recall question belongs in the
activity's you-do (`P` refs), not the exit ticket — the schema hard-rejects a third `X` item.

### Refs — how an answer finds its question

Give every question-bearing item a short `ref`: `W1…` warm-up, `P1…` practice, `X1…` exit ticket,
`C1` the checkpoint, `H1…` homework. Every `model_answers` and `homework_key` entry points at one.
`REF_ABSENT` fails a ref that resolves to nothing, a question that nothing answers, and prose that
says "see Q7" when there is no Q7. When the book prints no SLO codes at all, tag homework with the
**objective ordinal** — `O1`, `O2` — never with an invented board code.

### Minutes

`minutes` on every section. `faded_example.minutes` and `practice.minutes` on the two activity
beats. `homework.minutes ≥ 1`. The sum equals `period_minutes`.

---

## 6 · MATHS, CHEMISTRY AND THE THINGS THAT PRINT AS GIBBERISH

This section is the expert's chief complaint, and it is one rule with four corollaries.

**MATHS IS ALWAYS LaTeX, INSIDE `$…$`.**

- **Never a row-list.** `A=[[1,0],[2,3]]` is Python, and it prints as Python.
  Write `$A = \begin{bmatrix} 1 & 0 \\ 2 & 3 \end{bmatrix}$`.
- **Never a subscript hack.** Do not fake a matrix with `^` and `_`. Use `bmatrix`.
  You do **not** need to ask for display style — the renderer promotes any matrix inside `$…$` to
  full height automatically. Write it inline and it will read correctly.
- **Balance every `$`.** An odd number of `$` in a string means one of them prints as a dollar sign.
  `MATH_LEAK` counts them.
- **Every text-bearing field goes through KaTeX** — a section `title`, a block `title`, a figure
  caption, a list item, a model answer, a board line. So maths in a title is fine *as maths*; raw
  TeX outside `$…$` anywhere is a build failure.
- `$$…$$` gives a centred display line inside prose; the `latex` block gives a boxed display formula
  with a caption. Prefer the block when the formula IS the point.
- **Chemistry:** put spaces around a `+` that is an operator. `\ce{2H2+O2->2H2O}` is read by mhchem
  as an ionic CHARGE and prints `H₂⁺O₂`. Write `\ce{2H2 + O2 -> 2H2O}`. `\ce{Na+}` is correct as-is.

**QUESTIONS ARE SENTENCES, NOT LABELS.** `UNWORDED_Q` fails anything that does not tell the pupil
what to do.

| Never write | Write |
|---|---|
| `\|B\|, B⁻¹: B = [ … ]` | If $B = \begin{bmatrix}…\end{bmatrix}$, find $\|B\|$ and then $B^{-1}$. |
| `35°C = ?` | The thermometer reads 35 °C. State whether that is a qualitative or a quantitative observation. |
| `$A^{-1}$ (p.68)` | Find $A^{-1}$ for the matrix in Exercise 3.2 Q4 on p.68, which is $A = \begin{bmatrix}…\end{bmatrix}$. |

A page citation is a **pointer**, not a question. If you cite `Ex 3.2 Q4, p.68`, you must **also
state the question inline** — the teacher has one book and thirty pupils, and the reference block
has to solve it in full anyway.

**DIAGRAMS MUST BE WORTH LOOKING AT.** `DIAGRAM_DEGENERATE` fails a drawing whose subject is a
sliver, spans the canvas while being hairline, or leaves the canvas essentially blank. The
determinant-3 parallelogram was geometrically correct and pedagogically useless. **Choose numbers
that draw well**: for a determinant of 3, prefer $\begin{bmatrix} 3 & 1 \\ 1 & 2 \end{bmatrix}$
(det 5, a fat parallelogram) over one whose vectors are nearly parallel. Sanity-check every spec by
asking: *could a pupil point at the area?*

---

## 7 · HOMEWORK — the G9 Physics sample is the pattern

The Physics reviewer named it: homework that is real board-shaped work, tagged, and answerable.

- **THREE TO FIVE items. Four is the shape to aim at, and `HW_ITEM_COUNT` fails at more than 5.**
  Fewer, better questions (operator, 2026-09-02) — homework is the tail a teacher cuts first, and
  a six-item set is how a plan spends page 4 on work nobody marks. This is a DIFFERENT count from
  the *graded-items* bar below (the you-do items plus the exit ticket, 6–8 of them): that is
  classwork, it is unchanged, and it is not homework.
- **Real FBISE past/model-paper items, or textbook questions cited by page and number.** Never
  invent a past-paper citation. If you cannot verify it, use the textbook and cite it.
- **Every item tagged `[SLO code, K/U/A]`** — printed on the page as a chip beside the item. The
  code must be one this LP actually taught (`HW_TAGS` checks it against the O box).
- **MCQ-weighted** — at least half the items are `format: "mcq"`. The Maths HoD asked for the
  board's 50% ratio in practice, homework *and* assessment.
- **Only today's content.** An item that needs next period's method is a fail, not a stretch.
- **Never repeats a class item.** `DUP_QUESTION` normalises the text and compares it against every
  warm-up, practice and exit-ticket item. Copying is not practice.
- **No answers beside the questions.** `HW_ANSWER_INLINE` catches "Answer: …" and an item that has
  absorbed its own key. The answers go in `page2.homework_key`, worked in full — textbook questions
  included, because a teacher marking at 10pm does not have the answer key.
- **`homework.minutes ≥ 1`.** A "0 min" badge tells the teacher the work costs nothing.

---

## 7b · LANGUAGE, AND THE URDU TOGGLE

- **English-medium book (`provenance.medium: "en"`)** → the whole lp_doc is authored in **English**.
  Urdu may appear only as a keyword gloss. Then add an **`ur_overlay`**: a flat map of RFC-6901 JSON
  Pointers into this same document → the Urdu string that replaces the English one at render time.
  The structure never changes; only instruction strings swap.
  **What may NOT be overlaid** (lint enforces it): `/slo/text_verbatim` (a quoted printed outcome),
  anything under `/page2/exam_bank` (the exam is in the book's language), and the `text` of any
  `board` block (board text follows the exam). A textbook quotation *inside* a paragraph stays in the
  book's language too — overlay the instruction around it, not the quote. Numbers, formulae and
  `\ce{…}` never change.
- **Urdu-medium book (`provenance.medium: "ur"`)** → author the whole lp_doc **directly in Urdu**,
  once, in Urdu script, and emit **no `ur_overlay`**. No English instruction strings, no
  self-translation, no Roman Urdu. Technical terms of record may stay English where the book prints
  them English. Keep every honorific (`ﷺ`) exactly as printed.
- **Textbook quotations always stay in the book's language**, whatever the instruction language is.

## 7c · WRITING URDU AND ENGLISH ON THE SAME PAGE

The page's base direction is RTL and the renderer lays your text out with the Unicode bidi
algorithm. You write **logical order** — the order the sentence is read aloud — and you never
compensate for layout by re-ordering words. These rules are about what to WRITE; the renderer
owns direction and isolation.

1. **Digits in Urdu prose are Urdu digits: ۰۱۲۳۴۵۶۷۸۹** (the same rule diagrams already
   follow). Keep ASCII digits inside math, `\ce{…}`, SLO codes, URLs and the phone number —
   those are Latin atoms and the renderer isolates them.
2. **Page ranges in Urdu prose use تا, never a hyphen:** «ص ۸۵ تا ۸۸», «صفحات ۶ تا ۷». A
   hyphenated range beside Urdu text paints reversed («7-6») — تا cannot. Single pages are
   fine either way: «ص ۸۵».
3. **An English term of record sits exactly where the word belongs in the Urdu sentence.**
   Do not move it to the sentence edge, do not bracket it away, do not repeat it in Roman
   Urdu. First mention in a lesson carries an Urdu gloss in parentheses:
   «ضیائی تالیف (Photosynthesis) کے عمل میں پودے…». After that, use whichever single form the
   book itself prints. Which words ARE terms of record: the ones the book prints in English —
   scientific, mathematical and technical vocabulary the pupil must recognise on the exam
   paper. The exam's language is the book's language, always (§7b).
4. **Citations are one language in one order.** In an Urdu document write the source line
   fully Urdu-first: «(تشخیص: Summative · یونٹ ۵ · ص ۸۵)» — the English classification word
   last, immediately before the closing bracket, never interleaved digit-by-digit with Urdu
   words. Never write «صفحہ 85 · U · Summative» — it paints garbled on every render.
5. **Prefer sentence shapes that do not END on an English term.** «…photosynthesis کہتے ہیں۔»
   is safe; «…اسے کہتے ہیں photosynthesis.» strands the full stop. When the term must be last,
   end with the Urdu full stop ۔ directly after it and accept the renderer's isolation.
6. **Never split a Latin atom.** A formula, a `\ce{…}`, a URL, a code like `PS-10-C1-O1`, the
   phone number as dialled — each is written whole, in one place, untranslated, with no Urdu
   inserted inside it.
7. **In an `ur_overlay`, overlay EVERY instruction string you are allowed to** (§7b lists the
   protected slots). A half-overlaid document serves half-English prose under an Urdu label;
   the renderer cannot fix a missing translation.

---
---

## 8 · WORD BUDGETS — the page is finite

`lint_lp.js` budgets each section and the whole document; the renderer then proves the fit by
measuring the real layout. **TEACH ≤ 6 A4 pages, SUPPORT ≤ 4** (the measured capacity at the 18px
body floor). Over the cap is a loud failure, not a quiet trim. **An Urdu render is allowed
TEACH ≤ 7, SUPPORT ≤ 6** — the same words measured ~+33% more paper under Nastaliq's spacing —
but the WORD budgets below are one set of numbers for both languages: an Urdu plan says no more
than an English one; it only breathes more.

**Write to the AIM column, not the ceiling.** Word counters differ by a few percent and no model
counts words precisely — a document written *at* a ceiling lands a few words over it and costs a
full revision round for nothing. The ceilings below are the lint's hard stops (budget +30%); your
target is the aim.

> **These numbers came DOWN on 2026-09-02 and the page caps did not.** The pipeline's v9 documents
> were running 5–7 teach pages against the 5-page cap, because a v9 lesson is diagram- and
> table-heavy and words under-predict paper. The operator's call was to hold 5 + 4 and **cut the
> words ~15%**, with homework cut harder and the learning-outcome box cut hardest — it had been
> eating most of page 1. If a lesson genuinely will not fit, **cut content**; do not compress by
> writing denser prose, and never drop the body size.

| Section (v9) | Aim (words) | Hard ceiling | What it holds |
|---|---|---|---|
| Introduction | ~120 | 170 | the warm-up row **plus** the hook, vocabulary, watch-out and board line |
| Development | ~170 | 243 | key points, the I-do, the citation, the video line, the misconception |
| Activity | ~200 | 287 | the we-do and the you-do, with every answer |
| Conclusion | ~115 | 166 | the board question **and its mark scheme**, the exit ticket, the re-teach rule |
| Homework | ~85 | 124 | **3–5 tagged items** (their answers are in the reference block) |
| Whole document | **1,000–1,100** | 800–**1,200** | the measured five-page capacity at the 18px body floor |

**The learning-outcome box (`O`) has its own ceiling now** — it is the first thing printed and it
was running 70–120 words across the samples. `OUTCOME_BOX` is a hard gate, not a ±30% budget:

| Field | Aim | Hard ceiling |
|---|---|---|
| `outcome` — the one thing the pupil can do | ~15 words | **20** |
| `by_the_end` — the ✓ line naming the question type and its marks | ~18 words | **22** |
| **each** objective | ~12 words | **15** |
| the whole box (all of the above added up) | **~60 words** | **80** |

Write the outcome as one clause: *"Multiply two 2×2 matrices and state the order of the product."*
An objective that needs a subordinate clause is two objectives — split it or drop one.

**Over the ceiling FAILS** — it will not fit, and the renderer proves it. **Under budget only
WARNS**: short is allowed, and the finding that teachers cut the tail of a long plan first has not
changed. If a section will not fit, **cut content** — never compress by writing denser prose, and
never drop the body size.

**`board_weight` is a BADGE, not a sentence — 50 code points, hard.** It sits in the masthead
beside the grade. `"FBISE SSC-I · ~5 marks"` (22) is the shape; an 82-character badge
describing the paper is what broke the Grade 9 Biology header. Grades 6–8 carry `null`.

Three counted bars the lint holds you to, so hit them on the first pass:
- **Write SEVEN graded items with answers** (bar 6–8). The you-do items and the exit ticket count
  *together* — spread them, don't stack one block.
- **`exam_bank.mcq`: write at least 2 MCQs** (aim 2–3), each with one distractor code per
  WRONG option. One MCQ is a **hard fail** at grades 9–12 and a warning below that.
- **`one_screen`: aim 180–230 words** (hard 150–260). It is not counted in the document total —
  write it in full; a 145-word one_screen fails just as loudly as a 270-word one.

**Urdu costs roughly 1.5× the space of English** at the same content, because Nastaliq needs a
unitless line-height ≥ 2.0. An `ur_overlay` does not change the word budget, but it does change the
page count — an English plan packed to the cap will overflow in Urdu. Aim for ≤4 teach pages in
English if the lesson has an Urdu toggle.

---

## 8b · THE COACHING CORNER — the teacher's own square inch of the page

Section `H` of the reference block is **not** about the pupils. It is the one place on the plan
addressed to the teacher as a professional, and it is the K-5 shape, ported: **something from THIS
lesson → a question she asks herself → an offer of real coaching.**

**You write two fields. The renderer prints the third part.**

| Field | What it is | Gate |
|---|---|---|
| `coaching_lookfor` | The **observable move from THIS lesson** — what a coach standing at the back would see her do. Direct instruction, present tense, never a question. | `NO_SAY_BOX` |
| `coaching_reflection` | **ONE question she asks HERSELF**, about **her own class**, after **this** lesson. Ends in `?`. | `COACHING_CORNER` |
| *(the offer)* | "Record up to 40 minutes → send it to NIETE on WhatsApp **0320 6281951** → same-day tips back." **Printed by the renderer. Do not write it, do not repeat the number.** | — |

**The reflection is the part that goes wrong, so here is the test.** A reflection is about HER
ROOM. A question you could answer out of the textbook is the pupils' question, not hers, and the
gate rejects it:

| ✗ Not a reflection | ✓ A reflection |
|---|---|
| "What is the order of the product of a 2×2 and a 2×2 matrix?" | "Which of my pupils could say the address out loud before writing it, and who do I re-teach that to tomorrow?" |
| "Why does the mole ratio come from the balanced equation?" | "Did my class balance the equation first, or did most of them go straight to the numbers?" |
| "Reflect on your teaching." *(generic — it could sit on any plan)* | "Which of the three groups needed the printed grid, and do I start there next time?" |

Mechanically, the gate looks for the marks of her own practice — *my / I / my pupils / the class /
who / tomorrow / next time / re-teach* (Urdu: *میرے، اپنے، بچے، جماعت، کل، دوبارہ، کس کو*). Content
questions carry none of them, which is exactly the difference.

**Urdu-medium plans reflect in Urdu.** The number itself stays as it is dialled: `0320 6281951`.

---

## 9 · SELF-AUDIT BEFORE YOU EMIT

Run every line against the document you are about to return. Repair, then output. These are the
reviewer's own sign-off questions plus the gates that will run on it anyway — finding it here costs
one edit; finding it in the build costs a round.

**The reviewer's list, in order — stop at the first fail:**

1. Is anything **assessed** today that was not **taught** today? (warm-up, practice, exit ticket,
   checkpoint, homework, exam bank — all of it)
2. Do the section minutes sum to `period_minutes` **exactly**, and is `homework.minutes ≥ 1`?
3. Is the hook closed **inside** Development's **first** block, with `closes_hook: true`?
4. Does every objective have an SLO code, and is each one **modelled, practised in class AND
   assessed today**? (an objective that only appears in homework is a fail)
5. Is it **one skill**, or more than one?
6. Are the headings the closed list — outcome and objectives in **one box**, warm-up **inside**
   Introduction?
7. Does Development **cite the textbook page** it teaches from?
8. Is the MCQ share at the board's ratio, with a **coded distractor on every wrong option**?

**Then the mechanical sweep:**

- [ ] Every `$` is balanced; no `\begin`, `\frac` or `\ce` sits outside `$…$`; **no row-lists** anywhere.
- [ ] Every question is a **sentence** that says what to do — warm-up, practice, exit ticket,
      checkpoint, homework, exam bank, and every `prompt`.
- [ ] Every referenced question is **stated inline**, not just cited.
- [ ] Every question has a `ref`; every `model_answers` / `homework_key` entry names one that exists;
      every question is answered somewhere.
- [ ] Every MCQ has one distractor code per wrong option. (Author them; the renderer hides them.)
- [ ] Homework: **3–5 items**, tagged `[SLO, K/U/A]`, ≥50% MCQ, today's content only, **no answers**,
      nothing copied from a class item.
- [ ] The O box is inside its ceilings — outcome ≤20 words, `by_the_end` ≤22, each objective ≤15,
      **the whole box ≤80**. It is the first thing on page 1 (§8).
- [ ] `board_weight` is a badge of **≤50 code points**, or `null` for grades 6–8.
- [ ] Religious content: every mention of the Prophet carries `ﷺ`, every companion carries the
      honorific the book prints, no sacred name is in Latin script, every quoted prophetic word
      carries its hadith or its printed page, and `needs_human_review` is set (§4c).
- [ ] The warm-up's **first** item is the `scaffold` for today; a `prerequisite` and a `spaced` item
      follow.
- [ ] Vocabulary pre-teach is in the Introduction and carries its **page**.
- [ ] Activity has a **timed** we-do **before** a **timed** you-do.
- [ ] Conclusion has the board question + mark scheme, the exit ticket, and the re-teach rule with a
      **threshold**.
- [ ] `sequence` is filled in.
- [ ] No `say` block; no `SAY "…"` in any prose; `coaching_lookfor` **instructs** and does not
      ask, and `coaching_reflection` **is a question about her own class** (§8b).
- [ ] No concept is used before its teaching beat.
- [ ] Every diagram would let a pupil point at the thing it is about.
- [ ] No brand but `provenance.brand` appears anywhere in the content.
- [ ] No authoring metadata — no `lp_type` code, no rubric name, no instruction from this brief —
      appears in any teacher-facing block.
- [ ] `notes.gaps` says **what is absent**, in words. Never `"none"`.
- [ ] `one_screen` is 150–260 words.

**Then run the gates yourself if you can:**

```bash
node lp_html/lint_lp.js  <doc>.lp.json        # every gate above, deterministically
node lp_html/render_lp.js <doc>.lp.json --png # the page cap, the type floor, the figures
```

A clean `lint_lp.js` and a clean `render_lp.js` are the definition of done for a v3 document.
