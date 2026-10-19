/**
 * A picture in a reserved box (DESIGN v2 §2 S4.5, §5 dual-source, §7 "Image fails").
 * The box is sized by `aspect-ratio: w / h` (4 / 3 without sizes) before a byte arrives, so nothing shifts on 3G.
 * `loading="lazy"`, `decoding="async"`, alt = the step's text. On `error`, or 6 s without `load`, it retries ONCE,
 * silently, from `orig`; after that the box keeps its size and shows the failed caption. Tap → full-screen overlay.
 */
import { useEffect, useRef, useState } from 'react';
import { flnStrings, type FlnLang } from '../strings';
import type { FlnMedia } from '../types';
import { isolate } from './text';

const RETRY_MS = 6000;

export function MediaImage({ media, alt, uiLang }: { media: FlnMedia; alt: string; uiLang: FlnLang }) {
  const s = flnStrings(uiLang);
  const [src, setSrc] = useState(media.src);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const loaded = useRef(false);
  const retried = useRef(false);

  const fail = () => {
    if (loaded.current) return;
    if (!retried.current && media.orig && media.orig !== media.src) {
      retried.current = true;
      setSrc(media.orig);
      return;
    }
    setFailed(true);
  };

  useEffect(() => {
    if (failed || loaded.current) return undefined;
    const t = setTimeout(() => { if (!loaded.current && !retried.current) fail(); }, RETRY_MS);
    return () => clearTimeout(t);
  }, [src, failed]); // eslint-disable-line react-hooks/exhaustive-deps

  const ratio = media.w && media.h ? `${media.w} / ${media.h}` : '4 / 3';
  const text = (alt || '').trim();
  const rtl = uiLang === 'ur';
  return (
    <div className="fln-pic" style={{ aspectRatio: ratio }}>
      {failed ? (
        <span className="fln-pic-failed" lang={uiLang} dir={rtl ? 'rtl' : 'ltr'}>{isolate(s.image.failed, rtl)}</span>
      ) : (
        <button type="button" className="fln-pic-open" aria-label={s.image.enlarge} onClick={() => setOpen(true)}>
          <img
            src={src}
            alt={text}
            loading="lazy"
            decoding="async"
            width={media.w}
            height={media.h}
            onLoad={() => { loaded.current = true; }}
            onError={fail}
          />
        </button>
      )}
      {open ? (
        <div className="fln-overlay" role="dialog" aria-modal="true" aria-label={text || s.image.enlarge}>
          <button type="button" className="fln-overlay-close" onClick={() => setOpen(false)}>{s.image.close}</button>
          <img src={media.full ?? src} alt={text} decoding="async" />
        </div>
      ) : null}
    </div>
  );
}
