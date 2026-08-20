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
    indicatorCount: 10,
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
        // bd-2383 — named-evidence gate (Naveera R4). The generic "absent→1"
        // rule left B4 at 96% Proficient+ because the model credits ANY warm-up.
        // Score by NAMED concepts, never mere presence.
        aiDetectionMethod:
          'Do NOT reward the mere presence of a warm-up or an "any recall" opener. Score by NAMED evidence you can quote: level 3 (Proficient) requires the teacher explicitly restating or eliciting TWO OR MORE NAMED concepts from prior lessons that connect to today\'s content — name them. Level 4 requires a STUDENT restating or applying prior knowledge in their OWN words — quote the student. A generic opener ("do you remember yesterday?") with no specific concept actually recalled is level 2 at most; no reference is level 1. If you cannot name the specific prior concepts that were recalled, do NOT score above 2.',
      },
      {
        id: 'B5',
        name: 'Meaningful & Real-World Connections',
        levels: {
          1: 'Content presented in isolation, no real-world link.',
          2: 'Teacher mentions a connection but doesn\'t develop it.',
          3: 'Content connected to students\' lives or local context.',
          4: 'Students generate their own connections; examples from their community.',
        },
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
      },
      {
        id: 'B7',
        name: 'Use of Taleemabad Lesson Plan',
        levels: {
          1: 'Taleemabad lesson plan not used at all.',
          2: 'Plan open but teacher deviates significantly.',
          3: 'Plan followed with minor contextual adaptations.',
          4: 'Plan followed faithfully AND adapted intelligently to class needs.',
        },
      },
      {
        id: 'B8',
        name: 'Use of Prescribed Resources',
        levels: {
          1: 'No Taleemabad resources (video, worksheet, manipulatives) used.',
          2: 'Some resources used but not as intended.',
          3: 'Key resources used as prescribed in lesson plan.',
          4: 'All resources used effectively; teacher adds complementary materials.',
        },
      },
      {
        id: 'B9',
        name: 'Time on Task / Time on Learning',
        levels: {
          1: 'Less than 50% of class time spent on learning activities.',
          2: '50–69% on task (significant management/transition time lost).',
          3: '70–85% on task with efficient transitions.',
          4: 'More than 85% on task; routines are automatic, transitions seamless.',
        },
      },
      {
        id: 'B10',
        name: 'Lesson Closure & Consolidation',
        levels: {
          1: 'Lesson ends abruptly with no summary.',
          2: 'Teacher rushes through a brief recap.',
          3: 'Structured closure: recap key points, check understanding.',
          4: 'Students summarize learning, connect to next lesson, self-assess.',
        },
        // bd-2383 — named-evidence gate (Naveera R4). B10 stayed at 89%
        // Proficient+ because the model credits that the lesson closed at all;
        // a closed "samajh aa gayi?" check is NOT consolidation.
        aiDetectionMethod:
          'Do NOT credit that the lesson merely ended, nor a closed check for understanding ("samajh aa gayi?", "clear?", "theek hai?") — those are yes/no checks, not consolidation. Score by NAMED consolidation evidence you can quote: level 3 (Proficient) requires the teacher recapping TWO OR MORE NAMED key points of TODAY\'s lesson AND a genuine understanding check that surfaces what students learned (an open question, not yes/no). Level 4 requires STUDENTS summarizing the learning in their OWN words or self-assessing — quote them. A closed "did you understand?" with no student output is level 2 at most; an abrupt end is level 1. If you cannot name what was consolidated, do NOT score above 2.',
      },
    ],
  },
  high_leverage_practices: {
    key: 'C',
    displayName: 'High-Leverage Practices',
    indicatorCount: 12,
    indicators: [
      {
        id: 'C1',
        name: 'Quality Questioning (Bloom\'s Aligned)',
        levels: {
          1: 'Only yes/no or recall questions asked. Close-ended, requiring one-word answers.',
          2: 'Mix of recall and some open-ended questions, but they lack depth. E.g., \'Why is the capital important?\' without further exploration.',
          3: 'Purposeful mix including application & analysis questions. Open-ended questions dominate. Wait time given.',
          4: 'Questions span all Bloom\'s levels (Remember→Create); students generate questions; Socratic questioning evident.',
        },
      },
      {
        id: 'C2',
        name: 'Responsive Re-explanation & Adaptive Teaching',
        levels: {
          1: 'Repeats same explanation when students don\'t understand.',
          2: 'Tries a different approach but still teacher-centered.',
          3: 'Uses alternative representations (visual, concrete, analogy). Adjusts teaching to student level.',
          4: 'Diagnoses misconception, re-explains using student\'s own logic, confirms understanding.',
        },
      },
      {
        id: 'C3',
        name: 'Effective Feedback',
        levels: {
          1: 'No feedback given, or only \'good/bad\' evaluations. Generic: \'Good job\' or \'Try again.\'',
          2: 'Feedback given but generic (\'try harder\'). Specific but does not consistently guide improvement.',
          3: 'Specific feedback on what was done well and what to improve. Actionable.',
          4: 'Feedback is specific, actionable, with next steps. Students use feedback to self-correct. Guides refinement of reasoning.',
        },
      },
      {
        id: 'C4',
        name: 'Equitable Participation',
        levels: {
          1: 'Only 2–3 students participate; others ignored. Teacher-dominated.',
          2: 'Teacher calls on volunteers only. A few students contribute while others stay silent.',
          3: 'Deliberate strategies: cold call, pair-share, name sticks. Diverse students included.',
          4: 'All students participate; teacher tracks contributions; gender-equitable. Students debate and refine arguments.',
        },
      },
      {
        id: 'C5',
        name: 'Student Agency & Voice',
        levels: {
          1: 'Students are passive recipients; no choice or voice. Content from single perspective.',
          2: 'Occasional student input but teacher-dominated. Multiple perspectives mentioned but not explored.',
          3: 'Students make choices about how to demonstrate learning. Explore multiple perspectives.',
          4: 'Students lead discussions, choose methods, self-assess, peer-teach. Create novel solutions. Evaluate alternatives.',
        },
      },
      {
        id: 'C6',
        name: 'Classroom Management & Routines',
        levels: {
          1: 'Frequent disruptions; no visible routines. Students struggle to engage.',
          2: 'Some routines but inconsistently enforced. Instructions lack clarity for all groups.',
          3: 'Clear routines (entry, transitions, dismissal); minimal disruptions. Expectations clear.',
          4: 'Seamless routines; students self-manage; positive behavioral reinforcement. Students actively participate in complex, clearly defined tasks.',
        },
      },
      {
        id: 'C7',
        name: 'Positive & Supportive Learning Environment',
        levels: {
          1: 'Negative tone; punitive language or humiliation.',
          2: 'Neutral but cold; no encouragement.',
          3: 'Warm, encouraging tone; mistakes treated as learning opportunities.',
          4: 'Joyful classroom; students feel safe to take risks; laughter and curiosity present.',
        },
      },
      {
        id: 'C8',
        name: 'Modeling, Scaffolding & Problem-Solving',
        levels: {
          1: 'Teacher tells but doesn\'t show. Simple tasks demonstrated without explanation of process.',
          2: 'Teacher demonstrates once but moves on quickly. Problem-solving modeled but strategies not explained.',
          3: 'I Do → We Do → You Do scaffolding visible. Problem-solving and creativity modeled with clear strategies.',
          4: 'Gradual release with checks at each stage; scaffold removed when ready. Teacher brainstorms solutions and explains reasoning.',
        },
      },
      {
        id: 'C9',
        name: 'Collaborative Learning',
        levels: {
          1: 'No group or pair work. Students work individually without interaction.',
          2: 'Students in groups but working individually. Tasks lack depth.',
          3: 'Purposeful pair/group tasks with clear roles. Students work towards synthesized solutions.',
          4: 'Structured collaboration (think-pair-share, jigsaw); students build on each other\'s ideas. Teams design solutions to community problems.',
        },
      },
      {
        id: 'C10',
        name: 'Integration of Taleemabad Technology',
        levels: {
          1: 'No technology used despite availability.',
          2: 'Technology used as distraction/babysitter.',
          3: 'Taleemabad videos/apps used to support learning objectives.',
          4: 'Technology integrated seamlessly; students interact with content; teacher facilitates around it.',
        },
      },
      {
        id: 'C11',
        name: 'Self & Peer Assessment Facilitation',
        levels: {
          1: 'Assessment limited to teacher-led grading. Students receive grades without reflection.',
          2: 'Some self- or peer-assessment occurs, but inconsistent. Students assess without clear criteria.',
          3: 'Self- and peer-assessment structured and purposeful. Students use rubrics to assess work.',
          4: 'Students use rubrics to assess work, suggest improvements for peers, and set goals. Assessment tasks require analysis/evaluation/creation.',
        },
      },
      {
        id: 'C12',
        name: 'Classroom Resources & Space for Collaboration',
        levels: {
          1: 'Resources and space disorganized, limiting collaborative learning. No group work areas.',
          2: 'Some organization, but space/resources do not fully support collaboration.',
          3: 'Resources and space well-organized for collaborative tasks. Materials accessible.',
          4: 'Tables arranged for group work, materials easily accessible. Environment designed for inquiry and collaboration.',
        },
      },
    ],
  },
  student_engagement: {
    key: 'D',
    displayName: 'Student Engagement',
    indicatorCount: 7,
    indicators: [
      {
        id: 'D1',
        name: 'Active Participation Rate',
        levels: {
          1: 'Less than 25% of students visibly engaged. Collaboration minimal or absent.',
          2: '25–50% engaged; many passive or off-task.',
          3: '50–75% actively participating (writing, discussing, solving).',
          4: 'More than 75% actively engaged; energy is visible; students initiating. Structured collaboration on synthesis/problem-solving.',
        },
      },
      {
        id: 'D2',
        name: 'Cognitive Engagement Level (Bloom\'s)',
        levels: {
          1: 'Students copying or doing rote recall only. Passively receiving information.',
          2: 'Students completing tasks but without thinking deeply.',
          3: 'Students applying concepts to new problems (Bloom\'s Apply/Analyze).',
          4: 'Students creating, evaluating, debating — genuine intellectual work. Actively analyse, interpret, and critique content with supporting evidence.',
        },
      },
      {
        id: 'D3',
        name: 'Student-to-Student Interaction',
        levels: {
          1: 'No peer interaction; silent individual work only.',
          2: 'Students talk but not about content.',
          3: 'Students discuss content in pairs/groups; academic language used.',
          4: 'Students build on each other\'s ideas; respectful disagreement; peer teaching. Students debate solutions and propose creative alternatives.',
        },
      },
      {
        id: 'D4',
        name: 'Student Confidence & Risk-Taking',
        levels: {
          1: 'Students afraid to answer; avoidance behaviors visible.',
          2: 'Students answer only when certain; no risk-taking.',
          3: 'Students attempt challenging tasks; some comfortable with mistakes.',
          4: 'Students volunteer, ask questions, try difficult problems. Mistakes celebrated. Students freely share and debate ideas.',
        },
      },
      {
        id: 'D5',
        name: 'On-Task Behavior During Independent Work',
        levels: {
          1: 'Most students off-task during independent/group work.',
          2: 'Students start on-task but lose focus quickly.',
          3: 'Students sustain focus for most of independent work time.',
          4: 'Students self-regulate; seek help appropriately; persist through difficulty.',
        },
      },
      {
        id: 'D6',
        name: 'Student Use of Learning Materials',
        levels: {
          1: 'Students don\'t interact with provided materials.',
          2: 'Materials used passively (watching video, holding textbook).',
          3: 'Students actively use materials to solve problems or practice.',
          4: 'Students use materials creatively; extend beyond prescribed use.',
        },
      },
      {
        id: 'D7',
        name: 'Inclusivity of Engagement',
        levels: {
          1: 'Only front-row or high-ability students engaged.',
          2: 'Teacher attempts inclusion but success is limited.',
          3: 'Students across ability levels and genders are participating.',
          4: 'Deliberate inclusion of marginalized students; no one invisible. Gender-equitable participation.',
        },
      },
    ],
  },
  teacher_subject_knowledge: {
    key: 'F',
    displayName: 'Teacher Subject Knowledge',
    indicatorCount: 8,
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
      },
      {
        id: 'F3',
        name: 'Anticipation of Student Misconceptions',
        subjectGroup: 'general',
        levels: {
          1: 'Teacher unaware of common misconceptions in this topic.',
          2: 'Aware but doesn\'t address them proactively.',
          3: 'Anticipates and addresses at least 1–2 common misconceptions.',
          4: 'Systematically surfaces and corrects misconceptions; uses diagnostic questions.',
        },
      },
      {
        id: 'F4',
        name: 'Depth of Explanation',
        subjectGroup: 'general',
        levels: {
          1: 'Superficial/procedural explanation only (\'do it this way\').',
          2: 'Some conceptual explanation but relies on memorization.',
          3: 'Explains the \'why\' behind procedures; uses multiple representations.',
          4: 'Deep conceptual teaching; connects to broader principles; encourages student reasoning.',
        },
      },
      {
        id: 'F5',
        name: 'Subject-Specific Pedagogy: MATH',
        subjectGroup: 'math',
        levels: {
          1: 'Math taught purely procedurally; no use of manipulatives or visuals.',
          2: 'Some visual aids but conceptual understanding not developed.',
          3: 'Uses concrete → pictorial → abstract (CPA) progression; manipulatives present.',
          4: 'CPA approach mastered; multiple solution strategies explored; math talk norms established.',
        },
      },
      {
        id: 'F6',
        name: 'Subject-Specific Pedagogy: SCIENCE',
        subjectGroup: 'science',
        levels: {
          1: 'Science taught from textbook only; no inquiry or observation.',
          2: 'Some demonstration but teacher-led; students observe passively.',
          3: 'Hands-on activities present; students make predictions and observations.',
          4: 'Full inquiry cycle: question → predict → investigate → conclude. Students design investigations.',
        },
      },
      {
        id: 'F7',
        name: 'Subject-Specific Pedagogy: LITERACY / LANGUAGE',
        subjectGroup: 'literacy',
        levels: {
          1: 'Reading taught as decoding only; no comprehension strategies.',
          2: 'Some reading activities but no explicit strategy instruction.',
          3: 'Teacher models reading strategies (prediction, summarizing, questioning). Balanced approach.',
          4: 'Balanced literacy: phonics + fluency + vocabulary + comprehension + writing integrated.',
        },
      },
      {
        id: 'F8',
        name: 'Cross-Curricular Connections',
        subjectGroup: 'general',
        levels: {
          1: 'Subject taught in complete isolation.',
          2: 'Occasional reference to other subjects but not developed.',
          3: 'Meaningful connections made to at least one other subject area.',
          4: 'Integrated approach; students see how math connects to science connects to language.',
        },
      },
    ],
  },
};

