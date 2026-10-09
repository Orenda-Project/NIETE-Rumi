import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronRight, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FeatureGlyph, FEATURE_HUE } from '../icons';
import { useBidi } from './bidi';
import type { NotifyCopy } from './copy';
import { CHEVRON, FOCUS } from './styles';
import { useKitCopy } from './useKitCopy';

/**
 * bd-fmf24g.15 — ReadyBanner (COMPONENTS.md §12): "it is ready", for 10 seconds. A white card (20px corners, a
 * strong shadow) above the bottom menu: a 56px feature-colour icon with a green tick → "Lesson plan ready"
 * (18px/700), the title, "Grade 7 · Science" → a ✕ (56px target) → a full-width 56px indigo Open → a 6px bar along
 * the bottom edge that shrinks over `durationMs`, from its END edge toward its START (right to left in English, left
 * to right in Urdu).
 *
 *   PAUSES while her finger, mouse or keyboard/screen-reader focus is on it (WCAG 2.2.1), and carries on from
 *   where it stopped; `onExpire` once when it has run out. Time only counts while the page runs, so a banner never
 *   runs out on a screen she is not looking at.
 *   TWO or more ready at once are ONE banner, "2 ready": one 76px row per item (at most two) each with its own
 *   Open, and one bar. A third+ adds "+N more ready" (`onSeeAll`). A second item that lands while it shows joins
 *   it and the 10 seconds start again.
 *   FAILED: the same frame in red — "Couldn't make it", what it was, the real reason in a pale-red box, Try again
 *   (re-sends the same request: `onRetry`). It is an alert; a ready banner is a polite status.
 *
 * Open, ✕ and the timer only REPORT (`onOpen(id)`, `onClose()`, `onExpire()`): the host says what each means.
 */

export interface BannerRow {
  id: string;
  feature: 'lessons' | 'assessment';
  /** "Lesson plan" / "Paper". */
  what: string;
  /** The title — data. */
  title: string;
  /** "Grade 7 · Science" — data. */
  line: string;
}

export interface ReadyBannerProps {
  items: readonly BannerRow[];
  variant?: 'ready' | 'failed';
  /** Failed only: the real reason. */
  reason?: string;
  durationMs?: number;
  onOpen: (id: string) => void;
  onClose: () => void;
  onExpire: () => void;
  onRetry?: (id: string) => void;
  onSeeAll?: () => void;
  copy?: Partial<NotifyCopy>;
}

const TICK_MS = 100;
const INDIGO = '#33374a';
const RED = '#c8331f';

function Icon({ row, size, failed }: { row: BannerRow; size: 'lg' | 'sm'; failed: boolean }) {
  const hue = failed ? { fg: RED, bg: '#fee4e2' } : FEATURE_HUE[row.feature];
  const big = size === 'lg';
  return (
    <span
      aria-hidden="true"
      className={cn('relative flex shrink-0 items-center justify-center rounded-full', big ? 'h-14 w-14' : 'h-12 w-12')}
      style={{ background: hue.bg, color: hue.fg }}
    >
      <FeatureGlyph name={row.feature} size={big ? 28 : 24} />
      <i
        className={cn('absolute -bottom-[3px] -end-[3px] flex items-center justify-center rounded-full border-white text-white', big ? 'h-6 w-6 border-[2.5px]' : 'h-5 w-5 border-2')}
        style={{ background: failed ? RED : '#2f7a52' }}
      >
        {failed ? <span className="text-[13px] font-extrabold leading-none">!</span> : <Check className="h-[13px] w-[13px]" strokeWidth={3.6} />}
      </i>
    </span>
  );
}

