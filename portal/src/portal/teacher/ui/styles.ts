/**
 * bd-fmf24g.2 — class strings the teacher kit shares. The teacher app is drawn in the v28 canvas's coach-v2 look
 * (COMPONENTS.md "Shared rules"): grey page #f3f4f6, white cards with a #e5e7eb edge and 16px corners, ink
 * #1d2025, indigo #33374a for selection, muted #6b7280, neutral grey subject tiles; a feature's colour is never
 * used here (only its icon, FEATURE_HUE). The hexes are the canvas's own, as coach/ui.tsx writes them.
 *
 * Keyboard focus, the mirrored grid and arrow-key radio groups come from the new UI kit (newui/styles.ts), so
 * every page behaves the same under a keyboard and in Urdu.
 */
export { FOCUS, GRID, radioKeyDown } from '../../newui/styles';

/** Chip tones (COMPONENTS.md "Chip object everywhere"). */
export type ChipTone = 'done' | 'waiting' | 'info' | 'score' | 'error';
export interface ChipData {
  text: string;
  tone?: ChipTone;
}

export const CHIP_TONE: Record<ChipTone, string> = {
  done: 'bg-[#eaf6ef] text-[#2f7a52]',
  waiting: 'bg-[#fef3c7] text-[#b45309]',
  info: 'bg-[#f3f4f6] text-[#374151]',
  score: 'bg-[#e8e9f0] text-[#33374a]',
  error: 'bg-[#fee4e2] text-[#c8331f]',
};

/** A tappable white card: 1px edge, 16px corners, the soft shadow. */
export const CARD = 'rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]';

/** A selected card: 2px indigo edge on the light indigo tint, lifted. */
export const CARD_SELECTED = 'rounded-2xl border-2 border-[#33374a] bg-[#f4f5f8] shadow-[0_4px_12px_rgba(51,55,74,0.14)]';

/** The white card that holds a list's rows (one per day in a HistoryList). */
export const LIST_CARD = 'overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]';

/** A row inside a list card, after the first: a 1px divider. */
export const ROW_DIVIDER = 'border-t border-[#f0f1f3]';

/** A selected flat row: the tint and a 3px indigo bar on the START edge (left in English, right in Urdu). */
export const ROW_SELECTED = 'bg-[#f4f5f8] shadow-[inset_3px_0_0_#33374a] rtl:shadow-[inset_-3px_0_0_#33374a]';

/** The › at a row's end: grey, turned round in Urdu. */
export const CHEVRON = 'shrink-0 text-[#9ca3af] rtl:rotate-180';

/** Title and second line of a row. */
export const ROW_TITLE = 'text-[16px] font-semibold leading-[1.3]';
export const ROW_SUB = 'text-[13px] leading-[1.3] text-[#6b7280]';

/** The full-width outline button at a list's end (Show more, See all). */
export const OUTLINE_WIDE = 'flex min-h-[56px] w-full items-center justify-center gap-1.5 rounded-2xl border border-[#d1d5db] bg-white text-[16px] font-semibold text-[#33374a]';
