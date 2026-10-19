/**
 * bd-s6qbts.3 — EVERY word the schools analytics page shows, in one place, keyed by language.
 *
 * English only in v1 (PLAN v2 §4). Urdu is a DATA change: add `ur: { … }` beside `en` with the same keys (the type
 * makes a missing key a build error), then register it with the portal's Urdu completeness checks
 * (teacher/copyRegistry.ts COPY_MODULES) like the auth pages. No component holds a literal word.
 *
 * DATA is not copy: a school's name, its region, its EMIS code and every number come from the API as they are.
 *
 * bd-97x22y.2 (PLAN v6) — the ICT dashboard's structure: six tabs, her section labels (written in sentence case; the
 * page sets them in capitals, so an Urdu table needs no capitals of its own), sector cards, a chart per tab.
 * Scores as %, usage as counts (operator, 2026-10-14): `percent` below is the ONLY place a % sign is written, and
 * only the FICO / HITL score values use it (the page test checks every % on every tab). No bands, no thresholds.
 */
import type { SchoolsTab } from './tabs';
import type { LpBand, LpStatus } from '../types/portal';

export type SortKey =
  | 'name' | 'region' | 'teachers' | 'lpsOpened' | 'trainingModules' | 'dcObservations'
  | 'humanObservations' | 'avgFico' | 'avgHitl' | 'coachVisits';

export type PeriodPreset = 'week' | 'month' | 'quarter' | 'year';

export type ObservationKind = 'dc' | 'human';

