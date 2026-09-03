#!/usr/bin/env node
// render_lp.js — lp_doc JSON -> self-contained HTML -> two-page A4 PDF (+ PNGs).
//
//   node render_lp.js <lp_doc.json> [--out DIR] [--stem NAME] [--lang en|ur] [--png] [--no-pdf]
//
// Non-negotiables this script enforces (it exits non-zero if any fails):
//   • at most 2 TEACH pages and 2 SUPPORT pages, each part starting on a fresh page;
//   • NOTHING is silently clipped. Overflow is measured in the browser and reported
//     with the offending section id. A clipped LP is a lesson a teacher loses the
//     end of, and the end is the part that already gets cut (MDPI 16:5:699);
//   • fonts are loaded BEFORE the print pass (`await document.fonts.ready`) —
//     the Urdu "tofu"/overlap defects were font-load races, not missing glyphs;
//   • KaTeX + mhchem are rendered server-side; the page ships no client JS.
//
// Chrome comes from playwright-core (the main bot's copy, read-only) when it is
// available, else from `Google Chrome --headless --print-to-pdf`.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { buildHtml } = require("./lib/template");
const { applyOverlay } = require("./lib/overlay");
const { validateDoc } = require("./lib/validate");
const { REPO_ROOT } = require("./lib/fonts");
const { setInfo } = require("./lib/pdfmeta");

const A4 = { w: 794, h: 1123 };
// Operator decision 2026-08-30 (floor raised to 18px on 2026-09-01): the body floor is the
// hard constraint, so the page
// cap gives instead. Each part starts on a fresh page.
//
// Revised after the 8-sample run (2026-08-30): COMPLETENESS BEATS PAGE COUNT. Holding TEACH
// to 2 pages cost the G7 sample its key_points AND its keywords, and the G10 Urdu sample its
// We-Do beat — the plan fitted, and taught less.
//
// Revised again after the 11-sample run (2026-08-31, operator: "prioritize completeness"):
// 6 of 11 real 6-12 plans packed past 3 teach pages and 2 of them past 2 support pages —
// a Grade 10 determinants lesson and a سیرت close-reading do not fit a science one-pager.
// TEACH may reach 4 and SUPPORT 3. The last page before each cap WARNS, so nobody drifts
// there by accident; over the cap FAILS LOUD. Over-cap is never trimmed — see the PDF note
// below: a plan that is too long is one we cut deliberately, not one Chrome eats.
//
// Revised again 2026-09-01, when the operator raised the body floor to 18px: "make it larger,
// and keep enough spacing that it doesn't get airtight". A deliberate font increase is NOT
// bloat, so the CAP gives, not the content — see the measured numbers in lint_lp.js. Over the
// cap is still a loud FAIL; the cap's job is to catch padding, and it still does.
const MAX_PAGES = { teach: 5, support: 4 };     // above this: FAIL
const WARN_PAGES = { teach: 4, support: 3 };    // above this: WARN, and keep going

// PAGE CAPS ARE LANGUAGE-AWARE; WORD BUDGETS ARE NOT (operator, 2026-09-03).
//
// The SAME document rendered in both languages measured en=9pp / ur=12pp — a
// controlled ~+33% footprint, because Nastaliq's tall marks and descenders need
// line-height ~2.05 against Latin's 1.55, so an Urdu page carries roughly 2/3
// the lines of an English one at the same floor. Under the English caps every
// Urdu render of a full English-cap plan failed PAGE COUNT while carrying
// IDENTICAL content — the staging field score the day this was measured was
// EN 2/3 ready vs UR 0/4, every Urdu failure a PAGE COUNT.
//
// The operator's call, verbatim: "keep the same word limit (though pages can be
// a bit more to allow for decent urdu spacing)". So the word budgets in
// lint_lp.js stay one set of numbers for both languages — an Urdu plan says no
// more than an English one — and Urdu pays its measured paper cost here, in
// pages: teach 7 / support 5 (5/4 × 4/3 line density, rounded up), warns one
// page under each cap exactly as English warns.
const MAX_PAGES_UR = { teach: 7, support: 5 };
const WARN_PAGES_UR = { teach: 6, support: 4 };

