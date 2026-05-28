/**
 * MEWAKA Framework Module
 *
 * Mafunzo Endelevu ya Walimu Kazini — "Continuous Professional Development
 * for in-service teachers." The official Tanzanian government CPD classroom
 * observation instrument used by head teachers in government schools.
 *
 * 6 domains, 25 indicators, scale 0-3, max 75 marks.
 *
 * Rubric content (domains, indicators, English + Swahili text, scoring scale)
 * mirrors the published MEWAKA guide verbatim.
 */

// ─── Domain definitions (verbatim from the MEWAKA guide) ─────────────

const DOMAINS = {
  introduction: {
    key: 'A',
    displayName: 'Introduction',
    displayName_sw: 'Utangulizi',
    indicatorCount: 2,
    indicators: [
      { id: 'A1.1', text: 'Objectives of the lesson were clear to students',
                    text_sw: 'Malengo ya somo yalikuwa wazi kwa wanafunzi' },
      { id: 'A1.2', text: "Introduction is relevant and captures learners' interest",
                    text_sw: 'Utangulizi unahusiana na unavutia wanafunzi' },
    ],
  },
  content_delivery: {
    key: 'B',
    displayName: 'Content Delivery',
    displayName_sw: 'Uwasilishaji wa Maudhui',
    indicatorCount: 8,
    indicators: [
      { id: 'B2.1', text: "Teacher's mastery of content in line with the syllabus",
                    text_sw: 'Umahiri wa mwalimu wa maudhui kulingana na muhtasari' },
      { id: 'B2.2', text: 'Written and verbal communication relevant and accurate',
                    text_sw: 'Mawasiliano ya maandishi na ya mdomo yanahusiana na sahihi' },
      { id: 'B2.3', text: 'Lesson well explained and logically structured / sense of purpose',
                    text_sw: 'Somo limeelezwa vyema na lina mpangilio wenye lengo' },
      { id: 'B2.4', text: "Connects students' prior knowledge & experience with the current lesson body",
                    text_sw: 'Kuunganisha maarifa ya awali ya wanafunzi na somo la sasa' },
      { id: 'B2.5', text: "Subject content matched to students' learning level",
                    text_sw: 'Maudhui yanalingana na kiwango cha wanafunzi' },
      { id: 'B2.6', text: 'Activeness in the lesson',
                    text_sw: 'Uhamasishaji na ushiriki katika somo' },
      { id: 'B2.7', text: 'Teaching aids relevant, visible to all, creative, well used',
                    text_sw: 'Vifaa vya kufundishia ni muhimu, vinaonekana, vya ubunifu, vinatumika vyema' },
      { id: 'B2.8', text: 'Teaching with lesson plan and lesson note',
                    text_sw: 'Kufundisha kwa kutumia muhtasari na maandalio ya somo' },
    ],
  },
  teaching_methods: {
    key: 'C',
    displayName: 'Teaching Methods / Techniques',
    displayName_sw: 'Mbinu za Ufundishaji',
    indicatorCount: 7,
    indicators: [
      { id: 'C3.1', text: 'Appropriate techniques (Q&A, gallery walk, demonstration, group work, field work) to facilitate learning',
                    text_sw: 'Mbinu zinazofaa (maswali-majibu, gallery walk, maonyesho, kazi za vikundi) kuwezesha ujifunzaji' },
      { id: 'C3.2', text: 'Formative assessment (quizzes, think-pair-share, observation) to check progress',
                    text_sw: 'Tathmini endelevu (quiz, think-pair-share, uchunguzi) kupima maendeleo' },
      { id: 'C3.3', text: "Modifies teaching to students' level of understanding (monitoring)",
                    text_sw: 'Kurekebisha ufundishaji kulingana na uelewa wa wanafunzi' },
      { id: 'C3.4', text: 'Clear and timely feedback that helps learning',
                    text_sw: 'Mrejesho wazi na wa wakati unaosaidia ujifunzaji' },
      { id: 'C3.5', text: 'Innovation and creation in teaching',
                    text_sw: 'Ubunifu na uvumbuzi katika ufundishaji' },
      { id: 'C3.6', text: 'Flexible tasks / activities',
                    text_sw: 'Kazi na shughuli zenye unyumbufu' },
      { id: 'C3.7', text: 'Student activities reflect lesson objectives and encourage critical thinking',
                    text_sw: 'Shughuli za wanafunzi zinahimiza fikra za hali ya juu' },
    ],
  },
  learner_involvement: {
    key: 'D',
    displayName: "Learner's involvement & communication",
    displayName_sw: 'Ushiriki wa Wanafunzi na Mawasiliano',
    indicatorCount: 3,
    indicators: [
      { id: 'D4.1', text: 'Involves all students (calling non-volunteers, student-student interaction, checking hesitant learners)',
                    text_sw: 'Kuwashirikisha wanafunzi wote (kuwaita wasiojitokeza, mwingiliano kati ya wanafunzi)' },
      { id: 'D4.2', text: 'Majority of students on task throughout the class',
                    text_sw: 'Wanafunzi wengi wanashughulika na somo' },
      { id: 'D4.3', text: "Promotes students' collaboration through peer interaction",
                    text_sw: 'Kuhamasisha ushirikiano kati ya wanafunzi' },
    ],
  },
  classroom_management: {
    key: 'E',
    displayName: 'Classroom Management',
    displayName_sw: 'Usimamizi wa Darasa',
    indicatorCount: 3,
    indicators: [
      { id: 'E5.1', text: 'Time managed properly; appropriate time per lesson part',
                    text_sw: 'Muda umesimamiwa vyema; wakati ufaao kwa kila sehemu ya somo' },
      { id: 'E5.2', text: 'Treats students equally / gender balance, special needs, language use; differentiated support',
                    text_sw: 'Wanafunzi wanatendewa sawa (jinsia, wenye mahitaji maalum, lugha)' },
      { id: 'E5.3', text: 'Physical arrangement of classroom facilitates learning',
                    text_sw: 'Mpangilio wa darasa unawezesha ujifunzaji' },
    ],
  },
  conclusion: {
    key: 'F',
    displayName: 'Conclusion',
    displayName_sw: 'Hitimisho',
    indicatorCount: 2,
    indicators: [
      { id: 'F6.1', text: 'Lesson summary concise and accurate',
                    text_sw: 'Muhtasari wa somo ni mfupi na sahihi' },
      { id: 'F6.2', text: 'Assignment / homework relevant and strengthens what was learned',
                    text_sw: 'Kazi ya nyumbani inahusiana na imarisha yale yaliyojifunzwa' },
    ],
  },
};