const EN = {
  /** The page's own lang/dir: the words decide it, not the device setting — Urdu chrome over English words reads backwards. */
  lang: 'en',
  dir: 'ltr' as 'ltr' | 'rtl',
  /** Number formatting for this language (thousands separators). */
  numberLocale: 'en-US',
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as readonly string[],

  frame: {
    brand: 'NIETE',
    logoAlt: 'NIETE logo',
    menu: 'Analytics',
    tabsMenu: 'Analytics tabs',
    page: 'Schools analytics',
    logout: 'Log out',
    signedIn: 'Signed in',
    privacy: 'Privacy policy',
  },

  /** The six tabs, in the ICT dashboard's order (tabs.ts). */
  tabs: {
    overview: 'Overview',
    lp: 'LP Engagement',
    training: 'Trainings',
    observations: 'Observations',
    coaching: 'Coaching',
    info: 'Information',
  } as Record<SchoolsTab, string>,

  title: 'Schools analytics',
  lede: "How NIETE is used in Islamabad's government schools, region by region. Every number is for a school or a region; no teacher is named on this page.",

  filters: {
    region: 'Region',
    allRegions: 'All regions',
    period: 'Period',
    presets: { week: 'This week', month: 'This month', quarter: 'Last 3 months', year: 'This year' } as Record<PeriodPreset, string>,
    dates: { from: 'From', to: 'To', allTime: 'All time' },
    updating: 'Updating…',
  },

  scope: {
    allTime: 'All time',
    from: (d: string) => `From ${d}`,
    upTo: (d: string) => `Up to ${d}`,
    schools: (n: string) => `${n} ${n === '1' ? 'school' : 'schools'}`,
    teachers: (n: string) => `${n} ${n === '1' ? 'teacher' : 'teachers'}`,
  },

  /** Her section labels, per tab (PLAN v6 §2). */
  sections: {
    schools: 'Schools',
    teachers: 'Teachers',
    snapshot: 'Performance snapshot',
    scores: 'Scores',
    coaching: 'Coaching',
    lpOverview: 'Engagement overview',
    sectors: 'Sectors — click to view school breakdown',
    lpChart: 'LPs opened by sector',
    trainingOverview: 'Training overview',
    trainingChart: 'Modules completed by sector',
    obsSummary: 'Summary',
    obsChart: 'Avg observation score by sector',
    obsSectors: 'Sector breakdown',
    coachingSectors: 'Sector overview',
  },

  /** Tile names. */
  tiles: {
    schools: 'Total schools',
    teachers: 'Total teachers',
    lpsOpened: 'LPs opened',
    teachersOpenedLp: 'Teachers who opened',
    regionsActive: 'Regions with activity',
    trainingModulesShort: 'Training modules',
    trainingModules: 'Modules completed',
    teachersTrained: 'Teachers trained',
    dcObservations: 'DC observations',
    teachersWithDc: 'Teachers observed',
    humanObservations: 'Human observations',
    avgFico: 'Avg FICO',
    avgHitl: 'Avg HITL',
    coaches: 'Total coaches',
    coachVisits: 'Coach visits',
    schoolsVisited: 'Schools visited',
  },

  /** The school table's and the cards' names for a number. */
  metrics: {
    teachers: 'Teachers',
    lpsOpened: 'LPs opened',
    trainingModules: 'Modules completed',
    dcObservations: 'DC observations',
    humanObservations: 'Human observations',
    avgFico: 'Avg FICO',
    avgHitl: 'Avg HITL',
    coachVisits: 'Coach visits',
    coaches: 'Coaches',
    observations: 'Observations',
  },
  overviewLabel: 'Overview',
  xOfN: (x: string, n: string) => `${x} of ${n} teachers`,
  xOfNShort: (x: string, n: string) => `${x} of ${n}`,
  /** Under a count already shown big: "of 442 teachers", "of 6 regions", "of 16 schools". */
  ofTeachers: (n: string) => `of ${n} teachers`,
  ofRegions: (n: string) => `of ${n} ${n === '1' ? 'region' : 'regions'}`,
  ofSchools: (n: string) => `of ${n} schools`,
  schoolsVisitedOf: (x: string, n: string) => `${x} of ${n} schools visited`,
  scored: (n: string) => `${n} scored`,
  /** A FICO / HITL score out of 100. The ONLY % on the page. */
  percent: (v: string) => `${v}%`,
  loggedSince: (d: string) => `logged since ${d}`,

  observations: {
    kinds: { dc: 'Digital Coach', human: 'Human' } as Record<ObservationKind, string>,
    kindLabel: 'Observations by',
  },

  sectorCards: {
    view: 'View schools',
    viewDetails: 'View details',
    viewVisits: 'View school visits',
    hide: 'Hide schools',
  },

  breakdown: {
    title: (region: string) => `School breakdown — ${region}`,
    back: 'Back to all regions',
  },

  chart: {
    noValue: 'Nothing scored',
  },

  schools: {
    title: 'Schools',
    columns: {
      name: 'School', region: 'Region', teachers: 'Teachers', lpsOpened: 'LPs opened',
      trainingModules: 'Modules completed', dcObservations: 'DC observations', humanObservations: 'Human observations',
      avgFico: 'Avg FICO', avgHitl: 'Avg HITL', coachVisits: 'Coach visits',
    } as Record<SortKey, string>,
    /** The small line under a column's name. */
    columnHints: { lpsOpened: 'x of N teachers', trainingModules: 'x of N teachers', dcObservations: 'x of N teachers', avgFico: '(n scored)', avgHitl: '(n scored)' } as Partial<Record<SortKey, string>>,
    emis: (code: string) => `EMIS ${code}`,
    search: 'Search schools',
    searchHint: 'School name or EMIS code',
    count: (shown: string, total: string) => `${shown} of ${total} schools`,
    showing: (shown: string, total: string) => `Showing ${shown} of ${total}`,
    more: (n: string) => `Show ${n} more`,
    none: 'No school matches.',
    empty: 'No schools here.',
    sortBy: 'Sort by',
    sortAsc: 'Lowest first',
    sortDesc: 'Highest first',
    reverse: 'Reverse the order',
    legendLowN: 'Grey: fewer than 3 scored',
    legendNone: '— nothing scored in this period',
  },

  /** The Information tab: what each number counts, grouped as the tabs are (PLAN v6 §2). */
  how: {
    title: 'How these numbers are worked out',
    groups: [
      {
        title: 'Schools and teachers',
        items: [
          { term: 'Schools', text: 'Active NIETE schools in the six ICT regions: B.K, Sihala, Urban-I, Nilore, Urban-II and Tarnol. Test schools are left out. A school with no region on record, or with a region outside these six, is not shown and not counted in any number.' },
          { term: 'Teachers', text: "Teachers registered at the school today; test accounts are left out. A teacher's activity counts for the school she is at now, so a teacher who moved takes her earlier activity with her." },
        ],
      },
      {
        title: 'LP Engagement',
        items: [
          { term: 'LPs opened', text: "Different lesson plans the school's teachers opened in the period: opening the same plan again counts once per teacher. Opens are recorded from 4 Oct 2026, so a period that starts earlier shows fewer than really happened." },
          { term: 'Teachers who opened', text: 'How many of the N teachers opened at least one lesson plan in the period ("x of N").' },
          { term: 'Regions with activity', text: 'Regions where at least one lesson plan was opened in the period, out of the six.' },
          { term: 'LP engagement', text: "For each teacher, each week (Sunday to Saturday), each grade and each subject: the different lesson plans she opened plus the lesson plans she generated, out of 5 (5 or more counts as the full week). A teacher's LP engagement is the average over her weeks, grades and subjects with a lesson plan. A school's, a region's or the overall LP engagement adds up its teachers' and divides by all its teachers, so a teacher with no lesson plan counts 0. The subject and grade tables do the same with only that subject's or grade's lesson plans." },
          { term: 'On-Schedule, Moderate, Off-Schedule', text: "A teacher is On-Schedule at 60 percent or more, Moderate at 40 to 59 percent, and Off-Schedule below 40 percent; a teacher with no lesson plan in the period is Off-Schedule. A school's status reads its LP engagement the same way. In the tables, Overall adds up the teachers in each band across the rows, and its LP engagement is the average of the rows." },
          { term: 'Primary and Mid / High', text: 'Teachers by the levels they teach (their training levels). Primary counts their grade 1 to 5 lesson plans; Mid / High counts grade 6 to 12 lesson plans. A teacher who teaches both is counted in both.' },
          { term: 'Active sectors', text: 'Regions where at least one of these teachers has a lesson plan in the period.' },
        ],
      },
      {
        title: 'Trainings',
        items: [
          { term: 'Modules completed', text: "Training modules the school's teachers finished in the period, each module counted once per teacher." },
          { term: 'Teachers trained', text: 'How many of the N teachers finished at least one module in the period ("x of N").' },
          // bd-97x22y.4 (PLAN v7) — the Trainings tab's level progress.
          { term: 'Passed, In Progress, Not Started', text: "Each NIETE level (Aspiring Teacher, Emerging Practitioner, Skilled Practitioner, Teacher Leader) for every teacher whose training programme includes it. Passed: holds the level's certificate or passed its exam. In Progress: has finished at least one of its modules. Not Started: none yet, or the level before is not passed yet. The percentage is how many passed. All time: the period does not change it; the tab says when the numbers were read." },
          { term: 'Primary and Mid / High', text: 'Primary is teachers whose grades include Primary: all four levels. Mid / High is teachers whose grades include Middle or High: Skilled Practitioner and Teacher Leader, with Oxbridge (Passed: all 7 sessions passed) and Beaconhouse (Passed: at least one subject passed). A teacher who teaches both is in both.' },
          { term: 'Passed all levels', text: 'Primary: passed Teacher Leader. Mid / High: passed Skilled Practitioner, Teacher Leader, Oxbridge and Beaconhouse.' },
        ],
      },
      {
        title: 'Observations',
        items: [
          { term: 'DC observations', text: "Finished Digital Coach (AI) observations of the teachers' lessons in the period." },
          { term: 'Teachers observed', text: 'How many of the N teachers had at least one observation of that kind (Human or Digital Coach) in the period ("x of N").' },
          { term: 'Sectors active', text: 'Regions with at least one observation of that kind in the period.' },
          { term: 'LP Fidelity (Section B)', text: 'How closely the lesson followed its lesson plan: the FICO Section B score, out of 100 and shown as a percentage. A lesson with no lesson plan has no Section B score and is not counted in it, so fewer observations are scored for it than for C and D; its own "n scored" is shown on its card.' },
          { term: 'Teaching Practices (Section C)', text: 'The FICO Section C score (high-leverage teaching practices), out of 100 and shown as a percentage, averaged over the observations in the period.' },
          { term: 'Engagement (Section D)', text: 'The FICO Section D score (student engagement), out of 100 and shown as a percentage, averaged over the observations in the period.' },
          { term: 'Human observations', text: 'Finished observations of the teachers by a school leader or coach in the period, including ones the observer has reviewed.' },
          { term: 'Avg FICO', text: 'The average Digital Coach observation score, out of 100 and shown as a percentage, over the observations in the period that have a score. "n scored" is how many had one.' },
          { term: 'Avg HITL', text: "The average score of human observations after the observer's review, out of 100 and shown as a percentage. \"n scored\" is how many had one." },
          { term: 'Grey and —', text: 'An average from fewer than 3 scored observations is shown in grey: one or two lessons say little about a school. — means nothing was scored. A 0 is a real 0: none happened.' },
        ],
      },
      {
        title: 'Coaching',
        items: [
          { term: 'Total coaches', text: 'Coaches (test accounts left out) with at least one school in the region on record. A coach whose schools are in two regions counts in both region cards and once in the total. It is who is assigned today, so the period does not change it.' },
          { term: 'Coach visits', text: 'Scheduled coach visits marked done, on a day in the period, at an active school in the six regions.' },
          { term: 'Schools visited', text: 'Schools with at least one coach visit in the period ("x of N" schools).' },
          { term: 'Schools in a region', text: "A region card's schools: every school counted in that region, visited or not." },
          { term: 'Coaches by sector', text: "The names of each region's coaches, A to Z. A coach whose schools are in two regions is listed in both. Coaches are NIETE staff; no teacher is named." },
        ],
      },
      {
        title: 'Regions, periods and totals',
        items: [
          { term: 'Regions and totals', text: 'Counts are added up across schools. Avg FICO and Avg HITL are worked out over all the scored observations together, so a large school weighs more than a small one.' },
          { term: 'Section scores (B, C, D)', text: "These follow the ICT dashboard. A school's score, and the score at the top of the tab, average their observations. A region's card and its bars average the region's schools' scores instead, each school with a score counting once, so with a region chosen its card can differ a little from the score at the top." },
          { term: 'Period', text: 'Days are counted in Pakistan time, the first and the last day both included.' },
        ],
      },
    ] as ReadonlyArray<{ title: string; items: ReadonlyArray<{ term: string; text: string }> }>,
  },

  states: {
    loading: 'Loading the numbers',
    forbiddenTitle: 'Schools analytics',
    forbidden: 'This page is for analytics accounts. Ask the NIETE team if you need access.',
    error: "The numbers didn't load. Check your connection and try again.",
    coachingError: "The coaching numbers didn't load. Check your connection and try again.",
    retry: 'Try again',
  },

  /**
   * bd-97x22y.4 (PLAN v7) — the Trainings tab, her page 1 to 1: her labels, her level definitions (frontend
   * TrainingLevelCard.jsx / Trainings.jsx), her % passed. Level NAMES come from the API (training_levels); everything
   * else is here, keyed by the level's order (0-3).
   */
  trainingLevels: {
    bands: { primary: 'Primary Teachers', midhigh: 'Mid / High Teachers' },
    bandsLabel: 'Teachers',
    filter: { level: 'Training Level', all: 'All' },
    /** All time, from the server's snapshot. */
    snapshot: (when: string) => `All time · as of ${when}`,
    clock: { am: 'AM', pm: 'PM' },
    sections: {
      progress: 'Training level progress',
      chart: 'Training completion — sector comparison',
      sectors: 'Sectors',
    },
    /** The small line above a level card's name (hers: level 0 is "Beginning Teacher"). */
    cardLabels: ['Beginning Teacher', 'Emerging Practitioner', 'Skilled Practitioner', 'Teacher Leader'] as readonly string[],
    /** Her Mid / High names, and her chart's names for the two NIETE levels. */
    nieteName: (name: string) => `(NIETE) ${name}`,
    states: { passed: 'Passed', inProgress: 'In Progress', notStarted: 'Not Started' },
    whatIs: 'What is this level?',
    hideWhatIs: 'Hide definition',
    covered: 'What is covered',
    /** Her definitions of the four NIETE levels, by order. */
    definitions: [
      {
        short: 'Builds foundational knowledge and basic classroom skills for teachers new to the profession',
        full: 'Understanding core concepts, following structured routines, and applying simple strategies in literacy, numeracy, and classroom management.',
        coverage: [
          ['PP', 'Pedagogical Practice — Basic 5-step lesson planning, group reading, using diagrams to explain concepts'],
          ['CE', 'Content Expertise — Number sense, basic operations, phonics, Urdu letters and harakaat, early grammar, comprehension'],
          ['AF', 'Assessment & Feedback — Exit tickets, simple checklists, progress tracking, positive verbal feedback'],
          ['IE', 'Inclusive Education — Recognising diverse learners, simplified texts, flexible grouping, auditory aids'],
          ['DL', 'Digital Literacy — YouTube as teaching tool, Google search, basic PowerPoint or Slides'],
          ['CM', 'Classroom Management — Entry/exit routines, classroom rules, attention cues'],
          ['PG', 'Professional Growth — Reflective journaling, ethics and confidentiality, parent communication'],
        ],
      },
      {
        short: 'Develops structured lesson design and deeper content knowledge.',
        full: 'Teachers move from following instructions to applying and creating — designing activities, analysing student thinking, and using formative assessment purposefully.',
        coverage: [
          ['PP', "Pedagogical Practice — Bloom's Taxonomy, student-centred strategies, peer teaching, Socratic questioning, critical thinking"],
          ['CE', 'Content Expertise — Fractions, estimation, measurement, graphing, multi-skill literacy, paragraph writing, tenses, Urdu grammar'],
          ['AF', 'Assessment & Feedback — Seen vs unseen questions, formative quizzes, diagnostic assessments, summative assessment types'],
          ['IE', 'Inclusive Education — Scaffolding, differentiated assessments, Universal Design for Learning (UDL), child psychology'],
          ['DL', 'Digital Literacy — Blended learning, Google Forms for quizzes, digital progress tracking'],
          ['CM', 'Classroom Management — Managing multilingual classrooms, student SMART goals, behaviour charts'],
          ['PG', 'Professional Growth — SMART development goals, monthly reflective goal-setting, joining teacher networks'],
        ],
      },
      {
        short: 'Advances into inquiry-based and project-based learning, higher-order assessment design, and digital collaboration tools.',
        full: 'Teachers design complex learning experiences and begin contributing to wider school practice.',
        coverage: [
          ['PP', 'Pedagogical Practice — Project-based and inquiry-based learning, Socratic questioning, group problem-solving, sequenced lesson design'],
          ['CE', 'Content Expertise — Fractions, decimals, percentages, HCF/LCM, comprehension strategies, vocabulary, Urdu sentence types and grammar'],
          ['AF', 'Assessment & Feedback — Summative design, data-driven instruction, self-assessment, student portfolios, peer assessment, rubrics'],
          ['IE', 'Inclusive Education — Differentiated activities, learning stations, assistive technologies, advanced child psychology'],
          ['DL', 'Digital Literacy — Google Drive, Canva, interactive digital quizzes, Google Meet/Zoom for instruction'],
          ['CM', 'Classroom Management — Restorative practices, positive reinforcement, co-creating classroom culture'],
          ['PG', 'Professional Growth — Leading professional learning communities (PLCs), school-wide professional development strategy'],
        ],
      },
      {
        short: 'Develops school-wide leadership and peer mentoring capabilities.',
        full: 'Teachers design systemic programmes, lead colleague development, and drive inclusive and ethical school culture — shifting from classroom excellence to institution-level impact.',
        coverage: [
          ['PP', 'Pedagogical Practice — Mentoring peers in PBL, interdisciplinary lesson design, flipped classroom, leading peer observation programmes'],
          ['CE', 'Content Expertise — Coaching peers in maths pedagogy, correcting deep misconceptions, CPA method training, Urdu literacy coaching'],
          ['AF', 'Assessment & Feedback — School-wide assessment design, rubric workshops for colleagues, post-observation debrief facilitation'],
          ['IE', 'Inclusive Education — Mentoring peers in differentiation, creating IEPs, leading inclusion workshops, personalised learning frameworks'],
          ['DL', 'Digital Literacy — Leading school-wide Google tools initiative, implementing self-paced learning platforms'],
          ['CM', 'Classroom Management — Peer mentoring programmes, student behaviour committees, school-wide behaviour systems'],
          ['PG', 'Professional Growth — Community engagement, school-wide feedback systems, ethics policy leadership, shared development vision'],
        ],
      },
    ] as ReadonlyArray<{ short: string; full: string; coverage: ReadonlyArray<readonly [string, string]> }>,
    chart: {
      axis: '% of Teachers',
      /** The tooltip of one bar: "91% (497 of 548 teachers)". */
      tip: (pct: string, x: string, n: string) => `${pct} (${x} of ${n} teachers)`,
      none: 'No training completions recorded yet for this selection.',
    },
    sector: {
      passedAll: (n: string) => `of ${n} teachers have passed all levels`,
      passed: (n: string) => `${n} passed`,
      view: 'View Details',
      hide: 'Hide schools',
    },
    school: { passed: 'Passed', teachers: 'Teachers', none: 'No schools found.' },
    about: {
      title: 'About Training Levels',
      items: [
        { term: 'Aspiring Teacher (Level 0):', text: 'Builds foundational knowledge and basic classroom skills.' },
        { term: 'Emerging Practitioner (Level 1):', text: 'Develops structured lesson design and deeper content knowledge.' },
        { term: 'Skilled Practitioner (Level 2):', text: 'Advances into inquiry-based learning and digital collaboration.' },
        { term: 'Teacher Leader (Level 3):', text: 'Develops school-wide leadership and peer mentoring capabilities.' },
      ] as ReadonlyArray<{ term: string; text: string }>,
      /** How the three states and the % are worked out on NIETE's data. */
      counted: 'Passed: holds the level\'s certificate or passed its exam. In Progress: has finished at least one of its modules, not yet the exam. Not Started: no module finished yet, or the level below is not passed yet. Each level counts the teachers whose training programme includes it, and the % is how many of them passed. "Passed all levels" means passed Teacher Leader.',
      /** Mid / High: her partner rules on NIETE's records. */
      countedMidHigh: 'Mid / High teachers are those whose grades include Middle or High. Oxbridge: Passed = all 7 sessions passed, In Progress = at least one. Beaconhouse: Passed = at least one subject passed, In Progress = started without a pass. "Passed all levels" on Mid / High means NIETE Skilled Practitioner, NIETE Teacher Leader, Oxbridge and Beaconhouse all passed.',
    },
    /** Her Mid / High "Training Partners": Oxbridge, NIETE, Beaconhouse (Trainings.jsx, TrainingLevelCard.jsx). */
    partners: {
      title: 'Training Partners',
      oxbridge: 'Oxbridge Training',
      niete: 'NIETE Trainings',
      beaconhouse: 'Beaconhouse Training',
      /** Short names in the chart, the sector cards and the filter. */
      oxbridgeShort: 'Oxbridge',
      beaconhouseShort: 'Beaconhouse',
      nieteFilter: (name: string) => `NIETE — ${name}`,
      summary: (passed: string, inProgress: string) => `${passed} passed · ${inProgress} in progress`,
      nieteSummary: 'Skilled Practitioner & Teacher Leader',
      perSession: 'Teachers per session',
      bySession: 'Breakdown by session',
      perLevel: 'Teachers per level',
      byLevel: 'Breakdown by level',
      perSector: 'Per-sector breakdown',
      columns: { session: 'Session', level: 'Level', sector: 'Sector', middle: 'Middle', high: 'High', total: 'Total' },
      completedAll: 'Completed all',
      unique: 'Unique teachers (any level)',
      uniqueNote: 'a teacher may appear in multiple levels above',
      courses: 'Courses',
      oxbridgeDefinition: {
        short: 'Oxbridge Trainings focus on Game-Based Teaching, Learning, and Assessment (GBTLA) — a learner-centred approach that integrates curriculum-aligned games into teaching to promote active engagement, collaboration, critical thinking, and continuous formative assessment.',
        coverage: [
          ['Session 1', "Foundation – Purpose and Overview of GBTLA: Introduction to the principles, philosophy, and rationale of GBTLA. Participants explore how game-based learning supports curriculum delivery, student engagement, and assessment while understanding the teacher's role as a facilitator of learning."],
          ['Session 2', "Implementation – Structure and Teacher's Role: Focuses on the planning and implementation cycle of GBTLA, including lesson design, alignment with learning outcomes, classroom organisation, and effective facilitation using available classroom resources."],
          ['Session 3', "Using Offline Games: Develops teachers' capacity to facilitate low-cost, offline board and classroom games that reinforce curriculum concepts, encourage collaboration, and strengthen conceptual understanding without relying on digital technology."],
          ['Session 4', 'Assessment and Feedback: Explores the integration of formative assessment within gameplay. Teachers learn to observe evidence of learning, provide timely feedback, use questioning techniques, and make instructional decisions based on student performance.'],
          ['Session 5', 'Student Engagement, Behaviour and Classroom Management: Examines strategies for maintaining productive learning environments during game-based activities, including establishing routines, managing group dynamics, promoting positive behaviour, and ensuring equitable participation.'],
          ['Session 6', 'STEM/STEAM, Creativity and Advanced Applications: Introduces the application of GBTLA to STEM/STEAM education through inquiry, design thinking, problem-solving, creativity, and interdisciplinary learning experiences that extend beyond traditional classroom activities.'],
          ['Session 7', 'Bringing It All Together – GBTLA in Practice: A capstone session where participants integrate all components of GBTLA by designing, facilitating, and reflecting on complete game-based lessons, demonstrating effective planning, implementation, assessment, and classroom management.'],
        ] as ReadonlyArray<readonly [string, string]>,
      },
      beaconhouseDefinition: {
        short: "Beaconhouse Trainings build teachers' professional knowledge and practical classroom skills to deliver engaging, inclusive, and effective instruction. The programme covers evidence-based teaching methodologies, AI-enhanced instruction, inquiry-based learning, problem-solving, and learner-centred practices across four core subjects.",
        courses: [
        {
          name: 'English',
          desc: 'Builds foundational English language teaching knowledge and practical instructional skills for effective classroom practice.',
          modules: [
            {
        name: 'AI Literacy',
        desc: 'Builds teachers\' foundational AI knowledge and practical skills for effective classroom use. Covers AI concepts, responsible AI, prompt writing, and AI applications that enhance lesson planning, teaching, and productivity.',
        items: [
          { code: 'AI',  desc: 'AI fundamentals, models vs. agents, AI literacy' },
          { code: 'RAI', desc: 'Ethics, privacy, responsible AI, evaluating AI tools' },
          { code: 'PL',  desc: 'Prompt writing, refinement, and classroom prompts' },
          { code: 'TP',  desc: 'AI-assisted lesson planning and classroom workflows' },
        ],
      },
            {
              name: 'English Teaching Methodologies',
              desc: 'Builds teachers\' understanding of evidence-based English teaching approaches and learner-centred instructional practices for effective classroom instruction.',
              items: [
                { code: 'TM',  desc: 'Grammar Translation, Direct Method, Audio-Lingual, CLT' },
                { code: 'TBL', desc: 'Task-Based Learning and Flipped Classroom' },
                { code: 'LP',  desc: 'Lesson planning aligned with Student Learning Outcomes (SLOs)' },
              ],
            },
            {
              name: 'Reading & Writing Skills Instruction',
              desc: 'Strengthens teachers\' ability to develop reading, vocabulary, and writing skills using evidence-based strategies and AI-supported instruction.',
              items: [
                { code: 'RS', desc: 'Reading comprehension and think-aloud strategies' },
                { code: 'VS', desc: 'Vocabulary development and instructional techniques' },
                { code: 'WS', desc: 'Writing process, creative writing, and mind mapping' },
                { code: 'AI', desc: 'AI-supported reading and writing instruction' },
              ],
            },
            {
              name: 'Listening, Speaking & Language Use',
              desc: 'Develops teachers\' skills in teaching communication, grammar, listening, and speaking through interactive, learner-centred strategies.',
              items: [
                { code: 'LS', desc: 'Listening, storytelling, role-play, and debates' },
                { code: 'GU', desc: 'Grammar, sentence structure, tense, and punctuation' },
                { code: 'OC', desc: 'Pronunciation, intonation, and presentation skills' },
                { code: 'AI', desc: 'AI-supported differentiated instruction' },
              ],
            },
            {
              name: 'Assessment & Feedback in English',
              desc: 'Builds teachers\' capacity to assess learning, provide effective feedback, and use assessment data to improve instruction.',
              items: [
                { code: 'FA', desc: 'Formative assessment and classroom assessment strategies' },
                { code: 'FB', desc: 'Effective feedback techniques' },
                { code: 'RB', desc: 'Rubric design and application' },
                { code: 'AL', desc: 'Differentiated assessment and AI-supported teacher reflection' },
              ],
            },
          ],
        },
        {
          name: 'Mathematics',
          desc: 'Builds foundational mathematical knowledge and practical classroom skills for effective mathematics instruction.',
          modules: [
            { name: 'AI Literacy', desc: 'Builds teachers\' foundational AI knowledge and practical skills for effective classroom use. Covers AI concepts, responsible AI, prompt writing, and AI applications that enhance lesson planning, teaching, and productivity.', items: [
              { code: 'AI',  desc: 'AI fundamentals, models vs. agents, AI literacy' },
              { code: 'RAI', desc: 'Responsible AI, ethics, privacy, and AI evaluation' },
              { code: 'PL',  desc: 'Prompt writing and refinement' },
              { code: 'TP',  desc: 'AI-assisted lesson planning and classroom workflows' },
            ]},
            {
              name: 'Problem Solving & Mathematical Thinking',
              desc: 'Develops teachers\' ability to strengthen mathematical reasoning, problem-solving, and critical thinking through effective questioning, structured activities, and AI-supported instruction.',
              items: [
                { code: 'QT', desc: 'Questioning techniques for deeper mathematical thinking' },
                { code: 'PS', desc: 'Problem-solving strategies and real-world tasks' },
                { code: 'SA', desc: 'Structured mathematical activities' },
                { code: 'AI', desc: 'AI-supported question generation and lesson planning' },
              ],
            },
            {
              name: 'Collaborative Learning & Mathematical Discourse',
              desc: 'Builds teachers\' skills in creating collaborative mathematics classrooms that promote discussion, reflection, and active student participation.',
              items: [
                { code: 'CL', desc: 'Collaborative learning strategies' },
                { code: 'MD', desc: 'Mathematical discussions and discourse' },
                { code: 'SA', desc: 'Self- and peer-assessment' },
                { code: 'RT', desc: 'Reflective teaching and AI-supported lesson reflection' },
              ],
            },
            {
              name: 'Core Mathematical Concepts',
              desc: 'Strengthens teachers\' understanding of fundamental mathematical concepts and learning progressions to support effective mathematics instruction.',
              items: [
                { code: 'NR',  desc: 'Number systems and mathematical reasoning' },
                { code: 'FPR', desc: 'Fractions, ratios, percentages, and proportional reasoning' },
                { code: 'GM',  desc: 'Geometry and measurement' },
                { code: 'DS',  desc: 'Statistics, probability, and data handling' },
              ],
            },
            {
              name: 'Assessment & Feedback in Mathematics',
              desc: 'Builds teachers\' skills in assessing mathematical understanding, providing effective feedback, and improving learning outcomes.',
              items: [
                { code: 'FA', desc: 'Formative assessment and exit tickets' },
                { code: 'DF', desc: 'Differentiation and AI-supported instruction' },
                { code: 'FB', desc: 'Effective feedback strategies' },
                { code: 'RT', desc: 'Lesson reflection and continuous improvement' },
              ],
            },
          ],
        },
        {
          name: 'General Science',
          desc: 'Builds foundational scientific knowledge and practical classroom skills for effective science instruction.',
          modules: [
            { name: 'AI Literacy', desc: 'Builds teachers\' foundational AI knowledge and practical skills for effective classroom use. Covers AI concepts, responsible AI, prompt writing, and AI applications that enhance lesson planning, teaching, and productivity.', items: [
              { code: 'AI',  desc: 'AI fundamentals, models vs. agents, AI literacy' },
              { code: 'RAI', desc: 'Responsible AI, ethics, privacy, and AI evaluation' },
              { code: 'PL',  desc: 'Prompt writing and refinement' },
              { code: 'TP',  desc: 'AI-assisted lesson planning and classroom workflows' },
            ]},
            {
              name: 'Inquiry-Based Science Teaching',
              desc: 'Builds teachers\' skills in using inquiry-based approaches to promote scientific thinking, investigation, and hands-on learning.',
              items: [
                { code: 'IBL',  desc: 'Inquiry-based learning and scientific investigation' },
                { code: '5E',   desc: 'Applying the 5E instructional model' },
                { code: 'HI',   desc: 'Hands-on investigations and inquiry projects' },
                { code: 'AI',   desc: 'AI-supported science lesson planning' },
              ],
            },
            {
              name: 'Conceptual Understanding & Science Process Skills',
              desc: 'Strengthens teachers\' ability to develop conceptual understanding, scientific inquiry, and problem-solving through evidence-based teaching.',
              items: [
                { code: 'CU',   desc: 'Addressing misconceptions through conceptual teaching' },
                { code: 'SPS',  desc: 'Science process skills and inquiry' },
                { code: 'CM',   desc: 'Concept mapping and scientific models' },
                { code: 'STEM', desc: 'STEM activities and AI-supported reflection' },
              ],
            },
            {
              name: 'Differentiation, Inclusion & Scientific Communication',
              desc: 'Builds teachers\' skills in delivering inclusive science instruction and promoting effective scientific communication.',
              items: [
                { code: 'DI', desc: 'Differentiated instruction for diverse learners' },
                { code: 'SC', desc: 'Scientific vocabulary and communication' },
                { code: 'EL', desc: 'Student engagement, metacognition, and large-class strategies' },
                { code: 'AI', desc: 'AI-supported differentiation and instructional planning' },
              ],
            },
            {
              name: 'Assessment & Feedback in Science',
              desc: 'Builds teachers\' skills in assessing scientific understanding, providing effective feedback, and improving learning outcomes.',
              items: [
                { code: 'FA', desc: 'Formative assessment and exit tickets' },
                { code: 'QT', desc: 'Higher-order questioning and SLO alignment' },
                { code: 'FB', desc: 'Feedback strategies and rubric-based assessment' },
                { code: 'AI', desc: 'AI-supported question generation and assessment planning' },
              ],
            },
          ],
        },
        {
          name: 'Computer Science',
          desc: 'Builds foundational computer science knowledge and practical classroom skills for effective computing instruction.',
          modules: [
            { name: 'AI Literacy', desc: 'Builds teachers\' foundational AI knowledge and practical skills for effective classroom use. Covers AI concepts, responsible AI, prompt writing, and AI applications that enhance lesson planning, teaching, and productivity.', items: [
              { code: 'AI',  desc: 'AI fundamentals, models vs. agents, AI literacy' },
              { code: 'RAI', desc: 'Responsible AI, ethics, privacy, and AI evaluation' },
              { code: 'PL',  desc: 'Prompt writing and refinement' },
              { code: 'TP',  desc: 'AI-assisted lesson planning and classroom workflows' },
            ]},
            {
              name: 'CS Foundations',
              desc: 'Builds teachers\' foundational knowledge of computer science, curriculum planning, and responsible digital practices.',
              items: [
                { code: 'CP', desc: 'Curriculum planning and SLO alignment' },
                { code: 'BT', desc: 'Bloom\'s Taxonomy and higher-order thinking' },
                { code: 'DC', desc: 'Digital citizenship and CS terminology' },
                { code: 'AI', desc: 'AI-supported lesson planning and reflection' },
              ],
            },
            {
              name: 'Computational Thinking',
              desc: 'Develops teachers\' ability to strengthen computational thinking and problem-solving through learner-centred teaching strategies.',
              items: [
                { code: 'CT', desc: 'Computational thinking and design thinking' },
                { code: 'IS', desc: 'Inquiry-based, flipped, and microlearning approaches' },
                { code: 'QS', desc: 'Effective questioning for computational reasoning' },
                { code: 'AI', desc: 'AI-supported activities and assessment' },
              ],
            },
            {
              name: 'CS Concepts in the Classroom',
              desc: 'Builds teachers\' confidence in teaching core computer science concepts through engaging and practical classroom strategies.',
              items: [
                { code: 'CI', desc: 'Inquiry-based CS instruction' },
                { code: 'PS', desc: 'Computational problem-solving and design thinking' },
                { code: 'AS', desc: 'Active, flipped, and microlearning strategies' },
                { code: 'AI', desc: 'AI-supported classroom activities and resources' },
              ],
            },
            {
              name: 'Assessment & Feedback in Computer Science',
              desc: 'Builds teachers\' skills in assessing learning, providing effective feedback, and improving computer science instruction.',
              items: [
                { code: 'FA', desc: 'Formative assessment and exit tickets' },
                { code: 'FB', desc: 'Effective feedback strategies' },
                { code: 'RB', desc: 'Rubrics and success criteria' },
                { code: 'CA', desc: 'Constructive alignment and assessment design' },
              ],
            },
          ],
        },
      ] as ReadonlyArray<{
          name: string; desc: string;
          modules: ReadonlyArray<{ name: string; desc: string; items: ReadonlyArray<{ code: string; desc: string }> }>;
        }>,
      },
    },
    load: {
      busy: 'Loading the training numbers',
      error: "The training numbers didn't load. Check your connection and try again.",
    },
  },
  /** bd-97x22y.5 — the Observations tab in the ICT dashboard's words (PLAN v7, her Observations.jsx). */
  obsV7: {
    kinds: { human: 'Human observations', dc: 'Digital Coach observations' } as Record<ObservationKind, string>,
    summary: { human: 'Observation summary', dc: 'Digital Coach impact' } as Record<ObservationKind, string>,
    breakdown: 'FICO score breakdown',
    chart: { human: 'Avg observation scores by sector', dc: 'Digital Coach — avg scores by sector' } as Record<ObservationKind, string>,
    sectors: 'Sector breakdown',
    tiles: {
      observations: { human: 'Total observations', dc: 'Total DC observations' } as Record<ObservationKind, string>,
      teachersObserved: 'Teachers observed',
      sectorsActive: { human: 'Sectors active', dc: 'Sectors covered' } as Record<ObservationKind, string>,
    },
    /** Her three sections, in her order. */
    sections: { b: 'LP Fidelity', c: 'Teaching Practices', d: 'Engagement' },
    scoreCards: { b: 'LP Fidelity score', c: 'Teaching Practices score', d: 'Engagement score' },
    codes: { b: 'Section B', c: 'Section C', d: 'Section D' },
    /** "Section B — LP Fidelity" (the chart legend), "Section B — Human observations" (under a score card). */
    dash: (a: string, b: string) => `${a} — ${b}`,
    shortCodes: { b: 'B', c: 'C', d: 'D' },
    /** Her y-axis. */
    axis: 'Average score (%)',
    /** Under a sector card's count. */
    unit: { human: 'observations', dc: 'Digital Coach observations' } as Record<ObservationKind, string>,
    /** A school row's count: "12 obs". */
    obs: (n: string) => `${n} obs`,
    noSchools: 'No schools here.',
  },

  /** bd-97x22y.5 — the Coaching tab in the ICT dashboard's words (PLAN v7, her Coaching.jsx). */
  coachingV7: {
    totalCoaches: 'Total coaches',
    totalVisits: 'Total visits',
    schools: 'Schools',
    coaches: 'Coaches',
    byRegion: 'Coaches by sector',
    total: (n: string) => `${n} total`,
    coachesIn: (n: string) => `${n} ${n === '1' ? 'coach' : 'coaches'}`,
    none: 'No coaches',
  },

  /**
   * bd-97x22y.3 — the LP Engagement tab (schools analytics v7), her words and her order (LPEngagement.jsx): the
   * Primary / Mid-High toggle, ENGAGEMENT OVERVIEW, TEACHER STATUS, SECTORS (ring cards → school breakdown), the
   * subject and grade tables, and the sector-wise grouped bars. v7 shows her percentages (operator, 2026-10-14:
   * "fully 1 to 1"); they are written with `percent` above.
   */
  lpEngagement: {
    bandLabel: 'Teachers',
    bands: { primary: 'Primary Teachers', midhigh: 'Mid / High Teachers' } as Record<LpBand, string>,
    /** Her section labels (set in capitals by the page). */
    sections: {
      overview: 'Engagement overview',
      status: 'Teacher status',
      sectors: 'Sectors — click to view school breakdown',
    },
    /** Her card titles, as she writes them. */
    cards: {
      bySubject: 'LP Engagement by Subject',
      byGrade: (grades: string) => `LP Engagement by Grade — ${grades}`,
      chart: 'Sector-wise Performance in Subjects & Grades',
      chartHint: 'LP Engagement % per sector',
    },
    grades: { primary: 'Grades 1–5', midhigh: 'Grades 6–12' } as Record<LpBand, string>,
    /** Her KPI cards (set in capitals by the card). */
    tiles: {
      overall: 'Overall LP Engagement',
      tracked: 'Total Teachers Tracked',
      activeSectors: 'Active Sectors',
      onSchedule: 'On-Schedule Teachers',
      moderate: 'Moderate Teachers',
      offSchedule: 'Off-Schedule Teachers',
    },
    /** Her line under each card. */
    hints: {
      overall: { primary: 'Primary teachers', midhigh: 'Mid / High teachers' } as Record<LpBand, string>,
      tracked: 'Across all LP status categories',
      activeSectors: 'Sectors with LP data',
      onSchedule: 'LP ratio ≥ 60%',
      moderate: 'LP ratio 40–59%',
      offSchedule: 'LP ratio < 40%',
    },
    status: { on: 'On-Schedule', moderate: 'Moderate', off: 'Off-Schedule' } as Record<LpStatus, string>,
    /** In the middle of a sector's ring, under its %, on two lines. */
    ring: ['LP', 'Engage'] as [string, string],
    totalTeachers: 'Total Teachers',
    columns: {
      subject: 'Subject',
      grade: 'Grade',
      school: 'School Name',
      lp: 'LP Engagement',
      status: 'Status',
      lpShort: 'LP Engage',
      bands: { on: ['On-Schedule', '(≥60%)'], moderate: ['Moderate', '(40-59%)'], off: ['Off-Schedule', '(<40%)'] } as Record<LpStatus, [string, string]>,
    },
    overall: 'Overall',
    grade: (g: string) => `Grade ${g}`,
    viewBy: 'View By',
    viewByOptions: { subjects: 'Subjects', grades: 'Grades' } as Record<'subjects' | 'grades', string>,
    noSchools: 'No schools found for this sector.',
    loading: 'Loading LP engagement',
    error: "The LP engagement numbers didn't load. Check your connection and try again.",
  },
};

export type AnalyticsWords = typeof EN;

export const SCHOOLS_ANALYTICS_COPY: { readonly en: AnalyticsWords; readonly ur?: AnalyticsWords } = { en: EN };

/** The words for a language, English until that language's table exists. */
export function analyticsCopy(lang?: string | null): AnalyticsWords {
  return (lang === 'ur' && SCHOOLS_ANALYTICS_COPY.ur) || SCHOOLS_ANALYTICS_COPY.en;
}
