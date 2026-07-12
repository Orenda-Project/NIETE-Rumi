/**
 * Lesson Plan Template Service
 *
 * SINGLE SOURCE OF TRUTH for the text/Gamma lesson-plan framework.
 *
 * Before this service existed, the framework was defined THREE times inside
 * content.service.js `_generateGammaContent`, and the three copies disagreed:
 *   1. a ~70-line inline section list (## 1 … ## 9) in `inputText`,
 *   2. `numCards: 7` (a Gamma card-count knob), and
 *   3. `additionalInstructions` that said "Include all 9 sections".
 *
 * Customizers ("use our school's 5E model instead of the 9-section structure")
 * had to find and reconcile all three. Now they edit ONE file: this one.
 *
 * ── The framework ──────────────────────────────────────────────────────────
 * The lesson plan follows an evidence-based 9-section structure whose middle
 * five sections (4–8) ARE the 5E instructional model (Engage, Explore, Explain,
 * Elaborate, Evaluate), wrapped by Objectives/Overview/Materials up front and a
 * Differentiation section at the end. Sections 4–8 carry the 5E labels inline.
 *
 * ── numCards vs. section count (the resolved 7-vs-9 confusion) ───────────────
 * SECTION_COUNT (9) is how many `## N` headings the prompt asks Gamma to render
 * and what `additionalInstructions` references — these two MUST agree.
 *
 * `numCards` (7) is a SEPARATE Gamma knob: a soft hint for how many slide-cards
 * Gamma lays the document out across. It is intentionally NOT the section count
 * — Gamma groups the 9 sections onto ~7 cards. It is preserved at 7 to keep the
 * generated Gamma output byte-equivalent to the pre-extraction behavior.
 */

// The 9-section framework body. Sections 4–8 are the 5E model.
// This is the EXACT text previously inlined in content.service.js, verbatim.
const SECTIONS_BLOCK = `## 1. LEARNING OBJECTIVES & SUCCESS CRITERIA
- 2-3 clear, measurable learning objectives aligned with curriculum standards
- Student-friendly success criteria ("I can..." statements)
- Connection to prior knowledge and real-world applications

## 2. LESSON OVERVIEW
- Grade level and subject
- Duration (typically 40-60 minutes)
- Key concepts and vocabulary
- Prerequisites

## 3. MATERIALS & PREPARATION
- Required materials (emphasize low-cost, locally available resources)
- Teacher preparation steps
- Student handouts or worksheets needed
- Technology/digital resources (if applicable)

## 4. INTRODUCTION (ENGAGE) [8-10 minutes]
- Hook/attention-grabber to activate prior knowledge
- Essential question for the lesson
- Learning objectives shared with students
- Connection to students' lives and experiences

## 5. EXPLORATION/INVESTIGATION [15-20 minutes]
- Hands-on activity or investigation for students to explore the concept
- Guiding questions for teachers to ask
- What students should observe/discover
- Group work or pair work structures
- Common misconceptions to address

## 6. EXPLANATION/DIRECT INSTRUCTION [10-15 minutes]
- Clear, step-by-step explanation of key concepts
- Visual aids, diagrams, or models to use
- Examples and non-examples
- Vocabulary definitions with context
- Teacher modeling and think-aloud strategies

## 7. ELABORATION/GUIDED PRACTICE [10-15 minutes]
- Structured practice activities progressing from simple to complex
- Scaffolding strategies for struggling learners
- Extension challenges for advanced students
- Real-world application tasks
- Collaborative learning opportunities

## 8. EVALUATION/FORMATIVE ASSESSMENT [5-10 minutes]
- Formative assessment strategy (exit ticket, quick quiz, demonstration, etc.)
- Questions to check for understanding throughout the lesson
- Success criteria checklist
- Homework assignment (if applicable)
- Preview of next lesson

## 9. DIFFERENTIATION STRATEGIES
- Support for struggling learners (scaffolds, sentence frames, visual aids)
- Extensions for advanced students (depth, complexity, independent research)
- Language support for multilingual learners
- Modifications for students with special needs
- Alternative assessment options`;

