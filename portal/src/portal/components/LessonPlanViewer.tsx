import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ExternalLink, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { loadPdfjs } from '../lib/pdfjs';
import { RecordingContinuesChip } from './RecordingBar';
import {
  fetchLessonPlanPdf, LessonPlanNotReady, openLessonPlanOutside, sourceKey, type LessonPlanView,
} from '../lib/lessonPlanOpen';

/**
 * bd-5rz1v.10 — a lesson plan, read inside the portal (design: NIETE Portal
 * Coaching v1 mockups, Change 2, phone 3).
 *
 *   ‹ Plants: parts and their jobs
 *   ● Recording continues                                (only while recording)
 *   [−] [+] 100%                     [↗ Open in another app] (not while recording)
 *   ┌───────────┐
 *   │  page 1   │   pages drawn by pdf.js as they scroll near, fitted to the width
 *   └───────────┘
 *
 * Why not <iframe>/<embed>/<object>: the Android WebView has no PDF viewer, so
 * those show nothing or start a download there, even though desktop Chrome
 * renders them. pdf.js draws onto a <canvas>, which every WebView can show.
 *
 * Built for low-end phones: the bytes are fetched once, pages are drawn only
 * when they come near the screen and released when they go far away, and a
 * page's canvas is capped in pixels however far she zooms.
 *
 * When it cannot work (pdf.js will not load on an old WebView, the download
 * fails, the file is broken), it falls back to TODAY'S WAY — the signed link,
 * opened outside — by itself, so nobody is left on a blank screen. Except while
 * a lesson is recording: another app in front silences the microphone, so then
 * it asks instead, with the reason.
 *
 * Labels, not sentences (operator, 2026-10-03). All of the viewer's look is in
 * VIEWER_STYLE below, so a restyle is an edit to that one object.
 *
 * bd-5rz1v.14 — `chrome="none"`: the new UI draws the heading (its light InnerBar, with
 * "Open in another app" as a small action on it), so the viewer leaves out its own back + title
 * and its toolbar's outside button, and its zoom buttons sit in 56px targets (the new UI's tap
 * rule). Everything else — loading, the fallback, recording — is the same viewer. The default
 * ("own") is the viewer exactly as it was.
 */

const COPY = {
  back: 'Back',
  opening: 'Opening…',
  openOutside: 'Open in another app',
  failed: "Can't show it here",
  failedRecording: 'Recording may go silent',
  couldNotOpen: 'Could not open this lesson plan',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  page: (n: number) => `Page ${n}`,
};

export const VIEWER_STYLE = {
  frame: 'mx-auto flex w-full max-w-3xl flex-col gap-2.5 pb-4',
  header: 'flex min-h-12 items-center gap-1',
  back: 'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-primary',
  title: 'line-clamp-2 text-lg font-bold leading-snug text-primary',
  chipRow: 'px-1',
  loading: 'flex flex-col items-center gap-3 rounded-xl bg-white px-4 py-12 text-center text-[15px] text-[#3a3f4b]',
  progressTrack: 'h-2 w-40 overflow-hidden rounded-full bg-[#e5e7eb]',
  progressFill: 'h-full rounded-full bg-accent transition-[width]',
  failedCard: 'flex flex-col gap-3 rounded-xl bg-white p-4',
  failedNote: 'flex items-center gap-2.5 rounded-xl bg-[#fff6e0] px-3.5 py-3 text-[16px] font-semibold text-[#7a5600]',
  failedButton: 'flex h-14 items-center justify-center gap-2 rounded-[14px] border-2 border-primary bg-white text-lg font-bold text-primary',
  toolbar: 'flex items-center gap-1.5',
  zoomButton: 'flex h-11 w-11 items-center justify-center rounded-lg border border-[#d6d9de] bg-white text-primary disabled:text-[#c4c8cf]',
  zoomLabel: 'min-w-[3rem] px-1 text-sm tabular-nums text-muted-foreground',
  /** bd-5rz1v.14 — chrome "none" (the new UI): the same 44px button inside a 56px target. */
  zoomTarget: 'group flex min-h-[56px] min-w-[56px] items-center justify-center',
  zoomFace: 'flex h-11 w-11 items-center justify-center rounded-lg border border-[#d6d9de] bg-white text-primary group-disabled:text-[#c4c8cf]',
  outsideButton: 'ms-auto flex h-11 items-center gap-1.5 rounded-lg border border-[#d6d9de] bg-white px-3 text-sm font-semibold text-primary',
  pages: 'flex flex-col items-start gap-3',
  page: 'mx-auto shrink-0 bg-white shadow-sm',
};

