/**
 * bd-t7zk3t.11 — a video, tap-to-play only (DESIGN v2 §5 "Videos"): the poster (or a neutral box) and a
 * "Watch · <min> min · <MB> MB" button; nothing is fetched before the tap (`preload="none"`, `src` set on tap).
 * After 5 s in `waiting` the smaller copy (`src_low`, 360p) is offered. Dual-source like the picture: one retry
 * from `orig` on `error`.
 */
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { flnStrings, type FlnLang } from '../strings';
import type { FlnMedia } from '../types';
import { isolate } from './text';

const SLOW_MS = 5000;

export function MediaVideo({ media, uiLang }: { media: FlnMedia; uiLang: FlnLang }) {
  const s = flnStrings(uiLang);
  const rtl = uiLang === 'ur';
  const [src, setSrc] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  const retried = useRef(false);
  const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (waitTimer.current) clearTimeout(waitTimer.current); }, []);
  /** Inside the tap handler: the in-app browser only plays on a user gesture. */
  const start = (url: string) => {
    flushSync(() => setSrc(url));
    try { void ref.current?.play()?.catch(() => undefined); } catch { /* the controls still work */ }
  };

  const minutes = media.duration_s ? String(Math.max(1, Math.round(media.duration_s / 60))) : '';
  const mb = media.bytes ? String(Math.max(1, Math.round(media.bytes / 1_000_000))) : '';
  const label = s.video.watch(minutes, mb);

  const onWaiting = () => {
    if (waitTimer.current || !media.src_low || src === media.src_low) return;
    waitTimer.current = setTimeout(() => setSlow(true), SLOW_MS);
  };
  const onPlaying = () => {
    if (waitTimer.current) { clearTimeout(waitTimer.current); waitTimer.current = null; }
  };
  const onError = () => {
    if (!retried.current && media.orig && src !== media.orig) { retried.current = true; setSrc(media.orig); }
  };

  if (!src) {
    return (
      <div className="fln-video">
        {media.poster ? <img className="fln-video-poster" src={media.poster} alt="" loading="lazy" decoding="async" /> : <div className="fln-video-poster fln-video-poster--none" />}
        <button type="button" className="fln-video-watch" aria-label={label} onClick={() => start(media.src)}>
          <span aria-hidden="true">▶</span> {isolate(label, rtl)}
        </button>
      </div>
    );
  }
  return (
    <div className="fln-video">
      <video
        ref={ref}
        src={src}
        poster={media.poster}
        preload="none"
        controls
        playsInline
        onWaiting={onWaiting}
        onPlaying={onPlaying}
        onError={onError}
      />
      {slow && media.src_low ? (
        <button type="button" className="fln-video-smaller" onClick={() => { setSlow(false); onPlaying(); start(media.src_low!); }}>
          {isolate(s.video.smaller, rtl)}
        </button>
      ) : null}
    </div>
  );
}
