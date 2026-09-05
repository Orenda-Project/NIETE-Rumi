/**
 * lp612-render.service — lp_doc -> self-contained HTML -> A4 PDF.
 *
 * A thin, honest wrapper around the vendored renderer (`bot/vendor/lp-v9/render_lp.js`), called
 * through its programmatic `renderDoc()` entry rather than its CLI — see SYNC.md §3.3 for why
 * that entry exists and §3.2 for the chromium-channel change that lets it run off macOS.
 *
 * The wrapper deliberately adds almost nothing. Three things only:
 *
 *   1. IT TAKES A DOCUMENT, NOT A PATH. The renderer reads a file (it resolves figure `src`
 *      relative to the document's own directory), so the doc is written into `outDir` first.
 *      The caller holds an object; making it invent a temp file is the wrapper's job, not its.
 *   2. IT TURNS `problems` INTO ONE NAMED FAILURE. The renderer collects findings and lets its
 *      CLI choose an exit code; a service has to throw. Every entry in `problems` is a defect a
 *      TEACHER would meet on paper, so none of them is a warning:
 *        • OVERFLOW    — content clipped off the bottom of a page;
 *        • TYPE FLOOR  — body or chip type under the phone-readable floor;
 *        • PAGE COUNT  — a part over its hard cap (never trimmed: cutting a long plan is an
 *                        authoring decision, and a silent trim is how five-page PDFs of
 *                        seven-page lessons shipped);
 *        • TRUNCATION  — the PDF has FEWER pages than the layout built. The teacher's plan
 *                        just ends. This is the most expensive defect the renderer can ship
 *                        and the reason `page.pdf()` is called with no `pageRanges`.
 *   3. IT KEEPS `warnings` AS WARNINGS. A part over its SOFT target is allowed —
 *      completeness beats page count — and is returned, not thrown.
 *
 * WHAT IT DOES NOT DO: it does not re-lint (the author service owns the canon gate), it does
 * not decide the page caps or type floors (those are the renderer's exported constants, and
 * there is exactly one copy of each), and it does not look at the result. Nothing in this
 * pipeline replaces a human opening the pages and reading them.
 */

const fs = require('fs');
const path = require('path');

const { logToFile } = require('../utils/logger');
// The semantic-event channel (feature.action.result). Additive: the prose lines below stay
// exactly as they were — a sentence is what a human reads, an event name is what a query counts.
const { logEvent } = require('../utils/structured-logger');

// A static, literal require: the repo's unresolved-require audit reads the source text, and a
// `require(path.join(...))` is invisible to it — a vendored file that stopped existing would
// then reach production as a runtime crash instead of a red gate.
const { renderDoc } = require('../../vendor/lp-v9/render_lp.js');

function renderFailed(message, extra = {}) {
  const err = new Error(message);
  err.code = 'RENDER_FAILED';
  Object.assign(err, extra);
  return err;
}

// ── bd-htueq: cap concurrent Chromium renders IN THIS PROCESS ────────────────
//
// `render_lp.js` launches a fresh Chromium browser per call and closes it when done (SYNC.md
// §3.2/§3.7) — there was never a limit on how many of those run at once. Three ladder rounds plus
// a gate probe plus the final render is up to 5 renders per lesson; `SQS_WORKER_CONCURRENCY`
// (default 3) runs that many lessons at once per worker process; none of it was serialised. Up to
// ~15 concurrent Chromium instances fighting one container's CPU, RAM and the 64MB `/dev/shm`
// SYNC.md §3.7 already documents as tight for a SINGLE render is the measured cause of the
// load-test latency blowup (3 of 5 concurrent jobs over 936s vs 227-390s solo).
//
// This is a PER-PROCESS cap: fleet-wide concurrent renders = LP612_RENDER_CONCURRENCY x replica
// count. It bounds what one Node process launches; it does not know about, or coordinate with,
// any other replica.
//
// Default is 2, not "however many jobs run concurrently" (today up to 3 via
// SQS_WORKER_CONCURRENCY x up to 5 renders each). Justification, from what SYNC.md §3.7 already
// establishes rather than a fresh guess: a SINGLE render is already close to exhausting a
// container's 64MB /dev/shm (the reason `--disable-dev-shm-usage` exists at all), so multiplying
// that pressure by N concurrent Chromium processes — each also holding its own heap, its own
// fonts, its own page tree — is the direct mechanism of the load-test blowup, not a side effect of
// it. 2 keeps at least one render always progressing while still letting a second one overlap
// (rather than fully serialising every render in a process that may be mid-3-jobs), and caps
// worst-case concurrent Chromium memory at 2x a single render's footprint instead of up to 15x.
// Configurable per deployment via LP612_RENDER_CONCURRENCY once real numbers exist.
const DEFAULT_RENDER_CONCURRENCY = 2;

