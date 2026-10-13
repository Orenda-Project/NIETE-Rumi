import type { ComponentProps } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

/**
 * bd-fmf24g.68 — what Back means, once, for every header: the screen she was just on.
 *
 * With an in-app screen behind this one, Back is the browser's own step back (`navigate(-1)`), so she lands where she
 * came from, not on the page's fixed parent ("Coaching → Lesson plan → Back" is Coaching, not Home). Only when nothing
 * of the app is behind it — a fresh tab, a link from WhatsApp, the first page after sign-in — does Back go to the
 * page's fixed parent (`backTo`), replacing this entry so a second Back does not bounce.
 *
 * "Nothing behind" is React Router's first entry: the key "default" (a MemoryRouter and a fresh BrowserRouter), or a
 * history index of 0 (an entry replaced after sign-in gets a new key but keeps index 0).
 *
 * Never a way to a transient screen: a page that was only a step of sending or saving (Sending…, a submitted form,
 * a redirect) must be entered with `replace`, so it is not in the history to land on.
 */
export function nothingBehind(key: string): boolean {
  if (key === 'default') return true;
  try {
    const idx = (window.history.state as { idx?: unknown } | null)?.idx;
    return typeof idx === 'number' && idx <= 0;
  } catch {
    return false;
  }
}

export function useBack(backTo?: string): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return () => {
    if (backTo && nothingBehind(location.key)) navigate(backTo, { replace: true });
    else navigate(-1);
  };
}

/** A header's back arrow: a real link to `backTo` (href, focus, long-press) whose tap is `useBack`. */
export function BackLink({ to, onClick, ...rest }: ComponentProps<typeof Link>) {
  const back = useBack(typeof to === 'string' ? to : undefined);
  return (
    <Link
      {...rest}
      to={to}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        back();
      }}
    />
  );
}
