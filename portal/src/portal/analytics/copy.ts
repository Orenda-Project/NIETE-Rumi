/**
 * bd-s6qbts.3 — EVERY word the schools analytics page shows, in one place, keyed by language.
 *
 * English only in v1 (PLAN v2 §4). Urdu is a DATA change: add `ur: { … }` beside `en` with the same keys (the type
 * makes a missing key a build error), then register it with the portal's Urdu completeness checks
 * (teacher/copyRegistry.ts COPY_MODULES) like the auth pages. No component holds a literal word.
 *
 * DATA is not copy: a school's name, its region, its EMIS code and every number come from the API as they are.
 *
 * No percentages, bands or thresholds (PLAN v3): nothing here may contain a percent sign — the page test checks the
 * rendered tiles, cards and table for one.
 */

export type SortKey =
  | 'name' | 'region' | 'teachers' | 'lpsOpened' | 'dcObservations'
  | 'humanObservations' | 'avgFico' | 'avgHitl';

export type PeriodPreset = 'week' | 'month' | 'quarter' | 'year';

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
    page: 'Schools analytics',
    pageShort: 'Analytics',
    logout: 'Log out',
    signedIn: 'Signed in',
    privacy: 'Privacy policy',
  },

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

  /** The overview tiles, region cards and table columns share these names. */
  schoolsTile: 'Schools',
  metrics: {
    teachers: 'Teachers',
    lpsOpened: 'LPs opened',
    dcObservations: 'DC observations',
    humanObservations: 'Human observations',
    avgFico: 'Avg FICO',
    avgHitl: 'Avg HITL',
  },
  overviewLabel: 'Overview',
  xOfN: (x: string, n: string) => `${x} of ${n} teachers`,
  xOfNShort: (x: string, n: string) => `${x} of ${n}`,
  scored: (n: string) => `${n} scored`,
  loggedSince: (d: string) => `logged since ${d}`,

  regions: {
    title: 'By region',
    hint: 'Each region added up over its schools. Select one to see only its schools.',
    open: (region: string) => `Show ${region} only`,
  },

  schools: {
    title: 'Schools',
    columns: {
      name: 'School', region: 'Region', teachers: 'Teachers', lpsOpened: 'LPs opened',
      dcObservations: 'DC observations', humanObservations: 'Human observations',
      avgFico: 'Avg FICO', avgHitl: 'Avg HITL',
    } as Record<SortKey, string>,
    /** The small line under a column's name. */
    columnHints: { lpsOpened: 'x of N teachers', dcObservations: 'x of N teachers', avgFico: '(n scored)', avgHitl: '(n scored)' } as Partial<Record<SortKey, string>>,
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

  how: {
    title: 'How these numbers are worked out',
    items: [
      { term: 'Schools', text: 'Active NIETE schools in the six ICT regions: B.K, Sihala, Urban-I, Nilore, Urban-II and Tarnol. Test schools are left out. A school with no region on record, or with a region outside these six, is not shown and not counted in any number.' },
      { term: 'Teachers', text: "Teachers registered at the school today; test accounts are left out. A teacher's activity counts for the school she is at now, so a teacher who moved takes her earlier activity with her." },
      { term: 'LPs opened', text: 'Different lesson plans the school\'s teachers opened in the period: opening the same plan again counts once per teacher. "x of N" is how many of the school\'s N teachers opened at least one. Opens are recorded from 4 Oct 2026, so a period that starts earlier shows fewer than really happened.' },
      { term: 'DC observations', text: 'Finished Digital Coach (AI) observations of the teachers\' lessons in the period. "x of N" is how many of the N teachers had at least one.' },
      { term: 'Human observations', text: 'Finished observations of the teachers by a school leader or coach in the period, including ones the observer has reviewed.' },
      { term: 'Avg FICO', text: 'The average Digital Coach observation score, out of 100, over the observations in the period that have a score. The number in brackets is how many were scored.' },
      { term: 'Avg HITL', text: "The average score of human observations, out of 100, after the observer's review. The number in brackets is how many were scored." },
      { term: 'Grey and —', text: 'An average from fewer than 3 scored observations is shown in grey: one or two lessons say little about a school. — means nothing was scored. A 0 is a real 0: none happened.' },
      { term: 'Regions and totals', text: 'Counts are added up across schools. Averages are worked out over all the scored observations together, so a large school weighs more than a small one.' },
      { term: 'Period', text: 'Days are counted in Pakistan time, the first and the last day both included.' },
    ] as ReadonlyArray<{ term: string; text: string }>,
  },

  states: {
    loading: 'Loading the numbers',
    forbiddenTitle: 'Schools analytics',
    forbidden: 'This page is for analytics accounts. Ask the NIETE team if you need access.',
    error: "The numbers didn't load. Check your connection and try again.",
    retry: 'Try again',
  },
};

export type AnalyticsWords = typeof EN;

export const SCHOOLS_ANALYTICS_COPY: { readonly en: AnalyticsWords; readonly ur?: AnalyticsWords } = { en: EN };

/** The words for a language, English until that language's table exists. */
export function analyticsCopy(lang?: string | null): AnalyticsWords {
  return (lang === 'ur' && SCHOOLS_ANALYTICS_COPY.ur) || SCHOOLS_ANALYTICS_COPY.en;
}
