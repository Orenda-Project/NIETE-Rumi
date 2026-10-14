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
        ],
      },
      {
        title: 'Trainings',
        items: [
          { term: 'Modules completed', text: "Training modules the school's teachers finished in the period, each module counted once per teacher." },
          { term: 'Teachers trained', text: 'How many of the N teachers finished at least one module in the period ("x of N").' },
        ],
      },
      {
        title: 'Observations',
        items: [
          { term: 'DC observations', text: "Finished Digital Coach (AI) observations of the teachers' lessons in the period." },
          { term: 'Teachers observed', text: 'How many of the N teachers had at least one Digital Coach observation in the period ("x of N").' },
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
        ],
      },
      {
        title: 'Regions, periods and totals',
        items: [
          { term: 'Regions and totals', text: 'Counts are added up across schools. Averages are worked out over all the scored observations together, so a large school weighs more than a small one.' },
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
};

export type AnalyticsWords = typeof EN;

export const SCHOOLS_ANALYTICS_COPY: { readonly en: AnalyticsWords; readonly ur?: AnalyticsWords } = { en: EN };

/** The words for a language, English until that language's table exists. */
export function analyticsCopy(lang?: string | null): AnalyticsWords {
  return (lang === 'ur' && SCHOOLS_ANALYTICS_COPY.ur) || SCHOOLS_ANALYTICS_COPY.en;
}