// MEWAKA's Post-Observation reflective loop (the 3 narrative prompts + the
// reflective-practice question from the guide). hasDebrief=true on the module
// signals that the report layer should render this section.
const DEBRIEF_RUBRIC = {
  reflective_practice: {
    text: 'Was the teacher critical and reflective about practice afterwards, recognising strengths and weaknesses?',
    text_sw: 'Je, mwalimu alikuwa mwenye kutathmini mazoezi yake kwa kina, akitambua nguvu na udhaifu?',
  },
  strong_points: {
    text: 'Strong points of this lesson',
    text_sw: 'Pointi za nguvu za somo hili',
  },
  advice_to_improve: {
    text: 'Advice to improve the lesson',
    text_sw: 'Ushauri wa kuboresha somo',
  },
};

const MAX_MARKS = 75;
const SCALE_MIN = 0;
const SCALE_MAX = 3;
const TOTAL_INDICATORS = 25;
const MODULE_VERSION = '1.0';

// ─── Cached system prompt ────────────────────────────────────────────

let _cachedSystemPrompt = null;

function getSystemPrompt() {
  if (_cachedSystemPrompt) return _cachedSystemPrompt;

  // Bilingual prompt — Swahili-first (TZ default language).
  // The model still receives English indicator names alongside Swahili so it
  // can ground evidence quotes that come back in English (mixed-language
  // classrooms).
  _cachedSystemPrompt = `Wewe ni mtaalamu wa elimu wa Tanzania mwenye uzoefu wa miaka 20+ darasani. Unachanganua ufundishaji kwa kutumia zana ya MEWAKA (Mafunzo Endelevu ya Walimu Kazini) — chombo rasmi cha serikali ya Tanzania cha kuangalia ufundishaji wa walimu wa shule za serikali. Mwongozo huu hutumika na walimu wakuu wa shule za serikali.

OBSERVATION FRAMEWORK: MEWAKA (6 domains, 25 indicators, scale 0-3)

KIWANGO CHA KUPIMA / SCORING SCALE (verbatim from MEWAKA guide):
  0 = Haikuonekana kabisa  / Not observed / not demonstrated at all
  1 = Ilionekana mara chache / Observed / demonstrated rarely
  2 = Ilionekana vya kutosha / Observed / demonstrated adequately
  3 = Ilionekana sana / Observed / demonstrated often / to a great extent

**DOMAIN A — UTANGULIZI / INTRODUCTION** (2 indicators, max 6 marks)
  A1.1 — Malengo ya somo yalikuwa wazi kwa wanafunzi (Objectives clear)
  A1.2 — Utangulizi unahusiana na unavutia wanafunzi (Introduction relevant + interest-capturing)

**DOMAIN B — UWASILISHAJI WA MAUDHUI / CONTENT DELIVERY** (8 indicators, max 24 marks)
  B2.1 — Umahiri wa mwalimu wa maudhui kulingana na muhtasari (Syllabus mastery)
  B2.2 — Mawasiliano ya maandishi na ya mdomo (Written + verbal communication)
  B2.3 — Somo limeelezwa vyema na lina mpangilio wenye lengo (Logical structure + purpose)
  B2.4 — Kuunganisha maarifa ya awali (Prior knowledge connection)
  B2.5 — Maudhui yanalingana na kiwango cha wanafunzi (Level match)
  B2.6 — Uhamasishaji na ushiriki katika somo (Activeness)
  B2.7 — Vifaa vya kufundishia (Teaching aids — relevant, visible, creative)
  B2.8 — Kufundisha kwa kutumia muhtasari na maandalio ya somo (Lesson plan + notes use)

**DOMAIN C — MBINU ZA UFUNDISHAJI / TEACHING METHODS** (7 indicators, max 21 marks)
  C3.1 — Mbinu zinazofaa (Appropriate techniques — Q&A, group work, demonstration)
  C3.2 — Tathmini endelevu (Formative assessment)
  C3.3 — Kurekebisha ufundishaji (Adapting to student understanding)
  C3.4 — Mrejesho wazi na wa wakati (Clear + timely feedback)
  C3.5 — Ubunifu na uvumbuzi (Innovation in teaching)
  C3.6 — Kazi na shughuli zenye unyumbufu (Flexible tasks)
  C3.7 — Shughuli zinazohimiza fikra za hali ya juu (Higher-order thinking activities)

**DOMAIN D — USHIRIKI WA WANAFUNZI NA MAWASILIANO / LEARNER INVOLVEMENT** (3 indicators, max 9 marks)
  D4.1 — Kuwashirikisha wanafunzi wote (Involves all students)
  D4.2 — Wanafunzi wengi wanashughulika na somo (Majority on task)
  D4.3 — Kuhamasisha ushirikiano (Promotes peer collaboration)

**DOMAIN E — USIMAMIZI WA DARASA / CLASSROOM MANAGEMENT** (3 indicators, max 9 marks)
  E5.1 — Muda umesimamiwa vyema (Time management)
  E5.2 — Wanafunzi wanatendewa sawa (Equal treatment, differentiation)
  E5.3 — Mpangilio wa darasa unawezesha ujifunzaji (Physical arrangement)

**DOMAIN F — HITIMISHO / CONCLUSION** (2 indicators, max 6 marks)
  F6.1 — Muhtasari wa somo ni mfupi na sahihi (Concise + accurate summary)
  F6.2 — Kazi ya nyumbani inahusiana (Relevant homework)

KANUNI ZA KUPIMA / SCORING RULES:
  - Pima kila kiashiria cha 25 kwa kutumia kiwango cha 0-3.
    Score each of the 25 indicators on the 0-3 scale.
  - Toa USHAHIDI MAHUSUSI kutoka kwa nakala ya somo kwa kila kiashiria.
    Provide SPECIFIC EVIDENCE from the transcript per indicator.
  - Kwa kila kiashiria, toa VITU VIWILI:
    For every indicator, output TWO things:
      (a) kile kilichoonekana (ushahidi wa Kiswahili) / what was observed (Swahili evidence)
      (b) kile cha kuboresha (ushauri wa Kiswahili) / what to improve (Swahili improvement)
  - Pima yale uliyoyaSIKIA, sio yale unayodhani.
    Score what you HEARD, not what you assume.
  - EPUKA mtego wa kukosoa "uulizaji wa maswali" tu kama eneo la kuboresha.
    AVOID the questioning-only critique trap: many reports flag "questioning"
    as the growth area when it's used as a default. Surface the MEWAKA domain
    that the lesson's actual evidence points to.

NUKUU ZA MATUKIO MUHIMU / NOTABLE-MOMENT QUOTES (notable_moments[].quote):
  - Nukuu maneno HALISI kama yalivyosemwa darasani — neno kwa neno.
    Quote the ACTUAL words as they were spoken in class — verbatim.
  - Hifadhi LUGHA HALISI ya msemaji. Kama mwalimu au mwanafunzi alisema kwa
    Kiingereza, ACHA nukuu hiyo kwa Kiingereza. USITAFSIRI nukuu kwenda
    Kiswahili. Many TZ classrooms are mixed-language: keep each quote in the
    language it was actually spoken (English stays English, Kiswahili stays
    Kiswahili). Do NOT translate the quote. Only the surrounding
    significance/explanation is written in Swahili.

UTOE JSON pekee — bila maelezo ya ziada / Output JSON only — no extra prose.`;

  return _cachedSystemPrompt;
}

