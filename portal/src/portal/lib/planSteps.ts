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
 */

export type PlanLine = { page: number; y: number; height: number; text: string };
/** A step heading's band on its page, as fractions of the page's height from the top. */
export type StepMark = { page: number; top: number; height: number };

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

/** The step's heading line, searching each step after the previous one's heading; else null. */
export function findStepHeading(lines: PlanLine[], step: number): PlanLine | null {
  if (!HEADINGS[step]) return null;
  let from = 0;
  for (let s = 1; s <= step; s += 1) {
    const i = lines.findIndex((l, j) => j >= from && HEADINGS[s].test(l.text));
    if (s === step) return i >= 0 ? lines[i] : null;
    if (i >= 0) from = i + 1;
  }
  return null;
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
    const hit = findStepHeading(lines, step);
    if (!hit || !(heights[hit.page] > 0)) return null;
    const h = heights[hit.page];
    const round = (v: number) => Math.round(v * 10000) / 10000;
    return { page: hit.page, top: round((h - hit.y - hit.height) / h), height: round(hit.height / h) };
  } catch {
    return null;
  }
}
