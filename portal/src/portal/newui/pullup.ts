import { useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * bd-5rz1v.18 — what the pull-up menu (PullUpMenu.tsx) and the teacher's bar (NewUiNavigation.tsx)
 * share: her initials, and a swipe up or down.
 */

/** Her initials: the first letter of the first two words of her name. */
export function initials(name?: string | null): string {
  return (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => Array.from(w)[0]).join('').toUpperCase();
}

/* ── swipes ──────────────────────────────────────────────────────────────── */

/** How far a finger must travel to be a swipe and not a tap. */
const SWIPE_PX = 24;

/**
 * A swipe up or down on an element: pointer handlers to spread on it. A swipe that started on a
 * link must not also follow it, so the click that can come after is swallowed (capture phase).
 */
export function useSwipe({ onUp, onDown }: { onUp?: () => void; onDown?: () => void }) {
  const start = useRef<{ id: number; y: number } | null>(null);
  const swiped = useRef(false);
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      start.current = { id: e.pointerId, y: e.clientY };
      swiped.current = false;
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || s.id !== e.pointerId) return;
      const dy = e.clientY - s.y;
      if (dy <= -SWIPE_PX && onUp) { swiped.current = true; onUp(); }
      if (dy >= SWIPE_PX && onDown) { swiped.current = true; onDown(); }
    },
    onPointerCancel: () => { start.current = null; },
    onClickCapture: (e: ReactMouseEvent) => {
      if (!swiped.current) return;
      swiped.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