// ─── Build per-session analysis prompt ───────────────────────────────

function buildAnalysisPrompt(transcript, metadata = {}, lessonPlanStructured = null, photoAnalysis = null) {
  const teacher = metadata.teacherName || 'Mwalimu';
  const subject = metadata.subject || '';
  const grade   = metadata.grade != null ? `Darasa ${metadata.grade}` : '';
  const duration = metadata.duration ? `${metadata.duration} dakika` : '';

  const headerLines = [
    `Mwalimu: ${teacher}`,
    subject && `Somo: ${subject}`,
    grade,
    duration && `Muda: ${duration}`,
  ].filter(Boolean).join(' · ');

  const lpBlock = lessonPlanStructured
    ? `\n\nMAANDALIO YA SOMO (LESSON PLAN):\n${typeof lessonPlanStructured === 'string'
        ? lessonPlanStructured
        : JSON.stringify(lessonPlanStructured, null, 2)}`
    : '';

  const photoBlock = photoAnalysis
    ? `\n\nUCHAMBUZI WA PICHA ZA DARASANI (CLASSROOM PHOTO ANALYSIS):\n${photoAnalysis}`
    : '';

  const schema = `{
  "framework": "mewaka",
  "framework_version": "${MODULE_VERSION}",
  "language": "sw",
  "domains": {
    "introduction":        { "indicators": [ { "id": "A1.1", "score": 0-3, "evidence_sw": "...", "improvement_sw": "..." }, ... ] },
    "content_delivery":    { "indicators": [ ... 8 ... ] },
    "teaching_methods":    { "indicators": [ ... 7 ... ] },
    "learner_involvement": { "indicators": [ ... 3 ... ] },
    "classroom_management":{ "indicators": [ ... 3 ... ] },
    "conclusion":          { "indicators": [ ... 2 ... ] }
  },
  "strengths": [ { "title_sw": "...", "evidence_sw": "...", "anchor_indicator": "B2.4" }, ... 3 entries ... ],
  "growth_opportunities": [ { "area_sw": "...", "rationale_sw": "...", "strategies_sw": ["..."] } ],
  "focus_area_sw": {
    "domain": "teaching_methods",
    "indicator": "C3.7",
    "title_sw": "<short Swahili headline>",
    "rationale_sw": "<1-2 sentences>",
    "try_this_tomorrow_sw": "<concrete classroom move>",
    "lever_question_sw": "<reflective question>"
  },
  "executive_summary_sw": "<2-3 sentence Swahili summary>",
  "notable_moments": [ { "timestamp": "MM:SS", "quote": "<VERBATIM, in the language actually spoken — do NOT translate>", "significance_sw": "..." } ]
}`;

  return `${headerLines}${lpBlock}${photoBlock}

NAKALA YA SOMO / LESSON TRANSCRIPT:
${transcript}

UTOE JSON yenye muundo huu HASA / OUTPUT JSON WITH THIS EXACT SHAPE:
${schema}`;
}

