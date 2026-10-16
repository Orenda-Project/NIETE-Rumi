import { BarChart3, GraduationCap, Star, Users, type LucideIcon } from 'lucide-react';

/**
 * bd-97x22y.4 — her Trainings colours, 1 to 1 (operator, 2026-10-14: "fully 1 to 1"): one table, read by every part
 * of the tab so a level is the same colour on its card, its sector row and its bars.
 *
 * Hers: TrainingLevelCard.jsx LEVEL_CONFIG (cards), TrainingComparisonChart.jsx SERIES (bars), Trainings.jsx
 * TRAINING_LEVEL_TABS / TRAINING_LEVEL_META (toggle, sector rows), OxbridgeFunnelContent.jsx (middle / high).
 */
export interface Look {
  color: string;
  light: string;
  Icon: LucideIcon;
}

/** A level card, by the level's order (0 Aspiring Teacher … 3 Teacher Leader). */
export const LEVEL_LOOK: Record<number, Look> = {
  0: { color: '#3B82F6', light: '#EFF6FF', Icon: GraduationCap },
  1: { color: '#47ba7c', light: '#EDFDF5', Icon: Users },
  2: { color: '#F59E0B', light: '#FEF9EE', Icon: BarChart3 },
  3: { color: '#8B5CF6', light: '#F5F3FF', Icon: Star },
};

export const OXBRIDGE_LOOK: Look = { color: '#0891B2', light: '#E0F2FE', Icon: GraduationCap };
export const BEACONHOUSE_LOOK: Look = { color: '#818CF8', light: '#EEF2FF', Icon: Star };

/** Her green: section labels, the sector cards' big number, the chart's frame, "View Details". */
export const HER_GREEN = '#47ba7c';

/** Her Primary / Mid-High toggle. */
export const BAND_LOOK = {
  primary: { color: '#47ba7c', Icon: GraduationCap },
  midhigh: { color: '#818CF8', Icon: Users },
} as const;

/** Her chart series (TrainingComparisonChart.jsx), by level order, then the two partners. */
export const SERIES_COLOR: Record<string, string> = {
  0: '#3b82f6',
  1: '#10b981',
  2: '#f59e0b',
  3: '#8b5cf6',
  oxbridge: '#0891B2',
  beaconhouse: '#818CF8',
};

/** Her sector-card rows (TRAINING_LEVEL_META): the level colours, then the partners'. */
export const ROW_COLOR: Record<string, string> = {
  0: '#3B82F6',
  1: '#47ba7c',
  2: '#F59E0B',
  3: '#8B5CF6',
  oxbridge: '#0891B2',
  beaconhouse: '#818CF8',
};

export const MIDDLE_COLOR = '#0891B2';
export const HIGH_COLOR = '#818CF8';