function renderConcurrency() {
  const n = parseInt(process.env.LP612_RENDER_CONCURRENCY, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RENDER_CONCURRENCY;
}

/**
 * A minimal FIFO semaphore. `acquire()` resolves immediately while under the current
 * `renderConcurrency()`; once at capacity it queues the caller and resolves callers in the order
 * they arrived. `release()` MUST be called exactly once per successful `acquire()` — including on
 * a failure path — or a slot is burned forever and every later caller queues behind it forever.
 * `renderLessonPlan` below holds it in a try/finally for exactly that reason.
 */
class RenderSemaphore {
  constructor() {
    this.active = 0;
    this.queue = [];
  }

  acquire() {
    if (this.active < renderConcurrency()) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => { this.queue.push(resolve); });
  }

  release() {
    if (this.queue.length) {
      // Hand the slot directly to the next waiter — `active` is unchanged, so this is not a
      // release-then-reacquire race (JS has no concurrent threads to race here, but it also
      // means a resize of LP612_RENDER_CONCURRENCY never needs a signal: the next acquire()
      // reads it fresh).
      const next = this.queue.shift();
      next();
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }
}

// One per process, by design (see the block comment above).
const renderSemaphore = new RenderSemaphore();

// ── bd-htueq: lp612.render.slow ───────────────────────────────────────────────
//
// No single-render latency histogram exists yet — this event is what will build one. The default
// below is a starting point, not a measurement: a solo, uncontended render (embedded fonts, SVG
// diagrams, a 2-9 page PDF, no queue wait) should be a single-digit-seconds operation, so flagging
// anything past 2x that costs little in noise while surfacing real tail contention immediately
// rather than waiting for a proper baseline to accumulate. Tune LP612_RENDER_EXPECTED_MS once this
// event has produced one.
const DEFAULT_EXPECTED_RENDER_MS = 10000;

function expectedRenderMs() {
  const n = parseInt(process.env.LP612_RENDER_EXPECTED_MS, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_EXPECTED_RENDER_MS;
}

/**
 * @param {object} args
 * @param {object} args.lpDoc     an lp_doc (schema 3.0, or 2.0 — the renderer migrates 2.0 into
 *                                the 3.0 shape in memory and keeps ONE layout path)
 * @param {'en'|'ur'} [args.lang] language to render; defaults to the document's own medium
 * @param {string} args.stem      output basename, without extension
 * @param {string} args.outDir    directory for the .json, .html, .pdf and .render.json
 * @param {string} [args.correlationId]
 * @param {string} [args.segmentId] the lesson this render is for. Telemetry only — `stem` is
 *   sanitised for the filesystem and is `gate_<ts>` on ladder runs, so it cannot be joined back
 *   to a segment. Optional so the pure-authoring callers (scripts, tests) need not supply it.
 * @param {string} [args.renderId]  the niete_lp612_renders row. Telemetry only.
 * @param {'final'|'gate'} [args.phase='final'] which call this is: the document the teacher gets,
 *   or one of the revision ladder's gate probes. Defaults to `final` so a caller that has not
 *   been updated is never silently counted as a gate run.
 * @returns {Promise<{pdfPath:string, htmlPath:string, pageCount:number, warnings:string[]}>}
 * @throws  Error with .code 'RENDER_FAILED', .problems[], and .infra (bd-htueq) — `true` when the
 *   renderer died for ITS OWN reasons (a crash, a launch failure — infrastructure, not the
 *   document), `false` when `.problems` are real defects the document itself contains (a
 *   schema/overlay error, or the renderer's own OVERFLOW / TYPE FLOOR / PAGE COUNT / TRUNCATION
 *   findings). A caller that guards a revision ladder on this MUST NOT treat an `.infra` failure
 *   as "no defects" — see bot/workers/lp612-author.worker.js's renderCheck for why.
 *
 * Renders are additionally capped at `LP612_RENDER_CONCURRENCY` PER PROCESS (default
 * DEFAULT_RENDER_CONCURRENCY above) — the rest queue FIFO rather than each launching their own
 * Chromium. A render whose total time (queue wait + the render itself) exceeds 2x
 * `LP612_RENDER_EXPECTED_MS` emits `lp612.render.slow` with both numbers reported separately.
 */
async function renderLessonPlan({
  lpDoc, lang, stem, outDir, correlationId, segmentId, renderId, phase,
} = {}) {
  if (!lpDoc || typeof lpDoc !== 'object') throw renderFailed('renderLessonPlan needs an lpDoc object');
  if (!stem) throw renderFailed('renderLessonPlan needs a stem');
  if (!outDir) throw renderFailed('renderLessonPlan needs an outDir');

  const startedAt = Date.now();
  const trace = {
    segmentId: segmentId || null,
    renderId: renderId || null,
    lang: lang || null,
    phase: phase || 'final',
    correlationId: correlationId || null,
  };

  let docPath;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    docPath = path.join(outDir, `${stem}.lp.json`);
    fs.writeFileSync(docPath, JSON.stringify(lpDoc, null, 1), 'utf8');
  } catch (e) {
    // A disk/permission failure preparing the temp files. Not the document's fault, and not the
    // Chromium launch below — but it must still carry `.infra: true` (bd-htueq), because a caller
    // that only checks `.problems` for content has nothing else to go on here.
    logToFile('lp612 render could not prepare its temp files', {
      correlationId, stem, error: e.message,
    }, 'error');
    logEvent('lp612.render.failed', {
      ...trace, stem, outcome: 'failed', elapsedMs: Date.now() - startedAt,
      code: null, error: e.message, problems: [e.message], infra: true,
    });
    throw renderFailed(`render of ${stem} could not prepare its temp files: ${e.message}`, {
      problems: [e.message], infra: true, cause: e,
    });
  }

  // ── bd-htueq: acquire the per-process render slot ──────────────────────────
  const queueWaitStart = Date.now();
  await renderSemaphore.acquire();
  const queueWaitMs = Date.now() - queueWaitStart;
  const renderStart = Date.now();

  let out;
  let thrown = null;
  try {
    out = await renderDoc({
      doc: docPath,
      out: outDir,
      stem,
      lang: lang || null,
      png: false,
      pdf: true,
      quiet: true,
    });
  } catch (e) {
    thrown = e;
  } finally {
    // MUST run on the throw path too — a slot leaked here queues every later render behind a
    // failure that already finished, which wedges the process, not just this one lesson.
    renderSemaphore.release();
  }

  const renderMs = Date.now() - renderStart;
  const totalMs = queueWaitMs + renderMs;
  if (totalMs > 2 * expectedRenderMs()) {
    // Reported on EVERY outcome (success, content defect, or blow-up) — duration is orthogonal
    // to what the render produced. queueWaitMs and renderMs are kept separate on purpose: a slow
    // queue wait is a CAPACITY signal (raise LP612_RENDER_CONCURRENCY or add replicas), a slow
    // render is a CONTENTION/perf signal (the container itself is struggling) — conflating them
    // into one number tells whoever reads it to fix the wrong thing.
    logEvent('lp612.render.slow', {
      ...trace, stem, queueWaitMs, renderMs, totalMs, expectedMs: expectedRenderMs(),
      outcome: thrown ? 'failed' : 'ready',
    });
  }

  if (thrown) {
    const e = thrown;
    // SCHEMA_INVALID / OVERLAY_INVALID are the DOCUMENT's fault — the renderer refused to even
    // try. Anything else here is the renderer blowing up for ITS OWN reasons (a launch that could
    // not get going, a crash mid-render, a contention timeout) — infrastructure, not content.
    const infra = e.code !== 'SCHEMA_INVALID' && e.code !== 'OVERLAY_INVALID';
    logToFile('lp612 render threw', {
      correlationId, stem, code: e.code || null, error: e.message, infra,
    }, 'error');
    logEvent('lp612.render.failed', {
      ...trace, stem, outcome: 'failed', elapsedMs: Date.now() - startedAt,
      code: e.code || null, error: e.message, problems: e.errors || [e.message], infra,
    });
    throw renderFailed(`render of ${stem} failed: ${e.message}`, {
      problems: e.errors || [e.message],
      infra,
      cause: e,
    });
  }

  const problems = out.problems || [];
  const warnings = out.warnings || [];
  const byPart = out.pagesByPart || {};
  // bd-c3le6: which pages had a furniture-sized overflow taken out of their own bottom
  // whitespace so the lesson could ship. ALWAYS a list — `[]` means "we looked and there was
  // nothing", which is a different fact from "we did not look", and a fallback that leaves no
  // trace is a regression mask (rule 24(b)). If this starts firing across the corpus rather
  // than on the odd Urdu footer, the packer has drifted and this number is what says so.
  const absorbed = (out.report && out.report.overflow_absorbed) || [];
  if (absorbed.length) {
    logEvent('lp612.render.overflow_absorbed', {
      ...trace,
      stem,
      lang: lang || null,
      maxPx: (out.report && out.report.overflow_absorb_max_px) != null
        ? out.report.overflow_absorb_max_px
        : null,
      pages: absorbed,
      worstPx: absorbed.reduce((m, a) => Math.max(m, a.px || 0), 0),
    });
    logToFile('lp612 render: absorbed a furniture-sized overflow rather than discarding the lesson', {
      correlationId, stem, lang: lang || null, absorbed,
    }, 'warn');
  }
  // `pdfPages` counts the REAL file; `pagesByPart` counts what the packer laid out. They can
  // disagree, and when they do the renderer has already said so in `problems` — prefer the
  // file, because the file is what the teacher opens.
  const pageCount = out.pdfPages != null
    ? out.pdfPages
    : Object.values(byPart).reduce((a, n) => a + n, 0);

  if (problems.length) {
    logToFile('lp612 render produced defects', {
      correlationId, stem, lang: lang || null, problems, pagesByPart: byPart,
    }, 'error');
    logEvent('lp612.render.failed', {
      ...trace, stem, outcome: 'failed', elapsedMs: Date.now() - startedAt,
      code: 'RENDER_DEFECTS', pageCount, problems, pagesByPart: byPart, infra: false,
    });
    // THE ERROR CARRIES EVERYTHING THE SUCCESS RETURN DOES.
    //
    // bd-vjk68: a document refused ONLY for `PAGE COUNT` is now DELIVERED — the operator's call,
    // "we will stop cancelling ... lesson plans because of the length issue" — and the PDF that
    // makes that possible has already been written by the time this throws. The caller therefore
    // needs the same three facts the happy path returns: which parts ran to how many pages (for
    // the `over_cap` row and the `lp612.deliver.over_cap` event, whose whole purpose is to make
    // the page distribution measurable after the caps moved), and which overlay pointers were
    // applied (for `overlay_dropped`, whose absence would silently mark every over-cap Urdu
    // render as overlay-dropped and staple an honesty caption onto a perfectly good document).
    //
    // Nothing here decides anything: the service's contract is unchanged — any defect is still a
    // throw, and PAGE COUNT is still a defect. It only stops the throw from being lossier than
    // the return.
    throw renderFailed(
      `render of ${stem} produced ${problems.length} defect(s): ${problems.join(' | ')}`,
      {
        problems,
        infra: false,
        warnings,
        htmlPath: out.htmlPath,
        pdfPath: out.pdfPath,
        pageCount,
        pagesByPart: byPart,
        overlayApplied: (out.report && out.report.overlay_applied) || [],
        overflowAbsorbed: absorbed,
      }
    );
  }

  logToFile('lp612 render ok', {
    correlationId, stem, lang: lang || null, pageCount, pagesByPart: byPart,
    warnings, reportPath: out.reportPath,
  });
  logEvent('lp612.render.completed', {
    ...trace, stem, outcome: 'ready', elapsedMs: Date.now() - startedAt,
    pageCount, pagesByPart: byPart, warnings: warnings.length,
  });

  return {
    pdfPath: out.pdfPath,
    htmlPath: out.htmlPath,
    pageCount,
    // Per-part pages, so the row can record `over_cap` HONESTLY on the happy path too — a
    // delivered lesson that fits must say `over_cap: false`, not leave the column ambiguous.
    // The same field is on the throw path above; the two must not disagree in shape.
    pagesByPart: byPart,
    warnings,
    // The JSON pointers the ur_overlay actually replaced (renderDoc's
    // report.overlay_applied). The worker persists `overlay_dropped` from this
    // — an Urdu render of an EN-medium book with NOTHING applied is an
    // essentially-English document in RTL chrome, and the row must say so.
    // Always a list, never undefined: absence of a record is "nothing applied".
    overlayApplied: (out.report && out.report.overlay_applied) || [],
    // Same contract for the absorber (bd-c3le6): `[]` on a clean render, never undefined.
    overflowAbsorbed: absorbed,
  };
}

module.exports = { renderLessonPlan };
