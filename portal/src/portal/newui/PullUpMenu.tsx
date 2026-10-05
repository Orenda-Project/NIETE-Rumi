import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import i18n from 'i18next';
import type { LucideIcon } from 'lucide-react';
import { Award, BarChart3, CircleUserRound, Languages, ListChecks, Loader2, LogOut, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { language as languageApi } from '../services/api';
import { Chip } from './Chip';
import { NAV_COPY } from './copy';
import { FOCUS, GRID } from './styles';
import { initials, useSwipe } from './pullup';

/**
 * bd-5rz1v.18 — the pull-up menu (deep-screens.html, "Menu bar · pull up"): the operator's ONE
 * place for everything the teacher's five-item bar does not hold. It replaces the account sheet
 * (bd-5rz1v.12): every avatar opens this panel (accountSheet.ts holds whether it is open).
 *
 *   the handle  a 38×4 grab mark on top of the indigo bar (`.nav.handle`). The bar's own empty
 *               space is the handle's button (it sits behind the five items), and a swipe up
 *               anywhere on the bar opens the panel (useBarSwipe).
 *   the panel   a dimmed page (`.pu-scrim`); an indigo panel rising from the bar with 24px top
 *               corners (`.pullup`): a grab mark, "who" (her initials, her name, school · Teacher),
 *               then a 3-column grid of big tiles (`.pgrid`, `.ptile`). The menu row stays below
 *               it, above the dimmed page. On a desktop it is a card under the avatar.
 *   closing     role="dialog" + data-state="open" is what Android Back looks for
 *               (lib/back-button.cjs): Back sends Escape, and Escape closes it. So do a tap on the
 *               dimmed page, a swipe down, the handle again, and going to a tile.
 *
 * Tiles: My Classes, Certificates (the new Training certificates page), My grades (the band
 * picker, which bd-5rz1v.25 moved behind the avatar; it must stay reachable), Language, My account,
 * Analytics (the old page, until Home replaces it) and Logout, light red, across the last row.
 * Logout is the caller's guarded logout: while a lesson records it asks "Stop recording?" first.
 *
 * LANGUAGE (language-protocol skill; root CLAUDE.md rule 20). The portal's one language setting:
 * GET/PUT /api/portal/me/language, whose write goes through the bot's setUserLanguage — the ONE
 * writer (it validates the offer, sets the lock, clears both caches). The tile names the language
 * it switches to. A tap writes first and only then turns the page (i18n: lang + dir), so the page
 * never shows a language the bot did not accept; a failed write leaves the page and says Not
 * saved. `locked` means SHE chose (resolve-response-language.js: "use it always"): when the panel
 * reads a locked choice that this page is not showing, the page follows it — no write. An
 * unlocked value is a default, not her decision, and changes nothing. Nothing is ever written
 * without her tap.
 */

/* ── language ────────────────────────────────────────────────────────────── */

type Lang = 'ur' | 'en';
const asLang = (code?: string | null): Lang => (String(code || '').toLowerCase().startsWith('ur') ? 'ur' : 'en');
const isOffered = (code: unknown): code is Lang => code === 'ur' || code === 'en';

/**
 * The page's language, from the portal's one i18next instance (src/i18n/config.ts sets it up and
 * turns lang + dir on every change). Read directly rather than through react-i18next, so the
 * menu renders the same in a test that never set i18n up.
 */
function subscribe(onChange: () => void) {
  i18n.on('languageChanged', onChange);
  return () => { i18n.off('languageChanged', onChange); };
}
const currentLanguage = () => asLang(i18n.language);

function useLanguageTile(open: boolean) {
  const page = useSyncExternalStore(subscribe, currentLanguage, currentLanguage);
  const [status, setStatus] = useState<'idle' | 'saving' | 'failed'>('idle');
  // A tap after the panel opened wins over the read that was still on its way.
  const tapped = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    tapped.current = false;
    setStatus('idle');
    // Through a promise, so even a read that throws at once leaves the panel working.
    Promise.resolve()
      .then(() => languageApi.get())
      .then(({ language, locked }) => {
        if (!live || tapped.current || locked !== true || !isOffered(language)) return;
        if (language !== currentLanguage()) void i18n.changeLanguage(language);
      })
      .catch(() => { /* the tile still works: the write is what matters */ });
    return () => { live = false; };
  }, [open]);

  const target: Lang = page === 'ur' ? 'en' : 'ur';
  const toggle = useCallback(async () => {
    if (status === 'saving') return;
    tapped.current = true;
    setStatus('saving');
    try {
      await languageApi.set(target);
      await i18n.changeLanguage(target);
      setStatus('idle');
    } catch {
      setStatus('failed');
    }
  }, [status, target]);

  return { target, status, toggle };
}

/* ── the panel ───────────────────────────────────────────────────────────── */

const TILE = cn(
  'flex min-h-[84px] min-w-0 flex-col items-center justify-center gap-2 rounded-2xl px-1 py-2 text-center text-[13px] font-bold leading-tight text-white',
  'active:bg-nu-frame-translucent rtl:font-semibold rtl:leading-[1.8]',
  FOCUS,
);
const TILE_ICON = 'h-6 w-6 shrink-0';

function TileBody({ icon: Icon, label, current, spinning }: { icon: LucideIcon; label: string; current?: boolean; spinning?: boolean }) {
  return (
    <>
      <Icon
        className={cn(TILE_ICON, current ? 'text-nu-leaf' : 'text-nu-pullup-icon', spinning && 'motion-safe:animate-spin')}
        aria-hidden="true"
      />
      <span className="w-full truncate">{label}</span>
    </>
  );
}