const TOTAL_INDICATORS = 37; // FICO V3 B10+C12+D7+F8 (Section E omitted — ASER assessment, not audio-observable)
const SCALE_MAX = 4;
const MAX_MARKS = TOTAL_INDICATORS * SCALE_MAX; // 148 (FICO V3: 37×4). NB: header/comments elsewhere still say 104 — that was FICO V2 (26 indicators); V3 was adopted 2026-07-29.

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
   - 4: ${levels[4]}${ind.aiDetectionMethod ? `\n   AI Detection Method: ${ind.aiDetectionMethod}` : ''}`;
}

function getSystemPrompt() {
  if (_cachedSystemPrompt) return _cachedSystemPrompt;

  const sectionBlocks = Object.values(DOMAINS).map(section => {
    const header = `**SECTION ${section.key}: ${section.displayName.toUpperCase()}** (${section.indicatorCount} indicators, max ${section.indicatorCount * SCALE_MAX})`;
    const body = section.indicators.map(renderIndicatorRubric).join('\n\n');
    return `${header}\n\n${body}`;
  }).join('\n\n');

  _cachedSystemPrompt = `You are an expert classroom observer analyzing teaching practices using the FICO Fidelity & Impact Classroom Observation Tool (the ICT canonical rubric).

OBSERVATION FRAMEWORK: FICO V3
4 scored sections (B, C, D, F) — ${TOTAL_INDICATORS} indicators total — Scale 1-4
(Section E — Student Assessment — is intentionally out of scope for this flow: it is
one-on-one ASER/EGRA reading & numeracy testing, not observable from a classroom recording.)