/** The caps for one render, by the language actually being laid out. */
function pageCapsFor(lang) {
  return lang === "ur"
    ? { max: MAX_PAGES_UR, warn: WARN_PAGES_UR }
    : { max: MAX_PAGES, warn: WARN_PAGES };
}

// THE TYPE FLOORS, in one place. D4 was 16.5/13; the operator moved it to 18/14 on 2026-09-01
// because 16.5 still did not read on a phone. The DIAGRAM label floor is NOT here — it is
// 13.5px and it belongs to the diagram engine (diagrams/lib/svg.js), which sizes labels
// against the figure's own column, not against the page's body scale.
const BODY_FLOOR_PX = 18;
const CHIP_FLOOR_PX = 14;
// VENDOR DIVERGENCE (see SYNC.md, "chromium channel"): upstream hardcoded the macOS Chrome
// bundle path for the no-playwright fallback. On Railway that path does not exist, so the
// binary is now overridable and defaults per-platform. This fallback has no overflow probe
// and no PNGs and exists only so a dev box without playwright still produces a PDF.
const CHROME_CLI_BIN = process.env.LP612_CHROME_BIN ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome");

function parseArgs(argv) {
  const a = { png: false, pdf: true, lang: null, out: null, stem: null, quiet: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--png") a.png = true;
    else if (v === "--no-pdf") a.pdf = false;
    else if (v === "--quiet") a.quiet = true;
    else if (v === "--lang") a.lang = argv[++i];
    else if (v === "--out") a.out = argv[++i];
    else if (v === "--stem") a.stem = argv[++i];
    else rest.push(v);
  }
  a.doc = rest[0];
  return a;
}

// VENDOR DIVERGENCE (see SYNC.md, "playwright resolution"): upstream tried a machine-local
// checkout of another repo's node_modules first. Here playwright-core is a real dependency of
// bot/package.json, so the plain require is the only candidate — and in the root Jest suite it
// resolves to tests/__mocks__/playwright-core.js via moduleNameMapper, which is the seam that
// keeps a unit test from downloading or launching a browser.
function loadPlaywright() {
  try {
    return require("playwright-core");
  } catch (_) {
    return null;
  }
}

// VENDOR DIVERGENCE (see SYNC.md, "chromium channel"): upstream hardcoded
// `launch({ channel: "chrome" })`, which requires a Google Chrome INSTALL and fails on a
// Railway container, where the only browser is the chromium playwright ships. The channel is
// now: whatever LP612_CHROME_CHANNEL says; else "chrome" on macOS (a dev laptop has Chrome and
// the upstream behaviour is what the golden renders were eyeballed against); else undefined,
// which means playwright's own bundled chromium.
function chromeChannel() {
  const explicit = process.env.LP612_CHROME_CHANNEL;
  if (explicit) return explicit === "bundled" ? undefined : explicit;
  return process.platform === "darwin" ? "chrome" : undefined;
}

