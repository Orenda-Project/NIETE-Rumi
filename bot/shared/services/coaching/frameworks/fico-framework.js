/**
 * FICO Framework Module — ICT Canonical Rubric
 *
 * FICO — Fidelity & Impact Classroom Observation Tool.
 *
 * 4 scored sections (B, C, D, F) + Section A (metadata only, not scored).
 * 26 indicators, scale 1-4, max 104 marks.
 *
 * Rubric content (sections, indicators, "AI Detection Method" scoring guidance)
 * mirrors the canonical Google Sheet authored by the ICT team, verbatim.
 * Sheet: 1UZaHrXARlJ2cWiZAGFEuc-_o1zOiC5LNXaz11_XVkFU
 *
 * Scale:
 *   1 = Not Observed / Emerging
 *   2 = Developing
 *   3 = Proficient / Effective
 *   4 = Highly Effective
 *
 * Section F (Teacher Subject Knowledge) contains 10 indicators of which only
 * the subject-relevant rows apply per lesson (F1-F3 general; F4-F5 Mathematics;
 * F6-F7 Science; F8-F10 Literacy). Non-applicable rows are scored 1 with
 * evidence noting the subject mismatch — this keeps the total denominator
 * stable at 104 per the sheet's Scoring Summary tab.
 */

// ─── Section definitions (verbatim from the ICT sheet) ───────────────

