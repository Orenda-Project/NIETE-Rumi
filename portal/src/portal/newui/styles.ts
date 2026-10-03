import type { KeyboardEvent } from 'react';

/**
 * bd-5rz1v.19 — class strings and helpers the kit shares.
 *
 * Every tap target is at least 56px (TAP_MIN_PX in tokens.ts). Where the mockup draws
 * something smaller — the 40px back circle, the 36px date-range pill — the visible shape sits
 * inside a 56px target, as the menu's avatar does.
 */

/** Keyboard focus: the amber ring, visible on indigo and on white. */
export const FOCUS = 'outline-none focus-visible:ring-[3px] focus-visible:ring-nu-focus';

/** A 56px-tall target. */
export const TAP = 'min-h-[56px]';

/** A 56px square target, for something with only an icon. */
export const TAP_SQUARE = 'min-h-[56px] min-w-[56px]';

/**
 * A grid that mirrors in Urdu. NOT Tailwind's `grid` class: src/index.css (from the first
 * commit) forces every `.grid` to direction:ltr under [dir="rtl"], so a `grid` would keep its
 * first item on the left in Urdu. `[display:grid]` is the same display without that class.
 * checks/style.test.tsx refuses a bare `grid` in new-UI source.
 */
export const GRID = '[display:grid]';

/** What a row, tile or option does under a finger. */
export const PRESS = 'active:bg-nu-ink-xlight';

/** True when the element sits inside a right-to-left page (Urdu). */
export function isRtl(el: Element | null): boolean {
  const dir = el?.closest('[dir]')?.getAttribute('dir');
  return dir === 'rtl';
}

/**
 * Arrow keys for a one-choice group (role=radiogroup): the arrows move the pick and the focus,
 * Home and End jump to the ends. Left and right swap in RTL, so "next" is always the reading
 * direction. Items carry data-radio-key so focus can follow the pick.
 */
export function radioKeyDown<K extends string | number>(
  e: KeyboardEvent<HTMLElement>,
  keys: readonly K[],
  current: K | null,
  pick: (key: K) => void,
): void {
  if (!keys.length) return;
  const rtl = isRtl(e.currentTarget);
  const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
  const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
  const at = current === null ? -1 : keys.indexOf(current);
  let next: number;
  switch (e.key) {
    case forward:
    case 'ArrowDown':
      next = at < 0 ? 0 : (at + 1) % keys.length;
      break;
    case backward:
    case 'ArrowUp':
      next = at < 0 ? 0 : (at - 1 + keys.length) % keys.length;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = keys.length - 1;
      break;
    default:
      return;
  }
  e.preventDefault();
  pick(keys[next]);
  const group = e.currentTarget.closest('[role="radiogroup"]');
  const target = group?.querySelector<HTMLElement>(`[data-radio-key="${String(keys[next])}"]`);
  target?.focus();
}