export function ReadyBanner({
  items, variant = 'ready', reason, durationMs = 10_000, onOpen, onClose, onExpire, onRetry, onSeeAll, copy,
}: ReadyBannerProps) {
  const kit = useKitCopy();
  const words: NotifyCopy = { ...kit.notify, ...copy };
  const bidi = useBidi();
  const failed = variant === 'failed';

  // The 10 seconds: counted in ticks while nothing holds it, started again when the set of items changes.
  const key = `${variant}|${items.map((i) => i.id).join('|')}`;
  const [elapsed, setElapsed] = useState(0);
  const held = useRef(0);
  const expired = useRef(false);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  useEffect(() => {
    setElapsed(0);
    expired.current = false;
    const t = setInterval(() => { if (held.current === 0) setElapsed((e) => e + TICK_MS); }, TICK_MS);
    return () => clearInterval(t);
  }, [key]);
  useEffect(() => {
    if (elapsed >= durationMs && !expired.current) {
      expired.current = true;
      expireRef.current();
    }
  }, [elapsed, durationMs]);
  const hold = () => { held.current += 1; };
  const release = () => { held.current = Math.max(0, held.current - 1); };

  const first = items[0];
  if (!first) return null;
  const many = !failed && items.length > 1;
  const pct = Math.max(0, 100 - (elapsed / durationMs) * 100);
  const barHue = failed ? RED : many ? INDIGO : FEATURE_HUE[first.feature].fg;
  const readyWord = first.feature === 'lessons' ? words.readyLesson : words.readyPaper;
  const title = failed ? words.couldntMake : many ? words.readyMany(items.length) : readyWord;

  const close = (
    <button
      type="button"
      onClick={onClose}
      aria-label={kit.close}
      className={cn('-mt-2.5 flex h-14 w-14 shrink-0 items-center justify-center rounded-full', FOCUS)}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f3f4f6] text-[#4b5563]"><X className="h-[18px] w-[18px]" strokeWidth={2.6} aria-hidden="true" /></span>
    </button>
  );

  return (
    <section
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? 'assertive' : 'polite'}
      aria-label={title}
      data-testid="ready-banner"
      onPointerEnter={hold}
      onPointerLeave={release}
      onFocus={hold}
      onBlur={release}
      className="overflow-hidden rounded-[20px] border border-[#e5e7eb] bg-white text-[#1d2025] shadow-[0_14px_34px_rgba(16,24,40,0.24),0_2px_6px_rgba(16,24,40,0.08)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2"
    >
      {many ? (
        <>
          <div className="flex items-center gap-2.5 ps-4 pt-1.5">
            <span className="flex min-w-0 flex-1 items-center gap-2 text-[18px] font-bold">
              <span aria-hidden="true" className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#2f7a52] text-white"><Check className="h-[13px] w-[13px]" strokeWidth={3.6} /></span>
              {bidi(title)}
            </span>
            {close}
          </div>
          {items.slice(0, 2).map((row) => (
            <div key={row.id} className="flex min-h-[76px] items-center gap-3 border-t border-[#f0f1f3] px-3.5 py-2">
              <Icon row={row} size="sm" failed={false} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span dir="auto" className="truncate text-[15px] font-semibold leading-snug">{bidi(row.title)}</span>
                <span dir="auto" className="truncate text-[13px] font-semibold text-[#374151]">{bidi(`${row.what} · ${row.line}`)}</span>
              </span>
              <button
                type="button"
                aria-label={`${words.open} ${row.title}`}
                onClick={() => onOpen(row.id)}
                className={cn('flex h-14 min-w-[92px] shrink-0 items-center justify-center rounded-[14px] bg-[#33374a] px-[18px] text-[16px] font-semibold text-white', FOCUS)}
              >
                {words.open}
              </button>
            </div>
          ))}
          {items.length > 2 && (
            onSeeAll ? (
              <button type="button" onClick={onSeeAll} className={cn('flex min-h-[56px] w-full items-center gap-2 border-t border-[#f0f1f3] px-4 text-[15px] font-semibold text-[#33374a]', FOCUS)}>
                <span className="flex-1 text-start">{bidi(words.moreReady(items.length - 2))}</span>
                <span className="text-[14px] font-bold">{kit.seeAll}</span>
                <ChevronRight className={cn('h-5 w-5', CHEVRON)} aria-hidden="true" />
              </button>
            ) : (
              <p className="flex min-h-[56px] items-center border-t border-[#f0f1f3] px-4 text-[15px] font-semibold text-[#33374a]">{bidi(words.moreReady(items.length - 2))}</p>
            )
          )}
        </>
      ) : (
        <>
          <div className="flex items-start gap-3 pe-0.5 ps-3.5 pt-3.5">
            <Icon row={first} size="lg" failed={failed} />
            <span className="flex min-w-0 flex-1 flex-col gap-[3px] pt-px">
              <span className="text-[18px] font-bold leading-tight">{bidi(title)}</span>
              <span dir="auto" className="truncate text-[15px] font-semibold leading-snug">{bidi(first.title)}</span>
              <span dir="auto" className="truncate text-[13px] font-semibold text-[#374151]">{bidi(failed ? `${first.what} · ${first.line}` : first.line)}</span>
            </span>
            {close}
          </div>
          {failed && reason && <p className="mx-3.5 mt-2.5 rounded-xl bg-[#fef2f1] px-3 py-2.5 text-[14px] leading-snug text-[#7a271a]">{bidi(reason)}</p>}
          {failed ? (
            <div className="px-3.5 pb-3.5 pt-3">
              <button
                type="button"
                onClick={() => onRetry?.(first.id)}
                aria-label={words.tryAgain}
                className={cn('flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-[17px] font-semibold text-white', FOCUS)}
              >
                <RotateCcw className="h-5 w-5" aria-hidden="true" />
                {words.tryAgain}
              </button>
            </div>
          ) : (
            <div className="px-3.5 pb-3.5 pt-3">
              <button
                type="button"
                onClick={() => onOpen(first.id)}
                aria-label={`${words.open} ${first.title}`}
                className={cn('flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-[17px] font-semibold text-white', FOCUS)}
              >
                {words.open}
                <ArrowRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
              </button>
            </div>
          )}
        </>
      )}
      <div aria-hidden="true" className="flex h-1.5 bg-[#eef0f3]">
        <i
          data-testid="banner-bar"
          data-hue={barHue}
          className="block h-full motion-safe:transition-[width] motion-safe:duration-100 motion-safe:ease-linear"
          style={{ width: `${pct}%`, background: barHue }}
        />
      </div>
    </section>
  );
}
