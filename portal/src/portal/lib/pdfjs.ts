/**
 * bd-5rz1v.10 — pdf.js, loaded only when a lesson plan is opened.
 *
 * The library and its worker are ~1.5 MB. A static import would put that in
 * every teacher's first load, on low-end phones and weak connections, for a page
 * most visits never open. This dynamic import is the only way in, so Vite emits
 * pdf.js as its own chunk (and the worker as its own file), fetched on the first
 * open and cached after.
 *
 * The LEGACY build: some teachers' Android WebViews are old, and the modern
 * build assumes a recent browser. If even the legacy build cannot load or run
 * here, this rejects and the viewer falls back to today's way of opening.
 */
import type * as PdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export type Pdfjs = typeof PdfjsLib;

let loading: Promise<Pdfjs> | null = null;

export function loadPdfjs(): Promise<Pdfjs> {
  if (!loading) {
    loading = import('./pdfjsRuntime').then((m) => m.pdfjs);
    // A failed load (offline, a stale deploy's chunk) may succeed next time.
    loading.catch(() => { loading = null; });
  }
  return loading;
}
