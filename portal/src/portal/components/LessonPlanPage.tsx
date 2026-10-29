import { useEffect, useRef, useState } from 'react';
import { StepBand, StepOutline } from './stepMark';
import type { StepMark } from '../lib/planSteps';

/**
 * One page of a lesson plan, drawn by pdf.js onto a <canvas> only while it is near the screen
 * (split out of LessonPlanViewer, bd-v0toag.60 — no behaviour change). Its step outline, when the
 * mark falls on this page, is drawn over it, and the step's wash on every page the step runs over (bd-v0toag.78).
 */

/** The look of a page's frame (the viewer's VIEWER_STYLE.page points here). */
export const PAGE_STYLE = 'mx-auto shrink-0 bg-white shadow-sm';

/** ~16 MB of pixels per page canvas at most, however far she zooms. */
const MAX_CANVAS_PIXELS = 4_000_000;

type ViewportLike = { width: number; height: number; convertToViewportRectangle?: (r: number[]) => number[] };
type AnnotationLike = { subtype?: string; url?: string; rect?: number[] };

export type PdfPageLike = {
  getViewport: (o: { scale: number }) => ViewportLike;
  render: (o: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => { promise: Promise<unknown>; cancel: () => void };
  getTextContent: () => Promise<{ items: unknown[] }>;
  getAnnotations?: () => Promise<AnnotationLike[]>;
  cleanup?: () => void;
};

/** A web link on the page, as a box in % of the page (top-left origin). */
type PageLink = { url: string; left: number; top: number; width: number; height: number };

const pct = (n: number) => Math.round(n * 100000) / 1000;

/**
 * bd-v0toag.129: the canvas is a picture, so the PDF's own links (the v10 card's "Full details ›")
 * did nothing when tapped. Each http(s) link becomes a box over the page; other link kinds are left out.
 */
export function pageLinks(annotations: AnnotationLike[], base: ViewportLike): PageLink[] {
  const out: PageLink[] = [];
  for (const a of annotations) {
    if (a.subtype !== 'Link' || !a.url || !/^https?:\/\//i.test(a.url) || !a.rect || a.rect.length < 4) continue;
    const [x1, y1, x2, y2] = base.convertToViewportRectangle
      ? base.convertToViewportRectangle(a.rect)
      : [a.rect[0], base.height - a.rect[1], a.rect[2], base.height - a.rect[3]];
    out.push({
      url: a.url,
      left: pct(Math.min(x1, x2) / base.width),
      top: pct(Math.min(y1, y2) / base.height),
      width: pct(Math.abs(x2 - x1) / base.width),
      height: pct(Math.abs(y2 - y1) / base.height),
    });
  }
  return out;
}
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
  const [links, setLinks] = useState<PageLink[]>([]);
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
      page.getAnnotations?.().then((list) => { if (!cancelled) setLinks(pageLinks(list, base)); }).catch(() => { /* no links, page still shows */ });
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
      {mark?.bands.filter((b) => b.page === pageNumber).map((b) => (
        <StepBand key={`${b.page}-${b.top}`} band={b} star={b.page !== mark.page} />
      ))}
      {mark && mark.page === pageNumber ? <StepOutline mark={mark} /> : null}
      {links.map((l) => (
        <a key={`${l.url}-${l.left}-${l.top}`} data-testid="lp-link" href={l.url} target="_blank" rel="noopener noreferrer"
          aria-label={l.url} className="absolute z-10" style={{ left: `${l.left}%`, top: `${l.top}%`, width: `${l.width}%`, height: `${l.height}%` }} />
      ))}
    </div>
  );
};
