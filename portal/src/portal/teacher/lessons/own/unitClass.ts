import { LEVELS, SIZES, type Level, type Size } from './rules';

/**
 * bd-snkn32.59.1 — "Your class" on a unit page (children, level): sent with each day's make, remembered on this phone
 * for this unit only (a convenience; the server keeps every made day's answers). Storage can be off: then empty.
 */
export type UnitClass = { size: Size | null; level: Level | null };
const KEY = (id: string) => `lpOwnUnitClass:${id}`;
const EMPTY: UnitClass = { size: null, level: null };

export function readClass(id: string): UnitClass {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY(id)) || 'null') as Partial<UnitClass> | null;
    if (!v) return EMPTY;
    return {
      size: (SIZES as readonly string[]).includes(v.size as string) ? (v.size as Size) : null,
      level: (LEVELS as readonly string[]).includes(v.level as string) ? (v.level as Level) : null,
    };
  } catch {
    return EMPTY;
  }
}

export function writeClass(id: string, c: UnitClass): void {
  try { window.localStorage.setItem(KEY(id), JSON.stringify(c)); } catch { /* storage off: kept for this visit only */ }
}