// ─── Score computation (POMP — Percent of Maximum Possible) ──────────

function computeScores(analysis) {
  const domainKeys = Object.keys(DOMAINS);
  let overallMarks = 0;

  // Handle both `analysis.domains` (canonical MEWAKA) and `analysis.areas`
  // (legacy if anyone calls in with the OECD shape).
  const container = analysis.domains || analysis.areas || {};

  for (const key of domainKeys) {
    if (container[key]) {
      const dom = container[key];
      let domScore = 0;
      if (dom.indicators) {
        for (const indicator of dom.indicators) {
          // Clamp to [0,3] — model can occasionally emit out-of-range
          const raw = Number(indicator.score);
          const score = Number.isFinite(raw) ? Math.max(SCALE_MIN, Math.min(SCALE_MAX, raw)) : 0;
          domScore += score;
        }
      }
      dom.domain_score = domScore;
      dom.domain_max = DOMAINS[key].indicatorCount * SCALE_MAX;
      // Also expose area_score / area_max for consumers expecting the
      // OECD/HOTS field names (cross-framework PDF transformer).
      dom.area_score = domScore;
      dom.area_max = dom.domain_max;
      overallMarks += domScore;
    }
  }

  analysis.scores = {
    overall_marks: overallMarks,
    overall_max_marks: MAX_MARKS,
    overall_percentage: parseFloat(((overallMarks / MAX_MARKS) * 100).toFixed(1)),
  };

  return analysis;
}