const DOMAINS = {
  lesson_plan_fidelity: {
    key: 'B',
    displayName: 'Lesson Plan Fidelity',
    indicatorCount: 7,
    indicators: [
      {
        id: 'B1',
        name: 'Instructional Clarity & Learning Objectives',
        levels: {
          1: 'No clear learning objective stated. Activities lack purpose.',
          2: 'Objective mentioned but vague or not referenced during lesson.',
          3: 'Clear objective stated, referred to during lesson, linked to classroom activities.',
          4: 'Objective co-constructed with students, revisited at close. Students can articulate what they are learning and why.',
        },
        aiDetectionMethod: "Scan the first 5 minutes for goal-setting phrases ('today we will,' 'by the end,' 'you will learn'); count logical connectors through the lesson (first, next, because, therefore, so, then); identify comprehension-check questions; and compare precise vs. vague vocabulary use.",
      },
      {
        id: 'B2',
        name: 'Lesson Structure & Sequence',
        levels: {
          1: 'No discernible structure; random activities.',
          2: 'Some structure but missing key phases (intro/body/close).',
          3: 'Clear I Do → We Do → You Do sequence. Logical flow with transitions.',
          4: 'Logical flow with smooth transitions, recap, and closure activity. Students can follow the arc.',
        },
        aiDetectionMethod: "Identify temporal phase markers (beginning/middle/end) and transition phrases ('now that we've..., let's move to...'); track the teacher-talk ratio across the lesson to see whether it shifts from high support to low support, signalling the move through modelling, joint practice, and independent work.",
      },
      {
        id: 'B3',
        name: 'Activities & Tasks Alignment',
        levels: {
          1: 'Activities unrelated to lesson objective.',
          2: 'Some activities align but others are filler.',
          3: 'Most activities directly support the learning objective.',
          4: 'All activities purposefully scaffolded toward objective mastery. No wasted time.',
        },
        aiDetectionMethod: 'Compare the words used in activities and questions against the stated objective; classify the type of thinking each task requires and check it matches.',
      },
      {
        id: 'B4',
        name: 'Activation of Prior Knowledge',
        levels: {
          1: 'No reference to what students already know.',
          2: 'Brief mention but no student input sought.',
          3: 'Teacher connects new content to previously taught material.',
          4: 'Students actively recall and link prior knowledge; teacher builds on it.',
        },
        aiDetectionMethod: "Search for recall prompts ('remember,' 'last time,' 'what do you know about') near the start of the lesson, and check whether the teacher's next moves build on the answers.",
      },
      {
        id: 'B5',
        name: 'Meaningful & Real-World Connections',
        levels: {
          1: 'Content presented in isolation, no real-world link.',
          2: "Teacher mentions a connection but doesn't develop it.",
          3: "Content connected to students' lives or local context.",
          4: 'Students generate their own connections; examples from their community.',
        },
        aiDetectionMethod: "Search for connection phrases ('like when,' 'for example,' 'imagine,' 'remember in [subject] when...') and check whether the connection is explained or just mentioned in passing.",
      },
      {
        id: 'B6',
        name: 'Differentiation / Catering to Learning Levels',
        levels: {
          1: 'One-size-fits-all delivery, no differentiation.',
          2: 'Aware of different levels but no adapted tasks.',
          3: 'Tasks differentiated for at least 2 ability groups.',
          4: 'Multiple pathways offered; struggling students supported, advanced students stretched.',
        },
        aiDetectionMethod: "Listen for scaffolding language ('let's break this into smaller steps'), extension language ('those who finish can try...'), and alternate explanations ('let me explain it another way').",
      },
      {
        id: 'B7',
        name: 'Lesson Closure & Consolidation',
        levels: {
          1: 'Lesson ends abruptly with no summary.',
          2: 'Teacher rushes through a brief recap.',
          3: 'Structured closure: recap key points, check understanding.',
          4: 'Students summarize learning, connect to next lesson, self-assess.',
        },
        aiDetectionMethod: "Listen for closing/summary language ('to conclude,' 'let's review,' 'in summary') and whether students are asked to restate what they learned.",
      },
    ],
  },
  high_leverage_practices: {
    key: 'C',
    displayName: 'High-Leverage Practices',
    indicatorCount: 4,
    indicators: [
      {
        id: 'C1',
        name: "Quality Questioning (Bloom's Aligned)",
        levels: {
          1: 'Only yes/no or recall questions asked. Close-ended, requiring one-word answers.',
          2: "Mix of recall and some open-ended questions, but they lack depth. E.g., 'Why is the capital important?' without further exploration.",
          3: 'Purposeful mix including application & analysis questions. Open-ended questions dominate. Wait time given.',
          4: "Questions span all Bloom's levels (Remember→Create); students generate questions; Socratic questioning evident.",
        },
        aiDetectionMethod: "Classify each question as open or closed; look for a follow-up question after a student's answer, not just moving straight to the next student.",
      },
      {
        id: 'C2',
        name: 'Responsive Re-explanation & Adaptive Teaching',
        levels: {
          1: "Repeats same explanation when students don't understand.",
          2: 'Tries a different approach but still teacher-centered.',
          3: 'Uses alternative representations (visual, concrete, analogy). Adjusts teaching to student level.',
          4: "Diagnoses misconception, re-explains using student's own logic, confirms understanding.",
        },
        aiDetectionMethod: "Compare a first explanation to any follow-up to see if it's genuinely different; listen for correction language ('not quite,' 'actually,' 'the correct answer is') after wrong answers.",
      },
      {
        id: 'C3',
        name: 'Effective Feedback',
        levels: {
          1: "No feedback given, or only 'good/bad' evaluations. Generic: 'Good job' or 'Try again.'",
          2: "Feedback given but generic ('try harder'). Specific but does not consistently guide improvement.",
          3: 'Specific feedback on what was done well and what to improve. Actionable.',
          4: 'Feedback is specific, actionable, with next steps. Students use feedback to self-correct. Guides refinement of reasoning.',
        },
        aiDetectionMethod: "Check what the teacher says right after a student responds - a specific comment, or just generic 'good'/'wrong'? Look for guidance words like 'try,' 'instead,' 'next time.'",
      },
      {
        id: 'C4',
        name: 'Student Agency & Voice',
        levels: {
          1: 'Students are passive recipients; no choice or voice. Content from single perspective.',
          2: 'Occasional student input but teacher-dominated. Multiple perspectives mentioned but not explored.',
          3: 'Students make choices about how to demonstrate learning. Explore multiple perspectives.',
          4: 'Students lead discussions, choose methods, self-assess, peer-teach. Create novel solutions. Evaluate alternatives.',
        },
        aiDetectionMethod: "Listen for choice language ('you choose,' 'which do you prefer') and for moments where a student is leading, suggesting, or deciding something.",
      },
    ],
  },
  student_engagement: {
    key: 'D',
    displayName: 'Student Engagement',
    indicatorCount: 5,
    indicators: [
      {
        id: 'D1',
        name: 'Diversity of Conceptual Expression',
        levels: {
          1: 'No student responses about the concept appear in the transcript at all.',
          2: "All student responses closely copy the teacher's wording, or students only give very short answers - one word, a number, or a group chorus.",
          3: 'Students phrase the concept in 2 or more different ways, but only using words and examples the teacher already introduced.',
          4: "Students use at least 3 different phrasings of the concept, none copying the teacher's wording - and at least one student uses a word or example the teacher never introduced.",
        },
        aiDetectionMethod: "Compare how students phrase the concept against the teacher's own wording, and flag any student-introduced vocabulary or examples.",
      },
      {
        id: 'D2',
        name: 'Student Reasoning in Responses',
        levels: {
          1: 'The teacher never asks for reasoning and no student reasoning appears anywhere in the transcript.',
          2: 'The teacher asks for reasoning at least once, but no student response actually contains a reason.',
          3: 'At least one student response contains an explanation or reason, but only after the teacher explicitly asks for one.',
          4: "At least two student responses contain an explanation or reason - and at least one of them wasn't prompted by the teacher asking 'why'.",
        },
        aiDetectionMethod: "Look for reasoning language in student responses ('because...,' 'I think...,' 'so...'), and note whether it followed a direct prompt or came unprompted.",
      },
      {
        id: 'D3',
        name: 'Student-Initiated Questions',
        levels: {
          1: 'No student questions of any kind appear in the transcript.',
          2: "Students ask only procedural questions ('what page?', 'do we write it down?') - no content questions at all.",
          3: "At least one student asks a clarification question about the concept, showing they're trying to understand something they're unsure about.",
          4: 'At least one student asks a genuine question that goes beyond what was taught - extending the concept or connecting it to something else.',
        },
        aiDetectionMethod: 'Distinguish content questions from purely logistical ones, and check whether a question extends beyond what was directly taught.',
      },
      {
        id: 'D4',
        name: 'Spontaneous Transfer & Connection-Making',
        levels: {
          1: 'No connection-making activity of any kind appears in the lesson.',
          2: 'The teacher invites students to make a connection, but no student does.',
          3: "A student makes a connection to something outside the lesson only after the teacher explicitly prompts them ('where else have you seen this?').",
          4: 'At least one student makes an unprompted connection between the lesson and something outside it - their own life, an earlier topic, or another subject.',
        },
        aiDetectionMethod: "Track whether a student's outside-the-lesson connection came before or after a teacher prompt.",
      },
      {
        id: 'D5',
        name: 'Visible Learning Progression Across the Lesson',
        levels: {
          1: 'Too few student responses (fewer than 3) to compare the beginning and end of the lesson.',
          2: 'Student responses look about the same at the end as at the start - no noticeable change in vocabulary or completeness.',
          3: 'Student responses are somewhat more complete or accurate by the end, but the improvement is modest or inconsistent.',
          4: "By the end of the lesson, students use the concept's key vocabulary more often and give longer, more complete responses than at the start - including words only the teacher had used earlier.",
        },
        aiDetectionMethod: "Compare the vocabulary and length of student responses about the concept from the start of the lesson to the end.",
      },
    ],
  },
  teacher_subject_knowledge: {
    key: 'F',
    displayName: 'Teacher Subject Knowledge',
    indicatorCount: 10,
    // F1-F3 apply to every subject; F4-F5 = Mathematics; F6-F7 = Science;
    // F8-F10 = Literacy (English or Urdu). Non-applicable rows are scored 1
    // with evidence noting the subject mismatch — keeps the denominator at 104.
    indicators: [
      {
        id: 'F1',
        name: 'Content Accuracy',
        subjectGroup: 'general',
        levels: {
          1: 'Teacher makes factual errors that go uncorrected.',
          2: 'Mostly accurate but with minor errors or imprecise language.',
          3: 'Content is accurate; no errors observed.',
          4: 'Content is accurate AND teacher explains WHY (conceptual depth, not just facts).',
        },
        aiDetectionMethod: "Check facts and definitions stated by the teacher against what's correct for the subject, and listen for uncertainty language ('I think,' 'not sure').",
      },
      {
        id: 'F2',
        name: 'Use of Academic Language',
        subjectGroup: 'general',
        levels: {
          1: 'Incorrect or no subject-specific terminology used.',
          2: 'Some terms used but not explained or used inconsistently.',
          3: 'Key terms used accurately and explained to students.',
          4: 'Terms used naturally; students also use them; bilingual bridging (Urdu/English) effective.',
        },
        aiDetectionMethod: "Track how often subject-specific vocabulary is used, whether it's defined when first introduced, and whether the language stays precise rather than vague.",
      },
      {
        id: 'F3',
        name: 'Anticipation of Student Misconceptions',
        subjectGroup: 'general',
        levels: {
          1: 'Teacher unaware of common misconceptions in this topic.',
          2: "Aware but doesn't address them proactively.",
          3: 'Anticipates and addresses at least 1–2 common misconceptions.',
          4: 'Systematically surfaces and corrects misconceptions; uses diagnostic questions.',
        },
        aiDetectionMethod: "Listen for the teacher naming a misconception before students raise it ('many people think X, but actually...'), and for how accurately student errors are corrected.",
      },
      {
        id: 'F4',
        name: 'Mathematical Discourse & Reasoning',
        subjectGroup: 'mathematics',
        levels: {
          1: "Entirely answer-focused throughout ('what is the answer?') with no how or why; no student mathematical explanation at any point.",
          2: 'Asks reasoning questions but accepts one-word or answer-only responses without pressing further, or reasoning is prompted but no student explanation follows.',
          3: "Asks reasoning questions ('how do you know?', 'why does that work?') and presses for reasoning rather than accepting answer-only responses.",
          4: 'Same as level 3, and students produce audible mathematical reasoning at a level appropriate to their grade in response.',
        },
        aiDetectionMethod: "Count reasoning questions ('how,' 'why,' 'explain,' 'show me') and check whether a student explanation actually follows.",
      },
      {
        id: 'F5',
        name: 'Problem-Solving & Productive Struggle',
        subjectGroup: 'mathematics',
        levels: {
          1: 'Only routine procedural practice; teacher immediately provides solutions; no think time allowed.',
          2: 'A challenging problem is presented but think time is too brief, or the teacher jumps in too quickly and removes the challenge.',
          3: 'Presents a genuinely challenging, multi-step or non-routine problem and allows adequate think time rather than rushing to the answer.',
          4: "Same as level 3, and the teacher also actively encourages persistence during the struggle ('keep trying, you're on the right track').",
        },
        aiDetectionMethod: 'Identify problem complexity through the language used and measure the length of silent think time before the teacher intervenes.',
      },
      {
        id: 'F6',
        name: 'Inquiry-Based Approach',
        subjectGroup: 'science',
        levels: {
          1: 'Teacher starts directly with a definition or explanation; no space for student thinking at any point; pure transmission throughout.',
          2: 'Attempts an inquiry opening but gives the answer too quickly, or shifts to pure transmission and never returns.',
          3: 'Opens a concept with a question, picture, or scenario, and gives students genuine space to respond before explaining.',
          4: "Same as level 3, and the teacher visibly builds on at least one student's response to guide the class toward the concept.",
        },
        aiDetectionMethod: "Check whether the teacher's explanation comes before or after students are given a chance to respond, whenever a new concept is introduced.",
      },
      {
        id: 'F7',
        name: 'Science Talk & Student Sense-Making',
        subjectGroup: 'science',
        levels: {
          1: "All student responses are one-word, chorus, or a direct repetition of the teacher's words; no student expresses an idea in their own words.",
          2: "Some sentence-level responses but most are one-word or chorus answers, or students mostly repeat the teacher's exact wording.",
          3: "At least one student expresses a science idea in their own words, not just repeating the teacher's phrase.",
          4: "Same as level 3, and at least 2 students produce sentence-level responses in their own words, using some form of reasoning ('I think because...').",
        },
        aiDetectionMethod: "Measure whether student responses are one word or a full sentence, and check whether the wording is the student's own or a repeat of the teacher's.",
      },
      {
        id: 'F8',
        name: 'Explicit Phonics / Decoding',
        subjectGroup: 'literacy',
        levels: {
          1: 'Phonics drill and sequence completely skipped; no phonics instruction at any point.',
          2: 'A general phonics sequence is present but inconsistent - the teacher skips or rushes through one or more steps.',
          3: 'Phonics instruction follows most of the correct sequence (sound to blending to segmenting), explicitly taught and modelled.',
          4: 'The full sequence is present and complete - pronunciation, initial/final sounds, blending, and segmenting - with audible student practice at every stage.',
        },
        aiDetectionMethod: 'Track whether each stage of the phonics sequence appears, in order, with audible student responses at each one.',
      },
      {
        id: 'F9',
        name: 'Comprehension Strategy Instruction',
        subjectGroup: 'literacy',
        levels: {
          1: 'No strategy instruction at any point; teacher asks comprehension questions but never teaches HOW to comprehend.',
          2: 'Names and models the strategy but gives no student practice, or students practise without the strategy ever being named or modelled.',
          3: 'At least two of the three steps are present - naming the strategy, modelling it with text, or student practice.',
          4: 'All three steps are present in sequence - the strategy is named explicitly, modelled with text, and students practise it audibly.',
        },
        aiDetectionMethod: "Listen for the strategy being named ('this is called predicting'), modelled aloud ('watch me, I think...'), and then practised by students.",
      },
      {
        id: 'F10',
        name: 'Reading-Writing Connections',
        subjectGroup: 'literacy',
        levels: {
          1: 'Reading and writing are completely separate in the lesson, or only one of the two happens at all.',
          2: "Reading and writing both happen but the connection between them isn't made explicit - e.g. 'we read, now write' with no real link.",
          3: 'At least one explicit link is made between reading and writing (e.g. using the text as a model or prompt for student writing).',
          4: 'Two or more explicit reading-writing connections are made, with the text clearly used as a model for what students go on to write.',
        },
        aiDetectionMethod: "Search for bridge language connecting the two ('we read about X, now write about...', 'notice how the author...') and count explicit connections.",
      },
    ],
  },
};