/** Count /Type /Page objects in a PDF buffer. */
function pdfPageCount(buf) {
  return (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}

// Pass 1: measure every ATOM of each part at the real page width, so the page breaks are
// COMPUTED from what the browser actually lays out rather than estimated from word counts.
//
// v8.1: an atom is a section bar, a block, or one practice item — not a whole section. The
// height and the TOP MARGIN are reported separately, because the margin is real everywhere
// except on the first element of a page (`.pad > :first-child{margin-top:0}`); charging it
// there would silently shrink every page by up to one --sp-4.
//
// The `__probe` page carries the furniture the packer must also pay for and which is not an
// atom: the "…continued" strip, the per-page footer, and one repeated bar PER SECTION.
const MEASURE = `() => {
  document.body.classList.add('measuring');
  void document.body.offsetHeight;                 // force reflow before reading
  const box = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { h: Math.ceil(r.height + parseFloat(cs.marginBottom)), mt: Math.ceil(parseFloat(cs.marginTop)) };
  };
  const out = { parts: {}, probe: {} };
  for (const page of document.querySelectorAll('.page')) {
    const part = page.dataset.part;
    const pad = page.querySelector('.pad');
    if (part === '__probe') {
      for (const ch of pad.querySelectorAll('[data-probe]')) out.probe[ch.dataset.probe] = box(ch);
      continue;
    }
    out.parts[part] = out.parts[part] || [];
    for (const ch of pad.querySelectorAll(':scope > [data-atom]')) out.parts[part].push(box(ch));
  }
  document.body.classList.remove('measuring');
  return out;
}`;

/**
 * Greedy first-fit over ATOMS, with the two constraints v8 did not have.
 *
 * 1. GLUE — a break may not fall immediately after an atom marked `glue`. That is what keeps
 *    a section bar with its first block and a practice tag with its first item. When the
 *    natural break lands on a glued boundary the packer walks BACKWARDS to the last legal
 *    one; if that would empty the page it takes the illegal break rather than dropping
 *    content, because a lost block is worse than an orphan heading.
 * 2. FURNITURE — every page pays for its footer; every page after the first also pays for
 *    the "…continued" strip, and for the repeated section bar when it opens mid-section.
 *    Charging a guessed height instead is exactly how v8 overflowed every continuation page
 *    by the strip's own height (+39px on the Urdu G9 support page).
 *
 * @param atoms [{h, mt, glue, sec, first}]
 * @param capacity  the page box, ALREADY net of the footer
 * @param furn  { strip, contBar: {sectionKey: px} } — heights measured in the probe page
 * @returns { breaks:[atom index that starts each page after the first], pages:[{start, contBarSec}] }
 */
function packAtoms(atoms, capacity, furn = {}) {
  const strip = furn.strip || 0;
  const contBar = furn.contBar || {};
  const breaks = [];
  const pages = [];
  let pageStart = 0, pageIdx = 0;

  const open = (i, idx) => {
    const a = atoms[i] || {};
    // a page that opens on a section's OWN bar needs no repeat; one that opens in the middle
    // of a section does.
    const sec = idx > 0 && a.sec && !a.first ? a.sec : null;
    const overhead = idx > 0 ? strip + (sec ? (contBar[a.sec] || 0) : 0) : 0;
    pages[idx] = { start: i, contBarSec: sec };
    return capacity - overhead;
  };

  if (!atoms.length) return { breaks, pages: [] };
  let cap = open(0, 0);
  // the first atom of page 1 has its top margin suppressed by CSS; on a continuation page
  // the first atom follows the strip, so it keeps it.
  let used = atoms[0].h;

  for (let i = 1; i < atoms.length; i++) {
    const cost = atoms[i].h + (atoms[i].mt || 0);
    if (used + cost <= cap) { used += cost; continue; }
    let j = i;
    while (j > pageStart + 1 && atoms[j - 1].glue) j--;
    breaks.push(j);
    pageStart = j;
    pageIdx++;
    cap = open(j, pageIdx);
    used = atoms[j].h + (atoms[j].mt || 0);
    for (let k = j + 1; k <= i; k++) used += atoms[k].h + (atoms[k].mt || 0);
  }
  return { breaks, pages };
}

/**
 * The v8 signature, kept because it is the honest description of the degenerate case
 * (no glue, no per-section bars) and because the packer's oldest regression tests speak it.
 */
function computeBreaks(heights, capacity, contHeight = 0) {
  const atoms = heights.map((h) => ({ h, mt: 0, glue: false, sec: null, first: false }));
  return packAtoms(atoms, capacity, { strip: contHeight }).breaks;
}

// The in-page probe. Runs after fonts.ready; returns geometry + the smallest
// computed body-text size, so the phone gate can assert D4 without re-rendering.
const PROBE = `() => {
  const BODY_SEL = '.pad p, .pad li, .q, .a, .prompt, .res, .part';   // read in the room -> 18px
  const CHIP_SEL = '.kw, .op, .lf, .how, .tier, .kind, figcaption, .src, .cont, .marking, .tnote, .refq, .slocode, .seq, .hw .tag, .cite';  // chrome -> 14px
  const pages = [];
  let minBody = Infinity, minBodySample = null, minAny = Infinity, minChip = Infinity, minChipSample = null;
  for (const el of document.querySelectorAll('*')) {
    const t = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
    if (!t) continue;
    if (el.closest('.katex')) continue;           // KaTeX scripts are legitimately small
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < minAny) minAny = fs;
    if (el.matches(CHIP_SEL)) { if (fs < minChip) { minChip = fs; minChipSample = (el.className||el.tagName)+' :: '+el.textContent.trim().slice(0,40); } continue; }
    if (el.matches(BODY_SEL) && fs < minBody) {
      minBody = fs;
      minBodySample = (el.className || el.tagName) + ' :: ' + el.textContent.trim().slice(0, 48);
    }
  }
  for (const page of document.querySelectorAll('.page')) {
    const pad = page.querySelector('.pad');
    const pageBottom = page.getBoundingClientRect().bottom;
    const over = [];
    for (const el of page.querySelectorAll('[data-sec]')) {
      const r = el.getBoundingClientRect();
      const parent = el.parentElement;
      const pr = parent ? parent.getBoundingClientRect() : r;
      const bottom = Math.max(r.bottom, pr.bottom);
      if (bottom > pageBottom + 1) over.push({ sec: el.dataset.sec, overBy: Math.round(bottom - pageBottom) });
    }
    // Overflow is measured from the LAST PAINTED PIXEL, not from scrollHeight: .pad is a
    // flex column whose footer carries margin-top:auto, and scrollHeight over-reports that
    // auto margin by a few px. What matters is whether anything is drawn past the page's
    // inner bottom edge — that is what a clipped LP looks like.
    const cs = getComputedStyle(pad);
    const innerBottom = pageBottom - parseFloat(cs.paddingBottom);
    let lastBottom = 0, lastWhat = null, contentBottom = 0;
    for (const el of pad.querySelectorAll('*')) {
      if (!el.getClientRects().length) continue;
      const b = el.getBoundingClientRect().bottom;
      if (b > lastBottom) { lastBottom = b; lastWhat = (String(el.className) || el.tagName).slice(0, 40); }
      // FILL is measured over CONTENT only. Since v8.1 every page carries a footer pinned to
      // the page floor by margin-top:auto, so the last painted pixel is always the footer and
      // a naive fill reads 100% on a page that is two thirds white. That is the exact
      // illusion the operator asked us to stop having.
      if (!el.closest('.foot') && b > contentBottom) contentBottom = b;
    }
    pages.push({
      id: page.id,
      contentHeight: Math.round(pad.scrollHeight),
      boxHeight: Math.round(pad.clientHeight),
      lastPaintedPx: Math.round(lastBottom - page.getBoundingClientRect().top),
      contentBottomPx: Math.round(contentBottom - page.getBoundingClientRect().top),
      footTopPx: Math.round((pad.querySelector('.foot') ? pad.querySelector('.foot').getBoundingClientRect().top : innerBottom) - page.getBoundingClientRect().top),
      innerBottomPx: Math.round(innerBottom - page.getBoundingClientRect().top),
      lastElement: lastWhat,
      overflowPx: Math.max(0, Math.round(lastBottom - innerBottom)),
      overflowingSections: over,
    });
  }
  const byPart = {};
  for (const page of document.querySelectorAll('.page')) {
    byPart[page.dataset.part] = (byPart[page.dataset.part] || 0) + 1;
  }
  return {
    pageCount: document.querySelectorAll('.page').length,
    pagesByPart: byPart,
    minBodyFontPx: minBody === Infinity ? null : Math.round(minBody * 100) / 100,
    minBodySample,
    minAnyFontPx: minAny === Infinity ? null : Math.round(minAny * 100) / 100,
    minChipFontPx: minChip === Infinity ? null : Math.round(minChip * 100) / 100,
    minChipSample,
    pages,
  };
}`;

async function renderWithPlaywright(pw, htmlPath, outPdf, outPngStem, wantPng, repaginate, pdfMeta) {
  const channel = chromeChannel();
// VENDOR DIVERGENCE (see SYNC.md, "container launch flags"): two flags that matter only on a
  // container, and only under load (bd-v60qf).
  //   --disable-dev-shm-usage : a container's /dev/shm defaults to 64MB; Chromium keeps its
  //     shared memory there and a 9-page A4 render with embedded fonts and SVG diagrams exhausts
  //     it. The tab dies mid-render and it surfaces as "the render failed", with no readable
  //     out-of-memory anywhere — the worst shape of failure this pipeline can have.
  //   --no-sandbox : the sandbox needs kernel privileges the Railway container does not grant,
  //     without which the browser can fail to start at all.
  // Harmless on a dev box, which is exactly why nothing on a laptop would ever catch their absence.
  const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];
  const browser = await pw.chromium.launch(
    channel ? { channel, args: LAUNCH_ARGS } : { args: LAUNCH_ARGS },
  );
  try {
    const page = await browser.newPage({ viewport: { width: A4.w, height: A4.h }, deviceScaleFactor: 2 });
    const load = async (p) => {
      await page.goto("file://" + p + "?t=" + Date.now(), { waitUntil: "load" });
      await page.evaluate("document.fonts.ready.then(function(){return true;})");
      await page.emulateMedia({ media: "print" }); // screen layout under-reports print height
      await page.waitForTimeout(120);
    };
    await load(htmlPath);

    // PASS 1 — measure, compute the breaks, rewrite the file, reload. Pagination is
    // therefore derived from real layout, never from a word-count estimate.
    if (repaginate) {
      const m = await page.evaluate(`(${MEASURE})()`);
      const P = m.probe || {};
      const footH = P.__foot ? P.__foot.h + P.__foot.mt : 0;
      const strip = P.__strip ? P.__strip.h : 0;
      const contBar = {};
      for (const [k, v] of Object.entries(P)) if (!k.startsWith("__")) contBar[k] = v.h + v.mt;
      // every page now carries a footer, so the usable box is the page box less that footer
      const capacity = repaginate.capacity - footH;
      const furn = { strip, contBar };
      const withMeta = (part) =>
        (m.parts[part] || []).map((b, i) => Object.assign({}, b, repaginate.atoms[part][i] || {}));
      const teach = packAtoms(withMeta("teach"), capacity, furn);
      const support = packAtoms(withMeta("support"), capacity, furn);
      const breaks = { teach: teach.breaks, support: support.breaks };
      const rebuilt = repaginate.rebuild(breaks);
      fs.writeFileSync(htmlPath, rebuilt.html);
      await load(htmlPath);
      repaginate.warnings = rebuilt.warnings;
      repaginate.figureProblems = rebuilt.figureProblems;
      repaginate.breaks = breaks;
      repaginate.furniture = { footer_px: footH, cont_strip_px: strip, cont_bar_px: contBar, capacity_px: capacity };
      // the fill each page is packed to — the number the operator asked us to MEASURE, not
      // estimate. The probe below re-reads it from the real render as a cross-check.
      repaginate.packed = { teach: teach.pages, support: support.pages };
    }
    // evaluate() treats a string as an EXPRESSION — a bare arrow function would come
    // back as an unserializable function object (silently undefined). Call it.
    const probe = await page.evaluate(`(${PROBE})()`);
    let pdfPages = null;
    if (outPdf) {
      // NO PAGE RANGE. A range — frozen OR cap-derived — is silent data loss: Chrome drops
      // the surplus pages, the teacher's PDF just ends, and the cross-check then blames
      // "a splitting block". A cap-derived "1-5" ate 2 whole teach pages of the G6 Islamiat
      // plan and both G10 Urdu support pages in the 2026-08-30 sample run.
      // The renderer emits EVERY page the packer laid out; going over the cap is reported
      // below as a loud PAGE COUNT failure. Cutting a long plan is an authoring decision.
      const buf = await page.pdf({ width: `${A4.w}px`, height: `${A4.h}px`, printBackground: true });
      // The internal identifiers the footer no longer prints live HERE instead — visible to
      // the pipeline (and in File > Properties), invisible to the teacher.
      fs.writeFileSync(outPdf, pdfMeta ? setInfo(buf, pdfMeta) : buf);
      pdfPages = pdfPageCount(buf);
    }
    if (wantPng) {
      const els = await page.$$(".page");
      for (let i = 0; i < els.length; i++) {
        await els[i].screenshot({ path: `${outPngStem}-p${i + 1}.png` });
      }
    }
    return { probe, pdfPages, breaks: repaginate ? repaginate.breaks : null,
             furniture: repaginate ? repaginate.furniture : null };
  } finally {
    await browser.close();
  }
}