export interface PullUpMenuProps {
  open: boolean;
  onClose: () => void;
  /** Her name as the API gives it (users.name is in firstName) and the rest, if any. */
  firstName?: string | null;
  lastName?: string | null;
  schoolName?: string | null;
  pathname: string;
  accountPath: string;
  /** The guarded logout: it asks before ending a lesson that is still recording. */
  onLogout: () => void;
  /** The panel's id, for the handle's aria-controls. */
  id: string;
}

export function PullUpMenu({ open, onClose, firstName, lastName, schoolName, pathname, accountPath, onLogout, id }: PullUpMenuProps) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const lang = useLanguageTile(open);
  const swipe = useSwipe({ onDown: onClose });

  // Escape (and so Android Back) closes it; focus moves in and comes back; the page holds still.
  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (before && typeof before.focus === 'function' && document.contains(before)) before.focus();
    };
  }, [open]);

  if (!open) return null;

  const name = [firstName, lastName].map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean).join(' ');
  const school = typeof schoolName === 'string' ? schoolName.trim() : '';
  const letters = initials(firstName);
  const links: Array<{ to: string; title: string; icon: LucideIcon; testId?: string }> = [
    { to: '/portal/classes', title: NAV_COPY.accountRows.myClasses, icon: Users },
    { to: '/portal/training/certificates', title: NAV_COPY.accountRows.certificates, icon: Award },
    { to: '/portal/training/grades', title: NAV_COPY.accountRows.myGrades, icon: ListChecks },
  ];
  const after: typeof links = [
    // bd-3wb0s — My account (privacy policy, account deletion) stays one tap away.
    { to: accountPath, title: NAV_COPY.myAccount, icon: CircleUserRound, testId: 'mobile-nav-account' },
    { to: '/portal/coaching/analytics', title: NAV_COPY.accountRows.analytics, icon: BarChart3 },
  ];
  const link = (l: (typeof links)[number]) => {
    const current = pathname === l.to;
    return (
      <Link
        key={l.to}
        to={l.to}
        onClick={onClose}
        data-testid={l.testId}
        aria-current={current ? 'page' : undefined}
        className={cn(TILE, current ? 'bg-nu-frame-translucent' : 'bg-nu-pullup-tile')}
      >
        <TileBody icon={l.icon} label={l.title} current={current} />
      </Link>
    );
  };

  return (
    <>
      <div
        data-testid="newui-menu-scrim"
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-[45] bg-nu-surface-scrim motion-safe:animate-in motion-safe:fade-in-0"
      />
      <div
        ref={panel}
        id={id}
        role="dialog"
        data-state="open"
        aria-label={NAV_COPY.menu}
        tabIndex={-1}
        data-testid="newui-menu-panel"
        {...swipe}
        className={cn(
          'fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-[46] flex max-h-[calc(100vh-96px)] flex-col overflow-y-auto',
          'rounded-t-[24px] bg-nu-ink text-white shadow-nu-pullup outline-none',
          'motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-200',
          // bd-5rz1v.32 — a card under the avatar, which ends the menu's column (DESK_COLUMN): 40px
          // from the window's end, or the 1040px-wide middle's end once the window passes 1120px.
          'md:inset-x-auto md:bottom-auto md:end-[max(2.5rem,calc(50%_-_520px))] md:top-[72px] md:w-[380px] md:rounded-[24px] md:pt-2',
        )}
      >
        <span
          data-testid="newui-menu-grab-panel"
          aria-hidden="true"
          className="mb-1 mt-2.5 h-1 w-[38px] shrink-0 self-center rounded bg-nu-pullup-grab md:hidden"
        />
        <div data-testid="newui-menu-who" className="flex items-center gap-3 px-[18px] pb-3 pt-2">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nu-button text-sm font-extrabold text-white ring-2 ring-white/25"
          >
            {letters || <CircleUserRound className="h-6 w-6" />}
          </span>
          <span className="flex min-w-0 flex-col">
            {name ? <b className="truncate text-lg font-extrabold rtl:font-bold rtl:leading-[1.9]">{name}</b> : null}
            <small className="truncate text-xs font-semibold text-nu-nav-label rtl:leading-[1.9]">
              {[school, NAV_COPY.teacher].filter(Boolean).join(' · ')}
            </small>
          </span>
        </div>
        <div data-testid="newui-menu-grid" className={cn(GRID, 'grid-cols-3 gap-[10px] px-[14px] pb-[14px]')}>
          {links.map(link)}
          <button
            type="button"
            onClick={() => { void lang.toggle(); }}
            aria-busy={lang.status === 'saving' || undefined}
            data-testid="newui-menu-language"
            className={cn(TILE, 'bg-nu-pullup-tile')}
          >
            <TileBody
              icon={lang.status === 'saving' ? Loader2 : Languages}
              spinning={lang.status === 'saving'}
              label={NAV_COPY.languages[lang.target]}
            />
            {lang.status === 'failed' ? <Chip tone="error">{NAV_COPY.notSaved}</Chip> : null}
          </button>
          {after.map(link)}
          <button
            type="button"
            onClick={() => { onClose(); onLogout(); }}
            data-testid="mobile-nav-logout"
            className={cn(TILE, 'col-span-3 min-h-[56px] flex-row bg-nu-pullup-tile text-[14px] text-nu-pullup-out')}
          >
            <LogOut className={cn(TILE_ICON, 'text-nu-pullup-out rtl:-scale-x-100')} aria-hidden="true" />
            <span>{NAV_COPY.logout}</span>
          </button>
        </div>
      </div>
    </>
  );
}