const TOTAL_INDICATORS = 26; // 7+4+5+10
const SCALE_MAX = 4;
const MAX_MARKS = TOTAL_INDICATORS * SCALE_MAX; // 104

// ─── Cached system prompt ────────────────────────────────────────────

let _cachedSystemPrompt = null;

function renderIndicatorRubric(ind) {
  const levels = ind.levels;
  const subjectTag = ind.subjectGroup && ind.subjectGroup !== 'general'
    ? ` — SUBJECT: ${ind.subjectGroup.toUpperCase()}`
    : '';
  return `${ind.id} **${ind.name}** (1-4)${subjectTag}
   - 1: ${levels[1]}
   - 2: ${levels[2]}
   - 3: ${levels[3]}
   - 4: ${levels[4]}
   AI Detection Method: ${ind.aiDetectionMethod}`;
}

function getSystemPrompt() {
  if (_cachedSystemPrompt) return _cachedSystemPrompt;

  const sectionBlocks = Object.values(DOMAINS).map(section => {
    const header = `**SECTION ${section.key}: ${section.displayName.toUpperCase()}** (${section.indicatorCount} indicators, max ${section.indicatorCount * SCALE_MAX})`;
    const body = section.indicators.map(renderIndicatorRubric).join('\n\n');
    return `${header}\n\n${body}`;
  }).join('\n\n');

  _cachedSystemPrompt = `You are an expert classroom observer analyzing teaching practices using the FICO Fidelity & Impact Classroom Observation Tool (the ICT canonical rubric).

OBSERVATION FRAMEWORK: FICO
4 scored sections (B, C, D, F) — 26 indicators total — Scale 1-4

**SCALE:**
- 1 = Not Observed / Emerging: Indicator not present or not attempted.
- 2 = Developing: Partially present, inconsistent or ineffective.
- 3 = Proficient / Effective: Clearly present, mostly consistent and purposeful.
- 4 = Highly Effective: Exemplary, adapted to context, embedded in practice.

${sectionBlocks}

**TOTAL: ${MAX_MARKS} marks maximum** (${TOTAL_INDICATORS} indicators × 4)

SUBJECT-CONDITIONAL SECTION F:
Section F contains three subject-specific groups. Score each indicator using the level descriptors above. If the lesson subject does not match the indicator's SUBJECT tag (e.g. F4-F5 Mathematics rows in a Science lesson), score that indicator as 1 with evidence "Not applicable — lesson subject is <subject>, indicator applies to <subjectGroup>."

SPECIAL INSTRUCTIONS:
- For Section B indicator B1 (Instructional Clarity & Learning Objectives): if a lesson plan is linked, compare observed execution against the specific LP objectives + steps.
- Apply the AI Detection Method exactly as written for each indicator — it is the authored scoring guidance.
- Provide SPECIFIC transcript evidence for each indicator.
- Reference timestamps when quoting dialogue.`;

  return _cachedSystemPrompt;
}