const ZOOMS = [1, 1.25, 1.5, 2, 3];
/** ~16 MB of pixels per page canvas at most, however far she zooms. */
const MAX_CANVAS_PIXELS = 4_000_000;
/** A4 portrait, until the first page says otherwise. */
const DEFAULT_RATIO = 297 / 210;

type PdfPageLike = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => { promise: Promise<unknown>; cancel: () => void };
  cleanup?: () => void;
};
type PdfDocLike = { numPages: number; getPage: (n: number) => Promise<PdfPageLike>; destroy: () => Promise<void> | void };

function isCancel(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'RenderingCancelledException';
}

const PdfPage = ({ doc, pageNumber, width, ratio, onRatio, onFailed }: {
  doc: PdfDocLike;
  pageNumber: number;
  width: number;
  ratio: number;
  onRatio: (page: number, ratio: number) => void;
  onFailed: (page: number) => void;
}) => {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(() => pageNumber <= 2 || typeof IntersectionObserver === 'undefined');

  // Near the screen (within one and a half screens): draw. Far: let it go.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setNear(e.isIntersecting);
    }, { rootMargin: '150% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return undefined;
    if (!near || width <= 0) { c.width = 0; c.height = 0; return undefined; }
    let cancelled = false;
    let task: { promise: Promise<unknown>; cancel: () => void } | null = null;
    let page: PdfPageLike | null = null;
    (async () => {
      page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      onRatio(pageNumber, base.height / base.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let scale = (width / base.width) * dpr;
      const pixels = base.width * scale * base.height * scale;
      if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
      const viewport = page.getViewport({ scale });
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      task = page.render({ canvas: c, viewport });
      await task.promise;
    })().catch((err) => {
      if (!cancelled && !isCancel(err)) onFailed(pageNumber);
    });
    return () => {
      cancelled = true;
      try { task?.cancel(); } catch { /* finished */ }
      try { page?.cleanup?.(); } catch { /* nothing cached */ }
    };
  }, [near, width, doc, pageNumber, onRatio, onFailed]);

  return (
    <div ref={box} data-testid="lp-page" className={VIEWER_STYLE.page} style={{ width, height: Math.round(width * ratio) }}>
      <canvas ref={canvas} role="img" aria-label={COPY.page(pageNumber)} className="block h-full w-full" />
    </div>
  );
};

type Props = {
  view: LessonPlanView;
  /** "own": its back + title and its outside button (the old pages). "none": the page draws them. */
  chrome?: 'own' | 'none';
  /** A lesson is recording: say it continues; never hand off to another app by itself. */
  recording: boolean;
  onClose: () => void;
  /** Nothing to open yet (not published / still being written). */
  onNotReady: () => void;
};

