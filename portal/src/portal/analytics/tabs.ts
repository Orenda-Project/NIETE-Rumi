/**
 * bd-97x22y.2 — the schools analytics page's six tabs, in the ICT dashboard's order (PLAN v6 §1), and where each
 * one lives: /portal/analytics/schools is the Overview, /portal/analytics/schools/<tab> every tab (overview too).
 *
 * ONE list: the sidebar, the phone tab row, the page's route and the analytics-only gate (lib/homeRoute) all read it,
 * so a tab cannot be on the menu and refused by the gate, or the reverse. No imports: homeRoute imports this.
 */
export const SCHOOLS_PATH = '/portal/analytics/schools';

export type SchoolsTab = 'overview' | 'lp' | 'training' | 'observations' | 'coaching' | 'info';

export const SCHOOLS_TABS: readonly SchoolsTab[] = ['overview', 'lp', 'training', 'observations', 'coaching', 'info'];

export const isSchoolsTab = (t: unknown): t is SchoolsTab => SCHOOLS_TABS.includes(t as SchoolsTab);

/** The address of a tab: the Overview is the page itself. */
export const tabPath = (tab: SchoolsTab): string => (tab === 'overview' ? SCHOOLS_PATH : `${SCHOOLS_PATH}/${tab}`);

/** The tabs whose numbers are the schools read (all but Information); the Coaching tab adds its own read. */
export const DATA_TABS: readonly SchoolsTab[] = ['overview', 'lp', 'training', 'observations', 'coaching'];

/** The tabs that show the coaching numbers (PLAN v6 §2: the Overview's Coaching section and the Coaching tab). */
export const COACHING_TABS: readonly SchoolsTab[] = ['overview', 'coaching'];