// ─── Analysis prompt builder ─────────────────────────────────────────

function buildIndicatorJsonRow(ind) {
  return `        { "id": "${ind.id}", "name": "${ind.name.replace(/"/g, '\\"')}", "score": <1-4>, "evidence": "Detailed description + Quote: \\\"...\\\"", "timestamp": "exact time" }`;
}

function buildAnalysisPrompt(transcript, metadata, lessonPlanStructured, photoAnalysis) {
  const {
    grade,
    subject,
    duration,
    language,
    teacherFirstName,
    priorFeedback
  } = metadata || {};

  const lpFidelityNote = lessonPlanStructured
    ? `\nIMPORTANT - LP Fidelity: A lesson plan is linked. For Section B (especially B1, B2, B3), compare the planned LP objectives + steps against what was observed in the transcript.\n`
    : '';

  const photoNote = photoAnalysis
    ? `\nCLASSROOM PHOTOS: Visual evidence is available. Use it as supplementary context, but score primarily from audio-detectable signals (this rubric is audio-scoreable by design).\n`
    : '';

  const sectionJsonBlocks = Object.entries(DOMAINS).map(([sectionKey, section]) => {
    const indicatorRows = section.indicators.map(buildIndicatorJsonRow).join(',\n');
    return `    "${sectionKey}": {
      "indicators": [
${indicatorRows}
      ],
      "domain_score": <sum>,
      "domain_max": ${section.indicatorCount * SCALE_MAX}
    }`;
  }).join(',\n');

  return `Analyze this classroom transcript using the FICO ICT rubric.

LESSON CONTEXT:
${teacherFirstName ? `- Teacher's First Name: ${teacherFirstName}` : ''}
${grade ? `- Grade: ${grade}` : ''}
${subject ? `- Subject: ${subject}` : ''}
${duration ? `- Duration: ${Math.round(duration / 60)} minutes` : ''}
${language ? `- Primary Language: ${language}` : ''}

${priorFeedback ? `PRIOR FEEDBACK:\n${priorFeedback}\n` : ''}
${lpFidelityNote}${photoNote}
CLASSROOM TRANSCRIPT:
${transcript}

TASK: Score all ${TOTAL_INDICATORS} FICO indicators (1-4 scale) with evidence. Return STRICT JSON:

{
  "executive_summary": "2-3 sentences. Use ${teacherFirstName || 'the teacher'}'s FIRST NAME. Highlight strongest section and key growth area.",
  "domains": {
${sectionJsonBlocks}
  },
  "strengths": [
    { "title": "Strength", "evidence": "Specific evidence + Quote: \\"...\\"", "impact": "Learning impact" }
  ],
  "growth_opportunities": [
    { "area": "Area", "observation": "What was observed", "strategies": ["Strategy 1", "Strategy 2"] }
  ],
  "recommendations": ["Actionable recommendation 1", "Actionable recommendation 2", "Actionable recommendation 3"]
}

EVIDENCE RULES:
- For EACH indicator, describe what the teacher DID (not what they didn't do)
- Include English translation of dialogue: Quote: "..."
- Even for score 1, provide detailed evidence of what was observed
- For non-applicable Section F rows (subject mismatch), score 1 with evidence noting the mismatch`;
}

// ─── Score computation ───────────────────────────────────────────────

function computeScores(analysis) {
  const domainKeys = Object.keys(DOMAINS);
  let overallMarks = 0;

  for (const domainKey of domainKeys) {
    if (analysis.domains && analysis.domains[domainKey]) {
      const domain = analysis.domains[domainKey];
      let domainScore = 0;

      if (domain.indicators) {
        for (const indicator of domain.indicators) {
          domainScore += indicator.score || 0;
        }
      }

      domain.domain_score = domainScore;
      domain.domain_max = DOMAINS[domainKey].indicatorCount * SCALE_MAX;
      overallMarks += domainScore;
    }
  }

  analysis.scores = {
    overall_marks: overallMarks,
    overall_max_marks: MAX_MARKS,
    overall_percentage: parseFloat(((overallMarks / MAX_MARKS) * 100).toFixed(1))
  };

  return analysis;
}

// ─── Performance bands (per sheet's Interpretation Guide) ────────────

function getPerformanceBand(percentage) {
  if (percentage >= 85) return 'excellent';    // Highly Effective
  if (percentage >= 70) return 'proficient';   // Effective
  if (percentage >= 50) return 'developing';   // Emerging / Developing
  return 'emerging';                            // Needs Support
}

// ─── Scoring constants accessor ──────────────────────────────────────

function getScoringConstants() {
  return {
    domains: DOMAINS,
    maxMarks: MAX_MARKS,
    scaleMax: SCALE_MAX,
    totalIndicators: TOTAL_INDICATORS
  };
}

// ─── Module exports (standard framework interface) ───────────────────

module.exports = {
  name: 'fico',
  version: '2.0',
  displayName: 'FICO Framework',
  maxMarks: MAX_MARKS,
  hasDebrief: false,
  hasLPBonus: false,

  getSystemPrompt,
  buildAnalysisPrompt,
  computeScores,
  getPerformanceBand,
  getScoringConstants,
};
