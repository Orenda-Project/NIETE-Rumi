import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { FOCUS } from "../../teacher/ui/styles";
import { useFlowV6 } from "../flow/useCoachFlowV2";
import { REPORTS, type ReportsCopy } from "./copy";

/**
 * bd-o15qnr.39.2 (queue #204) — the teacher's report (an image), opened full screen IN the app. The operator 22 Nov
 * ~00:55: "The report to send to teacher is fixed size and I can't open it, so I can't view it. Can I view this PDF in
 * the app itself?"
 *
 *   <ReportImage src={view.report.imageUrl} alt={C.reportImage(name)} />        (loading="lazy" passes through)
 *
 * On the v6/v7 switch (useFlowV6: a coach on portal_coach_flow_v2, or a principal on the principal app it names) the
 * report is ONE tap target with an "Open full screen" label; a tap opens a full-screen viewer over the page:
 *   - scroll (the report at the screen's width, taller reports scroll), pinch zoom, double-tap zoom, + and − buttons
 *     (1× to 4×; the point under the fingers stays put)
 *   - a 56px round close; Escape closes it; ANDROID BACK closes it — in the app the back key sends Escape to an open
 *     role=dialog (lib/back-button.cjs), and in Chrome / WhatsApp's in-app browser Back pops the one history entry the
 *     viewer adds (same URL, so the page underneath never changes)
 *   - no download, no new tab, no link: the same image, in the page.
 * Off, or while the switch is read: the plain image, exactly as the screens drew it before.
 */

/** The report image as the Send and visit pages drew it before (kept byte-for-byte for the switch-off path). */
const IMG = "w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb]";
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.5;
const TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 320;
const TAP_SLOP_PX = 24;
/** The flag on the history entry the open viewer adds. */
const GUARD = "reportViewer";

export interface ReportImageProps {
  src: string;
  alt: string;
  loading?: "lazy" | "eager";
}

export function ReportImage({ src, alt, loading }: ReportImageProps) {
  const on = useFlowV6() === true;
  const C = useCopy(REPORTS);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Back to the report she opened it from, once the viewer closes.
  useEffect(() => {
    if (open) { wasOpen.current = true; return; }
    if (wasOpen.current) { wasOpen.current = false; opener.current?.focus(); }
  }, [open]);

  if (!on) return <img src={src} alt={alt} className={IMG} loading={loading} />;

  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        data-testid="report-open"
        className={cn("relative block w-full rounded-xl text-start", FOCUS)}
      >
        <img src={src} alt={alt} className={IMG} loading={loading} />
        <span className="pointer-events-none absolute bottom-2 end-2 inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[rgba(17,24,39,0.82)] px-3.5 text-[15px] font-semibold text-white">
          <Maximize2 className="h-4 w-4 shrink-0" strokeWidth={2.6} aria-hidden="true" />
          {C.openFullScreen}
        </span>
      </button>
      {open && <ReportViewer src={src} alt={alt} C={C} onClose={() => setOpen(false)} />}
    </>
  );
}

export default ReportImage;

function onGuard(): boolean {
  try {
    const state = window.history.state as Record<string, unknown> | null;
    return !!state && state[GUARD] === true;
  } catch {
    return false;
  }
}

const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const widthOf = (z: number) => `${Math.round(z * 1000) / 10}%`;
const distance = (a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) =>
  Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

type Anchor = { cx: number; cy: number; px: number; py: number };

