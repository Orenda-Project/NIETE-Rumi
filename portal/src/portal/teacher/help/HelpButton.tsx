import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router-dom';
import { CircleHelp, ListVideo, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tray } from '../ui/Tray';
import { StatusChip } from '../ui/StatusChip';
import { DockButton } from '../ui/DockButton';
import { FOCUS } from '../ui/styles';
import { useCopy } from '../i18n';
import { HELP } from './copy';
import { markHelpSeen, type HelpFeature, type HelpVideo } from './api';
import { useHelp, usePrefersReducedMotion } from './useHelp';
import { HELP_LIST_PATH, useVideoName } from './names';
import './help.css';

const SLOW_MS = 5000;

/**
 * A help video, tap-to-play only (the Reading Hour player's rules, fln/plan/MediaVideo.tsx): the poster and Watch;
 * nothing is fetched before the tap (`preload="none"`, `src` set inside the tap, which WhatsApp's browser needs to
 * play); after 5 s stuck loading, the smaller copy is offered.
 */
export function HelpPlayer({ video }: { video: HelpVideo }) {
  const H = useCopy(HELP);
  const [src, setSrc] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const start = (url: string) => {
    flushSync(() => setSrc(url));
    try { void ref.current?.play()?.catch(() => undefined); } catch { /* the controls still work */ }
  };
  const chips = [video.seconds ? H.length(video.seconds) : null, video.bytes ? H.size(video.bytes) : null].filter(Boolean) as string[];

  if (!src) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <div className="relative h-[213px] w-[120px] shrink-0 overflow-hidden rounded-2xl border border-[#e5e7eb] bg-[#333748]">
            {video.poster ? <img src={video.poster} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : null}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-[#33374a]"><Play className="h-6 w-6 translate-x-[2px] rtl:-translate-x-[2px]" aria-hidden="true" /></span>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5" dir="ltr">
            {chips.map((c) => <StatusChip key={c} text={c} tone="info" />)}
          </div>
        </div>
        <DockButton icon={Play} onClick={() => start(video.url)} testId="help-watch">{H.watch}</DockButton>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <video
        ref={ref}
        data-testid="help-video"
        src={src}
        poster={video.poster ?? undefined}
        preload="none"
        controls
        playsInline
        className="max-h-[60vh] w-full rounded-2xl bg-black"
        onWaiting={() => { if (!timer.current && video.urlSmall && src !== video.urlSmall) timer.current = setTimeout(() => setSlow(true), SLOW_MS); }}
        onPlaying={() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } }}
      />
      {slow && video.urlSmall ? (
        <button type="button" className={cn('self-start text-[15px] font-semibold text-[#2e7d57] underline', FOCUS)} onClick={() => { setSlow(false); start(video.urlSmall as string); }}>
          {H.smaller}
        </button>
      ) : null}
    </div>
  );
}

/** The tray a "?" (or a How to use row) opens: the page's video, or "Video coming soon"; then the full list. */
export function HelpTray({ open, onClose, feature, video, showList = true }: {
  open: boolean; onClose: () => void; feature: string; video: HelpVideo | null; showList?: boolean;
}) {
  const H = useCopy(HELP);
  const name = useVideoName();
  return (
    <Tray open={open} title={video ? name(feature) : H.howTo} onClose={onClose} testId="help-tray">
      <div className="flex flex-col gap-3 pb-2">
        {video ? <HelpPlayer video={video} /> : <p data-testid="help-coming-soon" className="m-0 text-[17px] font-semibold text-[#4b5563]">{H.comingSoon}</p>}
        {showList ? (
          <Link to={HELP_LIST_PATH} onClick={onClose} data-testid="help-all" className={cn('flex min-h-[56px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-3 text-[16px] font-semibold text-[#1d2025]', FOCUS)}>
            <ListVideo className="h-6 w-6 text-[#33374a]" aria-hidden="true" />
            {H.allVideos}
          </Link>
        ) : null}
      </div>
    </Tray>
  );
}