**SCALE — score by EFFECT, not mere presence:**
- 1 = Not Observed / Emerging: Indicator not present, not attempted, or not evidenced in the transcript.
- 2 = Developing: The move APPEARS but is superficial, closed, teacher-centred, or does not achieve its purpose.
- 3 = Proficient / Effective: The move is present AND the transcript shows it WORKED — a student responds substantively, a check surfaces real understanding, a task lands.
- 4 = Highly Effective: Proficient PLUS a student independently extends, applies, or transfers — the descriptor's level-4 bar is met.

**SCORING DISCIPLINE (applies to EVERY indicator, no exceptions):**
- A score of 3 or 4 REQUIRES a direct transcript quote showing BOTH the teacher move AND its effect on students. If you cannot quote the effect, cap the score at 2.
- If the behaviour is absent from the transcript, score 1. NEVER infer a move "probably happened" — score only what the transcript evidences.
- A closed or compliance check ("samajh aa gayi?", "are you sure?", "theek hai?", a choral "yes") is NOT a comprehension check. On its own it caps the relevant indicator at 2; reach 3 only if the teacher restates ≥2 named lesson concepts or a student restates/applies the content.
- For questioning indicators: classify each teacher question by Bloom level and count open-ended vs closed. Do not reach Proficient unless open-ended/higher-order questions dominate (≥50%).
- Match the transcript to the LEVEL DESCRIPTORS below literally — they are behavioural and specific. Pick the highest level whose description is fully evidenced, not the one the lesson gestured at.