function renderWithChromeCli(htmlPath, outPdf) {
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "lp8-"));
  execFileSync(CHROME_CLI_BIN, [
    "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
    `--user-data-dir=${tmp}`,
    `--print-to-pdf=${outPdf}`, "--virtual-time-budget=6000",
    "file://" + htmlPath,
  ], { stdio: "ignore" });
  return { probe: null, pdfPages: pdfPageCount(fs.readFileSync(outPdf)) };
}

/**
 * VENDOR DIVERGENCE (see SYNC.md, "programmatic entry"): upstream had only a CLI `main()`
 * that called `process.exit()`. A long-lived worker cannot shell into a function that kills
 * the process, and shelling OUT to `node render_lp.js` would put a subprocess and a
 * stdout-parse between the caller and its errors. So `main()` was split: everything that does
 * work now lives in `renderDoc()`, which RETURNS its findings, and `main()` is the thin CLI
 * shell that prints them and picks an exit code. No render logic was changed in the split.
 *
 * @param {object} a  { doc: path, out?, stem?, lang?, png?, pdf?, quiet? }
 * @returns {Promise<{report, problems, warnings, htmlPath, pdfPath, pagesByPart, probe}>}
 * @throws  Error with .code 'SCHEMA_INVALID' | 'OVERLAY_INVALID' and .errors[]
 */
