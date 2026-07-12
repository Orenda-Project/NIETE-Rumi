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
// The freeform framework above asks Gamma to INVENT lesson content from a
// topic string. The grounded mode is different: we already have the finished
// LP content (imported into curriculum_lp_ast from Taleemabad prod). We hand
// it to Gamma verbatim and ask it to LAY OUT the given content into the
// 9-section frame, not invent new content.
//
// Map of source columns → 9-section slots:
//   opening_steps                → 4. INTRODUCTION (ENGAGE)
//   explain_steps                → 6. EXPLANATION / DIRECT INSTRUCTION
//   practice_steps               → 5. EXPLORATION + 7. ELABORATION
//   independent_practice_steps   → 7. ELABORATION
//   conclusion_steps             → 8. EVALUATION
//   classroom_setup_instructions → 3. MATERIALS & PREPARATION
//   homework_instructions        → Trailing homework block within 8
//   topic + lp_slo               → 1. LEARNING OBJECTIVES
//   chapter_title/grade/subject/timing → 2. LESSON OVERVIEW
//
// The whole point: preserve teacher scripts (`{type: 'Say', statement: '...'}`)
// as verbatim teacher dialogue in the rendered PDF.

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

  const inputText = `You are LAYING OUT a pre-authored Pakistani primary-school lesson plan into the 9-section framework below. Do NOT invent new content. Do NOT paraphrase teacher scripts — preserve them verbatim. Where the source is silent on a section, keep it brief; do not fabricate.

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

CLASSROOM SETUP (verbatim from source):
${stepsToText(lp.classroom_setup_instructions)}

OPENING STEPS — for Section 4 ENGAGE (verbatim from source):
${stepsToText(lp.opening_steps)}

EXPLAIN STEPS — for Section 6 DIRECT INSTRUCTION (verbatim from source):
${stepsToText(lp.explain_steps)}

PRACTICE STEPS — for Sections 5 EXPLORATION + 7 ELABORATION (verbatim from source):
${stepsToText(lp.practice_steps)}

INDEPENDENT PRACTICE STEPS — for Section 7 ELABORATION continued (verbatim from source):
${stepsToText(lp.independent_practice_steps)}

CONCLUSION STEPS — for Section 8 EVALUATION (verbatim from source):
${stepsToText(lp.conclusion_steps)}

HOMEWORK (verbatim from source):
${stepsToText(lp.homework_instructions)}

Now lay this content out into the 9-section framework below. Preserve step numbering. Preserve teacher scripts (lines starting with [SAY], [ASK], [INSTRUCTION]) verbatim as teacher dialogue. Use section timings from the Duration line above.

${SECTIONS_BLOCK}

${FRAMEWORK_TRAILER}`;

  const additionalInstructions =
    `The source lesson-plan content above is PRE-AUTHORED and MUST be preserved verbatim. ` +
    `Lay it out into the ${SECTION_COUNT}-section framework — do NOT invent or add new content. ` +
    `Where source is silent on a section, keep that section brief (2-3 bullet points based only on info in the source). ` +
    `Preserve teacher scripts ([SAY]/[ASK]/[INSTRUCTION]) as verbatim teacher dialogue. ` +
    `Preserve all time allocations from the Duration line. ` +
    `Do not summarize or condense.`;

  return {
    inputText,
    numCards: NUM_CARDS,
    additionalInstructions,
    sectionCount: SECTION_COUNT,
  };
}

module.exports = {
  buildLessonPlanPrompt,
  buildGroundedLessonPlanPrompt,
  SECTION_COUNT,
  NUM_CARDS,
};
