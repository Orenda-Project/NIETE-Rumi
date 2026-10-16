/**
 * v10 coaching test (bd-v0toag.8, PR3) — where a step's heading sits in a lesson plan PDF, so the viewer can
 * take her to the step her thing to try belongs to and outline the heading.
 *
 * Read from the PDF's own text (pdf.js getTextContent): one line = the pieces at one height, left to right,
 * letters only, lowercase ("I  Opening (5 min)" → "iopeningmin"; the leading letter is the plan's step icon).
 * Steps are the report card's five (bot report-card STEPS): 1 Opening, 2 Explanation, 3 We Do, 4 You Do,
 * 5 Check. Each is searched for after the one before it, so a bare "Check" inside the Explanation is never
 * taken for the Check step. Checked on every local render, 14 Oct: all five found, in order, on 334/334 v9
 * plans (English, Maths, Urdu, Science) and 1,084/1,084 v10 cards. Not found is null: nothing is marked.
 * Pure apart from reading the document it is given.
 *
 * bd-v0toag.78 — the whole step as well (findStepSpan): from its start to the next step's start, on every page it
 * runs onto, above the footer, so the viewer can mark the short box and the full script under the heading. Urdu
 * step bars are in Urdu script, which pdf.js cannot read; each carries its icon letter on its own line (I, D, A, A,
 * C), so an Urdu step starts at that letter above its box, and a plan with no step names at all is read from the
 * letters alone. A step running onto a page repeats its bar a little higher than a new step's bar.
 */

export type PlanLine = { page: number; y: number; height: number; text: string };
/** One page's piece of a step, as fractions of the page's height from the top. */
export type StepBand = { page: number; top: number; bottom: number };
/** A step's heading band on its page (fractions of the page's height from the top), and the whole step's bands. */
export type StepMark = { page: number; top: number; height: number; bands: StepBand[] };

type TextItem = { str?: string; transform?: number[]; height?: number };
type PageLike = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{ items: unknown[] }>;
};
export type TextDocLike = { numPages: number; getPage: (n: number) => Promise<PageLike> };

const HEADINGS: Record<number, RegExp> = {
  1: /^[a-z]?opening(min)?[a-z]?$/,
  2: /^[a-z]?explanation(min)?(ido)?[a-z]?$/,
  3: /^[a-z]?wedo(min|classpractisestogether)?[a-z]?$/,
  4: /^[a-z]?youdo(min|pupilsworkalone|inthebook)?[a-z]?$/,
  5: /^[a-z]?check(min|exitticket)?[a-z]?$/,
};

/** Each step's icon letter, on its bar. */
const ICON: Record<number, string> = { 1: 'i', 2: 'd', 3: 'a', 4: 'a', 5: 'c' };
/** Where a page's text starts below the running header, and ends above the footer. */
const PAGE_TOP = 0.025;
const PAGE_FOOT = 0.955;
/** An Urdu bar letter this near the top of a page is a step running on (0.041), not a new step's bar (0.047). */
const RUNNING_ON = 0.044;
/** A piece of a step thinner than this (the sliver above a step starting at a page's top) is not marked. */
const SLIVER = 0.03;
/** After Check, the support pages. */
const SUPPORT = /^supportpagesfollow/;

const round = (v: number) => Math.round(v * 1000) / 1000;

/** One page's text as lines, top line first. */
export function planLines(page: number, items: unknown[]): PlanLine[] {
  const rows = new Map<number, { y: number; height: number; parts: Array<[number, string]> }>();
  for (const raw of items) {
    const it = raw as TextItem;
    if (typeof it?.str !== 'string' || !Array.isArray(it.transform)) continue;
    const y = Math.round(it.transform[5]);
    const row = rows.get(y) ?? { y, height: 0, parts: [] };
    row.height = Math.max(row.height, Number(it.height) || 0);
    row.parts.push([it.transform[4], it.str]);
    rows.set(y, row);
  }
  return [...rows.values()]
    .sort((a, b) => b.y - a.y)
    .map((r) => ({
      page,
      y: r.y,
      height: r.height,
      text: r.parts.sort((a, b) => a[0] - b[0]).map((p) => p[1]).join('').replace(/[^A-Za-z]/g, '').toLowerCase(),
    }))
    .filter((l) => l.text);
}