${sectionBlocks}

**TOTAL: ${MAX_MARKS} marks maximum** (${TOTAL_INDICATORS} indicators × 4)

SUBJECT-CONDITIONAL SECTION F:
F1-F4 and F8 apply to every subject. F5 = MATHEMATICS, F6 = SCIENCE, F7 = LITERACY/LANGUAGE. If the lesson subject does not match a subject-tagged indicator, score it 1 with evidence "Not applicable — lesson subject is <subject>, indicator applies to <subjectGroup>."

SPECIAL INSTRUCTIONS:
- For Section B indicator B1 (Instructional Clarity & Learning Objectives): if a lesson plan is linked, compare observed execution against the specific LP objectives + steps.
- Score STRICTLY by the level descriptors + the SCORING DISCIPLINE above. Where an AI Detection Method is given, apply it exactly.
- Provide SPECIFIC transcript evidence (a real quote) for each indicator; name the EFFECT on students, not just the teacher's move.
- Reference timestamps when quoting dialogue.`;

  return _cachedSystemPrompt;
}

// ─── Focus-area language directive ───────────────────────────────────

// FICO teachers are English/Urdu (NIETE / ICT). MEWAKA emits its focus_area
// hardcoded in Swahili because its entire prompt is Swahili; FICO's prompt is
// English, so the focus_area strings must be steered into the teacher's
// REGISTERED language explicitly. This mirrors the report-v2 narrative
// service's langRules(): Urdu → Nastaliq, gender-neutral, code-switch
// pedagogical terms in English, RTL. Never hardcode a language.
const LANG_NAME = { en: 'English', ur: 'Urdu' };

function focusAreaLangDirective(language) {
  if (language === 'ur') {
    return `FOCUS-AREA LANGUAGE — write the four focus_area strings (title, rationale, try_this_tomorrow, lever_question) in URDU (Nastaliq), warm and natural. Text is right-to-left. Use gender-neutral phrasing (verbal nouns / impersonal constructions), never gendered second-person verb forms. Keep pedagogical/technical terms in ENGLISH (Latin letters) inline (e.g. open-ended questions, scaffolding, phonics, Bloom's). Keep "domain" and "indicator" as the EXACT English keys/ids listed above — do NOT translate them.`;
  }
  const name = LANG_NAME[language] || 'English';
  return `FOCUS-AREA LANGUAGE — write the four focus_area strings (title, rationale, try_this_tomorrow, lever_question) in ${name}. Keep "domain" and "indicator" as the EXACT English keys/ids listed above — do NOT translate them.`;
}