const LessonPlanViewer = ({ view, recording, onClose, onNotReady, chrome = 'own' }: Props) => {
  const { toast } = useToast();
  const { source, title } = view;
  const key = sourceKey(source);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [progress, setProgress] = useState<number | null>(null);
  const [doc, setDoc] = useState<PdfDocLike | null>(null);
  const [zoom, setZoom] = useState(0);
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const [boxWidth, setBoxWidth] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  // Read at the moment it fails, not when the viewer opened.
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const notReadyRef = useRef(onNotReady);
  notReadyRef.current = onNotReady;

  const openOutside = useCallback(async () => {
    try {
      const r = await openLessonPlanOutside(source);
      if (r === 'not_ready') notReadyRef.current();
    } catch {
      toast({ title: COPY.couldNotOpen, variant: 'destructive' });
    }
    // `source` is identified by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, toast]);

  const failed = useRef(false);
  const fail = useCallback(() => {
    if (failed.current) return;
    failed.current = true;
    setState('failed');
    // Today's way, by itself, so nobody is left looking at a blank screen —
    // unless a lesson is recording (another app in front would silence it).
    if (!recordingRef.current) void openLessonPlanOutside(source).catch(() => {});
    // `source` is identified by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Fetch the bytes, then hand them to pdf.js.
  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDocLike | null = null;
    failed.current = false;
    setState('loading');
    setProgress(null);
    setDoc(null);
    setRatios({});
    (async () => {
      const bytes = await fetchLessonPlanPdf(source, (p) => { if (!cancelled) setProgress(p); });
      if (cancelled) return;
      const pdfjs = await loadPdfjs();
      if (cancelled) return;
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false });
      loaded = (await task.promise) as unknown as PdfDocLike;
      if (cancelled) { void loaded.destroy(); return; }
      setDoc(loaded);
      setState('ready');
    })().catch((err) => {
      if (cancelled) return;
      if (err instanceof LessonPlanNotReady) { notReadyRef.current(); return; }
      fail();
    });
    return () => {
      cancelled = true;
      if (loaded) void Promise.resolve(loaded.destroy()).catch(() => {});
    };
    // `source` is identified by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The width pages are fitted to: the reading area's, as it changes.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const measure = () => setBoxWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [state]);

  const onRatio = useCallback((page: number, ratio: number) => {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    setRatios((r) => (r[page] === ratio ? r : { ...r, [page]: ratio }));
  }, []);
  // A first page that cannot be drawn means nothing will be: fall back.
  const onFailed = useCallback((page: number) => { if (page === 1) fail(); }, [fail]);

  const fitWidth = boxWidth > 0 ? boxWidth : 360;
  const pageWidth = Math.round(fitWidth * ZOOMS[zoom]);
  const defaultRatio = ratios[1] ?? DEFAULT_RATIO;

  return (
    <div data-testid="lesson-plan-viewer" className={VIEWER_STYLE.frame}>
      {chrome === 'own' && (
        <div className={VIEWER_STYLE.header}>
          <button type="button" onClick={onClose} aria-label={COPY.back} className={VIEWER_STYLE.back}>
            <ChevronLeft className="h-6 w-6 rtl:rotate-180" aria-hidden="true" />
          </button>
          <h1 className={VIEWER_STYLE.title} dir="auto">{title}</h1>
        </div>
      )}

      {recording && <div className={VIEWER_STYLE.chipRow}><RecordingContinuesChip /></div>}

      {state === 'loading' && (
        <div className={VIEWER_STYLE.loading}>
          <Loader2 className="h-8 w-8 text-primary motion-safe:animate-spin" aria-hidden="true" />
          <span>{COPY.opening}</span>
          {progress != null && (
            <div className={VIEWER_STYLE.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className={VIEWER_STYLE.progressFill} style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
          )}
        </div>
      )}

      {state === 'failed' && (
        <div className={VIEWER_STYLE.failedCard}>
          <div className={VIEWER_STYLE.failedNote}>
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{COPY.failed}</span>
          </div>
          <button type="button" onClick={openOutside} className={VIEWER_STYLE.failedButton}>
            <ExternalLink className="h-5 w-5" aria-hidden="true" />
            {COPY.openOutside}
          </button>
          {/* Another app in front silences the microphone: say it, in three words. */}
          {recording && (
            <div className={VIEWER_STYLE.failedNote}>
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>{COPY.failedRecording}</span>
            </div>
          )}
        </div>
      )}

      {state === 'ready' && doc && chrome === 'own' && (
        <div className={VIEWER_STYLE.toolbar}>
          <button type="button" aria-label={COPY.zoomOut} disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}
            className={VIEWER_STYLE.zoomButton}>
            <ZoomOut className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" aria-label={COPY.zoomIn} disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
            className={VIEWER_STYLE.zoomButton}>
            <ZoomIn className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className={VIEWER_STYLE.zoomLabel}>{Math.round(ZOOMS[zoom] * 100)}%</span>
          {!recording && (
            <button type="button" onClick={openOutside} className={VIEWER_STYLE.outsideButton}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {COPY.openOutside}
            </button>
          )}
        </div>
      )}

      {state === 'ready' && doc && chrome === 'none' && (
        <div className={VIEWER_STYLE.toolbar}>
          <button type="button" aria-label={COPY.zoomOut} disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}
            className={VIEWER_STYLE.zoomTarget}>
            <span className={VIEWER_STYLE.zoomFace}><ZoomOut className="h-5 w-5" aria-hidden="true" /></span>
          </button>
          <button type="button" aria-label={COPY.zoomIn} disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
            className={VIEWER_STYLE.zoomTarget}>
            <span className={VIEWER_STYLE.zoomFace}><ZoomIn className="h-5 w-5" aria-hidden="true" /></span>
          </button>
          <span className={VIEWER_STYLE.zoomLabel}>{Math.round(ZOOMS[zoom] * 100)}%</span>
        </div>
      )}

      {/* Always mounted while loading or ready, so its width is known before the first page. */}
      {state !== 'failed' && (
        <div ref={scroller} className={`w-full ${zoom > 0 ? 'overflow-x-auto' : 'overflow-x-hidden'}`}>
          {state === 'ready' && doc && (
            <div className={VIEWER_STYLE.pages} style={{ width: pageWidth }}>
              {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((n) => (
                <PdfPage key={n} doc={doc} pageNumber={n} width={pageWidth}
                  ratio={ratios[n] ?? defaultRatio} onRatio={onRatio} onFailed={onFailed} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LessonPlanViewer;
