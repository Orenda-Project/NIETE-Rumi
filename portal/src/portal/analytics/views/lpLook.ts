import { CheckCircle2, Clock, TrendingUp, XCircle, type LucideIcon } from 'lucide-react';
import type { LpStatus } from '../../types/portal';

export { HER_GREEN } from './trainingLook';

/**
 * bd-97x22y.3 — her LP Engagement colours, 1 to 1 (operator, 2026-10-14: "fully 1 to 1"; the Trainings tab's
 * trainingLook.ts is the same idea): one table, read by every part of the tab, so a band or a subject is the same
 * colour on its card, its table cell and its bar. Hers: frontend/src/pages/LPEngagement.jsx (LPKPICard calls,
 * SectorLPCard, SectorBreakdownTable, LPBySubjectTable, SUBJECT_COLORS, CHART_PALETTE).
 */

/** Her KPI cards: the border and icon colour, the icon's tint, the icon. */
export interface KpiLook {
  color: string;
  light: string;
  Icon: LucideIcon;
}

export const KPI_LOOK = {
  overall: { color: '#47ba7c', light: '#EDFDF5', Icon: TrendingUp },
  tracked: { color: '#F59E0B', light: '#FEF9EE', Icon: CheckCircle2 },
  activeSectors: { color: '#818CF8', light: '#F0EFFE', Icon: XCircle },
  on: { color: '#47ba7c', light: '#EDFDF5', Icon: CheckCircle2 },
  moderate: { color: '#F59E0B', light: '#FEF9EE', Icon: Clock },
  off: { color: '#F43F5E', light: '#FFF1F2', Icon: XCircle },
} as const satisfies Record<string, KpiLook>;

/** Her band colours in the sector cards and the school status pill (SectorLPCard, SectorBreakdownTable). */
export const BAND_COLOR: Record<LpStatus, string> = { on: '#47ba7c', moderate: '#F59E0B', off: '#EF4444' };

/** Her table columns (LPBySubjectTable / LPByGradeTable: text-green-600, text-amber-500, text-red-500). */
export const TABLE_COLOR: Record<LpStatus, string> = { on: '#16A34A', moderate: '#F59E0B', off: '#EF4444' };

/** Her chart palette (CHART_PALETTE): a grade's bar takes the colour of its place, as hers does. */
const CHART_PALETTE = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#F97316', '#3B82F6', '#EC4899', '#14B8A6', '#84CC16', '#6366F1'];

/**
 * A subject's colour: hers by subject (SUBJECT_COLORS) where she had it; for a subject she did not have, a fixed colour
 * of her palette (hers falls back to the palette by position, which would repaint a subject when another one drops
 * out of the window). Where two of hers collide inside one band (her Biology = ISL green, Chemistry = Math violet,
 * Computer Science = Sci blue) the later one takes a free colour of her palette or a darker step of a family used;
 * Computer Science is a dark slate because every teal/green left sat too close to Islamiat in the Mid / High chart.
 */
const SUBJECT_COLOR: Readonly<Record<string, string>> = {
  english: '#4F46E5',
  urdu: '#EC4899',
  maths: '#8B5CF6',
  islamiat: '#10B981',
  social_studies: '#F97316',
  science: '#3B82F6',
  general_knowledge: '#F59E0B',
  physics: '#EF4444',
  chemistry: '#06B6D4',
  chemistry_experiment: '#0E7490',
  biology: '#84CC16',
  computer_science: '#334155',
  pakistan_studies: '#B45309',
  geography: '#0369A1',
  history: '#BE185D',
  zari_taleem: '#4D7C0F',
};

/** Her "Others" grey. */
const OTHER = '#9CA3AF';

export const subjectColor = (key: string): string => SUBJECT_COLOR[key] ?? OTHER;

/** The i-th grade of the band's list (Grade 1 or Grade 6 first). */
export const gradeColor = (index: number): string => CHART_PALETTE[index % CHART_PALETTE.length];
