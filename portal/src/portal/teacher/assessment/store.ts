import { useCallback, useSyncExternalStore } from 'react';
import { newPicks, type Picks } from './model';

/**
 * bd-fmf24g.6 — the New paper's choices, shared by its six step pages (each is its own route, so Back
 * and a reload work). Held in memory and mirrored to sessionStorage: a refresh mid-way keeps her picks,
 * a new browser tab starts clean. Every storage read/write is in try/catch (blocked, full, hand-edited).
 */

const KEY = 'teacher-v2-assessment-new:v1';
/** The bot's DEFAULT_QUESTIONS; the Questions step shows the live default from /assessment/options. */
const DEFAULT_COUNT = 15;

let current: Picks | null = null;
const listeners = new Set<() => void>();

function read(): Picks {
  if (current) return current;
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Picks>) : null;
    current = parsed && typeof parsed === 'object' ? { ...newPicks(DEFAULT_COUNT), ...parsed } : newPicks(DEFAULT_COUNT);
  } catch {
    current = newPicks(DEFAULT_COUNT);
  }
  return current;
}

function write(next: Picks): void {
  current = next;
  try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* memory is enough */ }
  listeners.forEach((l) => l());
}

export function setPicks(change: Partial<Picks> | ((p: Picks) => Partial<Picks>)): void {
  const base = read();
  write({ ...base, ...(typeof change === 'function' ? change(base) : change) });
}

/** Start a new paper (Make another, a fresh New paper from the hub). */
export function resetPicks(defaultCount: number = DEFAULT_COUNT): void {
  write(newPicks(defaultCount));
}

/** Tests only. */
export function clearPicksForTest(): void {
  current = null;
  try { sessionStorage.removeItem(KEY); } catch { /* nothing */ }
}

export function usePicks(): [Picks, typeof setPicks] {
  const subscribe = useCallback((cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, []);
  const picks = useSyncExternalStore(subscribe, read, read);
  return [picks, setPicks];
}