async function renderDoc(a) {
  if (!a || !a.doc) {
    const e = new Error("renderDoc needs { doc: <path to lp_doc.json> }");
    e.code = "NO_DOC";
    throw e;
  }
  const docPath = path.resolve(a.doc);
  const raw = JSON.parse(fs.readFileSync(docPath, "utf8"));

  const v = validateDoc(raw);
  if (!v.ok) {
    const e = new Error("SCHEMA INVALID — refusing to render:\n  " + v.errors.join("\n  "));
    e.code = "SCHEMA_INVALID";
    e.errors = v.errors;
    throw e;
  }

  const lang = a.lang || raw.provenance.medium || "en";
  const { doc, applied, errors: ovErrors } = applyOverlay(raw, lang);
  if (ovErrors.length) {
    const e = new Error("ur_overlay errors — refusing to render:\n  " + ovErrors.join("\n  "));
    e.code = "OVERLAY_INVALID";
    e.errors = ovErrors;
    throw e;
  }

  const outDir = path.resolve(a.out || path.join(path.dirname(docPath), "..", "out"));
  fs.mkdirSync(outDir, { recursive: true });
  const stem = a.stem || path.basename(docPath).replace(/\.(lp\.)?json$/i, "") + (lang === "ur" && raw.provenance.medium !== "ur" ? "_ur" : "");

  // v8.1: what the page no longer prints, the FILE still carries. `lesson_id`, `book_stem`
  // and `schema_version` are pipeline keys, so they go into the PDF's Info dictionary and
  // the render report — never into the teacher's footer.
  const pdfMeta = {
    Title: `${raw.provenance.topic} — Grade ${raw.provenance.grade} ${raw.provenance.subject}`,
    Subject: `lesson_id=${raw.lesson_id}; book_stem=${raw.provenance.book_stem}; pp.${raw.provenance.printed_pages}`,
    Keywords: `${raw.provenance.book_stem}; ${raw.lesson_id}; lp_doc ${raw.schema_version}; ${raw.lp_type}; lang=${lang}` +
      (raw.provenance.version ? `; v${raw.provenance.version}` : ""),
    Creator: (raw.provenance.brand && raw.provenance.brand.name) || "lp_html v8.1",
  };

  const pw = loadPlaywright();
  let built = buildHtml(doc, { lang, docDir: path.dirname(docPath), probeCont: !!pw });
  const { warnings, fontReport, pageContentHeight, hasRasterFigure } = built;
  let figureProblems = built.figureProblems || [];
  const htmlPath = path.join(outDir, `${stem}.html`);
  fs.writeFileSync(htmlPath, built.html);

  const pdfPath = a.pdf ? path.join(outDir, `${stem}.pdf`) : null;
  let result;
  if (pw) {
    const repaginate = {
      capacity: pageContentHeight,
      atoms: built.atoms,
      rebuild: (breaks) => buildHtml(doc, { lang, docDir: path.dirname(docPath), breaks }),
    };
    result = await renderWithPlaywright(pw, htmlPath, pdfPath, path.join(outDir, stem), a.png, repaginate, pdfMeta);
    if (repaginate.warnings) { warnings.length = 0; warnings.push(...repaginate.warnings); }
    if (repaginate.figureProblems) figureProblems = repaginate.figureProblems;
  } else {
    console.error("! playwright-core unavailable — falling back to Chrome CLI (no overflow probe, no PNGs)");
    result = pdfPath ? renderWithChromeCli(htmlPath, pdfPath) : { probe: null, pdfPages: null };
  }

  // ── report ────────────────────────────────────────────────────────────────
  const problems = [...figureProblems];   // an illegible or over-tall figure is a FAILURE,
                                          // never something the renderer quietly shrinks
  const probe = result.probe;
  if (probe) {
    for (const p of probe.pages) {
      if (p.overflowPx > 1) {
        const where = p.overflowingSections.length
          ? p.overflowingSections.map((s) => `${s.sec} (+${s.overBy}px)`).join(", ")
          : `last painted element: ${p.lastElement}`;
        problems.push(`OVERFLOW on ${p.id}: content is ${p.overflowPx}px taller than the page. Offending: ${where}`);
      }
    }
    if (probe.minBodyFontPx != null && probe.minBodyFontPx < BODY_FLOOR_PX) {
      problems.push(`TYPE FLOOR: smallest body text is ${probe.minBodyFontPx}px (<${BODY_FLOOR_PX}px) — ${probe.minBodySample}`);
    }
    if (probe.minChipFontPx != null && probe.minChipFontPx < CHIP_FLOOR_PX) {
      problems.push(`TYPE FLOOR: smallest chip/label is ${probe.minChipFontPx}px (<${CHIP_FLOOR_PX}px) — ${probe.minChipSample}`);
    }
  }
  const byPart = (probe && probe.pagesByPart) || {};
  const CAPS = pageCapsFor(lang);
  for (const [part, cap] of Object.entries(CAPS.max)) {
    const n = byPart[part] || 0;
    if (n > cap) problems.push(`PAGE COUNT: ${part} needs ${n} pages; the cap is ${cap}. Cut it, or move content to the other part.`);
    else if (CAPS.warn[part] && n > CAPS.warn[part]) {
      warnings.push(`${part} runs to ${n} pages (soft target ${CAPS.warn[part]}, hard cap ${cap}). Allowed — completeness beats page count — but check nothing is padding.`);
    }
  }
  const pagesBuilt = (byPart.teach || 0) + (byPart.support || 0);
  // A SHORT pdf and a LONG one are opposite bugs and used to share one misleading message.
  // Short = the teacher loses the end of the lesson — the most expensive defect this
  // renderer can ship, so it is named for what it is.
  if (result.pdfPages != null && pagesBuilt && result.pdfPages < pagesBuilt) {
    problems.push(`TRUNCATION: the PDF has ${result.pdfPages} page(s) but the layout built ${pagesBuilt} — ${pagesBuilt - result.pdfPages} page(s) of the lesson are MISSING from the file. The renderer must never emit fewer pages than the packer laid out.`);
  } else if (result.pdfPages != null && pagesBuilt && result.pdfPages > pagesBuilt) {
    problems.push(`PAGE COUNT: the PDF has ${result.pdfPages} page(s) but the layout built ${pagesBuilt}. A block is splitting across a page break.`);
  }
  // Chrome-CLI fallback has no per-part probe, so the per-part caps above cannot fire. Guard
  // the total there so a runaway build is still caught rather than shipped.
  if (!pagesBuilt && result.pdfPages != null && result.pdfPages > CAPS.max.teach + CAPS.max.support) {
    problems.push(`PAGE COUNT: PDF has ${result.pdfPages} pages; the cap is ${CAPS.max.teach + CAPS.max.support}.`);
  }

  const report = {
    lesson_id: doc.lesson_id,
    lang,
    overlay_applied: applied,
    html: path.relative(REPO_ROOT, htmlPath),
    pdf: pdfPath ? path.relative(REPO_ROOT, pdfPath) : null,
    pdf_pages: result.pdfPages,
    pages_by_part: (probe && probe.pagesByPart) || null,
    max_pages: CAPS.max,
    warn_pages: CAPS.warn,
    has_raster_figure: !!hasRasterFigure,
    has_vector_figure: !!built.hasVectorFigure,
    page_breaks: result.breaks || null,
    furniture_px: result.furniture || null,
    cont_strip_px: result.furniture ? result.furniture.cont_strip_px : null,
    // MEASURED fill, not estimated. The operator's target is "no page under ~85% except the
    // last page of each part"; this is the number that says whether we hit it.
    page_fill_pct: probe && probe.pages
      ? probe.pages.map((p) => ({ id: p.id, fill: Math.round((100 * p.contentBottomPx) / p.footTopPx) }))
      : null,
    pdf_metadata: pdfMeta,
    fonts_embedded: fontReport.resolved,
    fonts_missing: fontReport.missing,
    probe,
    warnings,
    problems,
  };
  const reportPath = path.join(outDir, `${stem}.render.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  return { report, reportPath, problems, warnings, htmlPath, pdfPath,
           pagesByPart: byPart, probe, pdfPages: result.pdfPages };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.doc) {
    console.error("usage: node render_lp.js <lp_doc.json> [--out DIR] [--stem NAME] [--lang en|ur] [--png] [--no-pdf]");
    process.exit(2);
  }
  let out;
  try {
    out = await renderDoc(a);
  } catch (e) {
    if (e.code === "SCHEMA_INVALID" || e.code === "OVERLAY_INVALID") {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  const { report, problems, warnings, htmlPath, pdfPath, probe, pdfPages } = out;
  const byPart = out.pagesByPart || {};
  const doc = { lesson_id: report.lesson_id };
  const lang = report.lang;
  if (!a.quiet) {
    console.log(`${doc.lesson_id}  [${lang}]  ->  ${path.relative(process.cwd(), pdfPath || htmlPath)}`);
    if (probe) {
      for (const p of probe.pages) {
        const fill = Math.round((100 * p.contentBottomPx) / p.footTopPx);
        console.log(`  ${p.id}: content ${p.contentBottomPx}px / box ${p.footTopPx}px = ${fill}% full` +
          (p.overflowPx > 0 ? `  ** CLIPPED by ${p.overflowPx}px (${p.lastElement}) **` : "  ok"));
      }
      console.log(`  pages: teach ${byPart.teach || 0}/${report.max_pages.teach} \u00b7 support ${byPart.support || 0}/${report.max_pages.support}`);
      console.log(`  smallest body ${probe.minBodyFontPx}px (floor ${BODY_FLOOR_PX}) · smallest chip ${probe.minChipFontPx}px (floor ${CHIP_FLOOR_PX}) · PDF pages: ${pdfPages}`);
    }
    for (const w of warnings) console.log(`  ! ${w}`);
  }
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(problems.length ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.stack || String(e));
    process.exit(1);
  });
}

// Exported for test/run_tests.js — the packer is the new core logic and needs its own cover.
// `renderDoc` and `chromeChannel` are vendor additions (see SYNC.md).
module.exports = { renderDoc, chromeChannel, computeBreaks, packAtoms,
  MAX_PAGES, WARN_PAGES, MAX_PAGES_UR, WARN_PAGES_UR, pageCapsFor,
  BODY_FLOOR_PX, CHIP_FLOOR_PX };
