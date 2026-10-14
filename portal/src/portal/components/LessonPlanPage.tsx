import { useEffect, useRef, useState } from 'react';
import { StepOutline } from './stepMark';
import type { StepMark } from '../lib/planSteps';

/**
 * One page of a lesson plan, drawn by pdf.js onto a <canvas> only while it is near the screen
 * (split out of LessonPlanViewer, bd-v0toag.60 — no behaviour change). Its step outline, when the
 * mark falls on this page, is drawn over it.
 */

/** The look of a page's frame (the viewer's VIEWER_STYLE.page points here). */
export const PAGE_STYLE = 'mx-auto shrink-0 bg-white shadow-sm';

/** ~16 MB of pixels per page canvas at most, however far she zooms. */
const MAX_CANVAS_PIXELS = 4_000_000;

export type PdfPageLike = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => { promise: Promise<unknown>; cancel: () => void };
  getTextContent: () => Promise<{ items: unknown[] }>;
  cleanup?: () => void;
};
export type PdfDocLike = { numPages: number; getPage: (n: number) => Promise<PdfPageLike>; destroy: () => Promise<void> | void };

function isCancel(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'RenderingCancelledException';
}

const pageLabel = (n: number) => `Page ${n}`;

export const PdfPage = ({ doc, pageNumber, width, ratio, onRatio, onFailed, mark }: {
  doc: PdfDocLike;
  pageNumber: number;
  width: number;
  ratio: number;
  onRatio: (page: number, ratio: number) => void;
  onFailed: (page: number) => void;
  mark?: StepMark | null;
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
    <div ref={box} data-testid="lp-page" data-page={pageNumber} className={`relative ${PAGE_STYLE}`} style={{ width, height: Math.round(width * ratio) }}>
      {/* bd-fmf24g.56: dir="ltr". A canvas inherits the page's direction, and in Urdu (rtl) pdf.js then draws each
          glyph offset by its own width: thin letters vanish and words break apart. A PDF page is always laid out ltr. */}
      <canvas ref={canvas} dir="ltr" role="img" aria-label={pageLabel(pageNumber)} className="block h-full w-full" />
      {mark && mark.page === pageNumber ? <StepOutline mark={mark} /> : null}
    </div>
  );
};