// ─── Analysis prompt builder ─────────────────────────────────────────

function buildIndicatorJsonRow(ind) {
  // bd-2369: `evidence_summary` is the ≤500-char gist the human observer sees on
  // the editable Flow form (Meta caps a TextArea at 600). `evidence` stays FULL
  // and flows to the teacher's report unchanged. One LLM pass emits both — no
  // extra call. Keep them consistent: the summary is a faithful compression of
  // the same moment, never a different judgement.
  return `        { "id": "${ind.id}", "name": "${ind.name.replace(/"/g, '\\"')}", "score": <1-4>, "evidence": "Detailed description + Quote: \\\"...\\\"", "evidence_summary": "<= 500 chars: the move + its effect on students + one short quote — the gist a reviewer needs to sanity-check the score", "timestamp": "exact time" }`;
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
  "focus_area": {
    "domain": "<ONE of: lesson_plan_fidelity | high_leverage_practices | student_engagement | teacher_subject_knowledge>",
    "indicator": "<the single indicator id to focus on next, e.g. C1>",
    "title": "<short headline, 3-6 words>",
    "rationale": "<1-2 sentences: why this ONE indicator is the highest-leverage next focus for this teacher>",
    "try_this_tomorrow": "<one concrete classroom move the teacher can try in their very next lesson>",
    "lever_question": "<ONE short, plain, open question the OBSERVER asks the TEACHER about her OWN lesson — inviting her to reflect on a real moment in this lesson (e.g. 'When you saw…', 'What made you…', 'When the pupils were asked…'). NOT a question about how to design questions, NOT pedagogy jargon, NOT a task. Max 15 words.>"
  },
  "recommendations": ["Actionable recommendation 1", "Actionable recommendation 2", "Actionable recommendation 3"]
}