/** Where the step's heading line is, searching each step after the previous one's heading; else -1. */
function headingAt(lines: PlanLine[], step: number): number {
  if (!HEADINGS[step]) return -1;
  let from = 0;
  for (let s = 1; s <= step; s += 1) {
    const i = lines.findIndex((l, j) => j >= from && HEADINGS[s].test(l.text));
    if (s === step) return i;
    if (i >= 0) from = i + 1;
  }
  return -1;
}

/** The step's heading line, searching each step after the previous one's heading; else null. */
export function findStepHeading(lines: PlanLine[], step: number): PlanLine | null {
  const i = headingAt(lines, step);
  return i >= 0 ? lines[i] : null;
}

/**
 * Where the step starts: its bar's icon letter, when that sits above the heading found (an Urdu box label), within a
 * page; else the heading. A heading with its minutes is the bar itself.
 */
function startAt(lines: PlanLine[], top: (l: PlanLine) => number, step: number): number {
  const i = headingAt(lines, step);
  if (i < 0 || lines[i].text.endsWith('min')) return i;
  const floor = step > 1 ? headingAt(lines, step - 1) : -1;
  for (let j = i - 1; j > floor && lines[j].page >= lines[i].page - 1; j -= 1) {
    if (lines[j].text === ICON[step] && top(lines[j]) > RUNNING_ON) return j;
  }
  return i;
}

/** Plans with no step names at all (Urdu renders of September): the bars' letters, I D A A C in order, skipping running-on bars. */
function barsAt(lines: PlanLine[], top: (l: PlanLine) => number): number[] {
  const bars: number[] = [];
  lines.forEach((l, j) => {
    if (bars.length < 5 && l.text === ICON[bars.length + 1] && top(l) > RUNNING_ON) bars.push(j);
  });
  return bars;
}

/** The step from its start to the next step's start (Check: to the support pages), page by page; else null. */
export function findStepSpan(lines: PlanLine[], heights: Record<number, number>, step: number): { start: PlanLine; bands: StepBand[] } | null {
  const top = (l: PlanLine) => round((heights[l.page] - l.y - l.height) / heights[l.page]);
  if (!HEADINGS[step]) return null;
  const named = lines.some((l) => Object.values(HEADINGS).some((h) => h.test(l.text)));
  const bars = named ? [] : barsAt(lines, top);
  const startOf = (n: number) => (named ? startAt(lines, top, n) : bars[n - 1] ?? -1);
  const s = startOf(step);
  if (s < 0) return null;
  const e = step < 5 ? startOf(step + 1) : lines.findIndex((l, j) => j > s && SUPPORT.test(l.text));
  const start = lines[s];
  const end = e > s ? lines[e] : null;
  const last = end ? end.page : start.page;
  const bands: StepBand[] = [];
  for (let page = start.page; page <= last; page += 1) {
    const band = { page, top: page === start.page ? top(start) : PAGE_TOP, bottom: end && page === end.page ? top(end) : PAGE_FOOT };
    if (band.bottom - band.top > SLIVER) bands.push(band);
  }
  return { start, bands };
}

/** Where the step's heading is in the document, else null. Never throws. */
export async function locateStep(doc: TextDocLike, step: number): Promise<StepMark | null> {
  if (!HEADINGS[step]) return null;
  try {
    const lines: PlanLine[] = [];
    const heights: Record<number, number> = {};
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      heights[n] = page.getViewport({ scale: 1 }).height;
      lines.push(...planLines(n, (await page.getTextContent()).items));
    }
    const span = findStepSpan(lines, heights, step);
    if (!span || !(heights[span.start.page] > 0)) return null;
    const { start, bands } = span;
    const h = heights[start.page];
    const r4 = (v: number) => Math.round(v * 10000) / 10000;
    return { page: start.page, top: r4((h - start.y - start.height) / h), height: r4(start.height / h), bands };
  } catch {
    return null;
  }
}