// How many `## N` sections the framework above defines. Single source for the
// number quoted in additionalInstructions — derived, not hardcoded a 2nd time.
const SECTION_COUNT = (SECTIONS_BLOCK.match(/^## \d+\./gm) || []).length;

// Gamma slide-card layout hint (NOT the section count). See header note.
const NUM_CARDS = 7;

// The trailing instructional block appended after the section list. Verbatim.
const FRAMEWORK_TRAILER = `Throughout the lesson plan, include:
- Specific dialogue examples for teachers
- Transition phrases between activities
- Time allocations for each section
- Questioning strategies (open-ended, probing, wait time)
- Classroom management tips for large/mixed-ability classes
- Formative assessment checkpoints

Make this practical, detailed, and immediately usable by teachers with varying experience levels.`;

/**
 * Build the lesson-plan prompt pieces from the single framework source.
 *
 * @param {object} [params]
 * @param {string} [params.language]  Language code (reserved for future
 *        per-language framework tweaks; the section framework is currently
 *        language-agnostic — the language-specific intro/suffix are owned by
 *        gamma-languages.config and applied by the caller).
 * @param {number|string} [params.grade]    Reserved; not yet woven into the
 *        framework body (grade calibration is a separate, pic-LP-only path).
 * @param {string} [params.subject]          Reserved; see grade.
 * @returns {{ inputText: string, numCards: number, additionalInstructions: string, sectionCount: number }}
 *   - inputText: the framework body to embed in the Gamma document prompt
 *     (the section list + the reinforcement trailer).
 *   - numCards: Gamma card-layout hint (7).
 *   - additionalInstructions: the "preserve structure, include all N sections"
 *     instruction, with N sourced from SECTION_COUNT (no hardcoded 2nd copy).
 *   - sectionCount: SECTION_COUNT (9), exposed for tests/consumers.
 */
function buildLessonPlanPrompt({ language, grade, subject } = {}) {
  const inputText = `This lesson plan should follow evidence-based pedagogical frameworks and be suitable for teachers in Pakistani classrooms (mixed-ability, limited resources). Structure the plan with these sections:

${SECTIONS_BLOCK}

${FRAMEWORK_TRAILER}`;

  const additionalInstructions =
    `Maintain the exact structure and formatting provided in the prompt. ` +
    `Include all ${SECTION_COUNT} sections with clear headings. ` +
    `Preserve all bullet points, time allocations, and instructional details. ` +
    `Do not summarize or condense the content.`;

  return {
    inputText,
    numCards: NUM_CARDS,
    additionalInstructions,
    sectionCount: SECTION_COUNT,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Grounded mode — Gamma consumes a pre-authored LP from curriculum_lp_ast
// ─────────────────────────────────────────────────────────────────────────
//
// The freeform framework above (5E model, 9 sections) asks Gamma to INVENT
// lesson content from a topic string. The grounded mode is different: the
// SOURCE JSON already has a 5-step GRR (Gradual Release of Responsibility)
// structure that mirrors modern structured pedagogy — one source array per
// GRR phase. So the grounded framework IS the source's own structure, not a
// 9-section wrapper. This gives a clean 1:1 mapping (no more splitting
// practice_steps across Exploration + Elaboration like the 5E wrapper did)
// and gives teachers the action-oriented "what am I doing right now?"
// mental model instead of the theory-descriptive 5E labels.
//
// Map of source columns → 5 GRR sections:
//   opening_steps                → 1. OPENING (hook / activate prior knowledge)
//   explain_steps                → 2. I DO (teacher models the concept)
//   practice_steps               → 3. WE DO (guided practice together)
//   independent_practice_steps   → 4. YOU DO (independent practice)
//   conclusion_steps             → 5. CONCLUSION (wrap-up + exit ticket)
//   classroom_setup_instructions → Materials & Preparation header block
//   homework_instructions        → Homework footer within Section 5
//   topic + lp_slo               → Learning Objectives header block
//   chapter_title/grade/subject  → Title bar
//   Differentiation, misconceptions → Differentiation Strategies footer
//
// The core guarantee: preserve teacher scripts (`{type: 'Say', statement: ...}`)
// as verbatim teacher dialogue in the rendered PDF. The GRR labels come from
// the framework template; content comes from the source arrays.

// GRR framework template with {section_time} placeholders substituted per LP.
// (Deployed 2026-07-12 as part of the 5E→GRR framework migration.)
const GRR_SECTIONS_TEMPLATE = `## 1. OPENING [{opening_time} minutes]
- Warm greeting + hook that activates prior knowledge
- Learning-objective preview shared with students
- Any classroom-management set-up (groups, materials distribution)

## 2. I DO — Direct Instruction [{explain_time} minutes]
- Teacher models the concept step-by-step
- Teacher thinks aloud so students hear the reasoning
- Board work: teacher writes / demonstrates while students observe
- Common misconceptions the teacher flags before students hit them

## 3. WE DO — Guided Practice [{practice_time} minutes]
- Teacher + students work through examples together
- Teacher circulates, asks questions, adjusts pacing
- Structured practice moving from simple to complex
- Checkpoints for understanding before releasing to independent work

## 4. YOU DO — Independent Practice [{independent_practice_time} minutes]
- Students practice on their own or in pairs
- Teacher observes and supports individual students
- Extension challenges for advanced students
- Scaffolds for struggling students (concrete manipulatives, sentence frames)

## 5. CONCLUSION — Wrap-up + Formative Assessment [{conclusion_time} minutes]
- Exit-ticket question or quick check-for-understanding
- One-sentence recap of the key takeaway students should walk away with
- Homework assignment + preview of next lesson
- Celebration / acknowledgment of student effort`;

const GRR_SECTION_COUNT = 5;

function fillGrrSectionTimes(lp) {
  return GRR_SECTIONS_TEMPLATE
    .replace('{opening_time}', lp.opening_time || 5)
    .replace('{explain_time}', lp.explain_time || 15)
    .replace('{practice_time}', lp.practice_time || 10)
    .replace('{independent_practice_time}', lp.independent_practice_time || 8)
    .replace('{conclusion_time}', lp.conclusion_time || 5);
}

function stepsToText(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return '(none)';
  return steps
    .map((s) => {
      const idx = s?.index != null ? `${s.index}. ` : '';
      const type = s?.type ? `[${String(s.type).toUpperCase()}] ` : '';
      const statement = s?.statement || '';
      return `${idx}${type}${statement}`.trim();
    })
    .filter(Boolean)
    .join('\n');
}

function totalMinutes(lp) {
  return (
    (lp.opening_time || 0) +
    (lp.explain_time || 0) +
    (lp.practice_time || 0) +
    (lp.independent_practice_time || 0) +
    (lp.conclusion_time || 0)
  );
}

/**
 * Build a grounded lesson-plan prompt for Gamma from a curriculum_lp_ast row.
 *
 * @param {Object} lp - a row from curriculum_lp_ast
 * @param {Object} [opts]
 * @param {string} [opts.language]  'en' | 'ur' (informational; the caller
 *   applies the langConfig intro/suffix separately)
 * @returns {{inputText: string, numCards: number, additionalInstructions: string, sectionCount: number}}
 *   Same shape as buildLessonPlanPrompt for drop-in compatibility.
 */
function buildGroundedLessonPlanPrompt(lp, { language } = {}) {
  if (!lp) throw new Error('buildGroundedLessonPlanPrompt: lp is required');

  const gradeSubject = `${lp.grade_label || ''} ${lp.subject_label || ''}`.trim();
  const durationMin = totalMinutes(lp);
  const durationText = durationMin
    ? `${durationMin} minutes total (opening ${lp.opening_time || 0}, explain ${lp.explain_time || 0}, practice ${lp.practice_time || 0}, independent ${lp.independent_practice_time || 0}, conclusion ${lp.conclusion_time || 0})`
    : '40-60 minutes';

  // Language reconciliation directive.
  // Grounded LPs have TWO independent language axes:
  //   1. FRAMEWORK LANGUAGE: section headings ("Section 4 · Introduction"),
  //      framework prose ("Learning Objectives", "Materials"), differentiation
  //      strategies — these follow the requested `language` param.
  //   2. SOURCE CONTENT: teacher scripts inside [SAY]/[ASK]/[INSTRUCTION]/
  //      [ANSWER]/[DO] markers — these come from the source LP and MUST be
  //      preserved verbatim regardless of `language` (they may themselves be
  //      Urdu, English, or bilingual code-switched depending on publisher).
  // ContentService also injects langConfig.promptSuffix ("Generate all content
  // in Urdu (اردو)…") ahead of this text — the reconciliation directive below
  // tells Gamma which parts of "all content" are excluded from translation.
  const isUrdu = language === 'ur';
  const languageDirective = isUrdu
    ? `LANGUAGE — FRAMEWORK vs SOURCE (READ CAREFULLY):
Render section HEADINGS ("Section 4 · Introduction (Engage)" etc.) and framework prose (Learning Objectives, Materials, Differentiation Strategies) in Urdu (اردو).
DO NOT translate or paraphrase teacher scripts, dialogue, or content inside [SAY], [ASK], [INSTRUCTION], [ANSWER], or [DO] markers — preserve them exactly as written in the source below. The source content may itself be Urdu, English, or mixed — keep it as-is.
KEEP the marker tags themselves in English ([SAY]/[ASK]/[INSTRUCTION]/[ANSWER]/[DO]) so teachers can visually distinguish action types.`
    : `LANGUAGE — FRAMEWORK vs SOURCE:
Render section headings and framework prose in English.
DO NOT translate or paraphrase teacher scripts inside [SAY]/[ASK]/[INSTRUCTION]/[ANSWER]/[DO] markers — the source content may already be in Urdu, English, or bilingual code-switched form; preserve verbatim.`;

  const grrSections = fillGrrSectionTimes(lp);

  const inputText = `You are LAYING OUT a pre-authored Pakistani primary-school lesson plan into the 5-step Gradual Release of Responsibility (GRR) framework below. The framework mirrors the source JSON's own step arrays 1:1 — each source array is exactly ONE GRR section. Do NOT invent new content. Do NOT paraphrase teacher scripts — preserve them verbatim. Where the source is silent on a section, keep it brief; do not fabricate.

${languageDirective}

LESSON PLAN SOURCE (from ${lp.publisher || 'publisher'} for ${gradeSubject}):

Topic: "${lp.topic || ''}"
Chapter: ${lp.chapter_number || ''}. ${lp.chapter_title || ''}
Publisher: ${lp.publisher || ''}
Grade: ${lp.grade_label || lp.grade || ''}
Subject: ${lp.subject_label || lp.subject || ''}
Duration: ${durationText}
Curriculum: ${lp.curriculum_key || ''}
SLO codes / Learning objectives: ${(lp.lp_slo && lp.lp_slo.length) ? lp.lp_slo.join(', ') : '(derive from topic)'}
${lp.contains_video ? `Videos: ${(lp.videos || []).join(', ')}` : ''}

CLASSROOM SETUP (for the "Materials & Preparation" header block — verbatim from source):
${stepsToText(lp.classroom_setup_instructions)}

OPENING STEPS — for Section 1 OPENING (verbatim from source):
${stepsToText(lp.opening_steps)}

EXPLAIN STEPS — for Section 2 I DO (verbatim from source):
${stepsToText(lp.explain_steps)}

PRACTICE STEPS — for Section 3 WE DO (verbatim from source):
${stepsToText(lp.practice_steps)}

INDEPENDENT PRACTICE STEPS — for Section 4 YOU DO (verbatim from source):
${stepsToText(lp.independent_practice_steps)}

CONCLUSION STEPS — for Section 5 CONCLUSION (verbatim from source):
${stepsToText(lp.conclusion_steps)}

HOMEWORK (renders inside Section 5 — verbatim from source):
${stepsToText(lp.homework_instructions)}

Structure the rendered lesson plan as:
- A title bar with the topic, grade + subject, and total duration
- A short "Learning Objectives" header block (from the topic + SLO codes)
- A short "Materials & Preparation" header block (from the Classroom Setup above)
- The 5 GRR sections below, each populated with the corresponding source array VERBATIM
- A closing "Differentiation Strategies" block (support for struggling students, extension for advanced)

Preserve step numbering. Preserve teacher scripts (lines starting with [SAY], [ASK], [INSTRUCTION], [DO], [ANSWER]) verbatim as teacher dialogue. Use the section timings shown in each heading.

${grrSections}`;

  const additionalInstructions =
    `The source lesson-plan content above is PRE-AUTHORED and MUST be preserved verbatim. ` +
    `Lay it out into the ${GRR_SECTION_COUNT}-step GRR framework (OPENING / I DO / WE DO / YOU DO / CONCLUSION) — do NOT invent or add new content. ` +
    `Each source array (opening_steps / explain_steps / practice_steps / independent_practice_steps / conclusion_steps) maps 1:1 to exactly ONE framework section — do NOT split content across sections. ` +
    `Where source is silent on a section, keep that section brief (2-3 bullet points based only on info in the source). ` +
    `Preserve teacher scripts ([SAY]/[ASK]/[INSTRUCTION]/[DO]/[ANSWER]) as verbatim teacher dialogue. ` +
    `Preserve all time allocations shown in the section headings. ` +
    `Do not summarize or condense.`;

  return {
    inputText,
    numCards: NUM_CARDS,
    additionalInstructions,
    sectionCount: GRR_SECTION_COUNT,
  };
}

module.exports = {
  buildLessonPlanPrompt,
  buildGroundedLessonPlanPrompt,
  SECTION_COUNT,           // 9 — freeform (5E) framework
  GRR_SECTION_COUNT,       // 5 — grounded (GRR) framework
  NUM_CARDS,
};