FOCUS AREA — pick the SINGLE most useful growth area (one domain + one indicator) as the teacher's lead next-step. Prefer the domain the lesson's actual evidence points to; do not default to "questioning". Its "domain" MUST be one of the four section keys above and "indicator" MUST be one of that section's indicator ids.
${focusAreaLangDirective(language)}

EVIDENCE RULES:
- For EACH indicator, describe what the teacher DID (not what they didn't do)
- Include English translation of dialogue: Quote: "..."
- Even for score 1, provide detailed evidence of what was observed
- For non-applicable Section F rows (subject mismatch), score 1 with evidence noting the mismatch
- For EACH indicator ALSO write "evidence_summary": a self-contained ≤500-character
  compression of that indicator's "evidence" — the move, its effect on students, and one
  short quote. It is the ONLY note the human observer reads on the review form, so it must
  stand alone and justify the score. Do NOT write "see full note" or truncate mid-sentence;
  compress. It must never contradict the full "evidence".`;
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

// ─── Section B from measured LP fidelity (P4.1 / bd-wmfsp.9, D27) ────
//
// When a lesson plan is linked and the executed÷prescribed fidelity engine produced a
// USABLE score, Section B (Lesson Plan Fidelity) is DERIVED from that measurement —
// fidelity_pct scaled onto Section B's /40 — instead of the 10 legacy B indicators.
// The overall /104 is recomputed so the total reflects the measured Section B.
//
// The 10 legacy B indicators are still emitted by the LLM: fidelity runs CONCURRENTLY
// with the pedagogy pass and may fail (garbled recording → fidelity_pct null), in which
// case the legacy indicator-summed Section B (the proxy) must be able to stand. So we
// override at merge time, never by stripping B from the prompt. No-LP and unusable
// recordings keep the proxy untouched.
const SECTION_B_KEY = 'lesson_plan_fidelity';

function applyLpFidelity(analysis, lpFidelity) {
  if (!analysis || !analysis.domains) return analysis;
  if (!lpFidelity || lpFidelity.status !== 'ok') return analysis;

  const pct = Number(lpFidelity.fidelity_pct);
  if (lpFidelity.fidelity_pct == null || Number.isNaN(pct)) return analysis; // unusable → proxy stands

  const sectionB = analysis.domains[SECTION_B_KEY];
  if (!sectionB) return analysis; // not a FICO analysis / no Section B — no-op

  const maxB = DOMAINS[SECTION_B_KEY].indicatorCount * SCALE_MAX; // 40
  sectionB.domain_score = Math.round((pct / 100) * maxB);
  sectionB.domain_max = maxB;
  sectionB.fidelity_derived = true;
  sectionB.fidelity_pct = pct;
  if (lpFidelity.band) sectionB.fidelity_band = lpFidelity.band;

  // Recompute overall from the (now fidelity-derived) domain_scores. C/D/F are unchanged.
  let overallMarks = 0;
  for (const key of Object.keys(DOMAINS)) {
    const d = analysis.domains[key];
    if (d && typeof d.domain_score === 'number') overallMarks += d.domain_score;
  }
  analysis.scores = {
    ...(analysis.scores || {}),
    overall_marks: overallMarks,
    overall_max_marks: MAX_MARKS,
    overall_percentage: parseFloat(((overallMarks / MAX_MARKS) * 100).toFixed(1)),
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
  version: '3.0', // FICO V3 (37 ind, B/C/D/F) — adopted from canonical Coaching Framework sheet 2026-07-29
  displayName: 'FICO Framework',
  maxMarks: MAX_MARKS,
  hasDebrief: false,
  hasLPBonus: false,

  getSystemPrompt,
  buildAnalysisPrompt,
  computeScores,
  applyLpFidelity,
  getPerformanceBand,
  getScoringConstants,
};