/**
 * The one look of every help "?" (the help videos' HelpButton and the Observe pages' ObserveHelpButton): a 56 px tap
 * holding a 40 px face, white on a page, glass on Home's navy band (`onDark`). Until she has opened a help tray once it
 * pulses (`fresh`); prefers-reduced-motion: a small still dot instead.
 *
 *   bare "?"   a 40 px circle with the "?" glyph; spoken "Help"
 *   `pill`     bd-sil83f (queue #269) — "How to use ?": the words, then the glyph (turned for Urdu: ؟), in a 40 px pill
 *              that never wraps; spoken by its words. The operator, 24 Nov ~19:20: "make it be the text how to use
 *              question mark ... at least on the home page ... not too large, not take too much space". Every Home
 *              draws it; a page header draws it only where it fits at 360 px in both languages (else the bare "?").
 */
export function HelpTrigger({ onClick, fresh, pill = false, onDark = false, testId }: {
  onClick: () => void; fresh: boolean; pill?: boolean; onDark?: boolean; testId: string;
}) {
  const H = useCopy(HELP);
  const reduced = usePrefersReducedMotion();
  const tone = onDark ? 'border-white/40 bg-white/10 text-white' : 'border-[#e5e7eb] bg-white text-[#33374a]';
  const dot = fresh && reduced ? <span data-testid="help-dot" aria-hidden="true" className="absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#47ba7d]" /> : null;
  const pulse = fresh && !reduced
    ? <span data-testid="help-pulse" aria-hidden="true" className={cn('niete-help-ring pointer-events-none absolute rounded-full border-2 border-[#47ba7d]', pill ? 'inset-x-0 inset-y-2' : 'inset-2')} />
    : null;
  if (pill) {
    return (
      // On Home's band (`onDark`) the 56 px tap overhangs the 44 px logo row (-my-1.5), so the band is no taller for it.
      <button type="button" data-testid={testId} data-help-pill="" onClick={onClick}
        className={cn('relative flex h-14 shrink-0 items-center rounded-full', onDark && '-my-1.5', FOCUS)}>
        {pulse}
        <span data-help-face="" className={cn('relative flex h-10 items-center gap-1 whitespace-nowrap rounded-full border pe-1.5 ps-2.5 text-[14px] font-semibold leading-none', tone)}>
          <span>{H.pill}</span>
          <CircleHelp className="h-[18px] w-[18px] shrink-0 rtl:-scale-x-100" aria-hidden="true" />
          {dot}
        </span>
      </button>
    );
  }
  return (
    <button type="button" aria-label={H.help} data-testid={testId} onClick={onClick}
      className={cn('relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full', FOCUS)}>
      {pulse}
      <span data-help-face="" className={cn('relative flex h-10 w-10 items-center justify-center rounded-full border', onDark ? 'border-white/30 bg-white/10 text-white' : tone)}>
        <CircleHelp className="h-[22px] w-[22px]" aria-hidden="true" />
        {dot}
      </span>
    </button>
  );
}

/**
 * bd-ik5e8j.4 (queue #85, placement A) — the help videos' "?" at the end of a page's header (HelpTrigger: a 40 px circle
 * in a 56 px target, like Back; `pill` for "How to use ?", queue #269). Drawn only when portal_help_videos is on for her
 * (otherwise nothing, so the page is today's). Until she has opened a help video once (remembered on the server, so on
 * every phone) it pulses gently; it stops the moment a tray opens. `onDark` for Home's navy band.
 */
export function HelpButton({ feature, onDark = false, pill = false }: { feature: HelpFeature; onDark?: boolean; pill?: boolean }) {
  const help = useHelp();
  const [open, setOpen] = useState(false);
  if (help.on !== true) return null;
  const video = help.data?.videos.find((v) => v.feature === feature) ?? null;
  const fresh = help.data !== null && !help.seen;
  return (
    <>
      <HelpTrigger testId="help-button" pill={pill} onDark={onDark} fresh={fresh} onClick={() => { setOpen(true); markHelpSeen(); }} />
      <HelpTray open={open} onClose={() => setOpen(false)} feature={feature} video={video} />
    </>
  );
}