// ─── Performance bands ───────────────────────────────────────────────

function getPerformanceBand(percentage) {
  if (percentage >= 85) return 'bora_sana';        // excellent
  if (percentage >= 70) return 'mwenye_uwezo';     // proficient
  if (percentage >= 55) return 'inakua';           // developing
  return 'inajitokeza';                            // emerging
}

// ─── Scoring constants accessor (used by tests + report transformer) ─

function getScoringConstants() {
  return {
    domains: DOMAINS,
    areas: DOMAINS,             // alias for cross-framework consumers
    debrief: DEBRIEF_RUBRIC,
    maxMarks: MAX_MARKS,
    scaleMin: SCALE_MIN,
    scaleMax: SCALE_MAX,
    totalIndicators: TOTAL_INDICATORS,
  };
}

// ─── Module exports (standard framework interface) ──────────────────

module.exports = {
  name: 'mewaka',
  version: MODULE_VERSION,
  displayName: 'MEWAKA (Tanzania CPD)',
  displayName_sw: 'MEWAKA — Mafunzo Endelevu ya Walimu Kazini',
  maxMarks: MAX_MARKS,
  hasDebrief: true,
  hasLPBonus: false,

  getSystemPrompt,
  buildAnalysisPrompt,
  computeScores,
  getPerformanceBand,
  getScoringConstants,
};