function ReportViewer({ src, alt, C, onClose }: { src: string; alt: string; C: ReportsCopy; onClose: () => void }) {
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const zoomRef = useRef(MIN_ZOOM);
  const scroller = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const anchor = useRef<Anchor | null>(null);
  const pinch = useRef<{ d0: number; z0: number } | null>(null);
  const tap = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Open: the page under it stops scrolling, focus goes to the close, Escape closes, and one history entry is added so
  // Back in the browser closes the viewer instead of leaving the page. Closed any other way, that entry is taken off.
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    try {
      const state = (window.history.state as Record<string, unknown> | null) || {};
      window.history.pushState({ ...state, [GUARD]: true }, "");
    } catch { /* no history to use (an embedded view): Escape and the close still work */ }
    const onPop = () => { if (!onGuard()) closeRef.current(); };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = overflow;
      if (onGuard()) {
        try { window.history.back(); } catch { /* nothing to take off */ }
      }
    };
  }, []);

  // After a zoom, scroll so the point she zoomed on stays where it was on the screen.
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    anchor.current = null;
    if (!el || !a) return;
    el.scrollLeft = Math.max(0, a.cx * zoom - a.px);
    el.scrollTop = Math.max(0, a.cy * zoom - a.py);
  }, [zoom]);

  /** Zoom to `next`, keeping the screen point (clientX, clientY) — the middle of the viewer when not given — in place. */
  const zoomTo = (next: number, clientX?: number, clientY?: number) => {
    const z = clamp(next);
    const el = scroller.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const px = (clientX ?? rect.left + el.clientWidth / 2) - rect.left;
      const py = (clientY ?? rect.top + el.clientHeight / 2) - rect.top;
      anchor.current = { cx: (el.scrollLeft + px) / zoomRef.current, cy: (el.scrollTop + py) / zoomRef.current, px, py };
    }
    zoomRef.current = z;
    setZoom(z);
  };
  const toggleAt = (clientX: number, clientY: number) => zoomTo(zoomRef.current > MIN_ZOOM ? MIN_ZOOM : TAP_ZOOM, clientX, clientY);

  const onTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    const t = e.touches;
    if (t.length >= 2) {
      pinch.current = { d0: Math.max(1, distance(t[0], t[1])), z0: zoomRef.current };
      tap.current = null;
      lastTap.current = null;
    } else if (t.length === 1) {
      tap.current = { x: t[0].clientX, y: t[0].clientY, moved: false };
    }
  };
  const onTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    const t = e.touches;
    if (pinch.current && t.length >= 2) {
      const p = pinch.current;
      zoomTo(p.z0 * (distance(t[0], t[1]) / p.d0), (t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2);
    } else if (tap.current && t.length === 1) {
      if (Math.hypot(t[0].clientX - tap.current.x, t[0].clientY - tap.current.y) > TAP_SLOP_PX) tap.current.moved = true;
    }
  };
  const onTouchEnd = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (pinch.current) {
      if (e.touches.length < 2) pinch.current = null;
      return;
    }
    const start = tap.current;
    tap.current = null;
    const end = e.changedTouches && e.changedTouches[0];
    if (!start || start.moved || !end) return;
    const now = Date.now();
    const prev = lastTap.current;
    if (prev && now - prev.t <= DOUBLE_TAP_MS && Math.hypot(end.clientX - prev.x, end.clientY - prev.y) <= TAP_SLOP_PX) {
      // A double tap: zoom here, and no click or dblclick follows from it.
      e.preventDefault();
      lastTap.current = null;
      toggleAt(end.clientX, end.clientY);
      return;
    }
    lastTap.current = { t: now, x: end.clientX, y: end.clientY };
  };
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => toggleAt(e.clientX, e.clientY);

  const roundButton = cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-[#33374a] disabled:opacity-40", FOCUS);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      data-state="open"
      data-testid="report-viewer"
      className="fixed inset-0 z-[80] flex flex-col bg-[#111827] text-white"
    >
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-[calc(8px+env(safe-area-inset-top,0px))]">
        <button type="button" aria-label={C.zoomOut} onClick={() => zoomTo(zoomRef.current / ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} className={roundButton}>
          <Minus className="h-6 w-6" strokeWidth={2.6} aria-hidden="true" />
        </button>
        <button type="button" aria-label={C.zoomIn} onClick={() => zoomTo(zoomRef.current * ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} className={roundButton}>
          <Plus className="h-6 w-6" strokeWidth={2.6} aria-hidden="true" />
        </button>
        <span className="flex-1" />
        <button ref={closeButton} type="button" aria-label={C.closeViewer} onClick={() => closeRef.current()} className={roundButton}>
          <X className="h-6 w-6" strokeWidth={2.6} aria-hidden="true" />
        </button>
      </div>
      <div
        ref={scroller}
        data-testid="report-zoom"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={onDoubleClick}
        // One finger scrolls (the browser's own panning); two fingers are ours, so the page itself never zooms.
        style={{ touchAction: "pan-x pan-y", overscrollBehavior: "contain" }}
        className="min-h-0 flex-1 overflow-auto pb-[env(safe-area-inset-bottom,0px)]"
      >
        <div className="flex min-h-full w-full">
          <img
            src={src}
            alt={alt}
            draggable={false}
            data-testid="report-viewer-image"
            style={{ width: widthOf(zoom) }}
            className="m-auto block h-auto max-w-none select-none bg-white"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
