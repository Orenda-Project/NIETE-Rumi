/**
 * bd-5rz1v.10 — pdf.js itself. Imported ONLY by lib/pdfjs.ts, dynamically: see there.
 *
 * The worker is built by Vite as a classic worker script (`?worker`), served as
 * .js from our own origin like every other asset. Pointing pdf.js at the
 * package's .mjs file instead would depend on the server sending .mjs with a
 * JavaScript type, which a module worker insists on.
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker';

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

export { pdfjs };
